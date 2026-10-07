import { acceptGoogleSpend } from "./googleSpendAcceptance";
import { prepareFreshGoogleSpend } from "./googleSpendRegistration";
import { normalizeSpendBase } from "./spend";
import { prepareMetaSpendDay, spendInstant, spendRef, type MetaSpendPacket } from "./metaSpendInput";
import type { FreshGoogleSpendReportInput, FreshSpendMarketingInventory } from "./googleSpendReportInput";
import { reconcileCandidate, type Candidate } from "./certification";
import type { FullBuildEvidence } from "./fullReportBuild";
import { evidenceDigest } from "./evidenceIntake";
import { reportDates } from "./commerceCandidate";
import type { Row } from "./primitives";
import { admitNativeSpendWindow, type NativeSpendWindowBinding } from "./nativeSpendWindowInput";

export type MultiProviderSpendInput = {
  version: 1; projectRef: string; shop: string; runId: string;
  inventory: FreshSpendMarketingInventory; metaDays: MetaSpendPacket[];
};
const canonical = (rows: Row[]) => rows.map(row => {
  const { publication_id: _publication, ...fields } = row;
  void _publication;
  const time = String(row.source_updated_at);
  // Match PostgreSQL's six-digit rendering without losing sub-millisecond time.
  if (/[1-9]/.test((/\.(\d+)Z$/.exec(time)?.[1] ?? "").slice(3))) throw new Error("marketing_time_precision");
  return { ...fields, source_updated_at: new Date(time).toISOString() };
}).sort((a, b) => evidenceDigest(a).localeCompare(evidenceDigest(b)));
const same = (a: string[], b: string[]) => new Set(a).size === a.length &&
  JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

/** A separate opt-in combined input path. Existing Google-only validation is
 * unchanged. Stored Meta packets and existing native Google bases remain distinct.
 */
