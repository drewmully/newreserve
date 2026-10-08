import { createHash } from "node:crypto";
import { attributeOrders, type AttributionCoverage, type AttributionPolicy, type CampaignContext } from "./attribution";
import { buildCustomer, normalizeIdentity, resolveTemporalIdentity, type HistoryEvidence, type IdentityEvidence } from "./identity";
import { deriveSessions, finalizeSessionConversions, linkCheckoutOrders, normalizeEvents,
  type CheckoutEvidence, type ObservedEvent, type SessionCoverage } from "./sessions";
import { acquisitionDaily, customerCohort, funnelDaily, productDaily, storeDaily,
  customerCohortReport, ratio, type Facts, type Gates, type ReportScope } from "./reporting";
import { validateCandidateGraph, reconcileCandidate, type Candidate, type Reconciliation } from "./certification";
import { normalizeCommerce, type CommerceDecision, type ShopifySnapshot } from "./commerce";
import { normalizeLedger, normalizePayment, uniqueLedger, type Movement, type PaymentEvidence } from "./financial";
import { reportDates } from "./commerceCandidate";
import { checked, decimal, key, nyDate, type Row } from "./primitives";
import { observedCampaigns } from "./campaignSource";
import { sessionConversionWindowDays } from "./calculationPolicy";
import { admitCashSourceEvidence, type CashSourceAdmission } from "./cashSourceEvidence";
import { admitCustomerGeneration, validateCustomerGenerationContext, type CustomerGenerationBinding, type CustomerGenerationInput } from "./historyCustomerSource";
import { PURCHASE_PROCESSING_SCHEMA, resolvePurchaseHistoryOwnership } from "./purchaseHistoryOwnership";
import { admitSalesEventWindow, type SalesEventWindowInput, type SalesEventWindowBinding } from "./salesEventWindowInput";
import { prepareSessionEntries, mapEntryObservations, mapEntryCheckoutEvidence, deriveEntrySessions,
  sessionEntryDayCount, type SessionEntryPolicy, type SourceSessionEntryInput } from "./sessionEntryInput";
import { admitNativeSpendWindow, type NativeSpendWindowBinding, type NativeSpendWindowInput } from "./nativeSpendWindowInput";
import { prepareSourceSessionReportBuild, type SourceSessionReportBinding,
  type SourceSessionReportInputV1 } from "./sourceSessionProducer";
import { summarizeSourceSessionConversion } from "./sourceSessionConversionInput";

