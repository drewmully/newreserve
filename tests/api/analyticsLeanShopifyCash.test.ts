import { expect, it } from "vitest";
import { mapApprovedShopifyCash, type ShopifyCashPolicy } from "@/lib/analytics/shopifyCash";
import type { ShopifyOrderDocument } from "@/lib/analytics/shopifySource";
import { normalizePayment } from "@/lib/analytics/financial";
const policy: ShopifyCashPolicy = { clock: "approved_successful_transaction_processed_at",
  approvalRef: "fixture:owner-cash-policy", version: "cash-v1", gateways: ["shopify_payments"],
  asOf: "2026-01-03T00:00:00Z" };
function doc(): ShopifyOrderDocument {
  const tx = (id: number, kind: string, amount: string, parent: number | null) => ({
    id: `gid://shopify/OrderTransaction/${id}`, kind, status: "SUCCESS", gateway: "shopify_payments", test: false,
    createdAt: "2026-01-01T12:00:00Z", processedAt: "2026-01-01T12:01:00Z",
    amountSet: { shopMoney: { amount, currencyCode: "USD" } },
    parentTransaction: parent ? { id: `gid://shopify/OrderTransaction/${parent}`, gateway: "shopify_payments" } : null,
  });
  return { shop: "fixture.myshopify.com", apiVersion: "2026-07", order: {
    id: "gid://shopify/Order/1", test: false, currencyCode: "USD",
    createdAt: "2026-01-01T11:00:00Z", updatedAt: "2026-01-02T00:00:00Z",
    transactionsCount: { count: 3, precision: "EXACT" },
    transactions: [tx(1, "AUTHORIZATION", "20", null), tx(2, "CAPTURE", "20", 1), tx(3, "REFUND", "5", 2)],
  } };
}
it("maps approved customer receipts and refunds without counting authorizations or bank payouts", () => {
  const rows = mapApprovedShopifyCash([doc()], policy);
  expect(rows.map(r => [r.kind, r.signedAmount])).toEqual([["capture", "20.000000"], ["refund", "-5.000000"]]);
  expect(rows.every(r => r.settlementEvidenceRef?.startsWith("shopify-success-policy:"))).toBe(true);
  expect(rows.map(r => normalizePayment(r, "fixture").cash_amount_usd)).toEqual(["20.000000", "-5.000000"]);
});
it("requires an explicit approved clock and gateway policy", () => {
  expect(() => mapApprovedShopifyCash([doc()], { ...policy, approvalRef: "" })).toThrow("policy_required");
  expect(() => mapApprovedShopifyCash([doc()], { ...policy, gateways: ["other"] })).toThrow("unapproved_gateway");
});
it("rejects incomplete, duplicate or future transaction sources", () => {
  const input = doc();
  input.order.transactionsCount = { count: 4, precision: "EXACT" };
  expect(() => mapApprovedShopifyCash([input], policy)).toThrow("incomplete_transactions");
  expect(() => mapApprovedShopifyCash([doc(), doc()], policy)).toThrow("duplicate_order");
  expect(() => mapApprovedShopifyCash([doc()], { ...policy, asOf: "2025-01-01T00:00:00Z" })).toThrow("revision");
});
it("does not turn pending, failed or test transactions into collected cash", () => {
  const input = doc();
  for (const row of input.order.transactions as Record<string, unknown>[]) row.status = "PENDING";
  expect(mapApprovedShopifyCash([input], policy)).toEqual([]);
  input.order.test = true;
  for (const row of input.order.transactions as Record<string, unknown>[]) { row.test = true; row.status = "SUCCESS"; }
  expect(mapApprovedShopifyCash([input], policy)).toEqual([]);
});
it("does not treat non-USD receipts as USD or invent a missing processed timestamp", () => {
  const input = doc();
  input.order.currencyCode = "CAD";
  for (const row of input.order.transactions as Record<string, unknown>[])
    row.amountSet = { shopMoney: { amount: row.kind === "REFUND" ? "5" : "20", currencyCode: "CAD" } };
  expect(normalizePayment(mapApprovedShopifyCash([input], policy)[0], "fixture").cash_amount_usd).toBeNull();
  (input.order.transactions as Record<string, unknown>[])[1].processedAt = null;
  expect(() => mapApprovedShopifyCash([input], policy)).toThrow("processed_time");
});
