import { createHash } from "node:crypto";
import { attributeOrders, type AttributionCoverage, type AttributionPolicy, type CampaignContext } from "./attribution";
import { buildCustomer, normalizeIdentity, resolveTemporalIdentity, type HistoryEvidence, type IdentityEvidence } from "./identity";
import { deriveSessions, finalizeSessionConversions, linkCheckoutOrders, normalizeEvents,
  type CheckoutEvidence, type ObservedEvent, type SessionCoverage } from "./sessions";
import { acquisitionDaily, customerCohort, funnelDaily, productDaily, storeDaily,
  type Facts, type Gates, type ReportScope } from "./reporting";
import { validateCandidateGraph, reconcileCandidate, type Candidate, type Reconciliation } from "./certification";
import { normalizeCommerce, type CommerceDecision, type ShopifySnapshot } from "./commerce";
import { normalizeLedger, normalizePayment, uniqueLedger, type Movement, type PaymentEvidence } from "./financial";
import { reportDates } from "./commerceCandidate";
import { checked, key, nyDate, type Row } from "./primitives";

export type FullBuildPolicy = {
  definition: string; mappingVersion: string; sessionVersion: string; funnelVersion: string;
  normalizationVersion: string; project: string; asOf: string; approvalRef: string;
  stages: Record<string, string>; attribution: AttributionPolicy;
  cohorts: { month: string; horizonDays: number; graceSeconds: number; acquisitionDefinition: string }[];
};
/** Owner-supplied evidence, never arbitrary "all gates true" from an HTTP caller.
 * Current permission/removals must come from the analytics consent authority,
 * NOT email/SMS marketing flags or a Firebase disabled flag.
 */
