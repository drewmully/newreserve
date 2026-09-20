import { checked, key, nyDate, type Row } from "./primitives";
export type ObservedEvent = {
  project: string; producer: string; actionId: string; nativeUuid: string; family: string; schemaVersion: string;
  occurredAt: string; receivedAt: string | null; sourceSessionId: string | null;
  distinctId: string | null; identityNamespace: string; customerId: string | null;
  analyticsPermitted: boolean;
};
/** An in-memory logical-view transform. It never persists a clone of native events. */
export function normalizeEvents(events: ObservedEvent[], config: {
  project: string; families: ReadonlySet<string>; schemaVersions: ReadonlySet<string>;
  sessionVersion: string; normalizationVersion: string; publication: string;
}): Row[] {
  const selected = new Map<string, Row>();
  for (const event of events) {
    if (event.project !== config.project) throw new Error("cross_project_event");
    if (!config.families.has(event.family) || !config.schemaVersions.has(event.schemaVersion)) throw new Error("unapproved_event_schema");
    nyDate(event.occurredAt);
    if (event.receivedAt) nyDate(event.receivedAt);
    const eventKey = key(event.project, event.producer, event.family, event.actionId);
    const row: Row = {
      event_key: eventKey, source_event_uuid: event.nativeUuid, event_name: event.family,
      schema_version: event.schemaVersion, producer: event.producer, occurred_at: event.occurredAt,
      received_at: event.receivedAt, distinct_id: event.analyticsPermitted ? event.distinctId : null,
      identity_namespace: event.identityNamespace, customer_id: event.analyticsPermitted ? event.customerId : null,
      session_key: event.sourceSessionId ? key(event.project, config.sessionVersion, event.sourceSessionId) : null,
      order_id: null, checkout_id: null, page_path: null, referrer: null, campaign_id: null, sku: null, offer_id: null,
      identity_status: !event.analyticsPermitted ? "restricted" : event.customerId ? "resolved" : "anonymous",
      session_link_status: event.sourceSessionId ? "pending" : "missing", order_link_status: "missing",
      analytics_eligible: event.analyticsPermitted, normalization_version: config.normalizationVersion,
      publication_id: config.publication,
    };
    const prior = selected.get(eventKey);
    if (prior) {
      for (const field of ["occurred_at", "session_key", "customer_id", "analytics_eligible"]) {
        if (prior[field] !== row[field]) throw new Error("conflicting_event_retry");
      }
      if (String(prior.source_event_uuid) <= event.nativeUuid) continue;
    }
    selected.set(eventKey, row);
  }
  return [...selected.values()];
}
export type SessionCoverage = { behaviorComplete: boolean; completeThrough: string; graceSeconds: number; approvalRef: string };
export function deriveSessions(events: Row[], config: {
  project: string; sessionVersion: string; funnelVersion: string; publication: string;
  sourceSessionIds: ReadonlyMap<string, string>; stages: ReadonlyMap<string, string>;
  now: string; coverage: SessionCoverage;
}): Row[] {
  if (!config.coverage.approvalRef || !Number.isSafeInteger(config.coverage.graceSeconds) || config.coverage.graceSeconds < 0) throw new Error("missing_session_policy");
  nyDate(config.now); nyDate(config.coverage.completeThrough);
  const grouped = new Map<string, Row[]>();
  for (const e of events) {
    if (e.publication_id !== config.publication) throw new Error("mixed_publication");
    if (!e.session_key) continue;
    const k = e.session_key as string;
    grouped.set(k, [...(grouped.get(k) ?? []), e]);
  }
  return [...grouped].map(([sessionKey, rows]) => {
    rows.sort((a, b) => String(a.occurred_at).localeCompare(String(b.occurred_at)));
    const first = rows[0];
    const sourceId = config.sourceSessionIds.get(sessionKey);
    if (!sourceId || key(config.project, config.sessionVersion, sourceId) !== sessionKey) throw new Error("invalid_session_namespace");
    const eligible = rows.filter(e => e.analytics_eligible === true);
    const customers = new Set(eligible.map(e => e.customer_id).filter(Boolean));
    const behavior = config.coverage.behaviorComplete;
    const windowEnd = Date.parse(first.occurred_at as string) + 7 * 86400000;
    const mature = behavior && Date.parse(config.now) >= windowEnd + config.coverage.graceSeconds * 1000 &&
      Date.parse(config.coverage.completeThrough) >= windowEnd;
    const flags: Record<string, boolean | null> = {};
    for (const stage of config.stages.keys()) flags[stage] = behavior ? eligible.some(e => e.event_name === config.stages.get(stage)) : null;
    return checked("sessions", {
      session_key: sessionKey, source_session_id: sourceId, sessionization_version: config.sessionVersion,
      started_at: first.occurred_at, ended_at: null, report_date: nyDate(first.occurred_at as string),
      entry_page: null, traffic_source: null, utm_source: null, utm_medium: null, utm_campaign: null,
      campaign_id: null, device_type: null, observed_geo: null,
      customer_id: customers.size === 1 ? [...customers][0] : null,
      identity_status: customers.size > 1 ? "conflicting" : customers.size === 1 ? "resolved" : "anonymous",
      eligible_event_count: behavior ? eligible.length : null, funnel_flags: flags,
      behavior_complete: behavior, conversion_window_complete: mature, analytics_eligible: eligible.length > 0,
      converted_session: null, funnel_version: config.funnelVersion, publication_id: config.publication,
    });
  });
}
export type CheckoutEvidence = {
  orderId: string; sessionKey: string; publication: string;
  method: "corroborated_checkout_id" | "verified_first_party_context"; evidenceRef: string;
};
export function linkCheckoutOrders(orders: Row[], sessions: Row[], evidence: CheckoutEvidence[], publication: string): Row[] {
  return orders.map(order => {
    if (order.publication_id !== publication) throw new Error("mixed_publication");
    const links = evidence.filter(e => e.publication === publication && e.orderId === order.order_id && e.evidenceRef &&
      sessions.some(s => s.publication_id === publication && s.session_key === e.sessionKey && s.analytics_eligible === true &&
        (!order.customer_id || !s.customer_id || order.customer_id === s.customer_id)));
    const unique = new Set(links.map(e => e.sessionKey));
    const match = unique.size === 1 ? links[0] : null;
    return { ...order, checkout_session_key: match?.sessionKey ?? null,
      checkout_link_status: match ? "matched" : unique.size > 1 ? "conflicting" : "missing",
      checkout_link_method: match?.method ?? "none", evidence_ref: match?.evidenceRef ?? null, link_version: "evidence-only-v1" };
  });
}
export function finalizeSessionConversions(sessions: Row[], orders: Row[], commerceComplete: boolean): Row[] {
  return sessions.map(s => {
    const ready = commerceComplete && s.conversion_window_complete === true && s.analytics_eligible === true;
    const start = Date.parse(s.started_at as string);
    const converted = ready ? orders.some(o => o.publication_id === s.publication_id && o.checkout_link_status === "matched" &&
      o.checkout_session_key === s.session_key && o.eligibility_status === "eligible" && typeof o.paid_at === "string" &&
      Date.parse(o.paid_at) >= start && Date.parse(o.paid_at) < start + 7 * 86400000) : null;
    return { ...s, converted_session: converted };
  });
}
