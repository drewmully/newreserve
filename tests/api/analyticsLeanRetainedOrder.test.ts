/** Pure synthetic retained documents. No runtime, SQL, token, or source calls. */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { composeRetainedOrderReports } from "@/lib/analytics/shopifyRetainedOrder";
import { mapPilotSource, type PilotPolicy } from "@/lib/analytics/shopifyPilotMapping";
import type { PilotSource } from "@/lib/analytics/shopifyPilotSource";
import { projectOrderSizeLine } from "@/lib/analytics/shopifyOrderSize";
import { sourceObject, type SourceObject } from "@/lib/analytics/shopifySource";
import { decimal, micros } from "@/lib/analytics/primitives";

const money = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
const connection = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
const gid = (kind: string, id: string) => `gid://shopify/${kind}/${id}`;
const publication = "synthetic:retained-order", evidence = "synthetic:durable-source", definition = "synthetic:observed-v1";
const policy: PilotPolicy = {
  decision: { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: false,
    approvalRef: "synthetic:eligibility" },
  lineClasses: { "2": "merchandise", "5": "merchandise" }, financialApprovalRef: "synthetic:finance",
  saleClock: "paid_at", refundClock: "refund_created_at",
};
function fixture(): PilotSource {
  const original = {
    id: gid("Order", "1"), createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-01-05T15:00:00Z",
    currencyCode: "USD", edited: false, taxesIncluded: false, test: false, cancelledAt: null,
    originalTotalPriceSet: money("24.790123"), subtotalPriceSet: money("23.456789"),
    transactionsCount: { count: 2, precision: "EXACT" },
    transactions: [
      { id: gid("OrderTransaction", "4"), kind: "SALE", status: "SUCCESS", gateway: "synthetic",
        test: false, createdAt: "2026-01-01T12:00:00Z", processedAt: "2026-01-01T12:01:00Z",
        amountSet: money("24.790123"), parentTransaction: null },
      { id: gid("OrderTransaction", "9"), kind: "REFUND", status: "SUCCESS", gateway: "synthetic",
        test: false, createdAt: "2026-01-05T04:58:00Z", processedAt: "2026-01-05T04:58:00Z",
        amountSet: money("3.123457"), parentTransaction: { id: gid("OrderTransaction", "4"), gateway: "synthetic" } },
    ],
    lineItems: connection([
      { id: gid("LineItem", "2"), sku: "BOX", quantity: 2, isGiftCard: false, product: { id: gid("Product", "3") },
        originalUnitPriceSet: money("10.123456"), originalTotalSet: money("20.246912"),
        discountAllocations: [{ allocatedAmountSet: money("2.123456") }] },
      { id: gid("LineItem", "5"), sku: "SHIRT", quantity: 1, isGiftCard: false, product: { id: gid("Product", "6") },
        originalUnitPriceSet: money("5.333333"), originalTotalSet: money("5.333333"), discountAllocations: [] },
    ]),
  };
  return {
    commerce: { shop: "retained-fixture.myshopify.com", apiVersion: "2026-07", projection: "financial_no_geo", order: original },
    financial: { id: original.id, updatedAt: original.updatedAt, currencyCode: "USD",
      originalTotalPriceSet: money("24.790123"), totalTaxSet: money("1.000001"),
      originalTotalDutiesSet: null, originalTotalAdditionalFeesSet: null, totalTipReceivedSet: money("0"),
      shippingLines: connection([{ id: gid("ShippingLine", "7"), discountedPriceSet: money("0.333333") }]),
      refunds: [{ id: gid("Refund", "8"), updatedAt: "2026-01-05T05:01:00Z" }] },
    refunds: [{
      id: gid("Refund", "8"), createdAt: "2026-01-05T04:59:00Z", updatedAt: "2026-01-05T05:01:00Z",
      order: { id: original.id }, totalRefundedSet: money("3.123457"), duties: [], orderAdjustments: connection([]),
      refundLineItems: connection([{ id: gid("RefundLineItem", "10"), quantity: 1,
        lineItem: { id: gid("LineItem", "2") }, subtotalSet: money("3.123456"), totalTaxSet: money("0.000001") }]),
      refundShippingLines: connection([]),
      transactions: connection([{ id: gid("OrderTransaction", "9"), kind: "REFUND", status: "SUCCESS",
        processedAt: "2026-01-05T04:58:00Z", amountSet: money("3.123457") }]),
    }],
  };
}
const compose = (source = fixture(), p = policy) =>
  composeRetainedOrderReports(source, p, publication, evidence, definition);
