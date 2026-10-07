import { createHash } from "node:crypto";
import { captureGoogleIndependentControls } from "./googleSpendCheck";
import { authorizeGoogleSpend, GOOGLE_ACCOUNT_QUERY, readGoogleSpend, type GoogleSpendAuth } from "./googleSpendSource";
import { prepareFreshGoogleSpend, type FreshGoogleSpendManifest } from "./googleSpendRegistration";
import { prepareGoogleDeliveryReport } from "./googleDeliveryReport";
import { sourceObject } from "./shopifySource";

export const googleAutomaticDigest = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
export type GoogleCaptureClaim = {
  state: "capture"; cycleId: string; grantId: string; revision: string;
  projectRef: string; shop: string; accountId: string; loginCustomerId: string;
  date: string; startedAt: string; deadline: string; expiresAt: string;
  maxPages: number; maxRequests: number; maxBytes: number; sourceDeadlineSeconds: number;
  approvalRef: string; actorRef: string; credentialBindingRef: string; credentialSha256: string;
};

/** Native credentials stay in the application. Only aggregate campaign evidence
 * reaches the restricted application commit. No database or connector calls. */
export async function captureGoogleAutomatic(claim: GoogleCaptureClaim, auth: GoogleSpendAuth,
  developerToken: string, request: typeof fetch = fetch, signal?: AbortSignal) {
  const c = sourceObject(claim);
  if (c.state !== "capture" || c.projectRef !== "xnfjdbpjuaezxjgargto" ||
    c.shop !== "mullybox-store.myshopify.com" || !/^[a-f0-9-]{36}$/.test(claim.cycleId) ||
    !/^\d{10}$/.test(claim.accountId) || !/^\d{10}$/.test(claim.loginCustomerId) ||
    !Number.isInteger(claim.maxPages) || claim.maxPages < 1 || claim.maxPages > 5 ||
    !Number.isInteger(claim.maxRequests) || claim.maxRequests < 5 + 2 * claim.maxPages || claim.maxRequests > 20 ||
    !Number.isInteger(claim.maxBytes) || claim.maxBytes < 1 || claim.maxBytes > 16 * 1024 * 1024 ||
    !Number.isFinite(Date.parse(claim.deadline)) || Date.parse(claim.deadline) <= Date.now() ||
    Date.parse(claim.deadline) - Date.now() > 180000 ||
    auth.mode !== "service_account" || !/^[a-f0-9]{64}$/.test(claim.credentialSha256) ||
    googleAutomaticDigest({ auth, developerToken }) !== claim.credentialSha256)
    throw new Error("google_automatic_capture_binding");
  const active = AbortSignal.any([AbortSignal.timeout(Math.max(1, Date.parse(claim.deadline) - Date.now())),
    ...(signal ? [signal] : [])]);
  let requests = 0, bytes = 0;
  const accountMetadata: { accountId: string; currency: string; timezone: string;
    startedAt: string; finishedAt: string; responseSha256: string }[] = [];
  const fetcher: typeof fetch = async (url, init) => {
    active.throwIfAborted();
    const u = new URL(String(url));
    if (u.protocol !== "https:" || u.username || u.password || u.search || u.hash ||
      !(u.href === "https://oauth2.googleapis.com/token" ||
        u.href === `https://googleads.googleapis.com/v25/customers/${claim.accountId}/googleAds:search`) ||
      init?.method !== "POST" || ++requests > claim.maxRequests) throw new Error("google_automatic_request_scope");
    const startedAt = new Date().toISOString();
    const response = await request(url, { ...init, redirect: "error",
      signal: AbortSignal.any([active, ...(init.signal ? [init.signal] : [])]) });
    const reader = response.body?.getReader(); if (!reader) throw new Error("google_automatic_empty_response");
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        active.throwIfAborted(); const part = await reader.read(); active.throwIfAborted();
        if (part.done) break;
        bytes += part.value.length;
        if (bytes > claim.maxBytes) throw new Error("google_automatic_byte_budget");
        chunks.push(part.value);
      }
    } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
    const body = Buffer.concat(chunks);
    if (u.hostname === "googleads.googleapis.com" &&
      JSON.parse(String(init.body)).query === GOOGLE_ACCOUNT_QUERY) {
      const metadata = sourceObject(JSON.parse(body.toString("utf8")));
      const rows = metadata.results;
      const account = Array.isArray(rows) && rows.length === 1 ? sourceObject(sourceObject(rows[0]).customer) : {};
      if (metadata.error || metadata.nextPageToken || account.id !== claim.accountId ||
        account.currencyCode !== "USD" || account.timeZone !== "America/New_York")
        throw new Error("google_automatic_metadata_before_aggregate");
      accountMetadata.push({ accountId: claim.accountId, currency: "USD", timezone: "America/New_York",
        startedAt, finishedAt: new Date().toISOString(), responseSha256: createHash("sha256").update(body).digest("hex") });
    }
    return new Response(body, { status: response.status, headers: response.headers });
  };
  // B/C are independently fetched before candidate A, not derived from it.
  const independent = await captureGoogleIndependentControls({ auth, developerToken, fetcher, signal: active,
    scope: { accountId: claim.accountId, loginCustomerId: claim.loginCustomerId,
      fromDate: claim.date, throughDate: claim.date, maxPages: claim.maxPages,
      maxRequests: 3 + claim.maxPages, deadlineSeconds: claim.sourceDeadlineSeconds,
      approvalRef: claim.approvalRef, actorRef: claim.actorRef, includeDeliveryMetrics: true } });
  const manifest: FreshGoogleSpendManifest = {
    version: 1, projectRef: claim.projectRef, accountId: claim.accountId, loginCustomerId: claim.loginCustomerId,
    approvalRef: claim.approvalRef, actorRef: claim.actorRef, revisionRef: `auto:${claim.cycleId}`,
    credentialBindingRef: claim.credentialBindingRef, coverage: "whole_account_campaign_day",
    sourceCurrency: "USD", sourceTimezone: "America/New_York", preparedAt: claim.startedAt,
    expiresAt: claim.expiresAt, freshnessCutoffAt: claim.startedAt,
    maxPages: claim.maxPages, maxRequestsPerDay: 2 + claim.maxPages,
    deadlineSeconds: claim.sourceDeadlineSeconds, days: [{ date: claim.date, dueAt: claim.startedAt }],
  };
  const prepared = prepareFreshGoogleSpend(manifest), id = prepared.registration.args.p_scope.days[0].runId;
  const nativeStartedAt = new Date().toISOString();
  const accessToken = await authorizeGoogleSpend({ auth, developerToken, fetcher, signal: active });
  const base = await readGoogleSpend({ accountId: claim.accountId, loginCustomerId: claim.loginCustomerId,
    date: claim.date, maxPages: claim.maxPages, approvalRef: claim.approvalRef, accessToken, developerToken,
    fetcher, signal: active, now: nativeStartedAt, baseReportId: id, evidenceRef: `lean_private.spend_jobs/${id}` });
  const asOf = new Date().toISOString();
  base.completedAt = asOf; // Observed completion, never a caller-supplied timestamp.
  const controlHash = googleAutomaticDigest(independent);
  const costControl = { provider: "google_ads", accountId: claim.accountId, date: claim.date,
    sourceCurrency: independent.currency, sourceTimezone: independent.timezone, capturedAt: independent.completedAt,
    evidenceRef: `google-auto-control:${controlHash}:cost`, independentlyExtracted: true, complete: true,
    verifiedEmpty: false, totalCostMicros: independent.totalCostMicros,
    campaigns: independent.campaigns.map(({ id, costMicros }) => ({ id, costMicros })) };
  const delivery = { version: 1 as const, accountId: claim.accountId, date: claim.date,
    definitionVersion: "google-account-daily-v1" as const, approvalRef: claim.approvalRef,
    control: { evidenceRef: `google-auto-control:${controlHash}:counts`, capturedAt: independent.completedAt,
      independentlyExtracted: true, complete: true, clickDefinition: "google_ads.metrics.clicks" as const,
      clicks: independent.clicks, impressions: independent.impressions,
      campaigns: independent.campaigns.map(({ id, clicks, impressions }) => ({ id, clicks, impressions })) } };
  const report = prepareGoogleDeliveryReport({ binding: delivery, fresh: { manifest, bases: [base],
    controls: [costControl], marketingInventory: { shop: claim.shop, dates: [claim.date],
      accounts: [{ provider: "google_ads", accountId: claim.accountId }], complete: false, independentlyExtracted: false,
      evidenceRef: `google-auto:${claim.cycleId}`, approvalRef: claim.approvalRef, capturedAt: asOf,
      salesScope: "unverified", salesCoverageRef: null, customerScope: "unverified", customerCoverageRef: null } },
    projectRef: claim.projectRef, publication: `full:auto_${claim.cycleId}`, shop: claim.shop,
    fromDate: claim.date, throughDate: claim.date, asOf });
  if ([report.spend_usd, report.clicks, report.impressions].some(value => value === null))
    throw new Error("google_automatic_independent_mismatch");
  active.throwIfAborted();
  return { manifest, spendRegistration: prepared.registration.args.p_scope, base, costControl, delivery, asOf,
    receipt: { transport: "native_google_ads", credentialBindingRef: claim.credentialBindingRef,
      accountMetadata,
      controlHash, nativeHash: googleAutomaticDigest(base), controlStartedAt: independent.startedAt,
      controlCompletedAt: independent.completedAt, nativeStartedAt, nativeCompletedAt: asOf, requests, bytes } };
}