export type FullBuildEvidence = {
  ref: string;
  identity: IdentityEvidence[];
  currentlyPermitted: string[]; removedCustomers: string[];
  customerHistory: Record<string, HistoryEvidence>;
  orderIdentities: { orderId: string; namespace: string; identifier: string; evidenceRef: string }[];
  checkout: Omit<CheckoutEvidence, "publication">[];
  campaigns: { sessionKey: string; context: CampaignContext }[];
  sessionCoverage: SessionCoverage;
  attributionCoverage: { orderId: string; coverage: AttributionCoverage; evidenceRef: string }[];
  // Original-purchase snapshots support edits, non-merchandise and non-USD cases
  // without misusing current line totals. Replace an order as one atomic unit.
  replacements: { snapshot: ShopifySnapshot; decision: CommerceDecision; movements: Movement[];
    payments: PaymentEvidence[]; evidenceRef: string }[];
  settlements: PaymentEvidence[];
  offers: { orderItemId: string; offerId: string; evidenceRef: string; mappingVersion: string;
    membershipBasis?: "source_line_discount" | "source_evidence" | "approved_bundle_rule" }[];
  proofs: Reconciliation[];
  externalControls: Record<string, { passed: boolean; evidenceRef: string }>;
  dateCoverage: { date: string; gates: Gates; evidenceRef: string }[];
  comparisons: string[];
  cohortCoverage: { month: string; horizonDays: number; fullMonthCovered: boolean;
    ledgerLineageComplete: boolean; originalLedgerIds: string[]; evidenceRef: string }[];
};
const gateTables: Record<keyof Gates, string[]> = {
  ledger: ["sales_ledger"], cash: ["payments"], orders: ["orders", "order_items"],
  purchase: ["orders", "order_items"], customers: ["customers", "identity_map"],
  spend: ["marketing_spend_daily"], attribution: ["order_attribution"],
  behavior: ["sessions"], productAllocation: ["sales_ledger", "order_items"],
};
// Controls are dependencies, not a global switch. Missing browser identity
// cannot erase independently reconciled commerce/cash. Certification and
// release still require all controls for their explicitly selected scope.
const gateControls: Record<keyof Gates, string[]> = {
  ledger: [], cash: [], orders: [], purchase: [], productAllocation: [],
  customers: ["temporal_identity_intervals"],
  spend: ["compatible_spend_scope"],
  behavior: ["event_customer_fk", "temporal_identity_intervals", "event_session_fk", "native_project_uuid_lineage"],
  attribution: ["event_customer_fk", "temporal_identity_intervals", "event_session_fk",
    "event_order_diagnostics", "native_project_uuid_lineage", "attribution_touch_event_fk"],
};
function unique<T>(rows: T[], id: (row: T) => string): Map<string, T> {
  const out = new Map<string, T>();
  for (const row of rows) {
    const k = id(row); if (out.has(k)) throw new Error("duplicate_full_build_evidence"); out.set(k, row);
  }
  return out;
}
export function buildFullReports(input: {
  base: Candidate; publication: string; shop: string; fromDate: string; throughDate: string;
  policy: FullBuildPolicy; evidence: FullBuildEvidence; events: ObservedEvent[];
}) {
  const { policy: p, evidence: e, publication: pub, shop } = input;
  if (![p.definition, p.mappingVersion, p.sessionVersion, p.funnelVersion, p.normalizationVersion,
    p.project, p.approvalRef, e.ref].every(v => typeof v === "string" && v.trim())) throw new Error("full_build_policy_required");
  nyDate(p.asOf);
  const dates = reportDates(input.fromDate, input.throughDate);
  if (dates.length > 31 || input.events.length > 10000 || e.identity.length > 10000 ||
      e.replacements.length > 100) throw new Error("full_build_budget");
  if (p.cohorts.length > 100 || Object.keys(p.stages).length > 50 ||
      Object.keys(p.stages).includes("all_sessions")) throw new Error("full_build_policy_budget");
  const facts: Candidate = Object.fromEntries(Object.entries(input.base).map(([table, rows]) =>
    [table, rows.map(row => ({ ...row, publication_id: pub }))]));
  for (const replacement of unique(e.replacements, r => key(r.snapshot.shop, r.snapshot.id)).values()) {
    const { snapshot, decision, movements, payments } = replacement;
    if (!replacement.evidenceRef || snapshot.shop !== shop) throw new Error("replacement_scope");
    const id = key(shop, snapshot.id);
    const items = new Set(facts.order_items.filter(i => i.order_id === id).map(i => i.order_item_id));
    for (const t of ["orders", "order_items", "sales_ledger", "payments", "order_attribution"])
      facts[t] = facts[t].filter(row => row.order_id !== id);
    facts.order_item_offers = facts.order_item_offers.filter(row => !items.has(row.order_item_id));
    const mapped = normalizeCommerce(snapshot, decision, pub);
    facts.orders.push(...mapped.orders); facts.order_items.push(...mapped.order_items);
    facts.order_item_offers.push(...mapped.order_item_offers);
    let ledger: Row[] = [];
    for (const m of movements) {
      if (m.shop !== shop || m.orderId !== snapshot.id) throw new Error("replacement_movement_scope");
      ledger = uniqueLedger([...ledger, ...normalizeLedger(m, pub, ledger)]);
    }
    facts.sales_ledger.push(...ledger);
    for (const payment of payments) {
      if (payment.shop !== shop || payment.orderId !== snapshot.id) throw new Error("replacement_payment_scope");
      facts.payments.push(normalizePayment(payment, pub));
    }
  }
  for (const payment of unique(e.settlements, r => key(r.shop, r.gateway, r.id)).values()) {
    if (payment.shop !== shop || !payment.settlementEvidenceRef) throw new Error("settlement_scope");
    const row = normalizePayment(payment, pub), old = facts.payments.find(v => v.payment_id === row.payment_id);
    if (old && ["order_id", "parent_payment_id", "source_amount", "source_currency", "transaction_kind"]
      .some(field => old[field] !== row[field])) throw new Error("settlement_conflicts_with_transaction");
    facts.payments = facts.payments.filter(v => v.payment_id !== row.payment_id); facts.payments.push(row);
  }
  for (const offer of e.offers) {
    if (!offer.evidenceRef || !offer.mappingVersion) throw new Error("offer_evidence_required");
    if (offer.membershipBasis !== undefined &&
        !["source_line_discount", "source_evidence", "approved_bundle_rule"].includes(offer.membershipBasis))
      throw new Error("offer_membership_basis_invalid");
    facts.order_item_offers.push(checked("order_item_offers", {
      order_item_id: offer.orderItemId, offer_id: offer.offerId, membership_basis: offer.membershipBasis ?? "source_evidence",
      evidence_ref: offer.evidenceRef, offer_mapping_version: offer.mappingVersion, publication_id: pub,
    }));
  }
  facts.identity_map = e.identity.map(row => normalizeIdentity(row, pub));
  const removed = new Set(e.removedCustomers);
  const permitted = new Set(e.currentlyPermitted.filter(id => !removed.has(id)));
  const resolve = (namespace: string, identifier: string, occurredAt: string) => resolveTemporalIdentity({
    namespace, identifier, occurredAt, version: p.mappingVersion, publication: pub,
    mappings: facts.identity_map, currentlyPermitted: permitted, removedCustomers: removed,
  });
  const orderIdentities = unique(e.orderIdentities, r => r.orderId);
  facts.orders = facts.orders.map(row => {
    const link = orderIdentities.get(row.order_id as string);
    if (link && !link.evidenceRef) throw new Error("order_identity_evidence_required");
    return { ...row, customer_id: link ? resolve(link.namespace, link.identifier,
      (row.paid_at ?? row.created_at) as string).customerId : null };
  });
  const observations = input.events.map(event => {
    if (Date.parse(event.occurredAt) > Date.parse(p.asOf)) throw new Error("future_behavior_event");
    const resolution = event.distinctId ? resolve(event.identityNamespace, event.distinctId, event.occurredAt) : null;
    const restricted = resolution && ["removed", "not_permitted", "conflicting"].includes(resolution.status);
    // First-party lean collection must have a current authority snapshot even
    // when anonymous. An old event's boolean is not current permission.
    const journeyAuthority = !event.family.startsWith("lean_") || event.identityNamespace === "lean_subject" &&
      e.identity.some(row => row.namespace === "lean_subject" && row.identifier === event.distinctId &&
        row.mappingVersion === p.mappingVersion && row.consent === "permitted" && row.removal === "active" &&
        Date.parse(row.from) <= Date.parse(event.occurredAt) &&
        (row.to === null || Date.parse(event.occurredAt) < Date.parse(row.to)));
    const allowed = event.analyticsPermitted && !restricted && journeyAuthority;
    return { ...event, analyticsPermitted: !!allowed, customerId: allowed ? resolution?.customerId ?? null : null,
      distinctId: allowed ? event.distinctId : null, sourceSessionId: allowed ? event.sourceSessionId : null };
  });
  const logical = normalizeEvents(observations, { project: p.project, publication: pub,
    families: new Set(Object.values(p.stages)), schemaVersions: new Set(observations.map(v => v.schemaVersion)),
    sessionVersion: p.sessionVersion, normalizationVersion: p.normalizationVersion });
  const nativeControls = ["native_project_uuid_lineage", "temporal_identity_intervals", "event_customer_fk"];
  const nativeReady = nativeControls.every(k => e.externalControls[k]?.passed && e.externalControls[k].evidenceRef);
  facts.sessions = deriveSessions(logical, { project: p.project, sessionVersion: p.sessionVersion,
    funnelVersion: p.funnelVersion, publication: pub, now: p.asOf, stages: new Map(Object.entries(p.stages)),
    sourceSessionIds: new Map(observations.filter(v => v.sourceSessionId).map(v =>
      [key(p.project, p.sessionVersion, v.sourceSessionId!), v.sourceSessionId!])),
    coverage: { ...e.sessionCoverage, behaviorComplete: nativeReady && e.sessionCoverage.behaviorComplete } });
  facts.orders = linkCheckoutOrders(facts.orders, facts.sessions, e.checkout.map(v => ({ ...v, publication: pub })), pub);
  const customers = new Set(e.identity.map(v => v.customerId).filter((v): v is string => v !== null));
  facts.customers = [...customers].sort().map(id => buildCustomer(id, removed.has(id) ? "removed" :
    permitted.has(id) ? "resolved" : "not_permitted", permitted.has(id), e.customerHistory[id] ??
    { expectedSources: [], completeSources: [], approvalRef: null, migrationsReconciled: false }, facts.orders, pub));
  const proofReady = (table: string) => reconcileCandidate(facts, e.proofs, [table]).length === 0;
  const commerceComplete = proofReady("orders") && proofReady("order_items") &&
    !!e.externalControls.event_order_diagnostics?.passed && !!e.externalControls.event_order_diagnostics.evidenceRef;
  facts.sessions = finalizeSessionConversions(facts.sessions, facts.orders, commerceComplete);
  const attribution = unique(e.attributionCoverage, v => v.orderId);
  const campaigns = unique(e.campaigns, v => v.sessionKey);
  facts.order_attribution = attributeOrders({ orders: facts.orders, sessions: facts.sessions, events: logical,
    publication: pub, policy: p.attribution,
    coverage: new Map([...attribution].map(([id, row]) => [id, {
      lookbackComplete: !!row.evidenceRef && nativeReady && row.coverage.lookbackComplete,
      identityComplete: !!row.evidenceRef && proofReady("identity_map") && row.coverage.identityComplete,
      graceComplete: !!row.evidenceRef && row.coverage.graceComplete,
    }])), campaigns: new Map([...campaigns].map(([id, row]) => [id, row.context])) });
  const issues = validateCandidateGraph(facts, pub, p.attribution.modelVersion);
  if (issues.length) throw new Error(`invalid_full_candidate:${issues.join(",")}`);
  const coverage = unique(e.dateCoverage, v => v.date);
  const verified = Object.fromEntries(Object.values(gateTables).flat().map(t => [t, proofReady(t)]));
  const scope = (date: string): ReportScope => {
    const claim = coverage.get(date);
    const gates = Object.fromEntries(Object.entries(gateTables).map(([gate, tables]) =>
      [gate, gateControls[gate as keyof Gates].every(k => e.externalControls[k]?.passed && e.externalControls[k].evidenceRef) &&
        !!claim?.evidenceRef && claim.gates[gate as keyof Gates] === true &&
        tables.every(t => verified[t])])) as Gates;
    // Independent key totals alone do not establish semantic completeness.
    gates.customers &&= facts.customers.every(c => c.analytics_permitted === true &&
      c.identity_status === "resolved" && c.history_complete === true) &&
      facts.orders.filter(o => o.eligibility_status === "eligible").every(o => o.customer_id !== null);
    gates.attribution &&= facts.order_attribution.every(a => a.attribution_complete === true);
    gates.behavior &&= e.sessionCoverage.behaviorComplete && nativeReady &&
      facts.sessions.every(s => s.behavior_complete === true);
    return { shop, publication: pub, definition: p.definition, model: p.attribution.modelVersion,
      date, stale: true, gates };
  };
  const reports: Record<string, Row[]> = { store_daily: [], product_daily: [], acquisition_daily: [],
    customer_cohorts: [], funnel_daily: [] };
  for (const date of dates) {
    const s = scope(date);
    reports.store_daily.push(storeDaily(facts as Facts, s));
    reports.product_daily.push(...productDaily(facts as Facts, s));
    reports.acquisition_daily.push(...acquisitionDaily(facts as Facts, s, new Set(e.comparisons)));
    reports.funnel_daily.push(...funnelDaily(facts as Facts, s, p.funnelVersion, Object.keys(p.stages)));
  }
  const cohortClaims = unique(e.cohortCoverage, v => key(v.month, String(v.horizonDays)));
  for (const cohort of p.cohorts) {
    const claim = cohortClaims.get(key(cohort.month, String(cohort.horizonDays)));
    const s = scope(dates[0]);
    reports.customer_cohorts.push(customerCohort(facts as Facts, s, { cohortMonth: cohort.month,
      horizonDays: cohort.horizonDays, graceSeconds: cohort.graceSeconds, asOf: p.asOf,
      acquisitionDefinition: cohort.acquisitionDefinition, approvalRef: p.approvalRef,
      fullMonthCovered: !!claim?.evidenceRef && claim.fullMonthCovered,
      ledgerLineageComplete: !!claim?.evidenceRef && claim.ledgerLineageComplete,
      originalLedgerIds: new Set(claim?.originalLedgerIds ?? []) }));
  }
  // Certification/selection is separate. Even reconciled numbers are private candidates.
  for (const rows of Object.values(reports)) for (const row of rows)
    row.readiness = Object.fromEntries(Object.entries(row.readiness as Record<string, string>)
      .map(([k, v]) => [k, v === "ready" ? "observed_unverified" : v]));
  const manifest = { nativeEvents: input.events.length, logicalEvents: logical.length,
    digest: createHash("sha256").update(JSON.stringify(logical)).digest("hex"), evidenceRef: e.ref,
    gates: dates.map(date => ({ date, gates: scope(date).gates })) };
  if (Object.values(reports).some(rows => rows.length > 20000) ||
      Buffer.byteLength(JSON.stringify({ facts, reports, manifest })) > 16000000) throw new Error("full_output_budget");
  return { facts, reports, manifest };
}
