import { expect, it } from "vitest";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { summarizeSourceSessionConversion } from "@/lib/analytics/sourceSessionConversionInput";
import { fullFixture } from "../fixtures/analyticsFull";

function fixture() {
  const f = fullFixture(), built = buildFullReports(f);
  return { publication: f.publication, fromDate: f.fromDate, throughDate: f.throughDate,
    asOf: f.policy.asOf, conversionWindowDays: 7, sessions: built.facts.sessions,
    orders: built.facts.orders, funnel: built.reports.funnel_daily, source: "legacy_action_session" as const };
}
it("mounts the readout in the actual builder without changing the canonical conversion", () => {
  const result = buildFullReports(fullFixture());
  const day = result.visitorConversion!.days[0];
  expect(day.knownPaidLinks).toEqual({ orders: 1, sessions: 1, state: "positive_observations_only" });
  expect(day.measuredSessions).toEqual({ value: 1, state: "observed_unverified" });
  expect(day.convertedSessions.value).toBe(1);
  expect(day.sessionConversionRate.value).toBe(result.reports.funnel_daily[0].session_conversion_rate);
  expect(result.visitorConversion!.uniqueVisitors.value).toBeNull();
  expect(result.reports.store_daily[0].net_merchandise_sales_usd).toBe("20.000000");
});
it("retains positive linked purchases without manufacturing maturity or a denominator", () => {
  const f = fullFixture(); f.evidence.sessionCoverage.behaviorComplete = false;
  const day = buildFullReports(f).visitorConversion!.days[0];
  expect(day.knownPaidLinks.orders).toBe(1);
  expect(day.measuredSessions.value).toBeNull();
  expect(day.convertedSessions.value).toBeNull();
  expect(day.sessionConversionRate).toEqual({ value: null, state: "unavailable" });
});
it.each([
  { checkout_link_status: "missing" }, { checkout_link_status: "conflicting" },
  { checkout_link_method: "timestamp_only" }, { evidence_ref: null }, { eligibility_status: "excluded_test" },
  { publication_id: "other" }, { paid_at: null }, { paid_at: "2026-01-01T10:59:59Z" },
  { paid_at: "2026-01-08T11:00:00Z" },
])("does not label an unsupported or outside-window order a positive: %j", mutation => {
  const f = fixture(); Object.assign(f.orders[0], mutation);
  expect(summarizeSourceSessionConversion(f).days[0].knownPaidLinks.orders).toBe(0);
});
it("counts distinct orders and distinct linked sessions separately", () => {
  const f = fixture(); f.orders.push({ ...f.orders[0] }, { ...f.orders[0], order_id: "second-synthetic-order" });
  expect(summarizeSourceSessionConversion(f).days[0].knownPaidLinks).toEqual({ orders: 2, sessions: 1,
    state: "positive_observations_only" });
});
it("uses the true paid clock even when payment precedes order creation by three seconds", () => {
  const f = fixture(); Object.assign(f.orders[0], { paid_at: "2026-01-01T12:00:00Z", created_at: "2026-01-01T12:00:03Z" });
  expect(summarizeSourceSessionConversion(f).days[0].knownPaidLinks.orders).toBe(1);
});
it("refuses links to ineligible sessions and future payments", () => {
  const f = fixture(); f.sessions[0].analytics_eligible = false;
  expect(summarizeSourceSessionConversion(f).days[0].knownPaidLinks.sessions).toBe(0);
  f.sessions[0].analytics_eligible = true; f.asOf = "2026-01-01T11:30:00Z";
  expect(summarizeSourceSessionConversion(f).days[0].knownPaidLinks.sessions).toBe(0);
});
it.each([
  { paid: "2026-01-01T11:00:00.000998Z", asOf: "2026-01-10T00:00:00Z", expected: 0 },
  { paid: "2026-01-01T11:00:00.000999Z", asOf: "2026-01-10T00:00:00Z", expected: 1 },
  { paid: "2026-01-01T12:00:00.000999Z", asOf: "2026-01-01T12:00:00.000998Z", expected: 0 },
  { paid: "2026-01-08T11:00:00.000998Z", asOf: "2026-01-10T00:00:00Z", expected: 1 },
  { paid: "2026-01-08T11:00:00.000999Z", asOf: "2026-01-10T00:00:00Z", expected: 0 },
])("retains microseconds at entry, asOf and the exclusive window end: %j", ({ paid, asOf, expected }) => {
  const f = fixture(); f.sessions[0].started_at = "2026-01-01T11:00:00.000999Z";
  f.orders[0].paid_at = paid; f.asOf = asOf;
  expect(summarizeSourceSessionConversion(f).days[0].knownPaidLinks.orders).toBe(expected);
});
it("does not turn a withheld numeric value into an available metric", () => {
  const f = fixture(); f.funnel[0].readiness = { measured_sessions: "withheld", session_conversion_rate: "withheld" };
  const day = summarizeSourceSessionConversion(f).days[0];
  expect(day.measuredSessions.value).toBeNull(); expect(day.sessionConversionRate.value).toBeNull();
});
it("keeps the excluded Google-style build shape unchanged", () => {
  const f = fullFixture(); f.policy.behaviorMode = "excluded"; f.events = [];
  expect(Object.hasOwn(buildFullReports(f), "visitorConversion")).toBe(false);
});
it("exports no session, order, customer, contact or private source identifiers", () => {
  const f = fixture(), json = JSON.stringify(summarizeSourceSessionConversion(f));
  for (const value of [f.publication, f.orders[0].order_id, f.sessions[0].session_key,
    f.sessions[0].source_session_id, f.sessions[0].customer_id]) {
    if (typeof value === "string" && value) expect(json).not.toContain(value);
  }
  expect(json).not.toMatch(/evidence_ref|paid_at|started_at|email|distinct_id/);
});
