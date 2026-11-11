/**
 * Assembles the email funnel report from live sources. Dependencies are
 * injectable so tests can run the whole pipeline against fixtures.
 */

import {
  FLOWS,
  KLAVIYO_METRICS,
  POPUP_STEPS,
  POPUP_VIEW_EVENT,
  WELCOME_FLOW_IDS,
  type FunnelWindow,
} from "./config";
import {
  buildCohort,
  buildFlowTable,
  buildFunnel,
  buildPopupFunnel,
  buildSourceTable,
  profileOutcome,
  rankLeaks,
  triggerSources,
  type FlowDefinition,
  type FlowTableRow,
  type FunnelStage,
  type Leak,
  type PopupStep,
  type ProfileOutcome,
  type SourceRow,
} from "./compute";
import * as live from "./sources";
import { Issues, type SourceIssue } from "./sources";

export interface FunnelReport {
  window: FunnelWindow;
  generatedAt: string;
  range: { start: string; end: string };
  funnel: FunnelStage[];
  signupsWithOrder: number;
  signupsWithRepeatOrReserve: number;
  sources: SourceRow[];
  flows: FlowTableRow[];
  popup: PopupStep[];
  leaks: Leak[];
  routing: Array<{ flowId: string; label: string; status: string; sources: string[] }>;
  coverage: string[];
  queries: Record<string, string>;
  issues: SourceIssue[];
}

export type Sources = Pick<
  typeof live,
  | "fetchSignupEvents"
  | "fetchProfileEvents"
  | "fetchExclusionProfileIds"
  | "fetchFlowDefinitions"
  | "fetchFlowReport"
  | "fetchPosthog"
  | "fetchShotRedemptions"
>;

function isoMinus(iso: string, deltaMs: number): string {
  return new Date(Date.parse(iso) - deltaMs).toISOString().replace(/\.\d{3}Z$/, "Z");
}

async function attempt<T>(issues: Issues, source: SourceIssue["source"], what: string, fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    issues.add(source, what, err);
    return null;
  }
}

export async function buildFunnelReport(window: FunnelWindow, opts: { now?: Date; sources?: Sources } = {}): Promise<FunnelReport> {
  const src = opts.sources ?? live;
  const now = opts.now ?? new Date();
  const start = new Date(now.getTime() - window * 86_400_000);
  const startIso = start.toISOString().replace(/\.\d{3}Z$/, "Z");
  const endIso = now.toISOString().replace(/\.\d{3}Z$/, "Z");
  const issues = new Issues();
  const coverage: string[] = [];

  const [signups, excluded, flowDefs, flowReport, posthog, shot] = await Promise.all([
    attempt(issues, "klaviyo", "signup events", () => src.fetchSignupEvents(startIso)),
    attempt(issues, "klaviyo", "exclusion segment", () => src.fetchExclusionProfileIds()),
    attempt(issues, "klaviyo", "flow definitions", () => src.fetchFlowDefinitions()),
    attempt(issues, "klaviyo", "flow report", () => src.fetchFlowReport(startIso, endIso)),
    attempt(issues, "posthog", "traffic and popup events", () => src.fetchPosthog(window)),
    attempt(issues, "shopify", "SHOT code orders", () => src.fetchShotRedemptions(startIso.slice(0, 10))),
  ]);

  const defs: FlowDefinition[] = flowDefs ?? [];
  const welcomeDefs = defs.filter((d) => WELCOME_FLOW_IDS.includes(d.id));
  const label = (id: string) => FLOWS.find((f) => f.id === id)?.label ?? id;

  const cohort = buildCohort(signups?.events ?? [], {
    excludedProfileIds: excluded ?? new Set(),
    welcomeFlows: welcomeDefs,
  });
  if (signups?.truncated) coverage.push("Signup events hit the page cap; counts are a floor.");

  const outcomes = new Map<string, ProfileOutcome>();
  let profileTruncated = 0;
  let profileMissing = 0;
  await live.mapLimit(cohort, 4, async (p) => {
    const res = await attempt(issues, "klaviyo", "profile events", () => src.fetchProfileEvents(p.profileId, isoMinus(p.firstSignupAt, 5 * 60_000)));
    if (res?.truncated) profileTruncated++;
    if (res?.missing) profileMissing++;
    outcomes.set(p.profileId, profileOutcome(p, res?.events ?? [], WELCOME_FLOW_IDS));
  });
  if (profileMissing) {
    coverage.push(`${profileMissing} signup profiles were merged or deleted in Klaviyo; they count as signups with no later stages.`);
  }
  if (profileTruncated) coverage.push(`${profileTruncated} profiles had more than 1,000 events; later events were not read.`);

  const visitors = posthog ? posthog.visitors : null;
  const popupViewers = posthog?.popupViewTracked ? posthog.popupCounts[POPUP_VIEW_EVENT] ?? 0 : null;
  if (posthog && !posthog.popupViewTracked) coverage.push("Popup views are not tracked yet; they start with the popup_view event.");

  const funnel = buildFunnel({ visitors, popupViewers, cohort, outcomes });
  const sources = buildSourceTable(cohort, outcomes, label);
  const flows = buildFlowTable(FLOWS, new Map(defs.map((d) => [d.id, d])), flowReport?.rows ?? []);
  if (flowReport?.truncated) coverage.push("Flow report was paginated; only the first page was read.");

  const popup = buildPopupFunnel({
    popupViews: popupViewers,
    steps: POPUP_STEPS.map((s) => ({ event: s.event, label: s.label, optional: s.optional, count: posthog?.popupCounts[s.event] ?? 0 })),
    redeemed: shot ? shot.orders : null,
  });
  coverage.push("Take a Shot phone is optional; its rate is the share of email submitters who added a phone.");

  const leaks = rankLeaks({ funnel: funnel.stages, sources, popup, cohort, outcomes });
  coverage.push(
    "Visitors and popup viewers are anonymous; their rates are count ratios, not a tracked cohort.",
    "Leaks are ranked from Signups onward; the visitor-to-signup gap is shown in the funnel only.",
  );

  return {
    window,
    generatedAt: now.toISOString(),
    range: { start: startIso, end: endIso },
    funnel: funnel.stages,
    signupsWithOrder: funnel.signupsWithOrder,
    signupsWithRepeatOrReserve: funnel.signupsWithRepeatOrReserve,
    sources,
    flows,
    popup,
    leaks,
    routing: welcomeDefs.map((d) => ({ flowId: d.id, label: label(d.id), status: d.status, sources: triggerSources(d.triggerFilter) })),
    coverage,
    queries: {
      signups: `Klaviyo GET /api/events filter=and(equals(metric_id,"${KLAVIYO_METRICS.siteSignup}"),greater-or-equal(datetime,${startIso}))`,
      stages: `Klaviyo GET /api/events filter=equals(profile_id,…) per signup; Received/Opened/Clicked Email with $flow in ${WELCOME_FLOW_IDS.join(",")}; Placed Order ${KLAVIYO_METRICS.placedOrder} non-renewal`,
      exclusions: "Klaviyo GET /api/segments/SXGW5m/profiles plus @mullybox.com, leo+ and +synctest emails",
      flows: `Klaviyo POST /api/flow-values-reports ${startIso}..${endIso}, conversion metric ${KLAVIYO_METRICS.placedOrder}`,
      visitors: posthog?.queries.visitors ?? "PostHog HogQL (unavailable)",
      popup: posthog?.queries.popup ?? "PostHog HogQL (unavailable)",
      redeemed: shot ? `Shopify orders(query: "${shot.query}")` : "Shopify (unavailable)",
    },
    issues: issues.list,
  };
}
