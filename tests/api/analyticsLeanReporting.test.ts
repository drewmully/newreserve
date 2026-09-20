import { describe, expect, it } from "vitest";
import { storeDaily, productDaily, acquisitionDaily, customerCohort, funnelDaily, ratio, deliveryMetrics, type Facts, type ReportScope } from "@/lib/analytics/reporting";
import { reportQuery } from "@/lib/analytics/query-boundary";
import contracts from "@/lib/analytics/reporting-contracts.json";
const scope: ReportScope = {
  shop: "s", publication: "p", definition: "v1", model: "m1", date: "2026-01-01", stale: false,
  gates: { ledger: true, cash: true, orders: true, purchase: true, customers: true, spend: true, attribution: true, behavior: true, productAllocation: true },
};
function facts(): Facts {
  const order = { shop_id: "s", publication_id: "p", order_id: "o", customer_id: "customer", paid_at: "2026-01-01T12:00:00Z", purchase_date: "2026-01-01", eligibility_status: "eligible", purchase_merchandise_net_usd: "90" };
  return {
    orders: [order],
    order_items: [1, 2].map(n => ({ publication_id: "p", order_item_id: `line-${n}`, order_id: "o", sku: "sku", item_class: "merchandise", quantity: String(n) })),
    sales_ledger: [["merchandise_gross", "100"], ["merchandise_discount", "-10"], ["merchandise_refund", "-20"], ["shipping_net", "5"], ["tax_net", "8"], ["fee", "-3"]].map(([component, amount], i) => ({
      publication_id: "p", ledger_entry_id: `l${i}`, order_id: "o", order_item_id: "line-1", component,
      amount_usd: amount, sales_eligible: true, product_allocation_status: "allocated", report_date: "2026-01-01", effective_at: "2026-01-01T13:00:00Z",
    })),
    payments: ["45", "20"].map((amount, i) => ({ publication_id: "p", payment_id: `t${i}`, order_id: "o", report_date: "2026-01-01", cash_eligible: true, cash_amount_usd: amount })),
    customers: [{ publication_id: "p", customer_id: "customer", identity_status: "resolved", analytics_permitted: true, history_complete: true, acquisition_date: "2026-01-01",
      first_eligible_order_id: "o", first_eligible_order_at: "2026-01-01T12:00:00Z" }],
    marketing_spend_daily: [{ publication_id: "p", report_date: "2026-01-01", source_campaign_id: "source-c", campaign_key: "campaign", channel: "google_ads", spend_usd: "10", clicks: 2, impressions: 100, click_definition: "clicks" }],
    order_attribution: [{ publication_id: "p", model_version: "m1", order_id: "o", conversion_date: "2026-01-01", channel: "google_ads", campaign_id: "campaign", attribution_complete: true, credit_weight: "1.000000000" }],
    sessions: [{ publication_id: "p", report_date: "2026-01-01", session_key: "session", funnel_version: "f1",
      analytics_eligible: true, behavior_complete: true, conversion_window_complete: true, converted_session: true, funnel_flags: { reveal: true } }],
  };
}
describe("five bounded reporting projections", () => {
  it("pins all 21 metric and 24 join contracts without claiming they are approved", () => {
    expect(contracts.metrics).toHaveLength(21); expect(contracts.joins).toHaveLength(24);
  });
  it("separately aggregates ledger, payments, items and orders without child fan-out", () => {
    expect(storeDaily(facts(), scope)).toMatchObject({
      net_merchandise_sales_usd: "70.000000", total_sales_usd: "83.000000", collected_cash_usd: "65.000000",
      eligible_orders: 1, new_customers: 1, aov_usd: "90.000000", mer: "7.000000", ncac_usd: "10.000000",
    });
    expect(productDaily(facts(), scope)[0].units).toBe("3.000000");
  });
  it("withholds only the metric domains with missing coverage", () => {
    const result = storeDaily(facts(), { ...scope, gates: { ...scope.gates, spend: false, cash: false } });
    expect(result.spend_usd).toBeNull(); expect(result.mer).toBeNull();
    expect(result.total_sales_usd).toBe("83.000000"); expect(result.aov_usd).toBe("90.000000");
  });
  it("does not replace unknown monetary fields with zero", () => {
    const f = facts(); f.sales_ledger[0].amount_usd = null;
    expect(storeDaily(f, scope).gross_merchandise_sales_usd).toBeNull();
    expect(ratio("10", "0")).toBeNull(); expect(ratio(null, "10")).toBeNull();
  });
  it("keeps unmatched merchandise out of certified product metrics but in store totals", () => {
    const f = facts(); f.sales_ledger[2].order_item_id = null;
    f.sales_ledger[2].product_allocation_status = "unresolved";
    const s = { ...scope, gates: { ...scope.gates, productAllocation: false } };
    expect(productDaily(f, s)[0].net_merchandise_sales_usd).toBeNull();
    expect(storeDaily(f, s).net_merchandise_sales_usd).toBe("70.000000");
  });
  it("compares frozen conversion-date purchase value with independently aggregated spend", () => {
    const comparison = new Set([JSON.stringify(["google_ads", "campaign"])]);
    expect(acquisitionDaily(facts(), scope, comparison)[0]).toMatchObject({
      first_party_roas: "9.000000", weighted_new_customers: "1.000000", spend_usd: "10.000000",
    });
    expect(acquisitionDaily(facts(), scope, new Set())[0].first_party_roas).toBeNull();
  });
  it("uses mature stage sessions as the explicit conversion denominator", () => {
    const f = facts(); f.sessions.push({ ...f.sessions[0], session_key: "immature", conversion_window_complete: false, converted_session: null });
    expect(funnelDaily(f, scope, "f1", ["reveal"])[0]).toMatchObject({ measured_sessions: 2, mature_sessions: 1, converted_sessions: 1, session_conversion_rate: "1.000000" });
  });
  const policy = () => ({
    cohortMonth: "2026-01-01", horizonDays: 30, graceSeconds: 3600, asOf: "2026-03-01T12:00:00Z", acquisitionDefinition: "a1",
    approvalRef: "approval", fullMonthCovered: true, originalLedgerIds: new Set(["l0", "l1"]), ledgerLineageComplete: true,
  });
  it("counts original prepayment ledger exactly once and excludes refunds at the horizon", () => {
    const f = facts();
    f.sales_ledger[0].effective_at = "2025-12-31T12:00:00Z";
    f.sales_ledger[1].effective_at = "2025-12-31T12:00:00Z";
    f.sales_ledger.push({ ...f.sales_ledger[2], ledger_entry_id: "late", effective_at: "2026-01-31T12:00:00Z" });
    expect(customerCohort(f, scope, policy())).toMatchObject({ observed_net_merchandise_sales_usd: "70.000000", revenue_ltv_usd: "70.000000" });
  });
  it("withholds the whole immature cohort rather than selecting only old members", () => {
    const f = facts();
    f.customers.push({ ...f.customers[0], customer_id: "young", first_eligible_order_at: "2026-01-31T12:00:00Z", acquisition_date: "2026-01-31" });
    const r = customerCohort(f, scope, { ...policy(), asOf: "2026-02-01T12:00:00Z" });
    expect(r.mature).toBe(false); expect(r.cohort_customers).toBeNull(); expect(r.revenue_ltv_usd).toBeNull();
  });
  it("returns exactly the workbook fields for all five projections", () => {
    const rows = {
      store_daily: storeDaily(facts(), scope), product_daily: productDaily(facts(), scope)[0],
      acquisition_daily: acquisitionDaily(facts(), scope, new Set())[0],
      customer_cohorts: customerCohort(facts(), scope, policy()), funnel_daily: funnelDaily(facts(), scope, "f1", [])[0],
    };
    for (const view of contracts.views) expect(Object.keys(rows[view.name as keyof typeof rows]).sort()).toEqual(view.fields.map(f => f.name).sort());
  });
  it("requires compatible optional click definitions and positive denominators", () => {
    expect(deliveryMetrics(facts().marketing_spend_daily, true)).toEqual({ ctr: "0.020000", cpc_usd: "5.000000", cpm_usd: "100.000000" });
    const rows = [...facts().marketing_spend_daily, { ...facts().marketing_spend_daily[0], click_definition: "different" }];
    expect(deliveryMetrics(rows, true).ctr).toBeNull();
  });
  it("rejects mixed shop, model or publication", () => {
    const f = facts(); f.orders[0].publication_id = "other";
    expect(() => storeDaily(f, scope)).toThrow("mixed_publication");
  });
  const query = { view: "store_daily" as const, shop: "s", publication: "p", definition: "v1", from: "2026-01-01", through: "2026-01-31", filters: {}, limit: 100 };
  it("uses only parameterized read-only allowlisted views and rejects unsupported cuts", () => {
    const result = reportQuery({ ...query, shop: "x'; drop table orders; --" });
    expect(result.sql).not.toContain("drop table"); expect(result.params[0]).toContain("drop table");
    expect(() => reportQuery({ ...query, filters: { email: "private" } })).toThrow("unsupported_cut");
    expect(() => reportQuery({ ...query, through: "2030-01-01" })).toThrow("unbounded");
    expect(() => reportQuery({ ...query, view: "acquisition_daily" })).toThrow("missing_view_version");
  });
});
