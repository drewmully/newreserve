import { createHash } from "node:crypto";
import { reportDates } from "./commerceCandidate";
import { nyDate } from "./primitives";
import { sourceObject } from "./shopifySource";
import { normalizeSpendBase, type SpendBase } from "./spend";
import { advanceGoogleSpendPilot } from "./googleSpendPilot";
import type { AnalyticsRpcClient } from "./rpcStore";

/** No credentials, registration call, switch change or source request on import. */
export type FreshGoogleSpendManifest = {
  version: 1; projectRef: string; accountId: string; loginCustomerId: string | null;
  approvalRef: string; actorRef: string; revisionRef: string; credentialBindingRef: string;
  coverage: "whole_account_campaign_day"; sourceCurrency: string; sourceTimezone: string;
  preparedAt: string; expiresAt: string; freshnessCutoffAt: string;
  maxPages: number; maxRequestsPerDay: number; deadlineSeconds: number;
  days: { date: string; dueAt: string }[];
};
function exact(value: unknown, keys: string[]) {
  const row = sourceObject(value);
  if (Object.keys(row).length !== keys.length || keys.some(k => !Object.hasOwn(row, k)))
    throw new Error("fresh_spend_manifest_fields");
  return row;
}
function text(value: unknown, pattern?: RegExp): string {
  if (typeof value !== "string" || !value.trim() || value !== value.trim() ||
      value.length > 256 || /[\u0000-\u001f]/.test(value) || pattern && !pattern.test(value))
    throw new Error("fresh_spend_manifest_value");
  return value;
}
function integer(value: unknown, min: number, max: number): number {
  if (!Number.isSafeInteger(value) || Number(value) < min || Number(value) > max)
    throw new Error("fresh_spend_manifest_budget");
  return Number(value);
}
function instant(value: unknown): string {
  const s = text(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/);
  nyDate(s);
  return new Date(s).toISOString();
}
function localDate(at: string, timezone: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone,
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(at));
}

/** Compile an operator-supplied manifest for existing owner-only migration 038.
 * Stable IDs bind the full policy, including freshness and expected metadata.
 * The returned payload is PREPARED, not evidence of registration or approval.
 */
