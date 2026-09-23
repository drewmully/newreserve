import { describe, expect, it } from "vitest";
import { normalizeLedger, normalizePayment, uniqueLedger, type Movement, type PaymentEvidence } from "@/lib/analytics/financial";
const movement = (): Movement => ({
  shop: "s", id: "m", orderId: "o", effectiveAt: "2026-01-01T14:00:00Z", currency: "USD",
  sourceTotal: "10.00", evidenceRef: "source", kind: "sale", salesEligible: true,
  slices: [{ id: "1", component: "merchandise_gross", amount: "10", lineId: "l", allocation: "allocated", reversesEntryId: null }],
});
const payment = (): PaymentEvidence => ({
  shop: "s", gateway: "gateway", id: "t", orderId: "o", parentId: null, kind: "sale",
  status: "succeeded", signedAmount: "10", currency: "USD", settledAt: "2026-01-03T14:00:00Z",
  settlementEvidenceRef: "settlement", adjustmentApproved: false,
});
describe("independent sales ledger and cash", () => {
  it("retains independent sales and settlement clocks", () => {
    expect(normalizeLedger(movement(), "p")[0].report_date).toBe("2026-01-01");
    expect(normalizePayment(payment(), "p").report_date).toBe("2026-01-03");
  });
  it.each(["authorization", "void"] as const)("does not count %s as cash", kind => {
    expect(normalizePayment({ ...payment(), kind }, "p").cash_eligible).toBe(false);
  });
  it.each(["pending", "failed", "cancelled"] as const)("does not count %s transactions", status => {
    expect(normalizePayment({ ...payment(), status }, "p").cash_amount_usd).toBeNull();
  });
  it("does not infer settlement from succeeded status or an order-paid event", () => {
    expect(normalizePayment({ ...payment(), settlementEvidenceRef: null }, "p").settled_at).toBeNull();
  });
  it("rejects allocations that do not equal the independent source total", () => {
    expect(() => normalizeLedger({ ...movement(), sourceTotal: "11" }, "p")).toThrow("allocation");
  });
  it("keeps unresolved refunds in store totals but not allocated product totals", () => {
    const m = movement(); m.kind = "refund"; m.sourceTotal = "-2";
    m.slices = [{ ...m.slices[0], amount: "-2", component: "merchandise_refund", lineId: null, allocation: "unresolved" }];
    expect(normalizeLedger(m, "p")[0]).toMatchObject({ amount_usd: "-2.000000", order_item_id: null });
  });
  it("requires coherent reversals and rejects double reversal", () => {
    const original = normalizeLedger(movement(), "p");
    const m = movement(); m.id = "reverse"; m.kind = "reversal"; m.sourceTotal = "-10";
    m.slices[0] = { ...m.slices[0], amount: "-10", reversesEntryId: original[0].ledger_entry_id as string };
    const reversal = normalizeLedger(m, "p", original);
    expect(uniqueLedger([...original, ...reversal, ...reversal])).toHaveLength(2);
    expect(() => normalizeLedger(m, "p", [])).toThrow("invalid_reversal");
    expect(() => uniqueLedger([...reversal, { ...reversal[0], ledger_entry_id: "other" }])).toThrow("duplicate_reversal");
  });
  it("deduplicates source keys and never lets an older snapshot erase a refund", () => {
    const rows = normalizeLedger(movement(), "p");
    expect(uniqueLedger([...rows, ...rows])).toHaveLength(1);
    expect(() => uniqueLedger([...rows, { ...rows[0], amount_usd: "0" }])).toThrow("conflicting");
  });
  it("preserves non-USD source evidence without invented conversions", () => {
    expect(normalizeLedger({ ...movement(), currency: "EUR" }, "p")[0].amount_usd).toBeNull();
    expect(normalizePayment({ ...payment(), currency: "EUR" }, "p").cash_amount_usd).toBeNull();
  });
  it("rejects inverted refund/capture signs", () => {
    expect(() => normalizePayment({ ...payment(), kind: "refund" }, "p")).toThrow("sign");
    expect(() => normalizePayment({ ...payment(), signedAmount: "-1" }, "p")).toThrow("sign");
  });
});
