import { randomUUID } from "node:crypto";
import contracts from "./lean-contracts.json";
import { canonicalJson, evidenceDigest } from "./evidenceIntake";
import { buildCustomer, normalizeIdentity, resolveTemporalIdentity } from "./identity";
import { reconcileCandidate, validateCandidateGraph, type Candidate } from "./certification";
import type { FullBuildEvidence, FullBuildPolicy } from "./fullReportBuild";
import { mapShopifyAnalyticsOrder } from "./shopifyMapping";
import { mapPilotSource } from "./shopifyPilotMapping";
import type { PilotSource } from "./shopifyPilotSource";
import { mappingPolicy, pipelineRpc, type PipelinePolicy } from "./shopifyPipeline";
import { shopifyId, sourceObject, sourceString } from "./shopifySource";
import { micros, nyDate, type Row } from "./primitives";
import type { CommerceDecision } from "./commerce";
import type { AnalyticsRpcClient } from "./rpcStore";
import { customerCohortComponents, type CustomerCohortComponents, type Facts, type ReportScope } from "./reporting";

type CustomerEvidence = Pick<FullBuildEvidence, "ref" | "identity" | "currentlyPermitted" |
  "removedCustomers" | "customerHistory" | "orderIdentities" | "proofs" | "externalControls" | "cohortCoverage">;
export type HistoryCustomerReporting = {
  definition: string; fromDate: string; throughDate: string;
  cohorts: FullBuildPolicy["cohorts"];
  cohortCoverage: FullBuildEvidence["cohortCoverage"];
};
export type CustomerGenerationBinding = {
  runId: string; generationHash: string; resultHash: string;
  authorityId: string; authorityRevision: string; authorityFingerprint: string;
};
export type CustomerGenerationInput = {
  version: 1; runId: string; sourcePublication: string; sourceRun: string; sourceCompletionHash: string;
  generationHash: string; resultHash: string; projectRef: string; shop: string;
  fromDate: string; throughDate: string; definition: string; mappingVersion: string; asOf: string;
  sourceOrigin: string; completeThrough: string; authority: HistoryCustomerInput["authority"];
  dates: { date: string; newCustomers: number | null }[];
  cohorts: CustomerCohortComponents[];
  orderBindings: { orderId: string; customerId: string | null; paidAt: string | null;
    sourceUpdatedAt: string; eligibility: string; firstEligibleOrder: boolean }[];
};

/** One complete customer, not an arbitrary time slice. The SQL reader binds
 * every row to the unchanged 040/041 generation and an independent inventory.
 * A guest is an explicit one-order member. Missing customer fields are not guests.
 */
export type HistoryCustomerInput = {
  state: "claimed"; version: 1; runId: string; memberId: string;
  projectRef: string; shop: string; publication: string;
  inputHash: string; generationHash: string;
  asOf: string; expiresAt: string; mappingVersion: string;
  sourceOrigin: string; completeThrough: string; reporting: HistoryCustomerReporting;
  authority: {
    authorityId: string; revision: string; fingerprint: string; sourceId: string; schemaVersion: string;
    scopeRef: string; evidenceRef: string; capturedAt: string; validUntil: string; maxAgeSeconds: number;
  };
  customerId: string | null;
  policy: PipelinePolicy;
  evidence: CustomerEvidence;
  orders: {
    id: string; updatedAt: string; sourceHash: string;
    decision: CommerceDecision; source: PilotSource;
  }[];
};