export function prepareFreshGoogleSpend(value: unknown) {
  const row = exact(value, ["version", "projectRef", "accountId", "loginCustomerId",
    "approvalRef", "actorRef", "revisionRef", "credentialBindingRef", "coverage",
    "sourceCurrency", "sourceTimezone", "preparedAt", "expiresAt", "freshnessCutoffAt",
    "maxPages", "maxRequestsPerDay", "deadlineSeconds", "days"]);
  if (row.version !== 1 || row.coverage !== "whole_account_campaign_day")
    throw new Error("fresh_spend_manifest_scope");
  const sourceTimezone = text(row.sourceTimezone);
  try { new Intl.DateTimeFormat("en", { timeZone: sourceTimezone }); }
  catch { throw new Error("fresh_spend_manifest_timezone"); }
  const manifest: FreshGoogleSpendManifest = {
    version: 1, projectRef: text(row.projectRef, /^[a-z]{20}$/),
    accountId: text(row.accountId, /^\d{10}$/),
    loginCustomerId: row.loginCustomerId === null ? null : text(row.loginCustomerId, /^\d{10}$/),
    approvalRef: text(row.approvalRef), actorRef: text(row.actorRef),
    revisionRef: text(row.revisionRef), credentialBindingRef: text(row.credentialBindingRef),
    coverage: "whole_account_campaign_day", sourceCurrency: text(row.sourceCurrency, /^[A-Z]{3}$/),
    sourceTimezone, preparedAt: instant(row.preparedAt), expiresAt: instant(row.expiresAt),
    freshnessCutoffAt: instant(row.freshnessCutoffAt),
    maxPages: integer(row.maxPages, 1, 5), maxRequestsPerDay: integer(row.maxRequestsPerDay, 3, 7),
    deadlineSeconds: integer(row.deadlineSeconds, 1, 90), days: [],
  };
  if (!Array.isArray(row.days) || row.days.length < 1 || row.days.length > 7 ||
      Date.parse(manifest.expiresAt) <= Date.parse(manifest.preparedAt) ||
      Date.parse(manifest.expiresAt) - Date.parse(manifest.preparedAt) > 14 * 86400000 ||
      manifest.freshnessCutoffAt < manifest.preparedAt ||
      manifest.freshnessCutoffAt >= manifest.expiresAt ||
      manifest.maxRequestsPerDay < 2 + manifest.maxPages)
    throw new Error("fresh_spend_manifest_bounds");
  for (const value of row.days) {
    const day = exact(value, ["date", "dueAt"]);
    const date = text(day.date), dueAt = instant(day.dueAt);
    reportDates(date, date);
    const previous = manifest.days.at(-1);
    // Mirror the reader's NY guard as well as the source-account local day.
    // Date conversion, not a fixed UTC offset, handles DST.
    if (dueAt < manifest.freshnessCutoffAt || dueAt >= manifest.expiresAt ||
        date >= localDate(dueAt, sourceTimezone) || date >= nyDate(dueAt) ||
        previous && (date <= previous.date || dueAt <= previous.dueAt))
      throw new Error("fresh_spend_manifest_day");
    manifest.days.push({ date, dueAt });
  }
  const manifestSha256 = createHash("sha256").update(JSON.stringify(manifest)).digest("hex");
  const pilotId = `fresh-google:${manifestSha256}`;
  const registration = {
    pilotId, projectRef: manifest.projectRef, accountId: manifest.accountId,
    loginCustomerId: manifest.loginCustomerId, maxPages: manifest.maxPages,
    expiresAt: manifest.expiresAt, approvalRef: manifest.approvalRef, actorRef: manifest.actorRef,
    days: manifest.days.map(day => ({ runId: `${pilotId}:${day.date}`, ...day })),
  };
  return { state: "prepared" as const, manifest, manifestSha256,
    registration: { rpc: "lean_spend_pilot_register" as const, args: { p_scope: registration } },
    bounds: { days: manifest.days.length, sourceRequests: manifest.days.length * manifest.maxRequestsPerDay,
      attemptsPerDay: 1, deadlineSecondsPerAdvance: manifest.deadlineSeconds },
    enabled: false as const, registered: false as const, publication: false as const };
}

type Prepared = ReturnType<typeof prepareFreshGoogleSpend>;
function verifyBase(base: SpendBase, prepared: Prepared, asOf: string) {
  const m = prepared.manifest, scope = prepared.registration.args.p_scope;
  const day = scope.days.find(d => d.runId === base.baseReportId);
  if (!day || base.provider !== "google_ads" || base.accountId !== m.accountId ||
      base.date !== day.date || base.sourceCurrency !== m.sourceCurrency ||
      base.sourceTimezone !== m.sourceTimezone ||
      base.evidenceRef !== `lean_private.spend_jobs/${day.runId}` ||
      instant(base.completedAt) > asOf || instant(base.completedAt) >= m.expiresAt ||
      base.rows.length > m.maxPages * 10000)
    throw new Error("fresh_spend_base_scope");
  return day;
}

/** Inspect retained bases only. Complete means reader evidence, not independent
 * account reconciliation, certification, sales compatibility or delivery.
 */
export function inspectFreshGoogleSpend(value: unknown, bases: SpendBase[], asOf: string) {
  const prepared = prepareFreshGoogleSpend(value), now = instant(asOf);
  const byRun = new Map<string, SpendBase>();
  for (const base of bases) {
    verifyBase(base, prepared, now);
    const old = byRun.get(base.baseReportId);
    // Fail closed for conflicting immutable evidence. Repeated identical input
    // is harmless, but does not authorize a second database registration.
    if (old && JSON.stringify(old) !== JSON.stringify(base))
      throw new Error("fresh_spend_conflicting_base");
    byRun.set(base.baseReportId, base);
  }
  return prepared.registration.args.p_scope.days.map(day => {
    const base = byRun.get(day.runId);
    let state: "missing" | "not_due" | "incomplete" | "stale" | "complete" | "complete_zero";
    if (!base) state = day.dueAt > now ? "not_due" : "missing";
    else if (!base.paginationComplete || (base.rows.length === 0) !== base.verifiedEmpty) state = "incomplete";
    else {
      normalizeSpendBase(base, base.baseReportId);
      state = now >= prepared.manifest.expiresAt ||
        instant(base.completedAt) < prepared.manifest.freshnessCutoffAt ||
        instant(base.completedAt) < day.dueAt ? "stale" : base.verifiedEmpty ? "complete_zero" : "complete";
    }
    const complete = state === "complete" || state === "complete_zero";
    return { runId: day.runId, date: day.date, state,
      sourceMicros: complete ? base!.rows.reduce((sum, r) => sum + BigInt(r.costMicros), BigInt(0)).toString() : null,
      usdEligible: complete && base!.sourceCurrency === "USD" && base!.sourceTimezone === "America/New_York",
      independentReconciliation: "unverified" as const, salesCompatibility: "unverified" as const,
      certification: "unverified" as const, delivery: "unverified" as const };
  });
}

