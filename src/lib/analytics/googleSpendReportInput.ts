import { acceptGoogleSpend, type SpendDayControl } from "./googleSpendAcceptance";
import { prepareFreshGoogleSpend } from "./googleSpendRegistration";
import { normalizeSpendBase, type SpendBase } from "./spend";
import { reportDates } from "./commerceCandidate";
import { evidenceDigest } from "./evidenceIntake";
import { reconcileCandidate, type Candidate } from "./certification";
import type { FullBuildEvidence } from "./fullReportBuild";
import { nyDate, type Row } from "./primitives";
import { sourceObject } from "./shopifySource";

export type FreshSpendMarketingInventory = {
  shop: string; dates: string[]; accounts: { provider: string; accountId: string }[];
  complete: boolean; independentlyExtracted: boolean; evidenceRef: string; approvalRef: string;
  capturedAt: string;
  salesScope: "whole_store_eligible_ledger" | "selected_product" | "unverified";
  salesCoverageRef: string | null;
  customerScope: "whole_store_eligible_customers" | "selected_product" | "unverified";
  customerCoverageRef: string | null;
};
export type StoreSpendRatioAdmission = { mer: boolean; ncac: boolean };
/** The input RPC derives bases from registered spend_jobs, never caller JSON.
 * Only manifest, controls and marketingInventory are owner-saved policy fields.
 */
export type FreshGoogleSpendReportInput = {
  manifest: unknown; bases: SpendBase[]; controls: SpendDayControl[];
  marketingInventory: FreshSpendMarketingInventory;
};
const ref = (value: unknown): value is string =>
  typeof value === "string" && !!value.trim() && value.length <= 512;
const exact = (value: Record<string, unknown>, fields: string[]) =>
  Object.keys(value).sort().join(",") === [...fields].sort().join(",");
function sameDates(value: string[], dates: string[]) {
  return Array.isArray(value) && new Set(value).size === value.length &&
    JSON.stringify([...value].sort()) === JSON.stringify([...dates].sort());
}
function timestamp(value: string) {
  nyDate(value);
  return Date.parse(value);
}
function comparableRows(rows: Row[]) {
  return rows.map(row => {
    const { publication_id, ...fields } = row;
    void publication_id;
    // SQL renders timestamptz with six fractional digits; source JSON uses three.
    const sourceTime = String(row.source_updated_at), fraction = /\.(\d+)Z$/.exec(sourceTime)?.[1] ?? "";
    if (/[1-9]/.test(fraction.slice(3))) throw new Error("fresh_spend_report_source_time_precision");
    return { ...fields, source_updated_at: new Date(timestamp(sourceTime)).toISOString() };
  }).sort((a, b) => evidenceDigest(a).localeCompare(evidenceDigest(b)));
}

/** Actual full-report input hook, before the existing buildFullReports call.
 * It narrows registered readiness; it never certifies a source, adds an approval,
 * invents a proof, fills a missing date or invokes a provider.
 */
