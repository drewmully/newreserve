import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareFreshGoogleSpendBuild, guardFreshGoogleSpendReports,
  type FreshGoogleSpendReportInput } from "@/lib/analytics/googleSpendReportInput";
import { prepareFreshGoogleSpend } from "@/lib/analytics/googleSpendRegistration";
import { normalizeSpendBase, type SpendBase } from "@/lib/analytics/spend";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { key } from "@/lib/analytics/primitives";
import { fullFixture, campaignKey } from "../fixtures/analyticsFull";

function fixture() {
  const f = fullFixture();
  f.policy.asOf = "2026-01-02T12:00:00Z";
  const plan = prepareFreshGoogleSpend({
    version: 1, projectRef: "a".repeat(20), accountId: "1234567890", loginCustomerId: null,
    approvalRef: "fixture:approved", actorRef: "fixture:operator", revisionRef: "fixture:revision",
    credentialBindingRef: "fixture:binding", coverage: "whole_account_campaign_day",
    sourceCurrency: "USD", sourceTimezone: "America/New_York",
    preparedAt: "2026-01-02T09:00:00Z", freshnessCutoffAt: "2026-01-02T10:00:00Z",
    expiresAt: "2026-01-03T12:00:00Z", maxPages: 1, maxRequestsPerDay: 3, deadlineSeconds: 10,
    days: [{ date: "2026-01-01", dueAt: "2026-01-02T10:00:00Z" }],
  });
  const runId = plan.registration.args.p_scope.days[0].runId;
  const source: SpendBase = { provider: "google_ads", accountId: "1234567890", date: "2026-01-01",
    baseReportId: runId, sourceTimezone: "America/New_York", sourceCurrency: "USD",
    completedAt: "2026-01-02T11:00:00Z", paginationComplete: true, verifiedEmpty: false,
    evidenceRef: `lean_private.spend_jobs/${runId}`, rows: [{ campaignId: "7", costMicros: "5000000" }] };
  const freshGoogleSpend: FreshGoogleSpendReportInput = {
    manifest: plan.manifest, bases: [source],
    controls: [{ provider: "google_ads", accountId: "1234567890", date: "2026-01-01",
      sourceCurrency: "USD", sourceTimezone: "America/New_York", capturedAt: "2026-01-02T11:30:00Z",
      evidenceRef: "fixture:independent-control", independentlyExtracted: true, complete: true,
      verifiedEmpty: false, totalCostMicros: "5000000", campaigns: [{ id: "7", costMicros: "5000000" }] }],
    marketingInventory: { shop: f.shop, dates: ["2026-01-01"],
      accounts: [{ provider: "google_ads", accountId: "1234567890" }],
      complete: true, independentlyExtracted: true, evidenceRef: "fixture:registry", approvalRef: "fixture:scope",
      capturedAt: "2026-01-02T11:30:00Z", salesScope: "whole_store_eligible_ledger",
      salesCoverageRef: "fixture:independent-whole-store-coverage",
      customerScope: "whole_store_eligible_customers", customerCoverageRef: "fixture:independent-whole-store-customers" },
  };
  f.base.marketing_spend_daily = normalizeSpendBase(source, "base");
  const proof = f.evidence.proofs.find(p => p.table === "marketing_spend_daily")!;
  // Independent fixture keys/total, never derived from an arrived row.
  proof.expectedKeys = [JSON.stringify(["google_ads", "1234567890", campaignKey, "2026-01-01", runId])];
  proof.amountChecks = [{ field: "spend_usd", expectedTotal: "5.000000" }];
  return { ...f, freshGoogleSpend, projectRef: "a".repeat(20), asOf: f.policy.asOf };
}
type Input = ReturnType<typeof fixture>;
function build(input: Input) {
  const prepared = prepareFreshGoogleSpendBuild(input);
  const result = buildFullReports({ ...input, base: prepared.base, evidence: prepared.evidence });
  guardFreshGoogleSpendReports(result.reports, prepared.storeRatioAdmission);
  return { prepared, result, store: result.reports.store_daily[0], acquisition: result.reports.acquisition_daily };
}
beforeEach(() => { vi.stubGlobal("fetch", vi.fn(() => { throw new Error("no_source_calls"); })); });
afterEach(() => { vi.unstubAllGlobals(); });

it("feeds the existing five-family builder, same facts/proofs and existing spend/ratio formulas", () => {
  const input = fixture(), before = structuredClone(input);
  const { prepared, result, store, acquisition } = build(input);
  expect(prepared.storeRatioAdmission).toEqual({ mer: true, ncac: true });
  expect(prepared.evidence.proofs).toEqual(input.evidence.proofs);
  expect(prepared.evidence.comparisons).toEqual(input.evidence.comparisons);
  expect(prepared.evidence.externalControls).toEqual(input.evidence.externalControls);
  expect(store).toMatchObject({ spend_usd: "5.000000", net_merchandise_sales_usd: "20.000000",
    mer: "4.000000", new_customers: 1, ncac_usd: "5.000000",
    readiness: { mer: "observed_unverified", spend_usd: "observed_unverified" } });
  expect(acquisition[0]).toMatchObject({ spend_usd: "5.000000", first_party_roas: "4.000000", ncac_usd: "5.000000" });
  expect(Object.keys(result.reports).sort()).toEqual([
    "acquisition_daily", "customer_cohorts", "funnel_daily", "product_daily", "store_daily"]);
  expect(result.facts.marketing_spend_daily[0]).toMatchObject({
    publication_id: input.publication, base_report_id: input.freshGoogleSpend.bases[0].baseReportId });
  expect(input).toEqual(before); expect(fetch).not.toHaveBeenCalled();
});

