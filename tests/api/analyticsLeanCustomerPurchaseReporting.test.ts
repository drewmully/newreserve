import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { summarizeCustomerPurchases } from "@/lib/analytics/customerPurchaseReporting";
import { prepareSalesEventWindowReport, prepareSalesEventWindowRegistration } from "@/lib/analytics/salesEventWindowPreparation";
import type { prepareSalesEventWindow } from "@/lib/analytics/salesEventWindowInput";

type Prepared = ReturnType<typeof prepareSalesEventWindow>;
type Conclusion = NonNullable<Prepared["scopedCustomers"]>["orders"][number];
const date = "2026-01-01";
// These fixtures represent the validated boundary, not raw source admission.
function prepared(statuses: (Conclusion["status"] | null)[], newCustomers: number | null,
  customerIds = statuses.map((_, i) => `synthetic-customer-${i}`)): Prepared {
  const orders = statuses.map((_, i) => ({ source_order_id: String(i + 1),
    eligibility_status: "eligible", purchase_date: date, paid_at: `${date}T12:0${i}:00Z` }));
  const conclusions = statuses.flatMap((status, i) => status === null ? [] : [{
    orderGid: `gid://shopify/Order/${i + 1}`, customerGid: customerIds[i], status,
    paidAt: orders[i].paid_at,
  }]);
  return {
    dates: [date], scope: { fromDate: date, throughDate: date },
    ref: `sales-event-window:sha256:${"a".repeat(64)}`,
    fullFacts: { orders },
    scopedCustomers: conclusions.length ? { orders: conclusions, digest: "b".repeat(64),
      sourceStartedAt: "2026-01-02T00:00:00Z", sourceCapturedAt: "2026-01-02T00:00:01Z" } : null,
    customerCounts: new Map([[date, newCustomers]]),
  } as unknown as Prepared;
}
describe("customer purchase reporting", () => {
  it("reports first and returning purchases with the actual order denominator", () => {
    const report = summarizeCustomerPurchases(prepared(["returning", "first_observable"], 1));
    expect(report.rows[0]).toMatchObject({ eligiblePurchaseOrders: 2, classifiedPurchaseOrders: 2,
      firstObservablePurchaseOrders: 1, returningPurchaseOrders: 1, observedCustomers: 2,
      newCustomers: 1, returningCustomers: 1, readiness: "observed_unverified", nextRequiredInput: null });
    expect(report.status).toBe("available");
  });
  it("deduplicates a same-day first purchase and later purchase by customer", () => {
    const report = summarizeCustomerPurchases(prepared(["first_observable", "returning"], 1, ["same", "same"]));
    expect(report.rows[0]).toMatchObject({ eligiblePurchaseOrders: 2, observedCustomers: 1,
      newCustomers: 1, returningCustomers: 0, returningPurchaseOrders: 1 });
  });
  it("does not turn missing customer history into guests or zero new customers", () => {
    const report = summarizeCustomerPurchases(prepared([null, null], null));
    expect(report.status).toBe("unavailable");
    expect(report.rows[0]).toMatchObject({ eligiblePurchaseOrders: 2, classifiedPurchaseOrders: 0,
      missingHistoryPurchaseOrders: 2, observedCustomers: null, newCustomers: null, returningCustomers: null,
      nextRequiredInput: "same_revision_customer_projection_and_complete_inventory" });
  });
  it("keeps a positive returning witness when another member is unresolved", () => {
    const report = summarizeCustomerPurchases(prepared(["returning", "unresolved"], null));
    expect(report.status).toBe("partial");
    expect(report.rows[0]).toMatchObject({ returningPurchaseOrders: 1, unresolvedPurchaseOrders: 1,
      observedCustomers: 2, newCustomers: null, returningCustomers: null,
      nextRequiredInput: "resolve_selected_purchase_history" });
  });
  it("does not call a same-day prior witness a known returning customer", () => {
    const report = summarizeCustomerPurchases(prepared(["returning"], null));
    expect(report.rows[0]).toMatchObject({ returningPurchaseOrders: 1, observedCustomers: 1,
      newCustomers: null, returningCustomers: null, nextRequiredInput: "resolve_first_purchase_within_paid_day" });
  });
  it("treats a conflicting not-eligible conclusion as unresolved, not an exclusion", () => {
    expect(summarizeCustomerPurchases(prepared(["not_eligible"], null)).rows[0])
      .toMatchObject({ eligiblePurchaseOrders: 1, unresolvedPurchaseOrders: 1, classifiedPurchaseOrders: 0 });
  });
  it("preserves measured zero only for an independently controlled empty paid window", () => {
    expect(summarizeCustomerPurchases(prepared([], 0)).rows[0]).toMatchObject({
      eligiblePurchaseOrders: 0, observedCustomers: 0, newCustomers: 0, returningCustomers: 0,
      readiness: "observed_unverified" });
  });
  it.each([
    prepared([null], 0), prepared(["unresolved"], 0), prepared(["first_observable"], 2),
    prepared(["returning"], -1),
  ])("refuses an inconsistent precomputed composition", p => {
    expect(() => summarizeCustomerPurchases(p)).toThrow("customer_purchase_report_composition");
  });
  it("emits no person/order/source-record identifiers and cannot promote cohort or browser claims", () => {
    const report = summarizeCustomerPurchases(prepared(["returning"], 0));
    const text = JSON.stringify(report);
    for (const privateValue of ["synthetic-customer", "gid://", "customerGid", "orderGid", "sourceRef", "paidAt"])
      expect(text).not.toContain(privateValue);
    expect(report).toMatchObject({ sourceOnly: true, productionAdmission: false, wholeStoreCoverage: false,
      lifetimeHistory: false, cohortCoverage: false, repeatPurchaseRate: null, revenueLtvUsd: null,
      browserIdentityAsserted: false });
    const { digest, ...body } = report;
    expect(digest).toBe(evidenceDigest(body));
  });
});