const empty = (): Candidate => Object.fromEntries(contracts.tables.map(t => [t.name, []]));
const hash = (v: unknown) => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const same = (a: unknown, b: unknown) => canonicalJson(a) === canonicalJson(b);
function nyMidnight(date: string) {
  for (const hours of [4, 5]) {
    const at = Date.parse(`${date}T00:00:00Z`) + hours * 3600000;
    if (nyDate(new Date(at).toISOString()) === date && nyDate(new Date(at - 1).toISOString()) !== date) return at;
  }
  throw new Error("history_customer_calendar");
}
function monthCovered(month: string, origin: string, cutoff: string) {
  if (!/^\d{4}-\d{2}-01$/.test(month)) throw new Error("history_customer_cohort_month");
  const next = new Date(Date.parse(`${month}T00:00:00Z`));
  next.setUTCMonth(next.getUTCMonth() + 1);
  return Date.parse(origin) <= nyMidnight(month) && Date.parse(cutoff) >= nyMidnight(next.toISOString().slice(0, 10));
}
const instant = (value: string) => {
  nyDate(value);
  return value.replace(/(?:\.(\d+))?Z$/, (_, digits: string | undefined) => `.${(digits ?? "").padEnd(6, "0")}Z`);
};

/** Validate a SQL-derived, hash-bound input. This cannot authenticate a caller's
 * JSON. The outer SQL input/finish/release/read fences are mandatory in production.
 * Current clock checks stay in that locked source-authority reader, not policy.asOf.
 */