it.each(["selected_product", "unverified"] as const)("withholds MER for %s sales without withholding independently complete customer nCAC", salesScope => {
  const input = fixture(); input.freshGoogleSpend.marketingInventory.salesScope = salesScope;
  const { store, acquisition } = build(input);
  expect(store).toMatchObject({ spend_usd: "5.000000", net_merchandise_sales_usd: "20.000000", mer: null, ncac_usd: "5.000000",
    readiness: { mer: "withheld", ncac_usd: "observed_unverified", spend_usd: "observed_unverified" } });
  expect(acquisition[0].first_party_roas).toBe("4.000000");
});

it("requires separate scope references and retains existing customer/attribution gates", () => {
  const input = fixture(); input.freshGoogleSpend.marketingInventory.salesCoverageRef = null;
  expect(build(input).store.mer).toBeNull();
  const limited = fixture();
  limited.evidence.dateCoverage[0].gates.customers = false;
  limited.evidence.dateCoverage[0].gates.attribution = false;
  const { store, acquisition } = build(limited);
  expect(store).toMatchObject({ spend_usd: "5.000000", mer: "4.000000", ncac_usd: null });
  expect(acquisition[0]).toMatchObject({ first_party_roas: null, ncac_usd: null });
});

it("keeps complete-customer nCAC numeric without ledger coverage or a sales reference", () => {
  const input = fixture();
  input.base.sales_ledger = [];
  input.evidence.proofs = input.evidence.proofs.filter(p => p.table !== "sales_ledger");
  input.evidence.dateCoverage[0].gates.ledger = false;
  input.freshGoogleSpend.marketingInventory.salesScope = "unverified";
  input.freshGoogleSpend.marketingInventory.salesCoverageRef = null;
  const { prepared, store } = build(input);
  expect(prepared.storeRatioAdmission).toEqual({ mer: false, ncac: true });
  expect(store).toMatchObject({ spend_usd: "5.000000", new_customers: 1, ncac_usd: "5.000000",
    net_merchandise_sales_usd: null, mer: null,
    readiness: { ncac_usd: "observed_unverified", mer: "withheld" } });
});

it("withholds nCAC for selected, unverified or unreferenced customers without withholding qualified MER", () => {
  for (const change of [
    (i: Input) => { i.freshGoogleSpend.marketingInventory.customerScope = "selected_product"; },
    (i: Input) => { i.freshGoogleSpend.marketingInventory.customerScope = "unverified"; },
    (i: Input) => { i.freshGoogleSpend.marketingInventory.customerCoverageRef = null; },
    (i: Input) => { i.freshGoogleSpend.marketingInventory.customerCoverageRef = ""; },
  ]) {
    const input = fixture(); change(input);
    const { prepared, store } = build(input);
    expect(prepared.storeRatioAdmission).toEqual({ mer: true, ncac: false });
    expect(store).toMatchObject({ spend_usd: "5.000000", mer: "4.000000", ncac_usd: null,
      readiness: { mer: "observed_unverified", ncac_usd: "withheld" } });
  }
});

it("does not promote incomplete customer history or a missing proof from a whole-store reference", () => {
  for (const change of [
    (i: Input) => { i.evidence.proofs = i.evidence.proofs.filter(p => p.table !== "customers"); },
    (i: Input) => { i.evidence.customerHistory = {}; },
  ]) {
    const input = fixture(); change(input);
    expect(build(input).store).toMatchObject({ spend_usd: "5.000000", mer: "4.000000",
      new_customers: null, ncac_usd: null, readiness: { ncac_usd: "withheld" } });
  }
});

it("rejects omitted customer scope fields rather than defaulting to whole-store coverage", () => {
  for (const field of ["customerScope", "customerCoverageRef"]) {
    const input = fixture();
    Reflect.deleteProperty(input.freshGoogleSpend.marketingInventory, field);
    expect(() => prepareFreshGoogleSpendBuild(input)).toThrow("inventory_contract");
  }
});

