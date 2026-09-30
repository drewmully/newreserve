import contracts from "./lean-contracts.json";
import { inspectFreshGoogleSpend, prepareFreshGoogleSpend } from "./googleSpendRegistration";
import { normalizeSpendBase, type SpendBase } from "./spend";
import { reconcileCandidate, validateCandidateGraph, type Candidate, type Reconciliation } from "./certification";
import { storeDaily, type Facts } from "./reporting";
import { decimal, key, micros, nyDate } from "./primitives";
import { evidenceDigest } from "./evidenceIntake";

export type SpendDayControl = {
  provider: string; accountId: string; date: string; sourceCurrency: string; sourceTimezone: string;
  capturedAt: string; evidenceRef: string; independentlyExtracted: boolean; complete: boolean;
  verifiedEmpty: boolean; totalCostMicros: string;
  campaigns: { id: string; costMicros: string }[];
};
export type CompatibleSalesPacket = {
  facts: Candidate; proofs: Reconciliation[];
  coverage: {
    kind: string; shop: string; dates: string[]; sourceCurrency: string; sourceTimezone: string;
    capturedAt: string; completeThrough: string; complete: boolean; independentlyExtracted: boolean;
    evidenceRef: string; approvalRef: string;
  };
  marketingInventory: {
    shop: string; dates: string[]; accounts: { provider: string; accountId: string }[];
    complete: boolean; independentlyExtracted: boolean; evidenceRef: string; approvalRef: string;
  };
};
export type GoogleSpendAcceptanceInput = {
  version: 1; manifest: unknown; bases: SpendBase[]; controls: SpendDayControl[];
  shop: string; publication: string; asOf: string; sales: CompatibleSalesPacket | null;
};
const empty = (): Candidate => Object.fromEntries(contracts.tables.map(t => [t.name, []]));
const ref = (s: unknown): s is string => typeof s === "string" && s.trim().length > 0 && s.length <= 512;
function timestamp(s: string) {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(s))
    throw new Error("spend_acceptance_timestamp_precision");
  nyDate(s);
  return Date.parse(s);
}
function cost(s: string) {
  if (typeof s !== "string" || !/^(0|[1-9]\d{0,19})$/.test(s)) throw new Error("spend_control_amount");
  const n = BigInt(s);
  decimal(n); // Reuse the existing six-place decimal bounds.
  return n;
}
function sameDates(a: string[], b: string[]) {
  return Array.isArray(a) && a.length === b.length && new Set(a).size === a.length &&
    JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

/** Independent input controls only. Never derive expected keys or totals from
 * the candidate. This checks saved evidence; it cannot authenticate its origin.
 */
function controlIssues(base: SpendBase, control: SpendDayControl | undefined,
  dueAt: string, asOf: string, publication: string): string[] {
  if (!control) return ["missing_account_day_control"];
  if (control.provider !== base.provider || control.accountId !== base.accountId ||
      control.date !== base.date || control.sourceCurrency !== base.sourceCurrency ||
      control.sourceTimezone !== base.sourceTimezone) return ["control_scope_mismatch"];
  if (!ref(control.evidenceRef) || control.evidenceRef === base.evidenceRef ||
      control.complete !== true || control.independentlyExtracted !== true)
    return ["control_independence_or_coverage_unverified"];
  if (timestamp(control.capturedAt) < timestamp(dueAt) || timestamp(control.capturedAt) > timestamp(asOf))
    return ["control_not_current"];
  if (!Array.isArray(control.campaigns) || control.campaigns.length > 10000 ||
      control.verifiedEmpty !== (control.campaigns.length === 0) ||
      control.verifiedEmpty !== base.verifiedEmpty) return ["control_zero_evidence_mismatch"];
  const ids = new Set<string>();
  for (const row of control.campaigns) {
    if (!/^[1-9]\d*$/.test(row.id) || ids.has(row.id)) throw new Error("spend_control_campaign");
    ids.add(row.id); cost(row.costMicros);
  }
  const total = cost(control.totalCostMicros);
  if (control.campaigns.reduce((n, r) => n + cost(r.costMicros), BigInt(0)) !== total)
    return ["control_total_inconsistent"];
  const rows = normalizeSpendBase(base, publication);
  const proof: Reconciliation = {
    table: "marketing_spend_daily", keyFields: ["campaign_key"], independentlyExtracted: true, complete: true,
    evidenceRef: control.evidenceRef,
    expectedKeys: (control.campaigns.length ? control.campaigns.map(c => c.id) : ["__verified_empty_account_day__"])
      .map(id => JSON.stringify([key(control.provider, control.accountId, id)])),
    amountChecks: [{ field: "source_amount", expectedTotal: decimal(total) }],
  };
  const issues = reconcileCandidate({ marketing_spend_daily: rows }, [proof], ["marketing_spend_daily"]);
  // Equal totals with costs moved between campaigns are not a matching base.
  const actual = new Map(base.rows.map(r => [r.campaignId, r.costMicros]));
  if (control.campaigns.some(r => actual.get(r.id) !== r.costMicros)) issues.push("campaign_amount_mismatch");
  return issues;
}

function salesIssues(input: GoogleSpendAcceptanceInput, dates: string[], accountId: string,
  cutoff: string): string[] {
  const sales = input.sales;
  if (!sales) return ["missing_compatible_sales_packet"];
  try {
    const c = sales.coverage, inventory = sales.marketingInventory;
    if (c.kind !== "whole_store_eligible_ledger" || c.shop !== input.shop ||
        c.sourceCurrency !== "USD" || c.sourceTimezone !== "America/New_York" ||
        !sameDates(c.dates, dates) || c.complete !== true || c.independentlyExtracted !== true ||
        !ref(c.evidenceRef) || !ref(c.approvalRef)) return ["sales_scope_or_coverage_unverified"];
    if (timestamp(c.capturedAt) < timestamp(cutoff) || timestamp(c.capturedAt) > timestamp(input.asOf) ||
        timestamp(c.completeThrough) > timestamp(c.capturedAt) ||
        dates.some(date => nyDate(c.completeThrough) <= date)) return ["sales_window_not_current_or_complete"];
    // The single-account tool cannot infer that this is all marketing spend.
    // Any additional provider/account requires a separately supported packet.
    if (inventory.shop !== input.shop || !sameDates(inventory.dates, dates) ||
        inventory.complete !== true || inventory.independentlyExtracted !== true ||
        !ref(inventory.evidenceRef) || !ref(inventory.approvalRef) ||
        inventory.accounts.length !== 1 || inventory.accounts[0].provider !== "google_ads" ||
        inventory.accounts[0].accountId !== accountId) return ["marketing_inventory_incompatible"];
    if (Object.values(sales.facts).some(rows => !Array.isArray(rows) || rows.length > 10000) ||
        sales.facts.marketing_spend_daily.length ||
        validateCandidateGraph(sales.facts, input.publication, "commerce-only", false).length)
      return ["sales_candidate_invalid"];
    if (sales.facts.orders.some(o => o.shop_id !== input.shop || o.source_currency !== "USD") ||
        sales.facts.sales_ledger.some(l => l.source_currency !== "USD" || l.report_currency !== "USD" ||
          l.report_date !== nyDate(String(l.effective_at)) ||
          micros(String(l.source_amount)) !== micros(String(l.amount_usd)))) return ["sales_currency_or_clock_mismatch"];
    const required = ["orders", "order_items", "sales_ledger"];
    for (const table of required) {
      const proof = sales.proofs.filter(p => p.table === table);
      const field = table === "orders" ? "order_id" : table === "order_items" ? "order_item_id" : "ledger_entry_id";
      if (proof.length !== 1 || JSON.stringify(proof[0].keyFields) !== JSON.stringify([field]) ||
          table === "sales_ledger" && !proof[0].amountChecks.some(c => c.field === "amount_usd"))
        return ["sales_proof_contract_mismatch"];
    }
    return reconcileCandidate(sales.facts, sales.proofs, required).map(() => "sales_reconciliation_mismatch");
  } catch { return ["sales_packet_invalid"]; }
}

/** Offline report acceptance adapter. No source/DB client, environment reads,
 * registration, certification, serving endpoint or destination mutation.
 */
export function acceptGoogleSpend(input: GoogleSpendAcceptanceInput) {
  if (input.version !== 1 || !ref(input.shop) || !ref(input.publication) ||
      !Array.isArray(input.bases) || input.bases.length > 14 ||
      input.bases.reduce((n, b) => n + b.rows.length, 0) > 10000 ||
      !Array.isArray(input.controls) || input.controls.length > 7 ||
      input.sales === undefined) throw new Error("spend_acceptance_input");
  timestamp(input.asOf);
  const prepared = prepareFreshGoogleSpend(input.manifest), m = prepared.manifest;
  const days = prepared.registration.args.p_scope.days;
  const inspected = inspectFreshGoogleSpend(m, input.bases, input.asOf);
  const controls = new Map<string, SpendDayControl>();
  for (const c of input.controls) {
    if (c.provider !== "google_ads" || c.accountId !== m.accountId || !days.some(d => d.date === c.date) ||
        controls.has(c.date)) throw new Error("spend_acceptance_control_scope");
    controls.set(c.date, c);
  }
  const salesProblems = salesIssues(input, days.map(d => d.date), m.accountId, m.freshnessCutoffAt);
  const compatibleSales = salesProblems.length === 0;
  const checks: { date: string; sourceState: string; spendIssues: string[]; merIssues: string[] }[] = [];
  const reports = days.map(day => {
    const status = inspected.find(r => r.runId === day.runId)!;
    const base = input.bases.find(b => b.baseReportId === day.runId);
    const complete = ["complete", "complete_zero"].includes(status.state);
    const problems = !complete ? [`source_${status.state}`] : controlIssues(
      base!, controls.get(day.date), day.dueAt, input.asOf, input.publication);
    if (complete && !status.usdEligible) problems.push("unsupported_reporting_currency_or_timezone");
    const spendReady = problems.length === 0;
    const facts = compatibleSales ? structuredClone(input.sales!.facts) : empty();
    facts.marketing_spend_daily = spendReady ? normalizeSpendBase(base!, input.publication) : [];
    const row = storeDaily(facts as Facts, {
      shop: input.shop, publication: input.publication, definition: "fresh-spend-acceptance-v1",
      model: "commerce-only", date: day.date, stale: true,
      gates: { spend: spendReady, ledger: compatibleSales, cash: false, orders: false, purchase: false,
        customers: false, attribution: false, behavior: false, productAllocation: false },
    });
    row.readiness = Object.fromEntries(Object.entries(row.readiness as Record<string, string>)
      .map(([metric, state]) => [metric, state === "ready" ? "observed_unverified" : state]));
    checks.push({ date: day.date, sourceState: status.state, spendIssues: problems,
      merIssues: [...salesProblems, ...problems, ...(spendReady && row.spend_usd === "0.000000" ? ["zero_spend_denominator"] : [])] });
    // Aggregates only. Do not emit facts, account/campaign/order IDs or input references.
    const { shop_id, publication_id, ...aggregate } = row;
    void shop_id; void publication_id;
    return aggregate;
  });
  return { state: checks.every(c => !c.spendIssues.length) ? "offline_controls_match" : "offline_withheld",
    certified: false, numericAcceptance: false, sourceAuthorityVerified: false,
    registered: false, enabled: false, hostedCalls: 0, exportReady: false, published: false,
    inputDigest: evidenceDigest(input), manifestDigest: prepared.manifestSha256, asOf: input.asOf,
    scope: "single_google_account_saved_input_comparison", checks, reports: { store_daily: reports },
    caveat: "Saved-input comparison only. Source authority, coverage approvals, certified selection and actual export require separate acceptance." };
}
