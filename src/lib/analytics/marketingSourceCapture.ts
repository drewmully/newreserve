import { createHash } from "node:crypto";
import { captureMetaSourceReceipts } from "./metaSourceIngestion";
import { metaHourlyPacketFromCaptures } from "./metaHourlySpendInput";
import { captureGoogleSourceControls } from "./googleSpendCheck";
import { googleAutomaticSetupCredentials } from "./googleAutomaticRuntime";
import { authorizeGoogleSpend, readGoogleSpend } from "./googleSpendSource";
import { prepareFreshGoogleSpend } from "./googleSpendRegistration";
import { prepareApplicationGoogleReport, savedMarketingProject, savedMarketingShop } from "./savedMarketingReport";
import { prepareMetaSpendDay } from "./metaSpendInput";
import { nyDate, type Row } from "./primitives";

export type MarketingProvider = "google_ads" | "meta_ads";
export type MarketingClaim = {
  state: "claimed"; jobId: string; token: string; provider: MarketingProvider;
  date: string; startedAt: string; deadline: string; attempt: number;
};
export type CaptureRuntime = { env: Record<string, string | undefined>; now(): number; request: typeof fetch };
export class MarketingSourceError extends Error {
  constructor(public category: string, public retryAfterSeconds = 0) { super(category); }
}
const fail = (category = "schema_changed"): never => { throw new MarketingSourceError(category); };
const object = (v: unknown): Row => {
  if (!v || typeof v !== "object" || Array.isArray(v)) return fail();
  return v as Row;
};
const iso = (n: number) => new Date(n).toISOString();
const hash = (b: Uint8Array) => createHash("sha256").update(b).digest("hex");
function retryAfter(value: string | null, now: number): number | "manual" | null {
  if (value === null) return null;
  const text = value.trim();
  // Never turn numeric overflow into an earlier fallback retry.
  if (text.length > 128) return "manual";
  if (/^\d+$/.test(text)) {
    const n = BigInt(text);
    return n > BigInt(86400) ? "manual" : Number(n);
  }
  const seconds = Math.ceil((Date.parse(text) - now) / 1000);
  if (!Number.isFinite(seconds)) return null;
  return seconds > 86400 ? "manual" : Math.max(0, seconds);
}
function providerThrottle(value: unknown, google: boolean, oauth: boolean): boolean {
  const row = (v: unknown): Row | null => v && typeof v === "object" && !Array.isArray(v) ? v as Row : null;
  const error = row(row(value)?.error);
  if (!error) return false;
  if (!google) return error.code === 4 || error.code === 17;
  if (oauth) return false;
  if (error.status === "RESOURCE_EXHAUSTED") return true;
  const quota = new Set(["RESOURCE_EXHAUSTED", "RESOURCE_TEMPORARILY_EXHAUSTED"]);
  return Array.isArray(error.details) && error.details.some(detail => {
    const errors = row(detail)?.errors;
    return Array.isArray(errors) && errors.some(item => quota.has(String(row(row(item)?.errorCode)?.quotaError)));
  });
}

function googleProjection(raw: unknown, query: string) {
  const b = object(raw);
  if (b.error || b.nextPageToken || b.results !== undefined && !Array.isArray(b.results)) return fail();
  const rows = (b.results ?? []) as unknown[];
  if (rows.length > 10000) return fail("incomplete_pages");
  return { fieldMask: b.fieldMask ?? null, results: rows.map(value => {
    const r = object(value);
    if (query.includes("customer.currency_code")) {
      const c = object(r.customer);
      return { customer: { id: c.id, currencyCode: c.currencyCode, timeZone: c.timeZone } };
    }
    const m = object(r.metrics), metrics = Object.fromEntries(["costMicros", "clicks", "impressions"]
      .filter(k => m[k] !== undefined).map(k => [k, m[k]]));
    return { segments: { date: object(r.segments).date }, metrics,
      ...(query.includes("FROM campaign") ? { campaign: { id: object(r.campaign).id } } : {}) };
  }) };
}

/** Fixed native destinations, no mutation endpoints, no credential receipts.
 * Captures one closed day. Source and registration errors never trigger HTTP retries. */
