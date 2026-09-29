/** Offline actual reader -> minimized retain -> extended SQL finish. No hosted I/O. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runShopifyPipeline } from "@/lib/analytics/shopifyPipeline";
import { acceptShopifyReceipt } from "@/lib/analytics/receipts";
import { createReceiptStore, type AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { PILOT_FINANCIAL_QUERY, PILOT_REFUND_QUERY } from "@/lib/analytics/shopifyPilotSource";
import { SHOPIFY_FINANCIAL_ORDER_QUERY, SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY, sourceObject } from "@/lib/analytics/shopifySource";
import { runtimeSource, runtimePolicy, runtimeProject, runtimeShop, runtimeMoney, runtimeConnection } from "../fixtures/analyticsRetainedRuntime";
let db: PGlite;
let network: ReturnType<typeof vi.fn>;
const rpcNames = new Set(["lean_accept_receipt", "lean_pipeline_claim", "lean_pipeline_retain",
  "lean_pipeline_finish", "lean_pipeline_finish_extended", "lean_pipeline_fail"]);
const jsonArgs = new Set(["p_payload", "p_facts", "p_reports", "p_product_reports", "p_order_item_sizes"]);
const client: AnalyticsRpcClient = { async rpc(name, args) {
  if (!rpcNames.has(name)) throw new Error("unexpected_rpc");
  const entries = Object.entries(args);
  const isJson = (key: string) => jsonArgs.has(key) || (name === "lean_pipeline_retain" && key === "p_source");
  try {
    const result = await db.query<{ value: unknown }>(
      `select public.${name}(${entries.map(([key], i) => `${key}=>$${i + 1}${isJson(key) ? "::jsonb" : ""}`).join(",")}) value`,
      entries.map(([key, value]) => isJson(key) && value !== null ? JSON.stringify(value) : value));
    return { data: result.rows[0].value, error: null };
  } catch { return { data: null, error: "synthetic_sql_failed" }; }
} };
beforeEach(async () => {
  network = vi.fn(() => { throw new Error("hosted_network_forbidden"); });
  vi.stubGlobal("fetch", network);
  db = new PGlite();
  await db.exec("create role service_role;create role anon;create role authenticated;");
  for (const name of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views", "017_shopify_pipeline"])
    await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
  // Additive sink only; product-only needs no 046 table or writer.
  await db.exec(readFileSync("sql/analytics/047_pipeline_extended.sql", "utf8"));
  await db.query(`insert into lean_private.pipeline_scope(shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
    values($1,$2,true,'2026-01-01','2026-02-01',$3::jsonb,'fixture:approved','fixture:operator')`,
  [runtimeShop, runtimeProject, JSON.stringify(runtimePolicy)]);
}, 30000);
afterEach(async () => { await db?.close(); expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
async function receipt(topic = "orders/updated", payload: Record<string, unknown> = { id: "1", email: "private" }) {
  const body = Buffer.from(JSON.stringify(payload));
  return acceptShopifyReceipt({ body, topic, secret: "fixture", deliveryId: "fixture-delivery",
    shop: runtimeShop, allowedShop: runtimeShop, retention: "financial_allowlist_v1",
    signature: createHmac("sha256", "fixture").update(body).digest("base64") }, createReceiptStore(client));
}
function run(source = runtimeSource()) {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const { query, variables } = JSON.parse(String(init?.body));
    const data = [SHOPIFY_FINANCIAL_ORDER_QUERY, SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY].includes(query) ?
      { order: source.commerce.order } : query === PILOT_FINANCIAL_QUERY ? { order: source.financial } :
        query === PILOT_REFUND_QUERY ? { refund: source.refunds.find(r => r.id === variables.id) } : null;
    if (!data) throw new Error("unexpected_query");
    return new Response(JSON.stringify({ data }), { headers: { "X-Shopify-API-Version": "2026-07" } });
  });
  return runShopifyPipeline({ client, projectRef: runtimeProject, databaseUrl: `https://${runtimeProject}.supabase.co`,
    shop: runtimeShop, accessToken: "fixture", fetcher });
}
const rows = async (query: string) => (await db.query(query)).rows;
describe("actual worker extended atomic boundary", () => {
  it("persists minimized source, store and product rows with 046 absent", async () => {
    await receipt();
    const source = runtimeSource(); source.financial.email = "private"; source.commerce.order.email = "private";
    expect(await run(source)).toEqual({ state: "done" });
    expect(await rows("select state from lean_private.work")).toEqual([{ state: "done" }]);
    expect(await rows("select total_sales_usd::text from lean_private.report_store_daily")).toEqual([{ total_sales_usd: "22.000000" }]);
    expect(await rows("select net_merchandise_sales_usd::text from lean_private.report_product_daily"))
      .toEqual([{ net_merchandise_sales_usd: "18.000000" }]);
    expect(await rows("select units::text,net_merchandise_sales_usd::text,certification,coverage from lean_analytics.observed_product_daily"))
      .toEqual([{ units: "2.000000", net_merchandise_sales_usd: "18.000000",
        certification: "unverified", coverage: "webhook_observed_only" }]);
    expect(JSON.stringify(await rows("select payload from lean_private.receipts"))).not.toContain("private");
    expect(JSON.stringify(await rows("select source from lean_private.pipeline_snapshots"))).not.toContain("private");
    expect(await rows("select count(*)::int n from lean_private.pipeline_heads")).toEqual([{ n: 1 }]);
    expect(await rows("select to_regclass('lean_private.order_item_sizes') name")).toEqual([{ name: null }]);
  });
  it("includes the observed refund product day without inventing missing dates", async () => {
    const source = runtimeSource(), order = source.commerce.order;
    order.transactionsCount = { count: 2, precision: "EXACT" };
    (order.transactions as unknown[]).push({ id: "gid://shopify/OrderTransaction/5", kind: "REFUND", status: "SUCCESS",
      gateway: "fixture", test: false, createdAt: "2026-01-02T10:00:00Z", processedAt: "2026-01-02T10:00:00Z",
      amountSet: runtimeMoney("5"), parentTransaction: { id: "gid://shopify/OrderTransaction/4", gateway: "fixture" } });
    source.financial.refunds = [{ id: "gid://shopify/Refund/6", updatedAt: "2026-01-02T11:00:00Z" }];
    source.refunds = [{ id: "gid://shopify/Refund/6", order: { id: order.id }, createdAt: "2026-01-02T10:01:00Z",
      updatedAt: "2026-01-02T11:00:00Z", totalRefundedSet: runtimeMoney("5"), duties: [], orderAdjustments: runtimeConnection([]),
      refundLineItems: runtimeConnection([{ id: "gid://shopify/RefundLineItem/7", quantity: 1,
        lineItem: { id: "gid://shopify/LineItem/2", email: "private" }, subtotalSet: runtimeMoney("4"), totalTaxSet: runtimeMoney("1") }]),
      refundShippingLines: runtimeConnection([]), email: "private",
      transactions: runtimeConnection([{ id: "gid://shopify/OrderTransaction/5", kind: "REFUND", status: "SUCCESS",
        processedAt: "2026-01-02T10:00:00Z", amountSet: runtimeMoney("5") }]) }];
    await receipt("refunds/create", { id: "6", order_id: "1", email: "private" });
    expect(await run(source)).toEqual({ state: "done" });
    expect(await rows("select report_date::text,net_merchandise_sales_usd::text from lean_private.report_product_daily order by report_date"))
      .toEqual([{ report_date: "2026-01-01", net_merchandise_sales_usd: "18.000000" },
        { report_date: "2026-01-02", net_merchandise_sales_usd: "-4.000000" }]);
    expect(JSON.stringify(await rows("select source from lean_private.pipeline_snapshots"))).not.toContain("private");
  });
  it("rolls back original finish facts/head/completion when a product insert fails", async () => {
    await db.exec(`create function lean_private.fixture_product_failure() returns trigger language plpgsql as
      $$begin raise exception 'synthetic failure';end$$;
      create trigger fixture_fail before insert on lean_private.report_product_daily
      for each row execute function lean_private.fixture_product_failure();`);
    await receipt();
    await expect(run()).rejects.toThrow("pipeline_storage_unavailable");
    for (const table of ["orders", "order_items", "sales_ledger", "payments", "report_store_daily", "report_product_daily", "pipeline_heads"])
      expect(await rows(`select count(*)::int n from lean_private.${table}`)).toEqual([{ n: 0 }]);
    expect(await rows("select state from lean_private.work")).toEqual([{ state: "leased" }]);
  });
  it.each([false, true])("requires 046 only for explicit size opt-in (installed=%s)", async installed => {
    if (installed) await db.exec(readFileSync("sql/analytics/046_order_item_sizes.sql", "utf8"));
    const policy = { ...runtimePolicy, sourceProjection: "financial_no_geo_order_size",
      orderSize: { policyRef: "fixture:size", productSemantics: { "3": "requested_box_top_size" } } };
    await db.query("update lean_private.pipeline_scope set policy=$1::jsonb,approval_ref='fixture:size'", [JSON.stringify(policy)]);
    const source = runtimeSource(), line = (sourceObject(source.commerce.order.lineItems).nodes as Record<string, unknown>[])[0];
    line.customAttributes = [{ key: "Top size", value: "M" }]; line.variantTitle = null;
    await receipt();
    if (installed) {
      expect(await run(source)).toEqual({ state: "done" });
      expect(await rows("select size_value,size_status from lean_private.order_item_sizes")).toEqual([{ size_value: "M", size_status: "known" }]);
    } else {
      await expect(run(source)).rejects.toThrow("pipeline_storage_unavailable");
      expect(await rows("select count(*)::int n from lean_private.orders")).toEqual([{ n: 0 }]);
      expect(await rows("select state from lean_private.work")).toEqual([{ state: "leased" }]);
    }
  });
});