function freeze(value: unknown) {
  if (value && typeof value === "object") { Object.values(value).forEach(freeze); Object.freeze(value); }
}
let network: ReturnType<typeof vi.fn>;
beforeEach(() => { network = vi.fn(() => { throw new Error("network_forbidden"); }); vi.stubGlobal("fetch", network); });
afterEach(() => { expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });

describe("one retained order report composition", () => {
  it("preserves exact mapper facts/store metrics/source totals and never mutates the retained input", () => {
    const source = fixture(), p = structuredClone(policy), before = JSON.stringify({ source, p });
    freeze(source); freeze(p);
    const baseline = mapPilotSource(source, p, publication, evidence), result = compose(source, p);
    expect(JSON.stringify(result.facts)).toBe(JSON.stringify(baseline.facts));
    expect(result.sourceTotals).toEqual(baseline.sourceTotals);
    for (const [index, report] of result.reports.entries()) {
      for (const [name, value] of Object.entries(baseline.reports[index]))
        if (!["definition_version", "is_stale", "readiness"].includes(name)) expect(report[name]).toEqual(value);
    }
    expect(JSON.stringify({ source, p })).toBe(before);
    expect(result).toMatchObject({ certification: "unverified", sampleScope: "single_order" });
    expect(result).not.toHaveProperty("order_item_sizes");
    expect(compose(source, p)).toEqual(result);
  });
  it("uses existing six-decimal product formulas on purchase/late-refund days, without gap filling or changing AOV", () => {
    const result = compose();
    expect(result.reports.map(row => row.report_date)).toEqual(["2026-01-01", "2026-01-04"]);
    expect(result.reports[0]).toMatchObject({ gross_merchandise_sales_usd: "25.580245",
      discounts_usd: "2.123456", net_merchandise_sales_usd: "23.456789", total_sales_usd: "24.790123",
      eligible_orders: 1, aov_usd: "23.456789", collected_cash_usd: null, spend_usd: null, new_customers: null });
    expect(result.reports[1]).toMatchObject({ refunds_usd: "3.123456", net_merchandise_sales_usd: "-3.123456",
      tax_net_usd: "-0.000001", total_sales_usd: "-3.123457", eligible_orders: 0, aov_usd: null });
    expect(result.productReports).toHaveLength(4);
    expect(result.productReports[0]).toMatchObject({ report_date: "2026-01-01", sku_bucket: "BOX", units: "2.000000",
      gross_merchandise_sales_usd: "20.246912", discounts_usd: "2.123456", net_merchandise_sales_usd: "18.123456" });
    expect(result.productReports[1]).toMatchObject({ sku_bucket: "SHIRT", units: "1.000000",
      gross_merchandise_sales_usd: "5.333333", discounts_usd: "0.000000", net_merchandise_sales_usd: "5.333333" });
    expect(result.productReports[2]).toMatchObject({ report_date: "2026-01-04", sku_bucket: "BOX", units: "0.000000",
      refunds_usd: "3.123456", net_merchandise_sales_usd: "-3.123456" });
    for (const store of result.reports) {
      for (const metric of ["gross_merchandise_sales_usd", "discounts_usd", "refunds_usd", "net_merchandise_sales_usd"])
        expect(decimal(result.productReports.filter(row => row.report_date === store.report_date)
          .reduce((total, row) => total + micros(row[metric] as string), BigInt(0)))).toBe(store[metric]);
      for (const metric of ["collected_cash_usd", "new_customers", "spend_usd", "ncac_usd", "mer"])
        expect(store[metric]).toBeNull();
    }
    for (const row of [...result.reports, ...result.productReports]) {
      expect(row).toMatchObject({ publication_id: publication, definition_version: definition, is_stale: true });
      expect(Object.values(row.readiness as Record<string, string>)).not.toContain("ready");
      expect(Object.values(row.readiness as Record<string, string>)).toContain("observed_unverified");
    }
    expect((result.reports[1].readiness as Record<string, string>).aov_usd).toBe("withheld");
  });
  it("retains the existing unknown SKU bucket instead of inferring a product name", () => {
    const source = fixture();
    (sourceObject(source.commerce.order.lineItems).nodes as SourceObject[])[1].sku = null;
    expect(compose(source).productReports.map(row => row.sku_bucket)).toEqual(["BOX", "unknown", "BOX", "unknown"]);
  });
  it("transports optional046 rows unchanged and keeps box requests distinct from purchased shirt variants", () => {
    const source = fixture(), p = structuredClone(policy);
    source.commerce.projection = "financial_no_geo_order_size";
    sourceObject(source.commerce.order.lineItems).nodes =
      (sourceObject(source.commerce.order.lineItems).nodes as SourceObject[]).map((line, index) =>
        projectOrderSizeLine({ ...line, customAttributes: index ? [] : [{ key: "Top size", value: " m " }],
          variantTitle: index ? "XL" : null }));
    p.orderSize = { policyRef: "synthetic:reviewed-size-policy",
      productSemantics: { "3": "requested_box_top_size", "6": "purchased_shirt_variant" } };
    const option = { orderSizeSidecar: true } as const;
    expect(() => compose(source, p)).toThrow("size_sidecar_sink_required");
    const result = composeRetainedOrderReports(source, p, publication, evidence, definition, option);
    const baseline = mapPilotSource(source, p, publication, evidence, option);
    expect(result.order_item_sizes).toEqual(baseline.order_item_sizes);
    expect(result.order_item_sizes?.map(row => [row.size_value, row.size_semantics, row.size_source])).toEqual([
      ["M", "requested_box_top_size", "custom_attribute_top_size"],
      ["XL", "purchased_shirt_variant", "variant_title_snapshot"],
    ]);
    expect(result.facts).toEqual(compose().facts);
    expect(result.reports).toEqual(compose().reports);
    expect(result.productReports).toEqual(compose().productReports);
    const absent = composeRetainedOrderReports(fixture(), p, publication, evidence, definition, option);
    expect(absent.order_item_sizes?.every(row => row.size_status === "projection_absent" && row.size_value === null)).toBe(true);
    const uncertain = fixture();
    uncertain.commerce.projection = "financial_no_geo_order_size";
    sourceObject(uncertain.commerce.order.lineItems).nodes =
      (sourceObject(uncertain.commerce.order.lineItems).nodes as SourceObject[]).map((line, index) =>
        projectOrderSizeLine({ ...line, customAttributes: index ? [] :
          [{ key: "Top size", value: "M" }, { key: "Top size", value: "L" }],
        variantTitle: index ? "Blue / XL" : null }));
    const withheld = composeRetainedOrderReports(uncertain, p, publication, evidence, definition, option);
    expect(withheld.order_item_sizes?.map(row => [row.size_status, row.size_value]))
      .toEqual([["conflict", null], ["unsupported", null]]);
    expect(withheld.facts).toEqual(result.facts);
    expect(withheld.productReports).toEqual(result.productReports);
  });
  it("does not invent policy, accept unsupported financial evidence, or silently adopt a size projection", () => {
    expect(() => compose(fixture(), { ...policy, financialApprovalRef: "" })).toThrow("pilot_financial_policy_required");
    const source = fixture(); source.commerce.order.edited = true;
    expect(() => compose(source)).toThrow("shopify_original_purchase_snapshot_required");
    const unexpectedSize = fixture(); unexpectedSize.commerce.projection = "financial_no_geo_order_size";
    expect(() => compose(unexpectedSize)).toThrow("shopify_size_policy_required");
    expect(() => composeRetainedOrderReports(fixture(), policy, publication, evidence, " "))
      .toThrow("retained_order_definition_required");
  });
  it("delegates invalid shop, publication and retained-evidence scope to existing validators", () => {
    const source = fixture(); source.commerce.shop = "unapproved.invalid";
    expect(() => compose(source)).toThrow("invalid_shopify_shop");
    expect(() => composeRetainedOrderReports(fixture(), policy, "", evidence, definition))
      .toThrow("invalid_order_items_shape");
    expect(() => composeRetainedOrderReports(fixture(), policy, publication, " ", definition))
      .toThrow("shopify_missing_policy_evidence");
  });
});
