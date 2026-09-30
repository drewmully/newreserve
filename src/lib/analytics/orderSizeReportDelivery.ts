import { timingSafeEqual } from "node:crypto";
import { ORDER_SIZES } from "./shopifyOrderSize";
export const orderSizeReportPath = "/api/analytics/reports/order-size";
const project = "xnfjdbpjuaezxjgargto";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const empty = (status: number) => new Response(null, { status, headers });
const object = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const keys = (v: Record<string, unknown>, expected: string[]) =>
  Object.keys(v).sort().join(",") === [...expected].sort().join(",");
function validRow(v: unknown) {
  if (!object(v) || !keys(v, ["purchase_date", "sku_bucket", "size_semantics", "size_status", "size_value",
    "unit_basis", "line_count", "quantity", "scope", "is_stale", "certification", "certified", "fulfillment_proven",
    "return_adjusted", "complete_history", "definition_version", "coverage_status"]) ||
    typeof v.purchase_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.purchase_date) ||
    !Number.isFinite(Date.parse(`${v.purchase_date}T00:00:00Z`)) ||
    new Date(`${v.purchase_date}T00:00:00Z`).toISOString().slice(0, 10) !== v.purchase_date ||
    typeof v.sku_bucket !== "string" || !v.sku_bucket.length || v.sku_bucket.length > 200 ||
    v.definition_version !== "order-size-report-v1" || v.coverage_status !== "selected_observed" ||
    v.scope !== "selected_observed_latest_heads" || v.is_stale !== true || v.certification !== "unverified" ||
    v.certified !== false || v.fulfillment_proven !== false || v.return_adjusted !== false || v.complete_history !== false ||
    typeof v.line_count !== "number" || !Number.isInteger(v.line_count) || v.line_count < 1 || v.line_count > 2147483647 ||
    typeof v.quantity !== "string" || !/^(0|[1-9]\d{0,13})\.\d{6}$/.test(v.quantity) || v.quantity === "0.000000") return false;
  // This fixed endpoint is approved for requested BOX top size only, not other shirt products.
  if (v.size_semantics === "not_collected")
    return v.size_status === "not_collected" && v.size_value === null && v.unit_basis === "unclassified_merchandise_units";
  if (v.size_semantics === "unsupported")
    return ["unsupported", "projection_absent"].includes(String(v.size_status)) &&
      v.size_value === null && v.unit_basis === "unclassified_merchandise_units";
  if (v.size_semantics !== "requested_box_top_size" || v.unit_basis !== "requested_box_units") return false;
  return v.size_status === "known" ? ORDER_SIZES.includes(v.size_value as typeof ORDER_SIZES[number]) :
    ["missing", "invalid", "conflict", "unsupported", "projection_absent"].includes(String(v.size_status)) && v.size_value === null;
}
export function validOrderSizeReportPayload(data: unknown) {
  if (!object(data) || !keys(data, ["coverage_status", "order_size_daily"]) || !Array.isArray(data.order_size_daily) ||
    data.order_size_daily.length > 10000) return false;
  if (data.coverage_status === "no_selected_orders") return data.order_size_daily.length === 0;
  if (data.coverage_status !== "selected_observed" || !data.order_size_daily.length || !data.order_size_daily.every(validRow)) return false;
  return new Set(data.order_size_daily.map(row => JSON.stringify([
    row.purchase_date, row.sku_bucket, row.size_semantics, row.size_status, row.size_value,
  ]))).size === data.order_size_daily.length;
}
/** Independent default-OFF GET; bearer reuse is an explicit activation proposal,
 * not a credential lookup. No selectors, provider calls, or financial endpoint changes.
 */
export async function orderSizeReportGet(req: Request, env: Record<string, string | undefined> = process.env,
  transport: typeof fetch = fetch) {
  if (env.LEAN_ORDER_SIZE_REPORTS_ENABLED !== "true" || env.VERCEL_ENV !== "production" ||
    env.VERCEL_GIT_COMMIT_REF !== "main") return empty(404);
  if (req.method !== "GET") return empty(405);
  const secret = env.LEAN_PRODUCTION_REPORTS_SECRET ?? "";
  if (secret.length < 32 || secret.length > 512) return empty(503);
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return empty(401);
  const url = new URL(req.url);
  if (url.pathname !== orderSizeReportPath || url.search || req.body !== null || req.headers.has("transfer-encoding") ||
    (req.headers.has("content-length") && req.headers.get("content-length") !== "0")) return empty(400);
  const key = env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY;
  if (env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== project ||
    env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${project}.supabase.co` || !key?.trim()) return empty(503);
  try {
    const response = await transport(`https://${project}.supabase.co/rest/v1/rpc/lean_order_size_reports_read`, {
      method: "POST", redirect: "error", signal: AbortSignal.timeout(15000),
      headers: { "Content-Type": "application/json", apikey: key, Authorization: `Bearer ${key}` }, body: "{}",
    });
    if (!response.ok) return empty(503);
    const reader = response.body?.getReader(); if (!reader) return empty(503);
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.length;
        if (bytes > 4194304) { await reader.cancel(); throw new Error("order_size_response_budget"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!validOrderSizeReportPayload(JSON.parse(text))) return empty(503);
    return new Response(text, { status: 200, headers: { ...headers, "Content-Type": "application/json" } });
  } catch { return empty(503); }
}
