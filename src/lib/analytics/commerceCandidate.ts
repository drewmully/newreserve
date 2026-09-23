import contracts from "./lean-contracts.json";
import { validateCandidateGraph, type Candidate } from "./certification";
import { mapPilotSource, type PilotPolicy } from "./shopifyPilotMapping";
import { type PilotSource } from "./shopifyPilotSource";
import { productDaily, storeDaily, type Facts, type ReportScope } from "./reporting";
import { nyDate, type Row } from "./primitives";
import { shopifyId, shopifyShop, sourceString } from "./shopifySource";

export type RetainedCommerce = { source: PilotSource; evidenceRef: string; policy: PilotPolicy };
export type CommerceCandidateScope = {
  shop: string; publication: string; definition: string; fromDate: string; throughDate: string;
};
export function reportDates(from: string, through: string): string[] {
  for (const date of [from, through]) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(Date.parse(date)) ||
        new Date(date).toISOString().slice(0, 10) !== date) throw new Error("invalid_report_dates");
  }
  const span = (Date.parse(through) - Date.parse(from)) / 86400000;
  if (span < 0 || span > 366) throw new Error("unbounded_report_dates");
  return Array.from({ length: span + 1 }, (_, i) => new Date(Date.parse(from) + i * 86400000).toISOString().slice(0, 10));
}
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") return `{${Object.entries(value)
    .sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => `${JSON.stringify(k)}:${stable(v)}`).join(",")}}`;
  return JSON.stringify(value);
}
/** Build ONE combined publication, not a sum of per-order ratios or counts.
 * Rows remain observed/unverified; complete pagination is NOT financial coverage.
 * Externally certified publication is a separate operator-controlled transaction.
 */
export function buildCommerceCandidate(records: RetainedCommerce[], scope: CommerceCandidateScope) {
  shopifyShop(scope.shop);
  if (!scope.publication.trim() || !scope.definition.trim() || records.length > 10000)
    throw new Error("invalid_commerce_candidate_scope");
  const dates = reportDates(scope.fromDate, scope.throughDate);
  const selected = new Map<string, RetainedCommerce>();
  for (const record of records) {
    if (record.source.commerce.shop !== scope.shop || !record.evidenceRef.trim())
      throw new Error("commerce_candidate_source_mismatch");
    const raw = record.source.commerce.order, id = shopifyId(raw.id, "Order");
    const updated = sourceString(raw.updatedAt); nyDate(updated);
    const prior = selected.get(id);
    if (prior && stable(prior.policy) !== stable(record.policy))
      throw new Error("commerce_candidate_policy_conflict");
    if (!prior || Date.parse(updated) > Date.parse(sourceString(prior.source.commerce.order.updatedAt)))
      selected.set(id, record);
    else if (Date.parse(updated) === Date.parse(sourceString(prior.source.commerce.order.updatedAt)) &&
        stable(record.source) !== stable(prior.source)) throw new Error("commerce_candidate_revision_conflict");
  }
  const facts: Candidate = Object.fromEntries(contracts.tables.map(t => [t.name, []]));
  for (const [, record] of [...selected].sort(([a], [b]) => a.localeCompare(b))) {
    const mapped = mapPilotSource(record.source, record.policy, scope.publication, record.evidenceRef);
    for (const table of contracts.tables) facts[table.name].push(...mapped.facts[table.name]);
  }
  if (validateCandidateGraph(facts, scope.publication, "commerce-only", false).length)
    throw new Error("commerce_candidate_invalid_graph");
  const store: Row[] = [], product: Row[] = [];
  for (const date of dates) {
    const reportScope: ReportScope = {
      shop: scope.shop, publication: scope.publication, definition: scope.definition,
      model: "commerce-only", date, stale: true,
      gates: { ledger: true, orders: true, purchase: true, productAllocation: true,
        cash: false, customers: false, spend: false, attribution: false, behavior: false },
    };
    store.push(storeDaily(facts as Facts, reportScope));
    product.push(...productDaily(facts as Facts, reportScope));
  }
  // "observed" is deliberately not "ready". A sample cannot certify a zero day.
  for (const row of [...store, ...product]) {
    row.readiness = Object.fromEntries(Object.entries(row.readiness as Record<string, string>)
      .map(([k, v]) => [k, v === "ready" ? "observed_unverified" : v]));
  }
  return {
    facts, reports: { store_daily: store, product_daily: product },
    certification: "unverified" as const, selectedOrders: selected.size,
    scope: { ...scope, kind: "observed_created_order_inventory" as const },
  };
}
