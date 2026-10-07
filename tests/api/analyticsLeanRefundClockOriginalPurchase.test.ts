import { describe, expect, it } from "vitest";
import { mapRefundClockOriginalPurchase } from "../../src/lib/analytics/refundClockOriginalPurchasePreparation";

// Synthetic policy/source only. Production authority is never a fixture.
function fixture() {
  const gid = (kind: string, id: number) => `gid://shopify/${kind}/${id}`;
  const bag = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
  const complete = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
  const paid = "2026-01-01T12:00:00Z", refundAt = "2026-01-02T12:00:02Z", revision = "2026-01-03T00:00:00Z";
  const parent = { id: gid("OrderTransaction", 8), kind: "SALE", status: "SUCCESS", test: false,
    gateway: "synthetic", createdAt: paid, processedAt: paid, amountSet: bag("225"), parentTransaction: null };
  const refunded = { id: gid("OrderTransaction", 9), kind: "REFUND", status: "SUCCESS", test: false,
    gateway: "synthetic", createdAt: "2026-01-02T12:00:00Z", processedAt: "2026-01-02T12:00:00Z",
    amountSet: bag("225"), parentTransaction: { id: parent.id, gateway: "synthetic" } };
  const product = (id: number, returning: boolean) => ({
    id: gid("Sale", id), __typename: "ProductSale", lineType: "PRODUCT",
    actionType: returning ? "RETURN" : "ORDER", quantity: returning ? -1 : 1,
    lineItem: { id: gid("LineItem", 3) }, totalAmount: bag(returning ? "-225" : "225"),
    totalTaxAmount: bag("0"), totalDiscountAmountBeforeTaxes: bag(returning ? "-25" : "25"),
    totalDiscountAmountAfterTaxes: bag(returning ? "-25" : "25")
  });
  return {
    source: {
      commerce: { shop: "synthetic.myshopify.com", apiVersion: "2026-07" as const, order: {
        id: gid("Order", 1), updatedAt: revision, createdAt: paid, currencyCode: "USD",
        edited: true, taxesIncluded: false, test: false, cancelledAt: null,
        originalTotalPriceSet: bag("225"), transactionsCount: { count: 2, precision: "EXACT" },
        transactions: [parent, refunded], lineItems: complete([{ id: gid("LineItem", 3), isGiftCard: false }])
      } },
      financial: { id: gid("Order", 1), updatedAt: revision, currencyCode: "USD",
        originalTotalPriceSet: bag("225"), totalTaxSet: bag("0"), totalTipReceivedSet: bag("0"),
        originalTotalDutiesSet: null, originalTotalAdditionalFeesSet: null, shippingLines: complete([]),
        refunds: [{ id: gid("Refund", 4), updatedAt: revision }] },
      refunds: [{ id: gid("Refund", 4), updatedAt: revision, createdAt: refundAt, order: { id: gid("Order", 1) },
        totalRefundedSet: bag("225"), duties: [], orderAdjustments: complete([]), refundShippingLines: complete([]),
        refundLineItems: complete([{ id: gid("RefundLineItem", 5), quantity: 1, lineItem: { id: gid("LineItem", 3) },
          subtotalSet: bag("225"), totalTaxSet: bag("0") }]), transactions: complete([refunded]) }]
    },
    document: { shop: "synthetic.myshopify.com", apiVersion: "2026-07" as const, orderGid: gid("Order", 1),
      sourceUpdatedAt: revision, capturedAt: "2026-01-04T00:00:00Z", complete: true as const,
      agreements: [
        { id: gid("SalesAgreement", 10), __typename: "OrderAgreement", reason: "ORDER", happenedAt: paid, sales: [product(11, false)] },
        { id: gid("SalesAgreement", 20), __typename: "ReturnAgreement", reason: "RETURN", happenedAt: refundAt, sales: [product(21, true)] }
      ] },
    policy: { decision: { eligibility: "eligible" as const, commerceSource: "other" as const,
      acquisitionEligible: false, approvalRef: "synthetic:decision" }, lineClasses: { "3": "merchandise" as const },
      saleClock: "paid_at" as const, refundClock: "refund_created_at" as const, financialApprovalRef: "synthetic:finance" },
    sourceEvidenceRef: "synthetic:pilot", agreementEvidenceRef: "synthetic:agreements",
    sourceCapturedAt: "2026-01-03T12:00:00Z"
  };
}
describe("source-proven sole-return clock preparation", () => {
  it("preserves real clock roles, original units/value and separate provider IDs", () => {
    const input = fixture(), before = JSON.stringify(input), result = mapRefundClockOriginalPurchase(input);
    expect(JSON.stringify(input)).toBe(before);
    expect(result.replacement.snapshot.lines[0]).toMatchObject({ quantity: 1, unitPrice: "250.000000", merchandiseDiscount: "25.000000" });
    expect(result.derivation.refundCreatedAt).toBe("2026-01-02T12:00:02Z");
    expect(result.derivation.payments[0].processedAt).toBe("2026-01-02T12:00:00Z");
    expect(result.derivation.refundGid).not.toBe(result.derivation.returnAgreementGid);
    expect(result.derivation.nativeForeignKeyClaimed).toBe(false);
    expect(result.derivation.financialApprovalRef).toBe(input.policy.financialApprovalRef);
  });
  it("refuses unequal clocks and extra changes instead of relabeling them", () => {
    const input = fixture(); input.document.agreements[1].happenedAt = "2026-01-02T12:00:00Z";
    expect(() => mapRefundClockOriginalPurchase(input)).toThrow("refund_clock_bridge_clock");
    const extra = fixture(); extra.document.agreements.push(extra.document.agreements[1]);
    expect(() => mapRefundClockOriginalPurchase(extra)).toThrow("refund_clock_bridge_sole_return_required");
  });
  it("requires complete direct refund evidence", () => {
    const input = fixture(); input.source.refunds[0].refundLineItems.pageInfo.hasNextPage = true;
    expect(() => mapRefundClockOriginalPurchase(input)).toThrow("refund_clock_bridge_incomplete_connection");
  });
  it("requires the exact returned original line and signed quantity", () => {
    const input = fixture(); input.document.agreements[1].sales[0].quantity = -2;
    expect(() => mapRefundClockOriginalPurchase(input)).toThrow("refund_clock_bridge_return_quantity");
  });
});
