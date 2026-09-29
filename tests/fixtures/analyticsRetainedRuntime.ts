import type { PilotSource } from "@/lib/analytics/shopifyPilotSource";
import type { PipelinePolicy } from "@/lib/analytics/shopifyPipeline";
export const runtimeShop = "runtime-fixture.myshopify.com";
export const runtimeProject = "aaaaaaaaaaaaaaaaaaaa";
export const runtimePolicy: PipelinePolicy = {
  decision: { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: false, approvalRef: "fixture:catalog" },
  productClasses: { "3": "merchandise" }, financialApprovalRef: "fixture:finance",
  saleClock: "paid_at", refundClock: "refund_created_at", sourceProjection: "financial_no_geo",
  retainedReports: "product-v1", sourceRetention: "financial_allowlist_v1",
};
export const runtimeMoney = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
export const runtimeConnection = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
export function runtimeSource(): PilotSource {
  const money = runtimeMoney, connection = runtimeConnection;
  const order = {
    id: "gid://shopify/Order/1", createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-01-02T12:00:00Z",
    currencyCode: "USD", test: false, cancelledAt: null, edited: false, taxesIncluded: false,
    originalTotalPriceSet: money("22"), subtotalPriceSet: money("18"),
    transactionsCount: { count: 1, precision: "EXACT" },
    transactions: [{ id: "gid://shopify/OrderTransaction/4", kind: "SALE", status: "SUCCESS",
      gateway: "fixture", test: false, createdAt: "2026-01-01T12:00:00Z",
      processedAt: "2026-01-01T12:01:00Z", amountSet: money("22"), parentTransaction: null }],
    lineItems: connection([{ id: "gid://shopify/LineItem/2", sku: "FIXTURE", quantity: 2,
      isGiftCard: false, product: { id: "gid://shopify/Product/3" },
      originalUnitPriceSet: money("10"), originalTotalSet: money("20"),
      discountAllocations: [{ allocatedAmountSet: money("2") }] }]),
  };
  return { commerce: { shop: runtimeShop, apiVersion: "2026-07", projection: "financial_no_geo", order },
    financial: { id: order.id, updatedAt: order.updatedAt, currencyCode: "USD",
      originalTotalPriceSet: money("22"), totalTaxSet: money("4"), originalTotalDutiesSet: null,
      originalTotalAdditionalFeesSet: null, totalTipReceivedSet: money("0"), shippingLines: connection([]), refunds: [] },
    refunds: [] };
}