export function prepareMultiProviderSpendBuild(input: {
  combined: MultiProviderSpendInput; freshGoogleSpend: FreshGoogleSpendReportInput;
  base: Candidate; evidence: FullBuildEvidence; projectRef: string; publication: string;
  shop: string; fromDate: string; throughDate: string; asOf: string;
  nativeSpendWindowBinding?: NativeSpendWindowBinding;
}) {
  const c = input.combined;
  if (!c || Object.keys(c).sort().join(",") !== ["version", "projectRef", "shop", "runId", "inventory", "metaDays"].sort().join(",") ||
    c.version !== 1 || c.projectRef !== input.projectRef || c.shop !== input.shop ||
    input.publication !== `full:${c.runId}` || !spendRef(c.runId) ||
    !Array.isArray(c.metaDays) || c.metaDays.length < 1 || c.metaDays.length > 49)
    throw new Error("marketing_combined_envelope");
  const fresh = input.freshGoogleSpend, { manifest } = prepareFreshGoogleSpend(fresh.manifest);
  const dates = reportDates(input.fromDate, input.throughDate);
  if (manifest.projectRef !== input.projectRef || dates.length > 7 ||
    !same(dates, manifest.days.map(d => d.date)) || fresh.bases.length !== dates.length ||
    new Set(fresh.bases.map(b => b.date)).size !== dates.length ||
    fresh.bases.some(b => b.accountId !== manifest.accountId || b.provider !== "google_ads" || !dates.includes(b.date)))
    throw new Error("marketing_google_scope");
  const checked = acceptGoogleSpend({ version: 1, manifest, bases: fresh.bases, controls: fresh.controls,
    shop: input.shop, publication: input.publication, asOf: input.asOf, sales: null });
  if (checked.checks.length !== dates.length || checked.checks.some(day => day.spendIssues.length))
    throw new Error("marketing_google_control");
  const google = fresh.bases.flatMap(b => normalizeSpendBase(b, input.publication));
  if (evidenceDigest(canonical(input.base.marketing_spend_daily)) !== evidenceDigest(canonical(google)))
    throw new Error("marketing_google_observed_generation");
  const pairs = new Set<string>(), generations = new Set<string>(), accounts = new Set<string>();
  const meta = c.metaDays.flatMap(day => {
    const pair = JSON.stringify([day.accountId, day.date]);
    if (!dates.includes(day.date) || pairs.has(pair) || generations.has(day.generationId))
      throw new Error("marketing_duplicate_or_unexpected_day");
    pairs.add(pair); generations.add(day.generationId); accounts.add(day.accountId);
    return prepareMetaSpendDay(day, { projectRef: input.projectRef, shop: input.shop,
      publication: input.publication, freshnessCutoffAt: manifest.freshnessCutoffAt, asOf: input.asOf }).facts;
  });
  if ([...accounts].some(id => dates.some(date => !pairs.has(JSON.stringify([id, date])))))
    throw new Error("marketing_missing_account_day");
  const base = structuredClone(input.base), evidence = structuredClone(input.evidence);
  base.marketing_spend_daily = [...google, ...meta];
  if (base.marketing_spend_daily.length > 10000) throw new Error("marketing_fact_budget");
  const scoped = admitNativeSpendWindow(evidence.nativeSpendWindow, {
    binding: input.nativeSpendWindowBinding, projectRef: input.projectRef, shop: input.shop,
    publication: input.publication, fromDate: input.fromDate, throughDate: input.throughDate,
    asOf: input.asOf, facts: base.marketing_spend_daily,
  });
  const inventory = c.inventory;
  if (!inventory || Object.keys(inventory).sort().join(",") !== ["shop", "dates", "accounts", "complete",
    "independentlyExtracted", "evidenceRef", "approvalRef", "capturedAt", "salesScope", "salesCoverageRef",
    "customerScope", "customerCoverageRef"].sort().join(",") ||
    !Array.isArray(inventory.accounts) || !Array.isArray(inventory.dates) ||
    typeof inventory.complete !== "boolean" || typeof inventory.independentlyExtracted !== "boolean" ||
    !["whole_store_eligible_ledger", "selected_product", "unverified"].includes(inventory.salesScope) ||
    !["whole_store_eligible_customers", "selected_product", "unverified"].includes(inventory.customerScope))
    throw new Error("marketing_inventory_contract");
  const keys = inventory.accounts.map(a => {
    if (!a || Object.keys(a).sort().join(",") !== "accountId,provider" ||
      !spendRef(a.provider) || !spendRef(a.accountId)) throw new Error("marketing_inventory_account");
    return JSON.stringify([a.provider, a.accountId]);
  });
  if (new Set(keys).size !== keys.length) throw new Error("marketing_inventory_duplicate");
  const expected = [JSON.stringify(["google_ads", manifest.accountId]),
    ...[...accounts].map(id => JSON.stringify(["meta_ads", id]))];
  const inventoryReady = !!scoped || inventory.shop === input.shop && same(inventory.dates, dates) &&
    inventory.complete === true && inventory.independentlyExtracted === true &&
    spendRef(inventory.evidenceRef) && spendRef(inventory.approvalRef) && same(keys, expected) &&
    spendInstant(inventory.capturedAt) >= spendInstant(manifest.freshnessCutoffAt) &&
    spendInstant(inventory.capturedAt) <= spendInstant(input.asOf);
  // Preserve the separately supplied whole-fact proof; never create expected keys
  // from these arrived rows or promote input booleans into denominator evidence.
  const proofReady = reconcileCandidate(base, evidence.proofs, ["marketing_spend_daily"]).length === 0;
  const control = evidence.externalControls.compatible_spend_scope;
  const scopeReady = !!scoped || !!inventoryReady && proofReady && control?.passed === true && spendRef(control.evidenceRef);
  evidence.dateCoverage = evidence.dateCoverage.map(day => ({ ...day,
    gates: { ...day.gates, spend: day.gates.spend === true && scopeReady && dates.includes(day.date) } }));
  const ready = scopeReady && dates.every(date => evidence.dateCoverage.some(day =>
    day.date === date && day.gates.spend && spendRef(day.evidenceRef)));
  return { base, evidence, storeRatioAdmission: {
    mer: ready && (!!scoped || inventory.salesScope === "whole_store_eligible_ledger" && spendRef(inventory.salesCoverageRef)),
    ncac: ready && (!!scoped || inventory.customerScope === "whole_store_eligible_customers" && spendRef(inventory.customerCoverageRef)),
  }, checks: { inventoryReady: !!inventoryReady, proofReady, scopeReady: !!scopeReady,
    ...(scoped ? { nativeSpendWindowDigest: scoped.digest, genericReconciliationClaimed: false } : {}) } };
}