export function admitCustomerGeneration(source: CustomerGenerationInput | undefined, input: {
  binding: CustomerGenerationBinding | undefined; shop: string; fromDate: string; throughDate: string;
  dates: string[]; policy: FullBuildPolicy; orders: Row[]; customers: Row[];
}) {
  if (source === undefined && input.binding === undefined) return undefined;
  const binding = input.binding, p = input.policy;
  if (!source || !binding || Buffer.byteLength(canonicalJson(source)) > 4000000 ||
      source.version !== 1 || source.runId !== binding.runId ||
      source.sourcePublication !== `customer-history:${binding.runId}` ||
      ![source.sourceCompletionHash, source.generationHash, source.resultHash].every(hash) ||
      source.generationHash !== binding.generationHash || source.resultHash !== binding.resultHash ||
      !/^[a-z]{20}$/.test(source.projectRef) || !source.sourceRun ||
      source.shop !== input.shop || source.fromDate !== input.fromDate || source.throughDate !== input.throughDate ||
      source.definition !== p.definition || source.mappingVersion !== p.mappingVersion || source.asOf !== p.asOf ||
      source.authority?.authorityId !== binding.authorityId || source.authority.revision !== binding.authorityRevision ||
      source.authority.fingerprint !== binding.authorityFingerprint)
    throw new Error("customer_generation_binding");
  [source.sourceOrigin, source.completeThrough, source.asOf, source.authority.capturedAt,
    source.authority.validUntil].forEach(nyDate);
  if (Date.parse(source.sourceOrigin) >= Date.parse(source.completeThrough) ||
      Date.parse(source.completeThrough) > Date.parse(source.asOf) ||
      !Number.isSafeInteger(source.authority.maxAgeSeconds) || source.authority.maxAgeSeconds < 1 ||
      source.authority.maxAgeSeconds > 300 || !hash(source.authority.fingerprint) ||
      Date.parse(source.authority.capturedAt) >= Date.parse(source.authority.validUntil) ||
      !/^[1-9]\d*$/.test(source.authority.revision) ||
      ![source.authority.sourceId, source.authority.schemaVersion, source.authority.scopeRef,
        source.authority.evidenceRef].every(v => typeof v === "string" && v.trim()))
    throw new Error("customer_generation_authority");
  const count = (v: unknown) => v === null || Number.isSafeInteger(v) && Number(v) >= 0 && Number(v) <= 70000;
  if (!Array.isArray(source.dates) || !same(source.dates.map(d => d.date), input.dates) ||
      source.dates.some(d => !count(d.newCustomers)) || !Array.isArray(source.cohorts) ||
      source.cohorts.length !== p.cohorts.length || !Array.isArray(source.orderBindings) ||
      source.orderBindings.length > 10100 || source.orderBindings.length !== input.orders.length)
    throw new Error("customer_generation_inventory");
  for (const d of source.dates) if (d.newCustomers !== null) {
    const end = new Date(Date.parse(`${d.date}T00:00:00Z`) + 86400000).toISOString().slice(0, 10);
    if (Date.parse(source.sourceOrigin) > nyMidnight(d.date) || Date.parse(source.completeThrough) < nyMidnight(end))
      throw new Error("customer_generation_date_coverage");
  }
  const cohortKeys = new Set<string>();
  for (const c of source.cohorts) {
    const cfg = p.cohorts.find(v => v.month === c.cohortMonth && v.horizonDays === c.horizonDays);
    const key = `${c.cohortMonth}:${c.horizonDays}`;
    if (!cfg || cohortKeys.has(key) || c.graceSeconds !== cfg.graceSeconds ||
        c.acquisitionDefinition !== cfg.acquisitionDefinition || c.asOf !== p.asOf ||
        typeof c.mature !== "boolean" || !count(c.cohortCustomers) || !count(c.repeatCustomers) ||
        c.mature && (c.cohortCustomers === null || c.repeatCustomers === null || c.repeatCustomers > c.cohortCustomers) ||
        !c.mature && (c.cohortCustomers !== null || c.repeatCustomers !== null || c.revenueUsd !== null))
      throw new Error("customer_generation_cohort");
    if (c.mature && !monthCovered(c.cohortMonth, source.sourceOrigin, source.completeThrough))
      throw new Error("customer_generation_cohort_coverage");
    if (c.revenueUsd !== null) micros(c.revenueUsd);
    cohortKeys.add(key);
  }
  const orders = new Map(input.orders.map(o => [String(o.order_id), o]));
  if (orders.size !== input.orders.length) throw new Error("customer_generation_order_inventory");
  const seen = new Set<string>(), firstCustomers = new Set<string>(), firstOrderKeys = new Set<string>();
  for (const b of source.orderBindings) {
    const o = orders.get(b.orderId);
    if (!o || seen.has(b.orderId) || o.customer_id !== b.customerId || o.eligibility_status !== b.eligibility ||
        typeof b.firstEligibleOrder !== "boolean" ||
        (o.paid_at === null || b.paidAt === null ? o.paid_at !== b.paidAt :
          instant(String(o.paid_at)) !== instant(b.paidAt)) ||
        instant(String(o.source_updated_at)) !== instant(b.sourceUpdatedAt))
      throw new Error("customer_generation_order_changed");
    seen.add(b.orderId);
    if (b.firstEligibleOrder) {
      if (!b.customerId || b.eligibility !== "eligible" || !b.paidAt || firstCustomers.has(b.customerId))
        throw new Error("customer_generation_first_order");
      firstCustomers.add(b.customerId); firstOrderKeys.add(b.orderId);
    }
  }
  for (const c of input.customers) if (c.history_complete === true && c.first_eligible_order_id !== null) {
    const b = source.orderBindings.find(v => v.orderId === c.first_eligible_order_id);
    if (!b?.firstEligibleOrder || b.customerId !== c.customer_id)
      throw new Error("customer_generation_conflicting_history_claim");
  }
  for (const d of source.dates) if (d.newCustomers !== null &&
    source.orderBindings.filter(b => b.firstEligibleOrder && b.paidAt && nyDate(b.paidAt) === d.date).length > d.newCustomers)
    throw new Error("customer_generation_new_customer_count");
  return { source, firstOrderKeys, dates: new Map(source.dates.map(d => [d.date, d.newCustomers])),
    cohorts: new Map(source.cohorts.map(c => [`${c.cohortMonth}:${c.horizonDays}`, c])) };
}

/** No I/O, source read or completeness inference. This only normalizes the
 * independently registered customer-complete shard. It cannot select a report.
 * Financial mapping may be unavailable without invalidating eligible orders.
 */
