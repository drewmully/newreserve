import { timingSafeEqual } from "node:crypto";
const project = "xeqlgxvrhgwwudyqtnun";
export const observedReportPath = "/api/analytics/reports/observed";
type Env = Record<string, string | undefined>;
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const empty = (status: number) => new Response(null, { status, headers });
const storeMetrics = ["gross_merchandise_sales_usd","discounts_usd","refunds_usd","net_merchandise_sales_usd",
  "shipping_net_usd","tax_net_usd","duty_net_usd","other_sales_adjustments_usd","total_sales_usd",
  "collected_cash_usd","eligible_orders","purchase_merchandise_net_usd","new_customers","spend_usd","ncac_usd","mer","aov_usd"];
const acquisitionMetrics = ["attributed_purchase_merchandise_net_usd","credited_orders","weighted_new_customers",
  "spend_usd","first_party_roas","ncac_usd"];
function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
function keys(value: Record<string, unknown>, names: string[]) {
  return Object.keys(value).sort().join(",") === [...names].sort().join(",");
}
function row(value: unknown, acquisition: boolean) {
  const metrics = acquisition ? acquisitionMetrics : storeMetrics;
  if (!object(value) || !keys(value, ["report_date","definition_version","is_stale","readiness",...metrics,
    ...(acquisition ? ["channel","campaign_bucket","model_version"] : [])]) ||
    value.definition_version !== "history-bridge-v1" || value.is_stale !== true ||
    typeof value.report_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value.report_date) ||
    !object(value.readiness) || !keys(value.readiness, metrics) ||
    typeof value.spend_usd !== "string" || !/^\d{1,14}\.\d{6}$/.test(value.spend_usd)) return false;
  const readiness = value.readiness;
  if (metrics.some(k => k === "spend_usd" ? readiness[k] !== "observed_unverified" :
    readiness[k] !== "withheld" || value[k] !== null)) return false;
  return !acquisition || (value.channel === "google_ads" && value.model_version === "commerce-only" &&
    typeof value.campaign_bucket === "string" && /^([a-f0-9]{64}|spend_unallocated)$/.test(value.campaign_bucket));
}

/** One fixed aggregate read, no provider transport, input-selected scope or DB credentials in output. */
export async function observedReportGet(req: Request, env: Env = process.env, transport: typeof fetch = fetch) {
  if (env.LEAN_OBSERVED_REPORTS_ENABLED !== "true" || env.VERCEL_ENV !== "preview" ||
    env.VERCEL_GIT_COMMIT_REF !== "review/analytics-initial-validation") return empty(404);
  if (req.method !== "GET") return empty(405);
  const secret = env.LEAN_OBSERVED_REPORTS_SECRET ?? "";
  if (secret.length < 32 || secret.length > 512) return empty(503);
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return empty(401);
  const url = new URL(req.url);
  if (url.pathname !== observedReportPath || url.search || req.body !== null ||
    req.headers.has("transfer-encoding") ||
    (req.headers.has("content-length") && req.headers.get("content-length") !== "0")) return empty(400);
  const scope = env.LEAN_OBSERVED_REPORTS_SCOPE_ID ?? "", key = env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY;
  if (env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== project ||
    env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${project}.supabase.co` ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(scope) || !key?.trim()) return empty(503);
  try {
    const response = await transport(`https://${project}.supabase.co/rest/v1/rpc/lean_observed_reports_read`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: JSON.stringify({ p_scope_id: scope, p_project: project }),
    });
    if (!response.ok) return empty(503);
    const reader = response.body?.getReader(); if (!reader) return empty(503);
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.length;
        if (bytes > 1048576) { await reader.cancel(); throw new Error("observed response budget"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const text = Buffer.concat(chunks).toString("utf8"), data = JSON.parse(text);
    if (!object(data) || Object.keys(data).sort().join(",") !== "acquisition_daily,coverage,store_daily" ||
      !Array.isArray(data.store_daily) || data.store_daily.length < 1 || data.store_daily.length > 7 ||
      !Array.isArray(data.acquisition_daily) || data.acquisition_daily.length > 1000 ||
      !data.store_daily.every(r => row(r, false)) || !data.acquisition_daily.every(r => row(r, true)) ||
      !object(data.coverage) || !keys(data.coverage, ["status","scope","financial_coverage_complete",
        "all_account_spend_coverage_complete","certified","snapshots","unavailable_domains"]) ||
      data.coverage.status !== "observed_unverified" || data.coverage.certified !== false ||
      data.coverage.scope !== "selected_google_account_saved_snapshots" ||
      data.coverage.financial_coverage_complete !== false || data.coverage.all_account_spend_coverage_complete !== false ||
      JSON.stringify(data.coverage.unavailable_domains) !== '["product_daily","customer_cohorts","funnel_daily"]' ||
      !Array.isArray(data.coverage.snapshots) || data.coverage.snapshots.length !== data.store_daily.length ||
      !data.coverage.snapshots.every(s => object(s) && keys(s, ["report_date","completed_at"]) &&
        typeof s.report_date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s.report_date) &&
        typeof s.completed_at === "string" && /^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|\+00:00)$/.test(s.completed_at)))
      throw new Error("observed response shape");
    return new Response(text, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch { return empty(503); }
}
