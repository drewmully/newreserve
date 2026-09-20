import { checked, nyDate, type Row } from "./primitives";
export type AttributionPolicy = {
  modelVersion: string; lookbackDays: number; approvalRef: string; allowObservedDirectFallback: boolean;
};
export type AttributionCoverage = { lookbackComplete: boolean; identityComplete: boolean; graceComplete: boolean };
export type CampaignContext = { channel: string; campaignKey: string | null; direct: boolean; evidenceRef: string };
/** One reviewed single-touch classification per eligible order, including unassigned buckets. */
export function attributeOrders(input: {
  orders: Row[]; sessions: Row[]; events: Row[]; publication: string; policy: AttributionPolicy;
  coverage: ReadonlyMap<string, AttributionCoverage>; campaigns: ReadonlyMap<string, CampaignContext>;
}): Row[] {
  const { policy } = input;
  if (!policy.approvalRef || !policy.modelVersion || !Number.isInteger(policy.lookbackDays) ||
      policy.lookbackDays < 1 || policy.lookbackDays > 365) throw new Error("unapproved_attribution_policy");
  const seen = new Set<string>();
  return input.orders.filter(o => o.eligibility_status === "eligible").map(order => {
    if (order.publication_id !== input.publication || typeof order.paid_at !== "string" || seen.has(String(order.order_id))) throw new Error("invalid_attribution_order");
    seen.add(String(order.order_id));
    const paid = Date.parse(order.paid_at);
    const coverage = input.coverage.get(order.order_id as string);
    const applicable = order.acquisition_eligible === true;
    const complete = !applicable || !!coverage?.lookbackComplete && coverage.identityComplete && coverage.graceComplete;
    const candidates = complete && applicable && order.customer_id ? input.sessions.filter(s => {
      const campaign = input.campaigns.get(s.session_key as string);
      const start = Date.parse(s.started_at as string);
      return s.publication_id === input.publication && s.customer_id === order.customer_id &&
        s.analytics_eligible === true && s.behavior_complete === true && s.identity_status === "resolved" &&
        start >= paid - policy.lookbackDays * 86400000 && start <= paid && !!campaign?.evidenceRef;
    }).sort((a, b) => Date.parse(b.started_at as string) - Date.parse(a.started_at as string) ||
      String(a.session_key).localeCompare(String(b.session_key))) : [];
    const nonDirect = candidates.find(s => !input.campaigns.get(s.session_key as string)!.direct);
    const selected = nonDirect ?? (policy.allowObservedDirectFallback ? candidates[0] : undefined);
    const campaign = selected ? input.campaigns.get(selected.session_key as string)! : undefined;
    const touches = selected ? input.events.filter(e => e.publication_id === input.publication &&
      e.session_key === selected.session_key && e.analytics_eligible === true &&
      Date.parse(e.occurred_at as string) >= Date.parse(selected.started_at as string) &&
      Date.parse(e.occurred_at as string) <= paid).sort((a, b) =>
        Date.parse(b.occurred_at as string) - Date.parse(a.occurred_at as string) ||
        String(a.event_key).localeCompare(String(b.event_key))) : [];
    return checked("order_attribution", {
      order_id: order.order_id, model_version: policy.modelVersion, publication_id: input.publication,
      acquisition_session_key: selected?.session_key ?? null, touch_event_key: touches[0]?.event_key ?? null,
      channel: !applicable ? "not_applicable" : campaign?.channel ?? "unattributed",
      campaign_id: campaign?.campaignKey ?? null,
      attribution_status: !complete ? "pending" : !applicable ? "not_applicable" : selected ? "attributed" : "unattributed",
      lookback_days: policy.lookbackDays, conversion_time_basis: "orders.paid_at", credit_weight: "1.000000000",
      conversion_date: nyDate(order.paid_at), attribution_complete: complete,
    });
  });
}
export function firstCustomerCredits(customers: Row[], attribution: Row[], publication: string, model: string): Row[] {
  const seen = new Set<string>();
  return customers.flatMap(c => {
    if (c.publication_id !== publication || c.analytics_permitted !== true || c.identity_status !== "resolved" ||
        c.history_complete !== true || !c.first_eligible_order_id) return [];
    if (seen.has(c.customer_id as string)) throw new Error("duplicate_customer_credit");
    seen.add(c.customer_id as string);
    const rows = attribution.filter(a => a.publication_id === publication && a.model_version === model &&
      a.order_id === c.first_eligible_order_id && a.attribution_complete === true);
    if (rows.length > 1) throw new Error("duplicate_order_credit");
    return rows.length ? [{ ...rows[0], customer_id: c.customer_id }] : [];
  });
}