export function normalizeHistoryCustomer(input: HistoryCustomerInput, now: string) {
  nyDate(now); nyDate(input.asOf); nyDate(input.expiresAt);
  nyDate(input.sourceOrigin); nyDate(input.completeThrough);
  const authority = input.authority;
  if (!authority || ![authority.authorityId, authority.sourceId, authority.schemaVersion,
    authority.scopeRef, authority.evidenceRef].every(v => typeof v === "string" && v.trim()) ||
    !/^[1-9]\d*$/.test(authority.revision) || !hash(authority.fingerprint) ||
    !Number.isSafeInteger(authority.maxAgeSeconds) || authority.maxAgeSeconds < 1 || authority.maxAgeSeconds > 300)
    throw new Error("history_customer_current_authority");
  nyDate(authority.capturedAt); nyDate(authority.validUntil);
  if (Date.parse(authority.capturedAt) > Date.parse(now) ||
    Date.parse(now) - Date.parse(authority.capturedAt) > authority.maxAgeSeconds * 1000 ||
    Date.parse(authority.validUntil) <= Date.parse(now) ||
    Date.parse(input.expiresAt) > Date.parse(authority.validUntil))
    throw new Error("history_customer_current_authority");
  if (input.state !== "claimed" || input.version !== 1 ||
      !/^[a-z]{20}$/.test(input.projectRef) ||
      ![input.runId, input.memberId, input.mappingVersion, input.evidence?.ref].every(v => typeof v === "string" && v.trim()) ||
      input.publication !== `customer-history:${input.runId}` ||
      !hash(input.inputHash) || !hash(input.generationHash) ||
      Date.parse(input.asOf) > Date.parse(now) || Date.parse(now) >= Date.parse(input.expiresAt) ||
      Date.parse(input.sourceOrigin) >= Date.parse(input.completeThrough) ||
      Date.parse(input.completeThrough) > Date.parse(input.asOf))
    throw new Error("history_customer_scope_or_clock");
  if (!input.reporting || !input.reporting.definition?.trim() ||
      !Array.isArray(input.reporting.cohorts) || input.reporting.cohorts.length > 100 ||
      new Set(input.reporting.cohorts.map(c => `${c.month}:${c.horizonDays}`)).size !== input.reporting.cohorts.length ||
      !Array.isArray(input.reporting.cohortCoverage) || !Array.isArray(input.evidence.cohortCoverage))
    throw new Error("history_customer_reporting_policy");
  if (Buffer.byteLength(canonicalJson(input)) > 8000000 || !Array.isArray(input.orders) ||
      !input.orders.length || input.orders.length > 100 ||
      !Array.isArray(input.evidence.identity) || input.evidence.identity.length > 10000)
    throw new Error("history_customer_shard_budget");
  const e = input.evidence, pub = input.publication, facts = empty();
  if (e.identity.some(row => row.mappingVersion !== input.mappingVersion ||
      row.customerId !== input.customerId) ||
      new Set(e.currentlyPermitted).size !== e.currentlyPermitted.length ||
      new Set(e.removedCustomers).size !== e.removedCustomers.length ||
      [...e.currentlyPermitted, ...e.removedCustomers].some(id => id !== input.customerId))
    throw new Error("history_customer_evidence_scope");
  const removed = new Set(e.removedCustomers);
  const permitted = new Set(e.currentlyPermitted.filter(id => !removed.has(id)));
  facts.identity_map = e.identity.map(row => normalizeIdentity(row, pub));
  const links = new Map(e.orderIdentities.map(link => [link.orderId, link]));
  if (links.size !== e.orderIdentities.length) throw new Error("history_customer_duplicate_link");
  const seen = new Set<string>(), usedLinks = new Set<string>();
  const ledgerUnavailable: string[] = [];
  for (const row of input.orders) {
    const id = shopifyId(row.id, "Order"), source = row.source;
    nyDate(row.updatedAt);
    if (seen.has(id) || !hash(row.sourceHash) || source.commerce.shop !== input.shop ||
        source.commerce.projection !== "financial_customer_id" ||
        source.commerce.order.id !== row.id || source.commerce.order.updatedAt !== row.updatedAt ||
        source.financial.id !== row.id || source.financial.updatedAt !== row.updatedAt ||
        Date.parse(row.updatedAt) > Date.parse(input.asOf))
      throw new Error("history_customer_source_revision");
    seen.add(id);
    if (row.decision.eligibility === "pending" || !row.decision.approvalRef?.trim())
      throw new Error("history_customer_unclassified_order");
    const sourceCustomer = source.commerce.order.customer;
    if (sourceCustomer === undefined) throw new Error("history_customer_missing_customer_projection");
    if (sourceCustomer !== null && !same(Object.keys(sourceObject(sourceCustomer)), ["id"]))
      throw new Error("history_customer_customer_projection");
    const sourceCustomerId = sourceCustomer === null ? null : shopifyId(sourceObject(sourceCustomer).id, "Customer");
    const evidenceRef = `history-customer-source:sha256:${row.sourceHash}`;
    const policy = mappingPolicy(source, { ...input.policy, decision: row.decision });
    const mapped = mapShopifyAnalyticsOrder(source.commerce, { ...policy, sourceEvidenceRef: evidenceRef }, pub);
    const order = mapped.orders[0], link = links.get(String(order.order_id));
    if (sourceCustomerId === null) {
      if (input.customerId !== null || input.orders.length !== 1 || link || e.identity.length)
        throw new Error("history_customer_guest_scope");
    } else {
      if (!link?.evidenceRef || link.namespace !== "shopify_customer" || link.identifier !== sourceCustomerId ||
          input.customerId === null) throw new Error("history_customer_source_link");
      usedLinks.add(link.orderId);
      const resolution = resolveTemporalIdentity({
        namespace: link.namespace, identifier: link.identifier,
        occurredAt: sourceString(order.paid_at ?? order.created_at),
        version: input.mappingVersion, publication: pub, mappings: facts.identity_map,
        currentlyPermitted: permitted, removedCustomers: removed,
      });
      // A changed mapping/permission cannot silently move or discard a customer.
      if (resolution.status !== "resolved" || resolution.customerId !== input.customerId)
        throw new Error("history_customer_ownership_or_permission");
      order.customer_id = input.customerId;
    }
    facts.orders.push(order);
    facts.order_items.push(...mapped.order_items);
    facts.payments.push(...mapped.payments);
    if (order.eligibility_status === "eligible") {
      try {
        const financial = mapPilotSource(source, policy, pub, evidenceRef);
        // Same commerce mapper, eligibility, source revision and paid clock.
        const financialOrder = { ...financial.facts.orders[0], customer_id: order.customer_id };
        if (!same(financialOrder, order)) throw new Error("history_customer_financial_order_changed");
        facts.sales_ledger.push(...financial.facts.sales_ledger);
      } catch (error) {
        // Only known financial-only limitations can withhold ledger values.
        // Commerce schema/paid-clock errors already failed above.
        if (!(error instanceof Error) || !/^pilot_[a-z_]+$/.test(error.message)) throw error;
        ledgerUnavailable.push(error.message);
      }
    }
  }
  if (usedLinks.size !== links.size) throw new Error("history_customer_extra_link");
  if (input.customerId !== null) {
    const history = e.customerHistory[input.customerId];
    if (Object.keys(e.customerHistory).length !== 1 || !history ||
        !history.completeThrough || !history.approvalRef || !history.migrationsReconciled ||
        !same(history.expectedSources, ["shopify"]) || !same(history.completeSources, ["shopify"]))
      throw new Error("history_customer_history_authority");
    nyDate(history.completeThrough);
    if (history.completeThrough !== input.completeThrough || Date.parse(history.completeThrough) > Date.parse(input.asOf))
      throw new Error("history_customer_history_cutoff");
    facts.customers = [buildCustomer(input.customerId, "resolved", permitted.has(input.customerId),
      history, facts.orders, pub)];
  } else if (Object.keys(e.customerHistory).length || e.currentlyPermitted.length || e.removedCustomers.length) {
    throw new Error("history_customer_guest_evidence");
  }
  const control = e.externalControls.temporal_identity_intervals;
  if (!control?.passed || !control.evidenceRef) throw new Error("history_customer_identity_control");
  const required = ["orders", "order_items", "customers", "identity_map"];
  const issues = [...validateCandidateGraph(facts, pub, "customer-history", false),
    ...reconcileCandidate(facts, e.proofs, required)];
  if (issues.length) throw new Error("history_customer_independent_reconciliation");
  const ledgerComplete = !ledgerUnavailable.length &&
    reconcileCandidate(facts, e.proofs, ["sales_ledger"]).length === 0;
  if (Object.values(facts).some(rows => rows.length > 10000) ||
      Buffer.byteLength(canonicalJson(facts)) > 16000000)
    throw new Error("history_customer_fact_budget");
  const components: CustomerCohortComponents[] = [];
  const customer = facts.customers[0];
  for (const cohort of input.reporting.cohorts) {
    // Nonmembers do not contribute a fabricated zero or poison another cohort.
    // The final reader independently counts all actual original members.
    if (!customer || String(customer.acquisition_date ?? "").slice(0, 7) !== cohort.month.slice(0, 7)) continue;
    const global = input.reporting.cohortCoverage.filter(c => c.month === cohort.month && c.horizonDays === cohort.horizonDays);
    const local = e.cohortCoverage.filter(c => c.month === cohort.month && c.horizonDays === cohort.horizonDays);
    if (global.length > 1 || local.length > 1) throw new Error("history_customer_duplicate_cohort_control");
    const scope: ReportScope = { shop: input.shop, publication: pub, definition: input.reporting.definition,
      model: "customer-history", date: input.reporting.fromDate, stale: true,
      gates: { orders: true, customers: true, ledger: ledgerComplete,
        cash: false, purchase: false, spend: false, attribution: false, behavior: false, productAllocation: false } };
    components.push(customerCohortComponents(facts as Facts, scope, {
      cohortMonth: cohort.month, horizonDays: cohort.horizonDays, graceSeconds: cohort.graceSeconds,
      asOf: input.asOf, acquisitionDefinition: cohort.acquisitionDefinition, approvalRef: input.policy.decision.approvalRef,
      fullMonthCovered: !!global[0]?.evidenceRef && global[0].fullMonthCovered &&
        monthCovered(cohort.month, input.sourceOrigin, input.completeThrough),
      ledgerLineageComplete: !!global[0]?.evidenceRef && global[0].ledgerLineageComplete &&
        !!local[0]?.evidenceRef && local[0].ledgerLineageComplete,
      originalLedgerIds: new Set(local[0]?.originalLedgerIds ?? []),
      historyCompleteThrough: new Map([[input.customerId!, e.customerHistory[input.customerId!].completeThrough!]]),
    }));
  }
  return {
    facts, ledgerComplete, components,
    customerComplete: input.customerId !== null &&
      facts.customers[0].history_complete === true && facts.customers[0].analytics_permitted === true,
    evidenceRef: e.ref, generationHash: input.generationHash,
    digest: evidenceDigest(facts),
  };
}

