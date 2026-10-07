import { describe, expect, it } from "vitest";
import { customerCohort, type Facts, type ReportScope } from "@/lib/analytics/reporting";

// Synthetic contract boundaries only. No source collection or authority claim.
const first = "2026-01-01T12:00:00.000500Z";
const horizon = "2026-01-31T12:00:00.000500Z";
const mature = "2026-02-02T12:00:00.000500Z";
const scope: ReportScope = {
  shop: "s", publication: "p", definition: "v1", model: "m1", date: "2026-01-01", stale: true,
  gates: { ledger: true, cash: false, orders: true, purchase: true, customers: true,
    spend: false, attribution: false, behavior: false, productAllocation: true },
};
function facts(): Facts {
  return {
    orders: [{ shop_id: "s", publication_id: "p", order_id: "first", customer_id: "customer",
      paid_at: first, eligibility_status: "eligible" }],
    customers: [{ publication_id: "p", customer_id: "customer", identity_status: "resolved",
      analytics_permitted: true, history_complete: true, acquisition_date: "2026-01-01",
      first_eligible_order_id: "first", first_eligible_order_at: first }],
    sales_ledger: [{ publication_id: "p", ledger_entry_id: "original", order_id: "first",
      component: "merchandise_gross", amount_usd: "100", sales_eligible: true, effective_at: first }],
    order_items: [], payments: [], marketing_spend_daily: [], sessions: [], order_attribution: [],
  };
}
const policy = () => ({
  cohortMonth: "2026-01-01", horizonDays: 30, graceSeconds: 48 * 3600, asOf: mature,
  acquisitionDefinition: "first-order", approvalRef: "synthetic:approval", fullMonthCovered: true,
  originalLedgerIds: new Set(["original"]), ledgerLineageComplete: true,
});

describe("customer cohort microsecond boundaries", () => {
  it("keeps the entire cohort withheld one microsecond before H plus grace", () => {
    expect(customerCohort(facts(), scope, { ...policy(), asOf: "2026-02-02T12:00:00.000499Z" }))
      .toMatchObject({ mature: false, cohort_customers: null, repeat_purchase_rate: null, revenue_ltv_usd: null });
  });

  it("requires source coverage through the exact H plus grace endpoint", () => {
    expect(customerCohort(facts(), scope, { ...policy(),
      historyCompleteThrough: new Map([["customer", "2026-02-02T12:00:00.000499Z"]]),
    })).toMatchObject({ mature: false, cohort_customers: null });
  });

  it.each([
    ["2026-01-31T12:00:00.000499Z", 1],
    [horizon, 0],
    ["2026-01-31T12:00:00.000501Z", 0],
  ])("uses the exact half-open repeat-purchase horizon at %s", (paidAt, repeats) => {
    const f = facts();
    f.orders.push({ ...f.orders[0], order_id: "repeat", paid_at: paidAt });
    expect(customerCohort(f, scope, policy())).toMatchObject({
      mature: true, cohort_customers: 1, repeat_customers: repeats,
    });
  });

  it.each([
    ["2026-01-31T12:00:00.000499Z", "80.000000"],
    [horizon, "100.000000"],
    ["2026-01-31T12:00:00.000501Z", "100.000000"],
  ])("uses the exact half-open refund horizon at %s", (effectiveAt, expected) => {
    const f = facts();
    f.sales_ledger.push({ ...f.sales_ledger[0], ledger_entry_id: "refund",
      component: "merchandise_refund", amount_usd: "-20", effective_at: effectiveAt });
    expect(customerCohort(f, scope, policy())).toMatchObject({
      observed_net_merchandise_sales_usd: expected, revenue_ltv_usd: expected,
    });
  });

  it("accepts an original component one microsecond before H", () => {
    const f = facts();
    f.sales_ledger[0].effective_at = "2026-01-31T12:00:00.000499Z";
    expect(customerCohort(f, scope, policy())).toMatchObject({ revenue_ltv_usd: "100.000000" });
  });

  it("does not include an adjustment one microsecond before payment", () => {
    const f = facts();
    f.sales_ledger.push({ ...f.sales_ledger[0], ledger_entry_id: "adjustment",
      component: "merchandise_refund", amount_usd: "-20", effective_at: "2026-01-01T12:00:00.000499Z" });
    expect(customerCohort(f, scope, policy())).toMatchObject({ revenue_ltv_usd: "100.000000" });
  });

  it("still accepts repeat purchase without a revenue ledger at exact maturity", () => {
    const f = facts();
    f.orders.push({ ...f.orders[0], order_id: "repeat", paid_at: "2026-01-31T12:00:00.000499Z" });
    expect(customerCohort(f, { ...scope, gates: { ...scope.gates, ledger: false } }, policy()))
      .toMatchObject({ mature: true, cohort_customers: 1, repeat_customers: 1, revenue_ltv_usd: null });
  });
});