export function prepareFreshGoogleSpendBuild(input: {
  freshGoogleSpend: FreshGoogleSpendReportInput;
  base: Candidate; evidence: FullBuildEvidence; projectRef: string;
  publication: string; shop: string; fromDate: string; throughDate: string; asOf: string;
}) {
  const fresh = sourceObject(input.freshGoogleSpend);
  if (!exact(fresh, ["manifest", "bases", "controls", "marketingInventory"]))
    throw new Error("fresh_spend_report_envelope");
  const { manifest, registration } = prepareFreshGoogleSpend(fresh.manifest);
  const dates = reportDates(input.fromDate, input.throughDate);
  const days = registration.args.p_scope.days;
  if (manifest.projectRef !== input.projectRef || dates.length > 7 ||
      dates.some(date => !days.some(day => day.date === date)) ||
      !Array.isArray(fresh.bases) || fresh.bases.length > 7 ||
      !Array.isArray(fresh.controls) || fresh.controls.length > 7)
    throw new Error("fresh_spend_report_scope");
  const bases = fresh.bases as SpendBase[], controls = fresh.controls as SpendDayControl[];
  if (bases.some(b => !dates.includes(b.date)) || controls.some(c => !dates.includes(c.date)) ||
      new Set(bases.map(b => b.baseReportId)).size !== bases.length)
    throw new Error("fresh_spend_report_source_inventory");
  const checked = acceptGoogleSpend({
    version: 1, manifest, bases, controls, shop: input.shop, publication: input.publication,
    asOf: input.asOf, sales: null,
  });
  const checks = checked.checks.filter(c => dates.includes(c.date));
  const base = structuredClone(input.base), evidence = structuredClone(input.evidence);
  // Normalize original retained bases, not report totals. A source snapshot may
  // be stale/unreconciled and still remain private evidence with its gate false.
  const normalized = bases.flatMap(b =>
    b.paginationComplete && (b.rows.length === 0) === b.verifiedEmpty
      ? normalizeSpendBase(b, input.publication) : []);
  if (!Array.isArray(base.marketing_spend_daily) || base.marketing_spend_daily.length > 10000)
    throw new Error("fresh_spend_report_fact_budget");
  // Refuse a different observed generation, even if its grand total is equal.
  // SQL020 has already persisted these source facts; SQL053 pins the same bases
  // and policy in the full-input hash and rechecks them at finish.
  if (evidenceDigest(comparableRows(base.marketing_spend_daily)) !== evidenceDigest(comparableRows(normalized)))
    throw new Error("fresh_spend_report_observed_source_mismatch");
  base.marketing_spend_daily = normalized;

  const inventory = sourceObject(fresh.marketingInventory) as unknown as FreshSpendMarketingInventory;
  if (!exact(sourceObject(inventory), ["shop", "dates", "accounts", "complete", "independentlyExtracted",
    "evidenceRef", "approvalRef", "capturedAt", "salesScope", "salesCoverageRef", "customerScope", "customerCoverageRef"]) ||
      !["whole_store_eligible_ledger", "selected_product", "unverified"].includes(inventory.salesScope) ||
      !["whole_store_eligible_customers", "selected_product", "unverified"].includes(inventory.customerScope))
    throw new Error("fresh_spend_report_inventory_contract");
  const inventoryReady = inventory.shop === input.shop && sameDates(inventory.dates, dates) &&
    inventory.complete === true && inventory.independentlyExtracted === true &&
    ref(inventory.evidenceRef) && ref(inventory.approvalRef) &&
    Array.isArray(inventory.accounts) && inventory.accounts.length === 1 &&
    inventory.accounts[0].provider === "google_ads" && inventory.accounts[0].accountId === manifest.accountId &&
    timestamp(inventory.capturedAt) >= timestamp(manifest.freshnessCutoffAt) &&
    timestamp(inventory.capturedAt) <= timestamp(input.asOf);
  // Keep original independent table proofs and comparison controls. A control
  // packet match cannot turn absent or failed full-build evidence into approval.
  const proofReady = reconcileCandidate(base, evidence.proofs, ["marketing_spend_daily"]).length === 0;
  const compatible = evidence.externalControls.compatible_spend_scope;
  const scopeReady = !!inventoryReady && proofReady && compatible?.passed === true && ref(compatible.evidenceRef);
  const goodDates = new Set(checks.filter(c => !c.spendIssues.length).map(c => c.date));
  evidence.dateCoverage = evidence.dateCoverage.map(c => ({
    ...c, gates: { ...c.gates, spend: c.gates.spend === true && scopeReady && goodDates.has(c.date) },
  }));
  const spendScopeReady = scopeReady && dates.every(date => goodDates.has(date) &&
      evidence.dateCoverage.some(c => c.date === date && ref(c.evidenceRef) && c.gates.spend === true));
  // Blended nCAC uses complete compatible new customers, not a revenue ledger.
  // Neither scope reference replaces the builder's independent denominator gates.
  const storeRatioAdmission: StoreSpendRatioAdmission = {
    mer: !!spendScopeReady && inventory.salesScope === "whole_store_eligible_ledger" && ref(inventory.salesCoverageRef),
    ncac: !!spendScopeReady && inventory.customerScope === "whole_store_eligible_customers" && ref(inventory.customerCoverageRef),
  };
  return { base, evidence, storeRatioAdmission,
    checks: checks.map(c => ({ date: c.date, sourceState: c.sourceState, spendIssues: c.spendIssues,
      inventoryReady: !!inventoryReady, proofReady, scopeReady: !!scopeReady })) };
}

/** Apply before the same lean_full_finish. No recalculation, no new report fields.
 * Partial/selected financials can remain useful without inventing global ratios.
 * Attributed ratios still use the builder's existing campaign/purchase controls.
 */
export function guardFreshGoogleSpendReports(reports: Record<string, Row[]>, admission: StoreSpendRatioAdmission): void {
  for (const row of reports.store_daily ?? []) {
    if (admission.mer !== true) {
      row.mer = null;
      row.readiness = { ...sourceObject(row.readiness), mer: "withheld" };
    }
    if (admission.ncac !== true) {
      row.ncac_usd = null;
      row.readiness = { ...sourceObject(row.readiness), ncac_usd: "withheld" };
    }
  }
}