export type FullBuildPolicy = {
  definition: string; mappingVersion: string; sessionVersion: string; funnelVersion: string;
  normalizationVersion: string; project: string; asOf: string; approvalRef: string;
  stages: Record<string, string>; attribution: AttributionPolicy;
  /** Defaults to 7 days; version changed rules with definition/funnelVersion. */
  conversionWindowDays?: number;
  /** Immutable operator scope. Excluded behavior is unavailable, never zero. */
  behaviorMode?: "required" | "excluded";
  cohorts: { month: string; horizonDays: number; graceSeconds: number; acquisitionDefinition: string }[];
  /** Immutable reference only. The SQL wrapper derives and fences the input. */
  customerGeneration?: CustomerGenerationBinding;
  /** Explicit selected sales-event window, never a whole-store inventory. */
  salesEventWindow?: SalesEventWindowBinding;
  sessionEntryPolicy?: SessionEntryPolicy;
  nativeSpendWindow?: NativeSpendWindowBinding;
  /** Named immutable sidecar. Never an owner-stored general behavior gate. */
  sourceSessionReport?: SourceSessionReportBinding;
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
  dateCoverage: { date: string; gates: Gates; evidenceRef: string;
    cashSourceAdmission?: CashSourceAdmission }[];
  comparisons: string[];
  cohortCoverage: { month: string; horizonDays: number; fullMonthCovered: boolean;
    ledgerLineageComplete: boolean; originalLedgerIds: string[]; evidenceRef: string }[];
  /** SQL-derived only; forbidden in owner-stored evidence by the outer wrapper. */
  customerGeneration?: CustomerGenerationInput;
  /** Retained independent event locator plus exact native source dependencies. */
  salesEventWindow?: SalesEventWindowInput;
  sessionEntries?: SourceSessionEntryInput;
  nativeSpendWindow?: NativeSpendWindowInput;
  sourceSessionReport?: SourceSessionReportInputV1;
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
  const sourcePolicy = Object.hasOwn(input.policy, "sourceSessionReport");
  const sourceEvidence = Object.hasOwn(input.evidence, "sourceSessionReport");
  if (sourcePolicy !== sourceEvidence || sourcePolicy &&
      (!input.policy.sourceSessionReport || !input.evidence.sourceSessionReport))
    throw new Error("source_session_report_pair_required");
  // Recompute correspondence here, not just in the job caller. Direct builder
  // callers cannot replace source membership with a precomputed count or gate.
  const sourceReport = sourcePolicy ? prepareSourceSessionReportBuild(input.evidence.sourceSessionReport!, {
    binding: input.policy.sourceSessionReport!, publication: input.publication, shop: input.shop,
    fromDate: input.fromDate, throughDate: input.throughDate, policy: input.policy,
    evidence: input.evidence, events: input.events,
  }) : null;
  if (sourceReport) input = { ...input, policy: sourceReport.policy, evidence: sourceReport.evidence, events: sourceReport.events };
  const { policy: p, publication: pub, shop } = input;
  const cohortOnly = p.sourceSessionReport?.mode === "entry_cohort";
  if (cohortOnly && (p.salesEventWindow || p.nativeSpendWindow || p.customerGeneration || p.cohorts.length))
    throw new Error("source_session_cohort_financial_scope");
  const conversionWindowDays = sessionConversionWindowDays(p.conversionWindowDays);
  const mode = p.behaviorMode ?? "required";
  if (!["required", "excluded"].includes(mode)) throw new Error("invalid_behavior_mode");
  if (mode === "excluded" && input.events.length) throw new Error("excluded_behavior_events");
  const hasEntryPolicy = Object.hasOwn(p, "sessionEntryPolicy");
  const hasEntrySource = Object.hasOwn(input.evidence, "sessionEntries");
  const entryObject = (v: unknown) => v !== null && typeof v === "object" && !Array.isArray(v);
  if (hasEntryPolicy !== hasEntrySource || hasEntryPolicy &&
      (!entryObject(p.sessionEntryPolicy) || !entryObject(input.evidence.sessionEntries) || mode === "excluded"))
    throw new Error("entry_mode_requires_paired_active_source");
  if (Object.hasOwn(p, "nativeSpendWindow") !== Object.hasOwn(input.evidence, "nativeSpendWindow") ||
      Object.hasOwn(p, "nativeSpendWindow") &&
      (!entryObject(p.nativeSpendWindow) || !entryObject(input.evidence.nativeSpendWindow)))
    throw new Error("native_spend_window_binding");
  // Apply the exclusion at the transform boundary too: callers cannot retain
  // all-passed browser controls or turn an absent source into a measured zero.
  let e = mode === "excluded" ? withoutBehaviorEvidence(input.evidence) : input.evidence;
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
  const cashAdmissions = e.dateCoverage.flatMap(row => row.cashSourceAdmission ? [row.cashSourceAdmission] : []);
  if (cashAdmissions.length > 1) throw new Error("duplicate_cash_source_admission");
  if (cashAdmissions.length) {
    const { context, controls } = cashAdmissions[0];
    if (context.scope.shop !== shop || context.scope.fromDate !== input.fromDate ||
        context.scope.throughDate !== input.throughDate || context.asOf !== p.asOf)
      throw new Error("cash_consumer_scope");
    // Check the actual final set, including retained base and replacement cash.
    // Keep the registered evidence reference required by the SQL finish guard.
    e = { ...admitCashSourceEvidence(e, context, controls, facts.payments).evidence, ref: e.ref };
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
  // Only a SQL-derived, completed, immutable customer binding can opt purchase
  // orders into current processing authorization. Browser resolve stays intact.
  const purchaseSource = e.customerGeneration?.authority?.schemaVersion === PURCHASE_PROCESSING_SCHEMA
    ? validateCustomerGenerationContext(e.customerGeneration, {
      binding: p.customerGeneration, shop, fromDate: input.fromDate, throughDate: input.throughDate, policy: p,
    }) : undefined;
  facts.orders = facts.orders.map(row => {
    const link = orderIdentities.get(row.order_id as string);
    if (link && !link.evidenceRef) throw new Error("order_identity_evidence_required");
    const resolution = link && purchaseSource
      ? resolvePurchaseHistoryOwnership({
        authority: purchaseSource.authority, namespace: link.namespace, identifier: link.identifier,
        occurredAt: (row.paid_at ?? row.created_at) as string, version: p.mappingVersion, publication: pub,
        mappings: facts.identity_map, currentlyPermitted: permitted, removedCustomers: removed,
      }) : link ? resolve(link.namespace, link.identifier, (row.paid_at ?? row.created_at) as string) : null;
    return { ...row, customer_id: resolution?.customerId ?? null };
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
  const entries = p.sessionEntryPolicy && e.sessionEntries ? prepareSessionEntries(e.sessionEntries, {
    policy: p.sessionEntryPolicy, project: p.project, sessionVersion: p.sessionVersion,
    mappingVersion: p.mappingVersion, publication: pub, asOf: p.asOf, identity: e.identity,
    currentlyPermitted: e.currentlyPermitted, removedCustomers: e.removedCustomers,
  }) : null;
  if (entries && e.campaigns.length) throw new Error("entry_campaign_context_not_admitted");
  const entryObservations = entries ? mapEntryObservations(observations, entries) : null;
  const boundObservations = entryObservations
    ? entryObservations.events.map(event => ({ ...event, campaignContext: undefined })) : observations;
  const entryCheckout = entries ? mapEntryCheckoutEvidence(e.checkout, entries) : null;
  const logical = normalizeEvents(boundObservations, { project: p.project, publication: pub,
    families: new Set(Object.values(p.stages)), schemaVersions: new Set(observations.map(v => v.schemaVersion)),
    sessionVersion: p.sessionVersion, normalizationVersion: p.normalizationVersion });
  const nativeControls = ["native_project_uuid_lineage", "temporal_identity_intervals", "event_customer_fk"];
  const nativeReady = nativeControls.every(k => e.externalControls[k]?.passed && e.externalControls[k].evidenceRef);
  facts.sessions = entries ? deriveEntrySessions(logical, entries, {
    funnelVersion: p.funnelVersion, publication: pub, now: p.asOf, stages: new Map(Object.entries(p.stages)),
    coverage: { ...e.sessionCoverage, behaviorComplete: nativeReady && e.sessionCoverage.behaviorComplete },
    conversionWindowDays, relationsComplete: entryObservations!.unmappedActions === 0 && entryCheckout!.unmappedCheckout === 0,
  }) : deriveSessions(logical, { project: p.project, sessionVersion: p.sessionVersion,
    conversionWindowDays,
    funnelVersion: p.funnelVersion, publication: pub, now: p.asOf, stages: new Map(Object.entries(p.stages)),
    sourceSessionIds: new Map(observations.filter(v => v.sourceSessionId).map(v =>
      [key(p.project, p.sessionVersion, v.sourceSessionId!), v.sourceSessionId!])),
    coverage: { ...e.sessionCoverage, behaviorComplete: nativeReady && e.sessionCoverage.behaviorComplete } });
  facts.orders = linkCheckoutOrders(facts.orders, facts.sessions,
    (entryCheckout?.checkout ?? e.checkout).map(v => ({ ...v, publication: pub })), pub);
  const customers = new Set(e.identity.map(v => v.customerId).filter((v): v is string => v !== null));
  facts.customers = [...customers].sort().map(id => buildCustomer(id, removed.has(id) ? "removed" :
    permitted.has(id) ? "resolved" : "not_permitted", permitted.has(id), e.customerHistory[id] ??
    { expectedSources: [], completeSources: [], approvalRef: null, migrationsReconciled: false }, facts.orders, pub));
  const proofReady = (table: string) => reconcileCandidate(facts, e.proofs, [table]).length === 0;
  const commerceComplete = proofReady("orders") && proofReady("order_items") &&
    !!e.externalControls.event_order_diagnostics?.passed && !!e.externalControls.event_order_diagnostics.evidenceRef;
  facts.sessions = finalizeSessionConversions(facts.sessions, facts.orders, commerceComplete, conversionWindowDays);
  sourceReport?.entryAdmission.assertFinalSessions(facts.sessions);
  const attribution = unique(e.attributionCoverage, v => v.orderId);
  const campaigns = entries ? new Map<string, CampaignContext>() :
    observedCampaigns(observations, p.project, p.sessionVersion, e.campaigns);
  facts.sessions = facts.sessions.map(row => ({ ...row,
    traffic_source: campaigns.get(String(row.session_key))?.channel ?? null,
    campaign_id: campaigns.get(String(row.session_key))?.campaignKey ?? null,
  }));
  facts.order_attribution = attributeOrders({ orders: facts.orders, sessions: facts.sessions, events: logical,
    publication: pub, policy: p.attribution,
    coverage: new Map([...attribution].map(([id, row]) => [id, {
      lookbackComplete: !entries && !!row.evidenceRef && nativeReady && row.coverage.lookbackComplete,
      identityComplete: !entries && !!row.evidenceRef && proofReady("identity_map") && row.coverage.identityComplete,
      graceComplete: !entries && !!row.evidenceRef && row.coverage.graceComplete,
    }])), campaigns });
  const issues = validateCandidateGraph(facts, pub, p.attribution.modelVersion);
  if (issues.length) throw new Error(`invalid_full_candidate:${issues.join(",")}`);
  const customerInput = admitCustomerGeneration(e.customerGeneration, {
    binding: p.customerGeneration, shop, fromDate: input.fromDate, throughDate: input.throughDate,
    dates, policy: p, orders: facts.orders, customers: facts.customers,
  });
  const coverage = unique(e.dateCoverage, v => v.date);
  const verified = Object.fromEntries(Object.values(gateTables).flat().map(t => [t, proofReady(t)]));
  const eventWindow = admitSalesEventWindow(e.salesEventWindow, {
    binding: p.salesEventWindow, projectRef: e.salesEventWindow?.scope.projectRef ?? "",
    shop, fromDate: input.fromDate, throughDate: input.throughDate, asOf: p.asOf,
    publication: pub, facts,
  });
  const nativeSpend = admitNativeSpendWindow(e.nativeSpendWindow, {
    binding: p.nativeSpendWindow, projectRef: p.nativeSpendWindow?.projectRef ?? "",
    shop, publication: pub, fromDate: input.fromDate, throughDate: input.throughDate,
    asOf: p.asOf, facts: facts.marketing_spend_daily,
  });
  const scope = (date: string): ReportScope => {
    const claim = coverage.get(date);
    const gates = Object.fromEntries(Object.entries(gateTables).map(([gate, tables]) =>
      [gate, gateControls[gate as keyof Gates].every(k => e.externalControls[k]?.passed && e.externalControls[k].evidenceRef) &&
        !!claim?.evidenceRef && claim.gates[gate as keyof Gates] === true &&
        tables.every(t => verified[t])])) as Gates;
    // Scope this exception to the four independently controlled commerce gates.
    // It must never change global proofReady/commerceComplete, session conversion,
    // customer, cash, behavior, spend or attribution readiness.
    if (eventWindow?.dates.has(date) && claim?.evidenceRef === eventWindow.ref)
      for (const gate of ["ledger", "orders", "purchase", "productAllocation"] as const)
        gates[gate] = claim.gates[gate] === true;
    // Exact provider/account/date union only. Generic proofReady remains false
    // and this source-correspondence branch cannot promote any non-spend gate.
    if (nativeSpend?.dates.has(date) && claim?.evidenceRef === e.ref)
      gates.spend = claim.gates.spend === true;
    // Independent key totals alone do not establish semantic completeness.
    gates.customers &&= facts.customers.every(c => c.analytics_permitted === true &&
      c.identity_status === "resolved" && c.history_complete === true) &&
      facts.orders.filter(o => o.eligibility_status === "eligible").every(o => o.customer_id !== null);
    gates.attribution &&= facts.order_attribution.every(a => a.attribution_complete === true);
    if (entries) gates.attribution = false;
    gates.behavior &&= e.sessionCoverage.behaviorComplete && nativeReady &&
      facts.sessions.every(s => s.behavior_complete === true);
    return { shop, publication: pub, definition: p.definition, model: p.attribution.modelVersion,
      date, stale: true, gates };
  };
  const reports: Record<string, Row[]> = { store_daily: [], product_daily: [], acquisition_daily: [],
    customer_cohorts: [], funnel_daily: [] };
  for (const date of dates) {
    const s = scope(date);
    const store = storeDaily(facts as Facts, s);
    const acquisition = acquisitionDaily(facts as Facts, s, new Set(e.comparisons));
    if (eventWindow && customerInput) throw new Error("conflicting_customer_scope_admissions");
    if (eventWindow?.dates.has(date) && coverage.get(date)?.evidenceRef === eventWindow.ref) {
      // A complete independent paid-date original population plus conclusive
      // selected-customer histories supports this daily count, not a global
      // customer table, lifetime history, cohort or repeat/LTV admission.
      const n = eventWindow.customerCounts.get(date) ?? null;
      store.new_customers = n;
      store.ncac_usd = ratio(store.spend_usd as string | null, n === null ? null : decimal(BigInt(n) * BigInt(1000000)));
      Object.assign(store.readiness as Record<string, string>, {
        new_customers: n === null ? "withheld" : "ready", ncac_usd: store.ncac_usd === null ? "withheld" : "ready",
      });
    }
    if (customerInput) {
      const covered = coverage.get(date);
      const n = covered?.evidenceRef && covered.gates.customers === true ? customerInput.dates.get(date)! : null;
      if (n !== null && typeof store.eligible_orders === "number" && n > store.eligible_orders)
        throw new Error("customer_generation_conflicting_order_coverage");
      store.new_customers = n;
      store.ncac_usd = ratio(store.spend_usd as string | null, n === null ? null : decimal(BigInt(n) * BigInt(1000000)));
      Object.assign(store.readiness as Record<string, string>, {
        new_customers: n === null ? "withheld" : "ready", ncac_usd: store.ncac_usd === null ? "withheld" : "ready",
      });
      for (const row of acquisition) {
        const selected = facts.order_attribution.filter(a => a.conversion_date === date && a.channel === row.channel &&
          (a.campaign_id ?? (["unattributed", "not_applicable"].includes(String(a.channel)) ? a.channel : "no_campaign")) === row.campaign_bucket);
        const credits = n !== null && s.gates.attribution && selected.every(a => a.attribution_complete === true)
          ? decimal(BigInt(selected.filter(a => customerInput.firstOrderKeys.has(String(a.order_id))).length) * BigInt(1000000)) : null;
        row.weighted_new_customers = credits;
        row.ncac_usd = ratio(row.spend_usd as string | null, credits);
        Object.assign(row.readiness as Record<string, string>, {
          weighted_new_customers: credits === null ? "withheld" : "ready", ncac_usd: row.ncac_usd === null ? "withheld" : "ready",
        });
      }
    }
    reports.store_daily.push(store);
    reports.product_daily.push(...productDaily(facts as Facts, s));
    reports.acquisition_daily.push(...acquisition);
    const funnel = funnelDaily(facts as Facts, s, p.funnelVersion, Object.keys(p.stages));
    if (entries) {
      const admitted = nativeReady && proofReady("sessions") && coverage.get(date)?.evidenceRef &&
        coverage.get(date)?.gates.behavior === true;
      const count = sourceReport ? sourceReport.entryAdmission.count(date) :
        admitted ? sessionEntryDayCount(entries, date) : null;
      const all = funnel.find(row => row.stage_id === "all_sessions")!;
      all.measured_sessions = count; all.stage_reached_sessions = count;
      Object.assign(all.readiness as Record<string, string>, {
        measured_sessions: count === null ? "withheld" : "ready",
        stage_reached_sessions: count === null ? "withheld" : "ready",
      });
      // Action stages and paid conversions remain on their original evidence
      // and maturity gates. Entry counts cannot certify either one.
    }
    reports.funnel_daily.push(...funnel);
  }
  const cohortClaims = unique(e.cohortCoverage, v => key(v.month, String(v.horizonDays)));
  for (const cohort of p.cohorts) {
    const claim = cohortClaims.get(key(cohort.month, String(cohort.horizonDays)));
    const s = scope(dates[0]);
    if (customerInput) {
      let components = customerInput.cohorts.get(`${cohort.month}:${cohort.horizonDays}`)!;
      // This is a metric-specific external input, not a generic proof gate.
      // Keep the full build's explicit cohort coverage and lineage withholdings.
      if (!claim?.evidenceRef || !claim.fullMonthCovered)
        components = { ...components, mature: false, cohortCustomers: null, repeatCustomers: null, revenueUsd: null };
      else if (!claim.ledgerLineageComplete) components = { ...components, revenueUsd: null };
      reports.customer_cohorts.push(customerCohortReport(s, components));
      continue;
    }
    reports.customer_cohorts.push(customerCohort(facts as Facts, s, { cohortMonth: cohort.month,
      horizonDays: cohort.horizonDays, graceSeconds: cohort.graceSeconds, asOf: p.asOf,
      acquisitionDefinition: cohort.acquisitionDefinition, approvalRef: p.approvalRef,
      fullMonthCovered: !!claim?.evidenceRef && claim.fullMonthCovered,
      ledgerLineageComplete: !!claim?.evidenceRef && claim.ledgerLineageComplete,
      originalLedgerIds: new Set(claim?.originalLedgerIds ?? []),
      historyCompleteThrough: Object.values(e.customerHistory).some(h => h.completeThrough !== undefined)
        ? new Map(Object.entries(e.customerHistory).filter(([, h]) => h.completeThrough !== undefined)
          .map(([id, h]) => [id, h.completeThrough!])) : undefined }));
  }
  // Certification/selection is separate. Even reconciled numbers are private candidates.
  for (const rows of Object.values(reports)) for (const row of rows)
    row.readiness = Object.fromEntries(Object.entries(row.readiness as Record<string, string>)
      .map(([k, v]) => [k, v === "ready" ? "observed_unverified" : v]));
  const sessionEntryLineage = entries ? { ...entries.lineage,
    unmappedActions: entryObservations!.unmappedActions, unmappedCheckout: entryCheckout!.unmappedCheckout } : null;
  const sourceReportLineage = sourceReport ? {
    digest: sourceReport.entryAdmission.digest, ref: sourceReport.entryAdmission.ref,
    accounting: sourceReport.entryAdmission.accounting, mode: p.sourceSessionReport!.mode,
  } : null;
  const manifest = { nativeEvents: input.events.length, logicalEvents: logical.length,
    // Keep the existing five-field SQL manifest. Its digest now binds opt-in
    // source-entry lineage as well as logical actions; legacy bytes stay stable.
    digest: createHash("sha256").update(JSON.stringify(sourceReportLineage
      ? { logical, sessionEntryLineage, sourceReportLineage }
      : sessionEntryLineage ? { logical, sessionEntryLineage } : logical)).digest("hex"), evidenceRef: e.ref,
    gates: dates.map(date => ({ date, gates: scope(date).gates })) };
  // This is a readout, not input to certification or a source permission gate.
  // Excluded Google-only builds retain their previous output shape.
  const visitorConversion = mode === "required" ? summarizeSourceSessionConversion({
    publication: pub, fromDate: input.fromDate, throughDate: input.throughDate, asOf: p.asOf,
    conversionWindowDays, sessions: facts.sessions, orders: facts.orders, funnel: reports.funnel_daily,
    source: entries ? "native_entry" : "legacy_action_session",
    entryAccounting: sourceReport?.entryAdmission.accounting,
  }) : undefined;
  if (cohortOnly) {
    // The authentic completed base remains an input dependency. Its financial
    // facts and unavailable financial scaffolding are not a B5 publication.
    for (const table of Object.keys(facts)) if (table !== "sessions") facts[table] = [];
    for (const table of Object.keys(reports)) if (table !== "funnel_daily") reports[table] = [];
    if (facts.sessions.some(row => row.customer_id !== null || row.converted_session !== null))
      throw new Error("source_session_cohort_customer_or_conversion");
  }
  if (Object.values(reports).some(rows => rows.length > 20000) ||
      Buffer.byteLength(JSON.stringify({ facts, reports, manifest })) > 16000000) throw new Error("full_output_budget");
  return { facts, reports, manifest, ...(sessionEntryLineage ? { sessionEntryLineage } : {}),
    ...(visitorConversion ? { visitorConversion } : {}) };
}

export function withoutBehaviorEvidence(evidence: FullBuildEvidence): FullBuildEvidence {
  const e = structuredClone(evidence);
  e.checkout = [];
  e.campaigns = [];
  e.sessionCoverage.behaviorComplete = false;
  e.attributionCoverage = e.attributionCoverage.map(row => ({ ...row, coverage: {
    lookbackComplete: false, identityComplete: false, graceComplete: false,
  } }));
  e.dateCoverage = e.dateCoverage.map(row => ({ ...row, gates: {
    ...row.gates, behavior: false, attribution: false,
  } }));
  return e;
}