// Optional private source bytes stay outside the published tree. This is the
// historical event-window proof, never acceptance of a different selected run.
const privateInput = process.env.LEAN_CUSTOMER_REPORT_PRIVATE_INPUT;
function historicalInput() {
  const raw = readFileSync(privateInput!, "utf8");
  expect(createHash("sha256").update(raw).digest("hex"))
    .toBe("043bb220282f6dcc7aa3ec7594d02d19ca4b294e07c2e61e2f0ab2a7cbc15c48");
  return JSON.parse(raw) as Parameters<typeof prepareSalesEventWindowReport>[0];
}
it.skipIf(!privateInput)("exposes the genuine historical consumer aggregate through report preparation", () => {
  const input = historicalInput(), result = prepareSalesEventWindowReport(input);
  const report = result.sourceBinding.customerReport;
  expect(report.rows.map(r => [r.eligiblePurchaseOrders, r.newCustomers, r.returningCustomers]))
    .toEqual([[0, 0, 0], [2, 1, 1]]);
  expect(report.evidence.customerResultDigest)
    .toBe("cb95c5b76d81e829499cedf354059ff256cb7fd000f95939335334b6245bf44c");
  expect(result.result.reports.store_daily.map(r => r.new_customers)).toEqual([0, 1]);
  expect(result.result.reports.store_daily.every(r => r.ncac_usd === null)).toBe(true);
  expect(result.sourceBinding.metadata.unprocessed).toHaveLength(290);
  expect(report.productionAdmission).toBe(false);
});
it.skipIf(!privateInput)("exposes the summary without adding SQL registration fields or altering input digest", () => {
  const input = historicalInput();
  const output = prepareSalesEventWindowRegistration({ source: input.source, policy: input.policy,
    runId: "synthetic_customer_report", baseRunId: "synthetic_customer_base",
    authority: { approvalRef: "synthetic:offline-only", actorRef: "synthetic:test",
      readyAt: input.policy.asOf, expiresAt: new Date(Date.parse(input.policy.asOf) + 300000).toISOString(),
      maxAgeSeconds: 86400 } });
  expect(output.customerReport).toEqual(prepareSalesEventWindowReport(input).sourceBinding.customerReport);
  expect(output).toMatchObject({ state: "prepared_disabled", enabled: false, registered: false, metricAcceptance: false });
  expect(output.registration.args.p_scope.sourceDigest).toBe(input.source.digest);
  expect(Object.keys(output.registration.args.p_scope).sort()).toEqual([
    "version", "projectRef", "shop", "runId", "baseRunId", "fromDate", "throughDate", "source", "sourceDigest",
    "authority", "reportPolicy", "fullPolicy", "spendRuns", "evidence", "behavior", "oldestCaptureAt", "latestCaptureAt",
  ].sort());
  expect(output.registration.args.p_scope).not.toHaveProperty("customerReport");
});
it.skipIf(!privateInput)("fails before aggregate exposure when genuine source bytes change", () => {
  const input = historicalInput();
  input.source.customers!.packetJson += " ";
  expect(() => prepareSalesEventWindowReport(input)).toThrow("sales_event_window_input_digest");
});
