import type { CampaignContext } from "./attribution";
import type { ObservedEvent } from "./sessions";
import { key } from "./primitives";

/** Native source context from the first observed eligible session action.
 * A later tagged action cannot rewrite entry attribution. Coverage/identity
 * gates remain external; the first event in a bounded read is not proof that
 * the actual session entry was captured.
 */
export function observedCampaigns(events: ObservedEvent[], project: string, version: string,
  reviewed: { sessionKey: string; context: CampaignContext }[]) {
  const result = new Map<string, CampaignContext>();
  for (const row of reviewed) {
    if (result.has(row.sessionKey)) throw new Error("duplicate_campaign_evidence");
    result.set(row.sessionKey, row.context);
  }
  const sessions = new Map<string, ObservedEvent[]>();
  const actions = new Map<string, ObservedEvent>();
  const signature = (e: ObservedEvent) => JSON.stringify([
    e.campaignContext?.channel ?? null, e.campaignContext?.campaignKey ?? null,
    e.campaignContext?.direct ?? null,
  ]);
  for (const event of events) {
    if (event.project !== project) throw new Error("cross_project_campaign");
    if (!event.analyticsPermitted || !event.sourceSessionId) continue;
    const action = key(project, event.producer, event.family, event.actionId);
    const prior = actions.get(action);
    if (prior && signature(prior) !== signature(event)) throw new Error("conflicting_campaign_retry");
    actions.set(action, event);
    const session = key(project, version, event.sourceSessionId);
    sessions.set(session, [...sessions.get(session) ?? [], event]);
  }
  for (const [session, rows] of sessions) {
    rows.sort((a, b) => Date.parse(a.occurredAt) - Date.parse(b.occurredAt) ||
      a.nativeUuid.localeCompare(b.nativeUuid));
    const first = rows[0], context = first.campaignContext;
    // Same-time contradictory entry observations have no safe ordering.
    if (rows.some(r => r.occurredAt === first.occurredAt && signature(r) !== signature(first)))
      throw new Error("conflicting_campaign_entry");
    if (!context) continue;
    if (!context.evidenceRef?.trim()) throw new Error("campaign_source_evidence_required");
    const old = result.get(session);
    if (old && (old.channel !== context.channel || old.campaignKey !== context.campaignKey ||
        old.direct !== context.direct)) throw new Error("conflicting_campaign_evidence");
    result.set(session, old ?? context);
  }
  return result;
}