it("never converts a control match into missing or failed independent full-build evidence", () => {
  for (const change of [
    (i: Input) => { i.evidence.proofs = i.evidence.proofs.filter(p => p.table !== "marketing_spend_daily"); },
    (i: Input) => { i.evidence.dateCoverage[0].gates.spend = false; },
    (i: Input) => { i.evidence.dateCoverage = []; },
    (i: Input) => { i.evidence.externalControls.compatible_spend_scope.passed = false; },
    (i: Input) => { delete i.evidence.externalControls.compatible_spend_scope; },
    (i: Input) => { i.freshGoogleSpend.controls = []; },
    (i: Input) => { i.freshGoogleSpend.controls[0].independentlyExtracted = false; },
  ]) {
    const input = fixture(); change(input);
    expect(build(input).store).toMatchObject({ spend_usd: null, mer: null, ncac_usd: null });
  }
});

it("retains source evidence privately but withholds report values for stale or conflicting controls", () => {
  for (const change of [
    (i: Input) => { i.asOf = i.policy.asOf = "2026-01-03T12:00:00Z"; },
    (i: Input) => { i.freshGoogleSpend.controls[0].capturedAt = "2026-01-02T09:59:59Z"; },
    (i: Input) => { i.freshGoogleSpend.controls[0].totalCostMicros = "6000000"; },
    (i: Input) => { i.freshGoogleSpend.controls[0].campaigns[0].id = "8"; },
  ]) {
    const input = fixture(); change(input);
    const { result, store } = build(input);
    expect(result.facts.marketing_spend_daily).toHaveLength(1);
    expect(store).toMatchObject({ spend_usd: null, mer: null, ncac_usd: null });
  }
});

it("does not infer a complete account/provider registry or compare a different shop/date vintage", () => {
  for (const change of [
    (i: Input) => { i.freshGoogleSpend.marketingInventory.accounts.push({ provider: "meta_ads", accountId: "fixture" }); },
    (i: Input) => { i.freshGoogleSpend.marketingInventory.accounts[0].accountId = "9876543210"; },
    (i: Input) => { i.freshGoogleSpend.marketingInventory.shop = "different.myshopify.com"; },
    (i: Input) => { i.freshGoogleSpend.marketingInventory.dates = ["2026-01-02"]; },
    (i: Input) => { i.freshGoogleSpend.marketingInventory.capturedAt = "2026-01-02T09:59:59Z"; },
    (i: Input) => { i.freshGoogleSpend.marketingInventory.complete = false; },
  ]) {
    const input = fixture(); change(input);
    expect(build(input).store.spend_usd).toBeNull();
  }
});

it("rejects different observed snapshots, even equal totals, and wrong runtime scope", () => {
  for (const change of [
    (i: Input) => { i.base.marketing_spend_daily[0].base_report_id = "old-base"; },
    (i: Input) => { i.base.marketing_spend_daily[0].campaign_key = "wrong-campaign"; },
    (i: Input) => { i.base.marketing_spend_daily[0].source_amount = "6.000000"; },
    (i: Input) => { i.projectRef = "b".repeat(20); },
    (i: Input) => { i.throughDate = "2026-01-02"; },
    (i: Input) => { i.freshGoogleSpend.bases.push(structuredClone(i.freshGoogleSpend.bases[0])); },
  ]) {
    const input = fixture(); change(input);
    expect(() => prepareFreshGoogleSpendBuild(input)).toThrow();
  }
});

it("accepts the SQL timestamp projection without weakening source-generation identity", () => {
  const input = fixture();
  input.base.marketing_spend_daily[0].source_updated_at = "2026-01-02T11:00:00.000000Z";
  expect(build(input).store.spend_usd).toBe("5.000000");
  input.base.marketing_spend_daily[0].source_updated_at = "2026-01-02T11:00:01.000000Z";
  expect(() => build(input)).toThrow("observed_source_mismatch");
  input.base.marketing_spend_daily[0].source_updated_at = "2026-01-02T11:00:00.000001Z";
  expect(() => build(input)).toThrow("source_time_precision");
});

it("preserves zero denominator behavior only with complete empty controls and the matching independent proof", () => {
  const input = fixture(), b = input.freshGoogleSpend.bases[0], c = input.freshGoogleSpend.controls[0];
  b.rows = []; b.verifiedEmpty = true; c.campaigns = []; c.verifiedEmpty = true; c.totalCostMicros = "0";
  input.base.marketing_spend_daily = normalizeSpendBase(b, "base");
  // The fixture supplies independently expected keys for the explicitly empty account/day.
  const proof = input.evidence.proofs.find(p => p.table === "marketing_spend_daily")!;
  proof.expectedKeys = [JSON.stringify(["google_ads", "1234567890",
    key("google_ads", "1234567890", "__verified_empty_account_day__"), "2026-01-01", b.baseReportId])];
  proof.amountChecks = [{ field: "spend_usd", expectedTotal: "0.000000" }];
  expect(build(input).store).toMatchObject({ spend_usd: "0.000000", mer: null, ncac_usd: "0.000000" });
  proof.expectedKeys = [JSON.stringify(["google_ads", "1234567890", "wrong-sentinel", "2026-01-01", b.baseReportId])];
  // Wrong independent sentinel is withheld, not repaired from arrived rows.
  expect(build(input).store.spend_usd).toBeNull();
  expect(prepareFreshGoogleSpendBuild(input).checks[0].proofReady).toBe(false);
});
