import { timingSafeEqual } from "node:crypto";
import { validProductionWorkbookPayload } from "./productionWorkbookDelivery";
export const productionReportPath = "/api/analytics/reports/production";
const project = "xnfjdbpjuaezxjgargto";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const empty = (status: number) => new Response(null, { status, headers });
const storeMetrics = ["gross_merchandise_sales_usd","discounts_usd","refunds_usd","net_merchandise_sales_usd",
  "shipping_net_usd","tax_net_usd","duty_net_usd","other_sales_adjustments_usd","total_sales_usd",
  "eligible_orders","purchase_merchandise_net_usd","aov_usd","collected_cash_usd","new_customers","spend_usd","ncac_usd","mer"];
const productMetrics = ["units","gross_merchandise_sales_usd","discounts_usd","refunds_usd","net_merchandise_sales_usd"];
const withheld = new Set(["collected_cash_usd","new_customers","spend_usd","ncac_usd","mer"]);
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).sort().join(",") === [...expected].sort().join(",");
function validRow(v: unknown, product: boolean) {
  const metrics = product ? productMetrics : storeMetrics;
  if (!object(v) || !keys(v, ["report_date","definition_version","is_stale","report_scope","certified",
    "complete_window","readiness",...metrics,...(product ? ["sku_bucket"] : [])]) ||
    typeof v.report_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.report_date) ||
    !Number.isFinite(Date.parse(`${v.report_date}T00:00:00Z`)) ||
    new Date(`${v.report_date}T00:00:00Z`).toISOString().slice(0,10) !== v.report_date ||
    typeof v.definition_version !== "string" || !/^[A-Za-z0-9_-]{1,100}$/.test(v.definition_version) ||
    typeof v.is_stale !== "boolean" || v.report_scope !== "webhook_observed_only" ||
    v.certified !== false || v.complete_window !== false ||
    !object(v.readiness) || !keys(v.readiness, metrics) ||
    (product && (typeof v.sku_bucket !== "string" || !v.sku_bucket.length || v.sku_bucket.length > 200))) return false;
  const readiness = v.readiness;
  return metrics.every(k => {
    if (withheld.has(k) || v[k] === null) return v[k] === null && readiness[k] === "withheld";
    return readiness[k] === "observed_unverified" && typeof v[k] === "string" &&
      (k === "eligible_orders" ? /^\d{1,14}$/.test(v[k] as string) : /^-?\d{1,14}\.\d{6}$/.test(v[k] as string));
  });
}
export function validProductionReportPayload(data: unknown) {
  if (!object(data) || !keys(data, ["store_daily","product_daily"]) ||
    !Array.isArray(data.store_daily) || data.store_daily.length > 366 ||
    !Array.isArray(data.product_daily) || data.product_daily.length > 10000 ||
    !data.store_daily.every(r => validRow(r,false)) || !data.product_daily.every(r => validRow(r,true))) return false;
  const dates = new Set(data.store_daily.map(r => `${r.report_date}|${r.definition_version}`));
  return dates.size === data.store_daily.length &&
    data.product_daily.every(r => dates.has(`${r.report_date}|${r.definition_version}`)) &&
    new Set(data.product_daily.map(r => JSON.stringify([r.report_date,r.definition_version,r.sku_bucket]))).size ===
      data.product_daily.length;
}
/** One fixed aggregate GET. No caller-controlled SQL, scope, date or source reads. */
export async function productionReportGet(req: Request, env: Record<string,string|undefined> = process.env,
  transport: typeof fetch = fetch) {
  if (env.LEAN_PRODUCTION_REPORTS_ENABLED !== "true" || env.VERCEL_ENV !== "production" ||
    env.VERCEL_GIT_COMMIT_REF !== "main") return empty(404);
  if (req.method !== "GET") return empty(405);
  // Switching the fixed contract requires a separate server opt-in and bearer.
  // The default remains SQL050's original two-resource observed-only contract.
  const mode = env.LEAN_PRODUCTION_REPORTS_MODE ?? "observed";
  if (mode !== "observed" && mode !== "workbook") return empty(503);
  const workbook = mode === "workbook";
  if (workbook && env.LEAN_PRODUCTION_WORKBOOK_REPORTS_ENABLED !== "true") return empty(404);
  const secret = (workbook ? env.LEAN_PRODUCTION_WORKBOOK_REPORTS_SECRET : env.LEAN_PRODUCTION_REPORTS_SECRET) ?? "";
  if (workbook && secret === env.LEAN_PRODUCTION_REPORTS_SECRET) return empty(503);
  if (secret.length < 32 || secret.length > 512) return empty(503);
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected,supplied)) return empty(401);
  const url = new URL(req.url);
  if (url.pathname !== productionReportPath || url.search || req.body !== null ||
    req.headers.has("transfer-encoding") ||
    (req.headers.has("content-length") && req.headers.get("content-length") !== "0")) return empty(400);
  const key = env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY;
  if (env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== project ||
    env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${project}.supabase.co` || !key?.trim()) return empty(503);
  try {
    const rpc = workbook ? "lean_production_workbook_reports_read" : "lean_production_reports_read";
    const response = await transport(`https://${project}.supabase.co/rest/v1/rpc/${rpc}`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` },
      body: workbook ? JSON.stringify({ p_project_ref: project }) : "{}",
    });
    if (!response.ok) return empty(503);
    const reader = response.body?.getReader(); if (!reader) return empty(503);
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.length;
        if (bytes > 4194304) { await reader.cancel(); throw new Error("report_response_budget"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!(workbook ? validProductionWorkbookPayload : validProductionReportPayload)(JSON.parse(text))) return empty(503);
    return new Response(text,{status:200,headers:{...headers,"Content-Type":"application/json"}});
  } catch { return empty(503); }
}