/** Opt-in library connection only; no new route or scheduler. Migration 038 must
 * already be installed and this exact manifest registered/enabled by its owner.
 * Reject drift before source reads, and reject wrong metadata before base commit.
 */
export async function advanceFreshGoogleSpend(input: Omit<Parameters<typeof advanceGoogleSpendPilot>[0],
  "projectRef" | "pilotId" | "now" | "signal"> & {
    manifest: unknown; enabled?: boolean; signal?: AbortSignal;
  }) {
  if (input.enabled !== true) return { state: "disabled" };
  const prepared = prepareFreshGoogleSpend(input.manifest), m = prepared.manifest;
  const scope = prepared.registration.args.p_scope, now = new Date().toISOString();
  if (now < m.preparedAt) throw new Error("fresh_spend_not_started");
  if (now >= m.expiresAt) return { state: "expired" };
  const signal = AbortSignal.any([AbortSignal.timeout(Math.min(m.deadlineSeconds * 1000,
    Date.parse(m.expiresAt) - Date.parse(now))),
    ...(input.signal ? [input.signal] : [])]);
  let runId: string | undefined, requests = 0;
  const client: AnalyticsRpcClient = { async rpc(name, args) {
    signal.throwIfAborted();
    if (new Date().toISOString() >= m.expiresAt) throw new Error("fresh_spend_expired");
    if (name === "lean_spend_finish") {
      const base = args.p_base as SpendBase;
      if (args.p_run !== runId || base.baseReportId !== runId)
        throw new Error("fresh_spend_finish_scope");
      const rows = inspectFreshGoogleSpend(m, [base], new Date().toISOString());
      if (!rows.some(r => r.runId === runId && ["complete", "complete_zero"].includes(r.state)))
        throw new Error("fresh_spend_finish_evidence");
    }
    const result = await input.client.rpc(name, args);
    if (result.error) return result;
    if (name !== "lean_spend_pilot_next" && name !== "lean_spend_claim") return result;
    const data = sourceObject(result.data);
    if (name === "lean_spend_pilot_next" && data.state === "ready") {
      const day = scope.days.find(d => d.runId === data.runId);
      if (!day || data.accountId !== m.accountId || day.dueAt > now)
        throw new Error("fresh_spend_next_scope");
      runId = day.runId;
    }
    if (name === "lean_spend_claim" && data.state === "claimed") {
      const day = scope.days.find(d => d.runId === args.p_run);
      if (!day || args.p_run !== runId || data.accountId !== m.accountId ||
          data.loginCustomerId !== m.loginCustomerId || data.date !== day.date ||
          data.maxPages !== m.maxPages || data.approvalRef !== m.approvalRef)
        throw new Error("fresh_spend_claim_scope");
    }
    return result;
  } };
  return advanceGoogleSpendPilot({ ...input, client, projectRef: m.projectRef,
    pilotId: scope.pilotId, now, signal, fetcher: async (url, init) => {
      signal.throwIfAborted();
      if (new Date().toISOString() >= m.expiresAt) throw new Error("fresh_spend_expired");
      if (++requests > m.maxRequestsPerDay) throw new Error("fresh_spend_request_budget");
      return (input.fetcher ?? fetch)(url, init);
    } });
}
