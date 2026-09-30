/** Synthetic only: local reader/mapper/017/046; no provider or retained samples. */
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { PGlite } from "@electric-sql/pglite";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { aggregateOrderSizes, OWNER_ORDER_SIZE_REPORT_SQL, type OrderSizeReportFacts } from "@/lib/analytics/orderSizeReporting";
import { readShopifyAnalyticsOrder, sourceObject, type SourceObject } from "@/lib/analytics/shopifySource";
import { projectOrderSizeLine } from "@/lib/analytics/shopifyOrderSize";
import { mapPilotSource, type PilotPolicy } from "@/lib/analytics/shopifyPilotMapping";
import type { PilotSource } from "@/lib/analytics/shopifyPilotSource";
import { productDaily, type Facts } from "@/lib/analytics/reporting";

const shop = "size-report-fixture.myshopify.com", project = "aaaaaaaaaaaaaaaaaaaa";
const scope = { shop, fromDate: "2026-01-01", throughDate: "2026-01-05" };
const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
const connection = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
const policy: PilotPolicy & { productClasses: Record<string, "merchandise"> } = {
  decision: { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: false, approvalRef: "synthetic:catalog" },
  lineClasses: { "2": "merchandise" }, productClasses: { "3": "merchandise", "6": "merchandise" },
  financialApprovalRef: "synthetic:finance", saleClock: "paid_at", refundClock: "refund_created_at",
  orderSize: { policyRef: "synthetic:size-policy", productSemantics: { "3": "requested_box_top_size", "6": "purchased_shirt_variant" } },
};
function source(id = "1", revision = "2026-01-02T12:00:00Z", shirt = false, missing = false): PilotSource {
  const order = { id: `gid://shopify/Order/${id}`, createdAt: "2026-01-01T12:00:00Z", updatedAt: revision,
    currencyCode: "USD", edited: false, taxesIncluded: false, test: false, cancelledAt: null,
    originalTotalPriceSet: money("20"), subtotalPriceSet: money("20"), transactionsCount: { count: 1, precision: "EXACT" },
    transactions: [{ id: "gid://shopify/OrderTransaction/4", kind: "SALE", status: "SUCCESS", gateway: "synthetic", test: false,
      createdAt: "2026-01-01T12:00:00Z", processedAt: "2026-01-01T12:01:00Z", amountSet: money("20"), parentTransaction: null }],
    lineItems: connection([{ id: "gid://shopify/LineItem/2", sku: shirt ? "SHIRT" : "BOX", quantity: 2, isGiftCard: false,
      product: { id: `gid://shopify/Product/${shirt ? "6" : "3"}` }, originalUnitPriceSet: money("10"),
      originalTotalSet: money("20"), discountAllocations: [], variantTitle: shirt ? "XL" : null,
      customAttributes: shirt || missing ? [] : [{ key: "Top size", value: "M" }] }]) };
  return { commerce: { shop, apiVersion: "2026-07", projection: "financial_no_geo_order_size", order },
    financial: { id: order.id, updatedAt: revision, currencyCode: "USD", originalTotalPriceSet: money("20"),
      totalTaxSet: money("0"), originalTotalDutiesSet: null, originalTotalAdditionalFeesSet: null,
      totalTipReceivedSet: money("0"), shippingLines: connection([]), refunds: [] }, refunds: [] };
}
function mapped(id = "1", missing = false) {
  const s = source(id, undefined, false, missing);
  sourceObject(s.commerce.order.lineItems).nodes =
    (sourceObject(s.commerce.order.lineItems).nodes as SourceObject[]).map(projectOrderSizeLine);
  return mapPilotSource(s, policy, `synthetic:${id}`, `lean_private.pipeline_snapshots/${id}`, { orderSizeSidecar: true });
}
const facts = (...batches: ReturnType<typeof mapped>[]): OrderSizeReportFacts => ({
  orders: batches.flatMap(b => b.facts.orders), order_items: batches.flatMap(b => b.facts.order_items),
  order_item_sizes: batches.flatMap(b => b.order_item_sizes ?? []),
});
let network: ReturnType<typeof vi.fn>;
beforeEach(() => { network = vi.fn(() => { throw new Error("network_forbidden"); }); vi.stubGlobal("fetch", network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("pure selected-order size reporting", () => {
  it("sums six-place purchase quantities without dates/ratios/refund units or caller mutation", () => {
    const a = mapped("1"), b = mapped("2"), input = facts(a, b);
    input.order_items[0].quantity = "0.100001"; input.order_items[1].quantity = "0.200002";
    const before = JSON.stringify(input), report = aggregateOrderSizes(input, scope);
    expect(report.rows).toEqual([{ purchase_date: "2026-01-01", sku_bucket: "BOX", size_semantics: "requested_box_top_size",
      size_status: "known", size_value: "M", unit_basis: "requested_box_units", line_count: 2, quantity: "0.300003" }]);
    expect(report).toMatchObject({ is_stale: true, certification: "unverified", certified: false,
      fulfillment_proven: false, return_adjusted: false, complete_history: false });
    expect(JSON.stringify(input)).toBe(before);
    expect(aggregateOrderSizes(input, { ...scope, fromDate: "2026-01-02" }).rows).toEqual([]);
    expect(JSON.stringify(report)).not.toMatch(/order_id|item_id|publication|customer|synthetic|snapshots|policy_ref/);
  });
  it("keeps unknown SKU and every absent/withheld size outcome in the denominator", () => {
    const input = facts(mapped()); input.order_items[0].sku = null;
    for (const status of ["missing", "invalid", "conflict", "unsupported", "projection_absent"]) {
      Object.assign(input.order_item_sizes[0], { size_status: status, size_value: null,
        size_source: status === "projection_absent" ? "none" : "custom_attribute_top_size" });
      expect(aggregateOrderSizes(input, scope).rows[0]).toMatchObject({ sku_bucket: "unknown", size_status: status,
        size_value: null, quantity: "2.000000", line_count: 1 });
    }
    input.order_item_sizes = [];
    expect(aggregateOrderSizes(input, scope).rows[0]).toMatchObject({ size_status: "not_collected",
      size_semantics: "not_collected", unit_basis: "unclassified_merchandise_units", quantity: "2.000000" });
  });
  it("rejects duplicate/orphan/cross-publication/unsupported facts and inconsistent046 tuples", () => {
    const changes: ((f: OrderSizeReportFacts) => void)[] = [
      f => f.orders.push({ ...f.orders[0], publication_id: "older" }),
      f => f.order_items.push({ ...f.order_items[0] }),
      f => { f.order_items[0].publication_id = "older"; },
      f => { f.order_items[0].order_id = "orphan"; },
      f => f.order_item_sizes.push({ ...f.order_item_sizes[0] }),
      f => { f.order_item_sizes[0].publication_id = "older"; },
      f => { f.order_item_sizes[0].order_item_id = "orphan"; },
      f => { f.order_item_sizes[0].size_status = "missing"; },
      f => { f.order_item_sizes[0].size_value = "medium"; },
      f => { f.order_item_sizes[0].size_source = "variant_title_snapshot"; },
      f => { f.order_item_sizes[0].policy_ref = ""; },
      f => { f.order_item_sizes[0].raw = "PRIVATE"; },
      f => { f.orders[0].shop_id = "other.myshopify.com"; },
      f => { f.orders[0].eligibility_status = "pending"; },
    ];
    for (const change of changes) { const input = facts(mapped()); change(input);
      expect(() => aggregateOrderSizes(input, scope)).toThrow("order_size_report_unavailable"); }
  });
});

it("owner SELECT matches reader→017+046 latest heads, never older known sizes or unselected samples", async () => {
  const db = new PGlite();
  try {
    await db.exec("create role anon;create role authenticated;create role service_role");
    for (const name of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views",
      "015_backfill", "016_shopify_pilot", "017_shopify_pipeline"])
      await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
    await expect(db.query(OWNER_ORDER_SIZE_REPORT_SQL, [shop, scope.fromDate, scope.throughDate])).rejects.toThrow();
    await db.exec(readFileSync("sql/analytics/046_order_item_sizes.sql", "utf8"));
    await db.query(`insert into lean_private.pipeline_scope(shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
      values($1,$2,true,'2026-01-01','2026-02-01',$3,'synthetic:approval','synthetic:owner')`, [shop, project, JSON.stringify(policy)]);
    const report = async () => (await db.query<{ report: ReturnType<typeof aggregateOrderSizes> }>(
      OWNER_ORDER_SIZE_REPORT_SQL, [shop, scope.fromDate, scope.throughDate])).rows[0].report;
    expect((await report()).status).toBe("unavailable");
    async function save(id: string, revision?: string, shirt = false, missing = false, collect = true) {
      const s = source(id, revision, shirt, missing), gid = s.commerce.order.id;
      if (missing) {
        const refund = { id: "gid://shopify/OrderTransaction/5", kind: "REFUND", status: "SUCCESS",
          gateway: "synthetic", test: false, createdAt: "2026-01-02T14:00:00Z", processedAt: "2026-01-02T14:01:00Z",
          amountSet: money("5"), parentTransaction: { id: "gid://shopify/OrderTransaction/4", gateway: "synthetic" } };
        (s.commerce.order.transactions as unknown[]).push(refund);
        s.commerce.order.transactionsCount = { count: 2, precision: "EXACT" };
        s.financial.refunds = [{ id: "gid://shopify/Refund/7", updatedAt: "2026-01-02T15:00:00Z" }];
        s.refunds = [{ id: "gid://shopify/Refund/7", updatedAt: "2026-01-02T15:00:00Z", createdAt: "2026-01-02T14:00:00Z",
          order: { id: gid }, totalRefundedSet: money("5"), duties: [], orderAdjustments: connection([]),
          refundLineItems: connection([{ id: "gid://shopify/RefundLineItem/8", quantity: 1,
            lineItem: { id: "gid://shopify/LineItem/2" }, subtotalSet: money("5"), totalTaxSet: money("0") }]),
          refundShippingLines: connection([]), transactions: connection([refund]) }];
      }
      s.commerce = await readShopifyAnalyticsOrder({ shop, accessToken: "synthetic-only", projection: "financial_no_geo_order_size",
        fetcher: async () => Response.json({ data: { order: s.commerce.order } },
          { headers: { "X-Shopify-API-Version": "2026-07" } }) }, String(gid));
      await db.query("select public.lean_accept_receipt('shopify',$1,$2,'orders/updated',$3,$4)",
        [randomUUID(), JSON.stringify([shop, gid]), "a".repeat(64), JSON.stringify({ admin_graphql_api_id: gid })]);
      const token = randomUUID();
      const claim = (await db.query<{ c: { workId: string; publication: string } }>(
        "select public.lean_pipeline_claim($1,$2,$3) c", [token, project, shop])).rows[0].c;
      await db.query("select public.lean_pipeline_retain($1,$2,$3)", [claim.workId, token, JSON.stringify(s)]);
      const m = mapPilotSource(s, policy, claim.publication, `lean_private.pipeline_snapshots/${claim.workId}`, { orderSizeSidecar: true });
      await db.transaction(async tx => {
        await tx.query("select public.lean_pipeline_finish($1,$2,$3,$4)", [claim.workId, token, JSON.stringify(m.facts),
          JSON.stringify(m.reports.map(row => ({ ...row, definition_version: "shopify-observed-v1" })))]);
        if (collect) await tx.query("select lean_private.write_order_item_sizes($1,$2)", [claim.publication, JSON.stringify(m.order_item_sizes)]);
      });
      return collect ? m : { ...m, order_item_sizes: undefined };
    }
    const first = await save("1"), shirt = await save("2", undefined, true), absent = await save("3", undefined, false, false, false);
    expect(await report()).toEqual(aggregateOrderSizes(facts(first, shirt, absent), scope));
    expect((await report()).rows.find(row => row.size_semantics === "purchased_shirt_variant"))
      .toMatchObject({ unit_basis: "purchased_shirt_variant_units", size_value: "XL", quantity: "2.000000" });
    const latest = await save("1", "2026-01-03T12:00:00Z", false, true);
    expect(latest.reports.map(row => row.report_date)).toEqual(["2026-01-01", "2026-01-02"]);
    const expected = aggregateOrderSizes(facts(latest, shirt, absent), scope);
    expect(await report()).toEqual(expected);
    expect((await db.query<{ report: unknown }>(OWNER_ORDER_SIZE_REPORT_SQL, [shop, "2026-01-02", scope.throughDate])).rows[0].report)
      .toMatchObject({ status: "available", rows: [] }); // Refund day is NOT a new purchase-unit row.
    expect(expected.rows.some(row => row.size_value === "M")).toBe(false);
    expect((await db.query<{ n: number }>("select count(*)::int n from lean_private.order_item_sizes where size_value='M'")).rows[0].n).toBe(1);
    // An old standalone candidate with valid facts, but no head, is never selected.
    const sample = mapped("99");
    await db.query("insert into lean_private.publications(publication_id,contract_version) values('synthetic:99','fixture')");
    for (const table of ["orders", "order_items"]) await db.query(`insert into lean_private.${table}
      select * from jsonb_populate_recordset(null::lean_private.${table},$1)`, [JSON.stringify(sample.facts[table])]);
    expect(await report()).toEqual(expected);
    const product = productDaily(first.facts as Facts, { shop, publication: first.facts.orders[0].publication_id as string,
      definition: "fixture", model: "none", date: "2026-01-01", stale: true,
      gates: { ledger: true, orders: true, purchase: true, productAllocation: true,
        cash: false, customers: false, spend: false, attribution: false, behavior: false } });
    expect(aggregateOrderSizes(facts(first), scope).rows[0].quantity).toBe(product[0].units);
    for (const sql of [
      "update lean_private.work set state='dead' where work_id=(select max(work_id) from lean_private.pipeline_heads)",
      "update lean_private.pipeline_heads set revision=revision+interval '1 second'",
      "update lean_private.order_item_sizes set policy_ref='wrong' where size_value='XL'",
      "update lean_private.order_item_sizes set size_value='S' where size_value='XL'",
      "update lean_private.order_items set product_id='wrong' where sku='SHIRT'",
      `update lean_private.order_items set order_item_id='wrong' where publication_id='${absent.facts.orders[0].publication_id}'`,
      "update lean_private.pipeline_heads set source=jsonb_set(source,'{commerce,order,updatedAt}','\"2026-02-01T00:00:00Z\"')",
    ]) {
      await db.exec("begin"); await db.exec(sql);
      expect(await report()).toMatchObject({ status: "unavailable", rows: [] }); await db.exec("rollback");
    }
    const bytes = async () => (await db.query(`select
      (select jsonb_agg(to_jsonb(x) order by order_item_id,publication_id)::text from lean_private.order_items x) items,
      (select jsonb_agg(to_jsonb(x) order by order_item_id,publication_id)::text from lean_private.order_item_sizes x) sizes,
      (select jsonb_agg(to_jsonb(x) order by publication_id,report_date)::text from lean_private.report_store_daily x) money`)).rows;
    const before = await bytes();
    await db.exec("begin read only"); expect(await report()).toEqual(expected); await db.exec("commit");
    expect(await bytes()).toEqual(before);
    await db.exec("set role service_role"); await expect(report()).rejects.toThrow(); await db.exec("reset role");
    expect(OWNER_ORDER_SIZE_REPORT_SQL).not.toMatch(/\b(insert|update|delete|create|alter|drop|grant)\b/i);
    expect(JSON.stringify(expected)).not.toMatch(/synthetic|snapshots|gid:|policy_ref|order_id|publication_id|customer/);
  } finally { await db.close(); }
}, 30000);
