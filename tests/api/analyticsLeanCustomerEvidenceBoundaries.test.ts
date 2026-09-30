/** Synthetic saved-input boundaries only. No collection, credentials or hosted calls. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { normalizeLedger } from "@/lib/analytics/financial";
import { customerCohort, type Facts } from "@/lib/analytics/reporting";
import { fullFixture, fullShop } from "../fixtures/analyticsFull";

let network: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  network = vi.spyOn(globalThis, "fetch").mockImplementation(() => {
    throw new Error("hosted_network_forbidden");
  });
});
afterEach(() => { expect(network).not.toHaveBeenCalled(); network.mockRestore(); });

it.each(["2026-01-31T12:00:00Z", "2026-02-01T12:00:00Z"])(
  "withholds cohort revenue when an original component is at/after H: %s", effectiveAt => {
    const input = fullFixture();
    input.base.sales_ledger[0].effective_at = effectiveAt;
    input.base.sales_ledger[0].report_date = effectiveAt.slice(0, 10);
    const result = buildFullReports(input);
    expect(result.reports.customer_cohorts[0]).toMatchObject({
      cohort_customers: 1, repeat_customers: 0, repeat_purchase_rate: "0.000000",
      observed_net_merchandise_sales_usd: null, revenue_ltv_usd: null,
      readiness: { revenue_ltv_usd: "withheld" },
    });
  },
);

it("retains a classified original prepayment component exactly once", () => {
  const input = fullFixture();
  input.base.sales_ledger[0].effective_at = "2025-12-31T12:00:00Z";
  input.base.sales_ledger[0].report_date = "2025-12-31";
  const result = buildFullReports(input);
  expect(result.reports.customer_cohorts[0]).toMatchObject({
    cohort_customers: 1, observed_net_merchandise_sales_usd: "20.000000",
    revenue_ltv_usd: "20.000000", repeat_purchase_rate: "0.000000",
  });
});

it.each(["2026-01-31T12:00:00Z", "2026-02-01T12:00:00Z"])(
  "excludes an ordinary refund at/after H without withholding fixed-H revenue: %s", effectiveAt => {
    const input = fullFixture();
    const refund = normalizeLedger({
      shop: fullShop, id: "refund-after-H", orderId: "1", effectiveAt, currency: "USD",
      sourceTotal: "-5", evidenceRef: "fixture:refund", kind: "refund", salesEligible: true,
      slices: [{ id: "refund", component: "merchandise_refund", amount: "-5", lineId: "2",
        allocation: "allocated", reversesEntryId: null }],
    }, "base");
    input.base.sales_ledger.push(...refund);
    const proof = input.evidence.proofs.find(p => p.table === "sales_ledger")!;
    proof.expectedKeys.push(JSON.stringify([refund[0].ledger_entry_id]));
    proof.amountChecks = [{ field: "amount_usd", expectedTotal: "15" }];
    expect(buildFullReports(input).reports.customer_cohorts[0]).toMatchObject({
      cohort_customers: 1, repeat_customers: 0, observed_net_merchandise_sales_usd: "20.000000",
      revenue_ltv_usd: "20.000000",
    });
  },
);

it.each([null, undefined, "not-a-time"])("rejects malformed source timestamps in the actual builder: %s", value => {
  const input = fullFixture();
  if (value === undefined) delete input.base.sales_ledger[0].effective_at;
  else input.base.sales_ledger[0].effective_at = value;
  expect(() => buildFullReports(input)).toThrow();
});

it.each([null, undefined, "not-a-time"])("withholds revenue for malformed clocks at the calculation boundary: %s", value => {
  const input = fullFixture(), result = buildFullReports(input);
  if (value === undefined) delete result.facts.sales_ledger[0].effective_at;
  else result.facts.sales_ledger[0].effective_at = value;
  const row = customerCohort(result.facts as Facts, {
    shop: input.shop, publication: input.publication, definition: input.policy.definition,
    model: input.policy.attribution.modelVersion, date: input.fromDate, stale: true,
    gates: input.evidence.dateCoverage[0].gates,
  }, {
    cohortMonth: "2026-01-01", horizonDays: 30, graceSeconds: 0, asOf: input.policy.asOf,
    acquisitionDefinition: "fixture:first-order", approvalRef: "fixture:policy",
    fullMonthCovered: true, ledgerLineageComplete: true,
    originalLedgerIds: new Set(input.evidence.cohortCoverage[0].originalLedgerIds),
  });
  expect(row).toMatchObject({ cohort_customers: 1, repeat_purchase_rate: "0.000000",
    observed_net_merchandise_sales_usd: null, revenue_ltv_usd: null });
});
