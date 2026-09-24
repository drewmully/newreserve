import { expect, it } from "vitest";
import { mapShopifyLineDiscounts } from "@/lib/analytics/shopifyOffers";
import { SHOPIFY_ANALYTICS_ORDER_QUERY, type ShopifyOrderDocument } from "@/lib/analytics/shopifySource";
import { key } from "@/lib/analytics/primitives";
import { prepareMullyRefresh } from "@/lib/analytics/mymullyRefresh";
import { readMullyCustomers } from "@/lib/analytics/mymullySource";
import { refreshFixture } from "../fixtures/analyticsRefresh";
import { fullFixture } from "../fixtures/analyticsFull";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
const shop = "fixture.myshopify.com";
const allocation = (index: number, type = "DiscountCodeApplication", code = "PRIVATE_CODE", amount = "2") => ({
  allocatedAmountSet: { shopMoney: { amount, currencyCode: "USD" } },
  discountApplication: { __typename: type, index, targetType: "LINE_ITEM", ...(type === "DiscountCodeApplication" ? { code } : {}) },
});
const order = (id = "1"): ShopifyOrderDocument => ({ shop, apiVersion: "2026-07", order: {
  id: `gid://shopify/Order/${id}`, currencyCode: "USD", customer: null,
  lineItems: { nodes: [{ id: "gid://shopify/LineItem/2", customAttributes: [],
    discountAllocations: [allocation(0), allocation(1, "AutomaticDiscountApplication")] }],
  pageInfo: { hasNextPage: false } },
} });
it("selects application evidence and keeps stacked native offers without exporting codes", () => {
  expect(SHOPIFY_ANALYTICS_ORDER_QUERY).toContain("... on DiscountCodeApplication { code }");
  const result = mapShopifyLineDiscounts([order()], shop);
  expect(result).toHaveLength(2);
  expect(result.map(r => r.orderItemId)).toEqual([key(shop, "1", "2"), key(shop, "1", "2")]);
  expect(result.every(r => r.membershipBasis === "source_line_discount")).toBe(true);
  expect(JSON.stringify(result)).not.toContain("PRIVATE_CODE");
});
it("shares a code within a shop but never equates order-local automatic discounts", () => {
  const a = mapShopifyLineDiscounts([order()], shop), b = mapShopifyLineDiscounts([order("3")], shop);
  expect(a[0].offerId).toBe(b[0].offerId);
  expect(a[1].offerId).not.toBe(b[1].offerId);
  const other = order(); other.shop = "another.myshopify.com";
  expect(mapShopifyLineDiscounts([other], other.shop)[0].offerId).not.toBe(a[0].offerId);
});
it("does not invent membership for zero allocations or undiscounted items", () => {
  const doc = order();
  (doc.order.lineItems as { nodes: { discountAllocations: unknown[] }[] }).nodes[0].discountAllocations =
    [allocation(0, "DiscountCodeApplication", "ZERO", "0")];
  expect(mapShopifyLineDiscounts([doc], shop)).toEqual([]);
});
it.each([
  ["missing allocation selection", (line: Record<string, unknown>) => { delete line.discountAllocations; }],
  ["missing application", (line: Record<string, unknown>) => { line.discountAllocations = [{ allocatedAmountSet: allocation(0).allocatedAmountSet }]; }],
  ["negative amount", (line: Record<string, unknown>) => { line.discountAllocations = [allocation(0, "DiscountCodeApplication", "X", "-1")]; }],
  ["duplicate application", (line: Record<string, unknown>) => { line.discountAllocations = [allocation(0), allocation(0)]; }],
  ["unknown application", (line: Record<string, unknown>) => { line.discountAllocations = [allocation(0, "NewUnsupportedApplication")]; }],
  ["empty code", (line: Record<string, unknown>) => { line.discountAllocations = [allocation(0, "DiscountCodeApplication", "")]; }],
  ["null code", (line: Record<string, unknown>) => {
    const a = allocation(0); Object.assign(a.discountApplication, { code: null }); line.discountAllocations = [a];
  }],
  ["missing code", (line: Record<string, unknown>) => {
    const a = allocation(0); delete a.discountApplication.code; line.discountAllocations = [a];
  }],
])("fails closed for %s", (_, mutate) => {
  const doc = order(); mutate((doc.order.lineItems as { nodes: Record<string, unknown>[] }).nodes[0]);
  expect(() => mapShopifyLineDiscounts([doc], shop)).toThrow();
});
it("rejects application identity changes across lines and duplicate source orders", () => {
  const doc = order(), nodes = (doc.order.lineItems as { nodes: Record<string, unknown>[] }).nodes;
  nodes.push({ id: "gid://shopify/LineItem/3", discountAllocations: [allocation(0, "DiscountCodeApplication", "OTHER")] });
  expect(() => mapShopifyLineDiscounts([doc], shop)).toThrow("conflict");
  expect(() => mapShopifyLineDiscounts([order(), order()], shop)).toThrow("duplicate_line");
});
it("automatically wires native membership through refresh and preserves monetary totals", async () => {
  const refresh = refreshFixture(), doc = order();
  const snapshot = await readMullyCustomers({ projectRef: refresh.intake.scope.projectRef, shop,
    capturedAt: refresh.intake.asOf, customerIds: [], entities: ["shopify"] }, "fixture");
  const out = prepareMullyRefresh({ refresh, source: { snapshot, orders: [doc],
    permissions: [], mappingVersion: refresh.policy.mappingVersion },
  binding: { sourceId: "mully", schemaVersion: "v1", approvalRef: "fixture", maxAgeSeconds: 86400 } });
  const f = fullFixture(); f.evidence.offers = out.bundle.full.evidence.offers;
  const result = buildFullReports(f);
  expect(result.facts.order_item_offers).toHaveLength(2);
  expect(result.facts.order_item_offers.every(r => r.membership_basis === "source_line_discount")).toBe(true);
  expect(result.reports.store_daily[0].net_merchandise_sales_usd).toBe("20.000000");
  expect(result.reports.product_daily[0].net_merchandise_sales_usd).toBe("20.000000");
  expect(out.bundle.full.evidence.proofs).toEqual(refresh.intake.packets.find(p => p.section === "proofs")!.payload);
});