/** One durable member per invocation. Explicitly off unless a caller supplies
 * the local gate AND an owner-enabled SQL scope. No provider client or fetch.
 */
export async function runHistoryCustomerStep(options: {
  approved: boolean; client: AnalyticsRpcClient; runId: string; projectRef: string;
  now?: () => string;
}) {
  if (options.approved !== true) return { state: "disabled" };
  if (!/^[a-z]{20}$/.test(options.projectRef) || !/^[a-zA-Z0-9_-]{1,100}$/.test(options.runId))
    throw new Error("history_customer_target");
  const args = { p_run: options.runId, p_project: options.projectRef, p_token: randomUUID() };
  const input = sourceObject(await pipelineRpc(options.client, "lean_history_customer_claim", args));
  if (["disabled", "expired", "busy", "complete"].includes(String(input.state))) return { state: String(input.state) };
  if (input.runId !== options.runId || input.projectRef !== options.projectRef)
    throw new Error("history_customer_target");
  const result = normalizeHistoryCustomer(input as HistoryCustomerInput, (options.now ?? (() => new Date().toISOString()))());
  const done = await pipelineRpc(options.client, "lean_history_customer_finish", {
    ...args, p_member: input.memberId, p_input_hash: input.inputHash, p_result: result,
  });
  return { state: done === true ? "member_written" : "changed" };
}