export async function captureMarketingSource(c: MarketingClaim, r: CaptureRuntime) {
  if (!/^[1-9]\d{0,18}$/.test(c.jobId) || c.date >= nyDate(iso(r.now())) ||
    !Number.isFinite(Date.parse(c.deadline)) || r.now() >= Date.parse(c.deadline)) return fail("scope_invalid");
  const start = r.now(), deadline = Math.min(Date.parse(c.deadline) - 5000,
    start + (c.provider === "google_ads" ? 60000 : 55000));
  let count = 0, bytes = 0;
  let observedError: MarketingSourceError | undefined;
  const googleReceipts: Row[] = [];
  const transport: typeof fetch = async (input, init) => {
    const url = new URL(String(input)), began = r.now();
    const google = c.provider === "google_ads", oauth = url.href === "https://oauth2.googleapis.com/token";
    if (google ? init?.method !== "POST" || ![ "https://oauth2.googleapis.com/token",
      "https://googleads.googleapis.com/v25/customers/4335795219/googleAds:search"].includes(url.href) :
      init?.method !== "GET" || url.origin !== "https://graph.facebook.com" ||
      !["/v25.0/act_2796962933960445", "/v25.0/act_2796962933960445/insights"].includes(url.pathname) ||
      url.searchParams.has("access_token")) return fail("scope_invalid");
    if (++count > (google ? 7 : 3)) return fail("incomplete_pages");
    const remaining = Math.min(15000, deadline - began);
    if (remaining <= 0) return fail("timeout");
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timed = new Promise<never>((_, reject) => {
      timer = setTimeout(() => { controller.abort(); reject(new MarketingSourceError("timeout")); }, remaining);
    });
    try {
      const response = await Promise.race([r.request(url.href, { ...init, redirect: "error",
        signal: controller.signal, cache: "no-store" }), timed]);
      if (!response.ok) {
        const delay = retryAfter(response.headers.get("retry-after"), r.now());
        if (delay === "manual") {
          void response.body?.cancel().catch(() => {});
          return fail("rate_limit_manual");
        }
        const reader = response.body?.getReader();
        let nativeError: unknown = null;
        if (reader) {
          const chunks: Uint8Array[] = []; let size = 0, complete = false;
          try {
            for (;;) {
              const part = await Promise.race([reader.read(), timed]);
              if (part.done) { complete = true; break; }
              size += part.value.length; bytes += part.value.length;
              if (bytes > 8388608 || size > (google ? 8388608 : 1000000))
                throw new MarketingSourceError("incomplete_pages", delay ?? 0);
              if (size > 16384) break; // No error-message/body retention.
              chunks.push(part.value);
            }
            if (complete) {
              try { nativeError = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { /* Unknown stays unmapped. */ }
            }
          } catch (e) {
            if (e instanceof MarketingSourceError && e.category !== "timeout") throw e;
            // An unreadable error body cannot shorten an already received
            // Retry-After. Retain header/status classification below.
          } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
        }
        const throttled = response.status === 429 || providerThrottle(nativeError, google, oauth);
        if (throttled) throw new MarketingSourceError("rate_limited", typeof delay === "number" ? delay : 3600);
        if ([401, 403].includes(response.status)) throw new MarketingSourceError("authentication_denied", delay ?? 0);
        throw new MarketingSourceError(response.status >= 500 ? "provider_unavailable" : "schema_changed",
          delay ?? 0);
      }
      const reader = response.body?.getReader(); if (!reader) return fail();
      const chunks: Uint8Array[] = []; let size = 0;
      try {
        for (;;) {
          const part = await Promise.race([reader.read(), timed]); if (part.done) break;
          size += part.value.length; bytes += part.value.length;
          if (size > (google ? 8388608 : 1000000) || bytes > 8388608) return fail("incomplete_pages");
          chunks.push(part.value);
        }
      } finally { void reader.cancel().catch(() => {}); reader.releaseLock(); }
      if (r.now() >= deadline) return fail("timeout");
      const body = Buffer.concat(chunks);
      if (google) {
        const query = oauth ? null : object(JSON.parse(String(init?.body))).query;
        if (!oauth && typeof query !== "string") return fail();
        googleReceipts.push({ method: "POST", url: url.href, query, startedAt: iso(began),
          finishedAt: iso(r.now()), status: 200, bodyBytes: body.length, bodySha256: hash(body),
          response: oauth ? null : googleProjection(JSON.parse(body.toString("utf8")), String(query)) });
      }
      return new Response(body, { status: response.status, headers: response.headers });
    } catch (e) {
      observedError = e instanceof MarketingSourceError ? e : new MarketingSourceError("provider_unavailable");
      throw observedError;
    } finally { if (timer) clearTimeout(timer); controller.abort(); }
  };
  try {
    const ref = `app-marketing-job:${c.jobId}`;
    if (c.provider === "meta_ads") {
      const token = (r.env.META_MARKETING_API_TOKEN ?? "").trim();
      if (!/^[!-~]{1,4096}$/.test(token) ||
        !["2796962933960445", "act_2796962933960445"].includes((r.env.META_AD_ACCOUNT_ID ?? "").trim()))
        return fail("configuration_missing");
      const receipts = await captureMetaSourceReceipts({ now: r.now, request: transport }, c.date, c.startedAt, token);
      const asOf = iso(r.now());
      const meta = metaHourlyPacketFromCaptures({ projectRef: savedMarketingProject, shop: savedMarketingShop,
        generationId: `meta_ingest_app_${c.jobId}`, accountId: "act_2796962933960445", date: c.date,
        approvalRef: "app-owned-marketing-v1", actorRef: ref, controlApprovalRef: `${ref}:control`,
        freshnessCutoffAt: c.startedAt, asOf, ...receipts });
      prepareMetaSpendDay(meta, { projectRef: savedMarketingProject, shop: savedMarketingShop,
        publication: ref, freshnessCutoffAt: c.startedAt, asOf });
      return { packet: { kind: "app_meta_v1", meta, asOf }, receipts };
    }
    let credentials: ReturnType<typeof googleAutomaticSetupCredentials>;
    try { credentials = googleAutomaticSetupCredentials(r.env); } catch { return fail("configuration_missing"); }
    const { auth, developerToken } = credentials;
    const active = AbortSignal.timeout(Math.max(1, deadline - r.now()));
    const control = await captureGoogleSourceControls({ auth, developerToken, fetcher: transport, signal: active,
      scope: { accountId: "4335795219", loginCustomerId: "9552995078", fromDate: c.date, throughDate: c.date,
        maxPages: 1, maxRequests: 4, deadlineSeconds: 60, approvalRef: "app-owned-marketing-v1",
        actorRef: ref, includeDeliveryMetrics: true } });
    const manifest = { version: 1 as const, projectRef: savedMarketingProject, accountId: "4335795219",
      loginCustomerId: "9552995078", approvalRef: "app-owned-marketing-v1", actorRef: ref,
      revisionRef: ref, credentialBindingRef: "application-generic-google-service-account",
      coverage: "whole_account_campaign_day", sourceCurrency: "USD", sourceTimezone: "America/New_York",
      preparedAt: c.startedAt, expiresAt: c.deadline, freshnessCutoffAt: c.startedAt, maxPages: 1,
      maxRequestsPerDay: 3, deadlineSeconds: 60, days: [{ date: c.date, dueAt: c.startedAt }] };
    const registration = prepareFreshGoogleSpend(manifest);
    const runId = registration.registration.args.p_scope.days[0].runId;
    const accessToken = await authorizeGoogleSpend({ auth, developerToken, fetcher: transport, signal: active });
    const base = await readGoogleSpend({ accountId: "4335795219", loginCustomerId: "9552995078", date: c.date,
      maxPages: 1, approvalRef: "app-owned-marketing-v1", accessToken, developerToken, fetcher: transport,
      signal: active, now: iso(r.now()), baseReportId: runId, evidenceRef: `lean_private.spend_jobs/${runId}` });
    const asOf = iso(r.now()); base.completedAt = asOf;
    base.evidenceRef = `lean_private.marketing_source_jobs/${c.jobId}`;
    const costControl = { provider: "google_ads", accountId: "4335795219", date: c.date,
      sourceCurrency: control.currency, sourceTimezone: control.timezone, capturedAt: control.completedAt,
      evidenceRef: `${ref}:independent-cost`, independentlyExtracted: true, complete: true,
      verifiedEmpty: control.verifiedEmpty, totalCostMicros: control.totalCostMicros,
      campaigns: control.campaigns.map(({ id, costMicros }) => ({ id, costMicros })) };
    const delivery = { version: 1, accountId: "4335795219", date: c.date, approvalRef: "app-owned-marketing-v1",
      definitionVersion: "google-account-daily-v1", control: { evidenceRef: `${ref}:independent-counts`,
        capturedAt: control.completedAt, independentlyExtracted: true, complete: true,
        clickDefinition: "google_ads.metrics.clicks", clicks: control.clicks, impressions: control.impressions,
        campaigns: control.campaigns.map(({ id, clicks, impressions }) => ({ id, clicks, impressions })) } };
    const google = { kind: "app_google_v1", jobId: c.jobId, manifest, base, costControl, delivery, asOf };
    prepareApplicationGoogleReport(google, ref);
    if (count !== 7) return fail("scope_invalid");
    return { packet: { kind: "app_google_v1", google, asOf }, receipts: { requests: googleReceipts } };
  } catch (e) {
    if (observedError) throw observedError;
    if (e instanceof MarketingSourceError) throw e;
    const text = e instanceof Error ? e.message : "";
    throw new MarketingSourceError(text.includes("dst") || text.includes("open") ? "unsupported_window" :
      text.includes("mismatch") || text.includes("unverified") ? "control_mismatch" : "schema_changed");
  }
}
