import { expect, it } from "vitest";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { fullFixture } from "../fixtures/analyticsFull";

// Entirely synthetic source/coverage evidence. These assertions test metric
// independence; they do not assert permission or completeness in a live source.
function anonymousFixture() {
  const f = fullFixture();
  f.policy.stages = { view: "lean_quiz_started" };
  f.events[0] = { ...f.events[0], family: "lean_quiz_started", identityNamespace: "lean_subject" };
  f.evidence.identity = [{ ...f.evidence.identity[0], namespace: "lean_subject",
    customerId: null, resolution: "unresolved" }];
  f.evidence.currentlyPermitted = [];
  f.evidence.customerHistory = {};
  f.evidence.orderIdentities = [];
  f.evidence.attributionCoverage = [];
  // The independent synthetic export expects no canonical customers and one
  // anonymous grant, not a customer inferred from an event or checkout.
  f.evidence.proofs.find(p => p.table === "customers")!.expectedKeys = [];
  f.evidence.proofs.find(p => p.table === "identity_map")!.expectedKeys = [
    JSON.stringify(["lean_subject", "uid-fixture", "2025-01-01T00:00:00Z", "identity-v1"]),
  ];
  return f;
}

it("reports permitted anonymous sessions and verified conversion without customer history", () => {
  const result = buildFullReports(anonymousFixture());
  expect(result.facts.customers).toEqual([]);
  expect(result.facts.sessions[0]).toMatchObject({ customer_id: null, identity_status: "anonymous" });
  expect(result.reports.funnel_daily[0]).toMatchObject({
    measured_sessions: 1, mature_sessions: 1, converted_sessions: 1, session_conversion_rate: "1.000000",
  });
  expect(result.reports.store_daily[0]).toMatchObject({
    net_merchandise_sales_usd: "20.000000", eligible_orders: 1, spend_usd: "5.000000",
    new_customers: null, ncac_usd: null,
  });
  expect(result.reports.customer_cohorts[0]).toMatchObject({ repeat_purchase_rate: null, revenue_ltv_usd: null });
  expect(result.reports.acquisition_daily.every(r => r.first_party_roas === null)).toBe(true);
});

it("keeps session counts available while conversion is immature", () => {
  const f = anonymousFixture();
  f.policy.asOf = "2026-01-03T00:00:00Z";
  const result = buildFullReports(f);
  expect(result.reports.funnel_daily[0]).toMatchObject({
    measured_sessions: 1, mature_sessions: 0, converted_sessions: 0, session_conversion_rate: null,
  });
});

it("does not invent anonymous attribution from a verified checkout link alone", () => {
  const result = buildFullReports(anonymousFixture());
  expect(result.facts.orders[0].checkout_link_status).toBe("matched");
  expect(result.facts.order_attribution[0]).toMatchObject({
    acquisition_session_key: null, attribution_status: "pending", attribution_complete: false,
  });
});

it("withholds sessions on missing event coverage without suppressing commerce", () => {
  const f = anonymousFixture();
  f.evidence.sessionCoverage.behaviorComplete = false;
  const result = buildFullReports(f);
  expect(result.reports.funnel_daily[0]).toMatchObject({ measured_sessions: null, session_conversion_rate: null });
  expect(result.reports.store_daily[0].eligible_orders).toBe(1);
});

it.each(["denied", "unknown"] as const)("does not count anonymous %s permission as a measured zero", consent => {
  const f = anonymousFixture();
  f.evidence.identity[0].consent = consent;
  const result = buildFullReports(f);
  expect(result.facts.sessions).toEqual([]);
  // Expected session-key reconciliation now fails; unavailable is not zero.
  expect(result.reports.funnel_daily[0].measured_sessions).toBeNull();
  expect(result.reports.store_daily[0].new_customers).toBeNull();
});
