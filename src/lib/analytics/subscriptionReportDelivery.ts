import { timingSafeEqual } from "node:crypto";
export const subscriptionReportPath = "/api/analytics/reports/subscriptions";
const project = "xnfjdbpjuaezxjgargto";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const empty = (status: number) => new Response(null, { status, headers });
const metrics = ["observed_active_contracts", "observed_distinct_subscribers",
  "observed_next_renewal_at", "observed_renewing_contracts_in_window"];
const object = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === "object" && !Array.isArray(v);
const exact = (v: Record<string, unknown>, fields: string[]) => Object.keys(v).sort().join(",") === [...fields].sort().join(",");
const count = (v: unknown, max = 1000) => typeof v === "number" && Number.isSafeInteger(v) && v >= 0 && v <= max;
const time = (v: unknown): v is string => typeof v === "string" &&
  /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?(?:Z|[+-]\d{2}:\d{2})$/.test(v) && Number.isFinite(Date.parse(v));
export function validSubscriptionReportPayload(data: unknown) {
  if (!object(data) || !exact(data, ["subscription_observations"]) ||
      !Array.isArray(data.subscription_observations) || data.subscription_observations.length > 7) return false;
  const cycles = new Set<unknown>();
  return data.subscription_observations.every((r: unknown) => {
    if (!object(r) || !exact(r, ["cycle", "capture_started_at", "capture_finished_at", "renewal_until_exclusive",
      "scan_traversal", "pagination_ended", "completed_pages", "raw_rows_captured", "observed_unique_contracts",
      "revision_conflict", "report_scope", "scope_complete", "snapshot_consistency", "certified", "readiness", ...metrics]) ||
      !count(r.cycle, 7) || Number(r.cycle) < 1 || cycles.has(r.cycle) ||
      !time(r.capture_started_at) || !time(r.capture_finished_at) ||
      Date.parse(r.capture_finished_at) < Date.parse(r.capture_started_at) ||
      Date.parse(r.capture_finished_at) - Date.parse(r.capture_started_at) > 7 * 86400000 ||
      r.renewal_until_exclusive !== null && (!time(r.renewal_until_exclusive) ||
        Date.parse(r.renewal_until_exclusive) <= Date.parse(r.capture_finished_at) ||
        Date.parse(r.renewal_until_exclusive) > Date.parse(r.capture_finished_at) + 90 * 86400000) ||
      !["all_returned_pages_traversed", "budget_limited", "partial"].includes(String(r.scan_traversal)) ||
      r.pagination_ended !== (r.scan_traversal === "all_returned_pages_traversed") ||
      !count(r.completed_pages, 20) || Number(r.completed_pages) < 1 ||
      !count(r.raw_rows_captured) || !count(r.observed_unique_contracts) ||
      Number(r.observed_unique_contracts) > Number(r.raw_rows_captured) ||
      typeof r.revision_conflict !== "boolean" || r.report_scope !== "captured_pages_only" ||
      r.scope_complete !== false || r.snapshot_consistency !== "unverified" || r.certified !== false ||
      !object(r.readiness) || !exact(r.readiness, metrics)) return false;
    cycles.add(r.cycle);
    const readiness = r.readiness;
    return metrics.every(k => {
      if (readiness[k] === "withheld") return r[k] === null;
      if (readiness[k] !== "observed_unverified" || r.revision_conflict) return false;
      if (k !== "observed_active_contracts" &&
          (readiness.observed_active_contracts !== "observed_unverified" || !count(r.observed_active_contracts))) return false;
      if (k === "observed_next_renewal_at") return r[k] === null ? r.observed_active_contracts === 0 :
        time(r[k]) && Date.parse(r[k]) >= Date.parse(r.capture_finished_at as string);
      return count(r[k]) && Number(r[k]) <= Number(k === "observed_active_contracts" ?
        r.observed_unique_contracts : r.observed_active_contracts);
    });
  });
}
/** Fixed aggregate-only GET; independent opt-in, bearer and DB gate. No Loop call. */
export async function subscriptionReportGet(req: Request, env: Record<string, string | undefined> = process.env,
  transport: typeof fetch = fetch) {
  if (typeof window !== "undefined") return empty(404);
  if (env.LEAN_SUBSCRIPTION_REPORTS_ENABLED !== "true" || env.VERCEL_ENV !== "production" ||
      env.VERCEL_GIT_COMMIT_REF !== "main") return empty(404);
  if (req.method !== "GET") return empty(405);
  const secret = env.LEAN_SUBSCRIPTION_REPORTS_SECRET ?? "";
  if (secret.length < 32 || secret.length > 512) return empty(503);
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return empty(401);
  const url = new URL(req.url);
  if (url.pathname !== subscriptionReportPath || url.search || req.body !== null ||
      req.headers.has("transfer-encoding") || req.headers.has("content-length") && req.headers.get("content-length") !== "0")
    return empty(400);
  const key = env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY;
  if (env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== project ||
      env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${project}.supabase.co` || !key?.trim()) return empty(503);
  try {
    const response = await transport(`https://${project}.supabase.co/rest/v1/rpc/lean_subscription_reports_read`, {
      method: "POST", redirect: "error", cache: "no-store",
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(15000)]),
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` }, body: "{}",
    });
    if (!response.ok || response.redirected) { void response.body?.cancel().catch(() => {}); return empty(503); }
    const reader = response.body?.getReader(); if (!reader) return empty(503);
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.length;
        if (bytes > 65536) { await reader.cancel(); throw new Error(); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!validSubscriptionReportPayload(JSON.parse(text))) return empty(503);
    return new Response(text, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch { return empty(503); }
}
