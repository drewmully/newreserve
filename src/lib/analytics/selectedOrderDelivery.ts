import { timingSafeEqual } from "node:crypto";
export const selectedOrderPath = "/api/analytics/reports/selected-order";
const project = "xeqlgxvrhgwwudyqtnun";
const headers = { "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" };
const empty = (status: number) => new Response(null,{status,headers});
const storeMetrics = ["gross_merchandise_sales_usd","discounts_usd","refunds_usd","net_merchandise_sales_usd",
  "shipping_net_usd","tax_net_usd","duty_net_usd","other_sales_adjustments_usd","total_sales_usd",
  "collected_cash_usd","eligible_orders","purchase_merchandise_net_usd","new_customers","spend_usd","ncac_usd","mer","aov_usd"];
const productMetrics = ["units","gross_merchandise_sales_usd","discounts_usd","refunds_usd","net_merchandise_sales_usd"];
const withheld = new Set(["collected_cash_usd","new_customers","spend_usd","ncac_usd","mer"]);
const object = (v: unknown): v is Record<string,unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const keys = (v: Record<string,unknown>, names: string[]) => Object.keys(v).sort().join(",") === [...names].sort().join(",");
function row(v: unknown, product: boolean) {
  const metrics = product ? productMetrics : storeMetrics;
  if (!object(v) || !keys(v,["report_date","definition_version","is_stale","readiness","report_scope","certified",
    "complete_window","selected_order_count","source_updated_at","policy_scope",...metrics,...(product ? ["sku_bucket"] : [])]) ||
    v.definition_version !== "selected-order-v1" || v.is_stale !== true || v.certified !== false ||
    v.complete_window !== false || v.selected_order_count !== 1 || v.report_scope !== "selected_order_sample" ||
    v.policy_scope !== "prior_single_order_test" ||
    typeof v.report_date !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(v.report_date) ||
    typeof v.source_updated_at !== "string" || !/^\d{4}-\d{2}-\d{2}T[\d:.]+(Z|\+00:00)$/.test(v.source_updated_at) ||
    !object(v.readiness) || !keys(v.readiness,metrics) ||
    (product && (typeof v.sku_bucket !== "string" || v.sku_bucket.length < 1 || v.sku_bucket.length > 200))) return false;
  const readiness = v.readiness;
  return metrics.every(k => withheld.has(k) ? v[k] === null && readiness[k] === "withheld" :
    v[k] === null ? readiness[k] === "withheld" : readiness[k] === "observed_unverified" &&
    (k === "eligible_orders" ? v[k] === 0 || v[k] === 1 :
      typeof v[k] === "string" && /^-?\d{1,14}\.\d{6}$/.test(v[k] as string)));
}
export function validSelectedOrderPayload(data: unknown) {
  if (!object(data) || !keys(data,["store_daily","product_daily"]) ||
    !Array.isArray(data.store_daily) || data.store_daily.length < 1 || data.store_daily.length > 4 ||
    !Array.isArray(data.product_daily) || data.product_daily.length < 1 || data.product_daily.length > 400 ||
    !data.store_daily.every(v => row(v,false)) || !data.product_daily.every(v => row(v,true))) return false;
  const dates = data.store_daily.map(r => r.report_date);
  return new Set(dates).size === dates.length && data.product_daily.every(r => dates.includes(r.report_date)) &&
    new Set(data.product_daily.map(r => JSON.stringify([r.report_date,r.sku_bucket]))).size === data.product_daily.length;
}
/** Fixed aggregate GET only. Server credentials never leave the server. */
export async function selectedOrderGet(req: Request, env: Record<string,string|undefined> = process.env,
  transport: typeof fetch = fetch) {
  if (env.LEAN_SELECTED_ORDER_ENABLED !== "true" || env.VERCEL_ENV !== "preview" ||
    env.VERCEL_GIT_COMMIT_REF !== "review/analytics-initial-validation") return empty(404);
  if (req.method !== "GET") return empty(405);
  const secret = env.LEAN_SELECTED_ORDER_SECRET ?? "";
  if (secret.length < 32 || secret.length > 512) return empty(503);
  const expected = Buffer.from(`Bearer ${secret}`), supplied = Buffer.from(req.headers.get("authorization") ?? "");
  if (expected.length !== supplied.length || !timingSafeEqual(expected,supplied)) return empty(401);
  const url = new URL(req.url);
  if (url.pathname !== selectedOrderPath || url.search || req.body !== null || req.headers.has("transfer-encoding") ||
    (req.headers.has("content-length") && req.headers.get("content-length") !== "0")) return empty(400);
  const scope = env.LEAN_SELECTED_ORDER_SCOPE_ID ?? "", key = env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY;
  if (env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== project ||
    env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${project}.supabase.co` ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(scope) || !key?.trim()) return empty(503);
  try {
    const response = await transport(`https://${project}.supabase.co/rest/v1/rpc/lean_selected_order_read`,{
      method:"POST",redirect:"error",signal:AbortSignal.timeout(15000),
      headers:{"Content-Type":"application/json",apikey:key,Authorization:`Bearer ${key}`},
      body:JSON.stringify({p_scope_id:scope,p_project:project}),
    });
    if (!response.ok) return empty(503);
    const reader = response.body?.getReader(); if (!reader) return empty(503);
    const chunks: Uint8Array[] = []; let bytes = 0;
    try {
      for (;;) {
        const part = await reader.read(); if (part.done) break;
        bytes += part.value.length;
        if (bytes > 1048576) { await reader.cancel(); throw new Error("selected_response_budget"); }
        chunks.push(part.value);
      }
    } finally { reader.releaseLock(); }
    const text = Buffer.concat(chunks).toString("utf8");
    if (!validSelectedOrderPayload(JSON.parse(text))) return empty(503);
    return new Response(text,{status:200,headers:{...headers,"Content-Type":"application/json"}});
  } catch { return empty(503); }
}
