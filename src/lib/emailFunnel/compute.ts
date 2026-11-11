/**
 * Pure computation for the email funnel dashboard. No I/O: ./sources.ts
 * fetches, this module counts. Everything is unit-tested in
 * tests/api/emailFunnelLive.test.ts.
 *
 * Stage model (one cohort, strictly nested from Signups down):
 *   Visitors        PostHog unique persons with page_view on mymully.com
 *   Popup viewers   PostHog unique persons with popup_view (null until tracked)
 *   Signups         Klaviyo profiles with a "Mully Site Signup" event in window
 *   Entered flow    ...that received an email from a welcome flow after signup
 *   Opened/clicked  ...that opened or clicked a welcome-flow email
 *   First order     ...with a non-renewal Placed Order after signup
 *   Repeat/Reserve  ...with 2+ such orders, a Reserve item, or a Loop start
 * Visitors and popup viewers are anonymous, so those two rates are ratios of
 * counts, not a tracked cohort.
 */

import {
  KLAVIYO_METRICS,
  RENEWAL_SOURCE_NAME,
  RESERVE_ITEM_NAMES,
  isTestEmail,
  type FlowRef,
} from "./config";

// ─── Types ─────────────────────────────────────────────────────────────────

export interface SignupEvent {
  profileId: string;
  email: string | null;
  datetime: string;
  source: string;
  stage: string;
  emailConsent: boolean | null;
  props: Record<string, unknown>;
}

export interface ProfileEvent {
  metricId: string;
  datetime: string;
  props: Record<string, unknown>;
}

interface FilterSpec {
  type?: string;
  operator?: string;
  value?: unknown;
}
interface Condition {
  type?: string;
  field?: string;
  filter?: FilterSpec;
}
export interface TriggerFilter {
  condition_groups?: Array<{ conditions?: Condition[] }>;
}

export interface FlowDefinition {
  id: string;
  name: string;
  status: string;
  triggerMetricId: string | null;
  triggerFilter: TriggerFilter | null;
}

export interface CohortProfile {
  profileId: string;
  firstSignupAt: string;
  events: SignupEvent[];
  sources: string[];
  /** Live welcome flows whose trigger filter matches at least one of this profile's signup events. */
  routedFlowIds: string[];
  smsOnly: boolean;
}

export interface ProfileOutcome {
  entered: boolean;
  enteredFlowIds: string[];
  engaged: boolean;
  firstOrder: boolean;
  repeatOrReserve: boolean;
}

export interface FunnelStage {
  key: string;
  label: string;
  phase: "Capture" | "Nourish" | "Warm" | "Convert" | "Lifecycle";
  count: number | null;
  /** Share of the previous stage with a count (null when either side is missing). */
  rateFromPrev: number | null;
  /** Set when the rate skips an untracked stage, e.g. Signups vs Visitors while popup views are missing. */
  rateBase?: string;
  source: string;
  note?: string;
}

export interface SourceRow {
  source: string;
  signups: number;
  emailConsentRate: number | null;
  flows: string[];
  entered: number;
  noFlowShare: number | null;
  unrouted: boolean;
}

export interface FlowReportRow {
  flowId: string;
  messageId?: string;
  recipients: number;
  delivered: number;
  opensUnique: number;
  clicksUnique: number;
  conversionUniques: number;
  conversionValue: number;
}

export interface FlowTableRow {
  flowId: string;
  label: string;
  name: string;
  status: string;
  stage: string;
  messages: number;
  recipients: number;
  delivered: number;
  openRate: number | null;
  clickRate: number | null;
  placedOrderRate: number | null;
  revenue: number;
  revenuePerRecipient: number | null;
}

export interface PopupStep {
  key: string;
  label: string;
  /** Optional side step (phone): its rate is vs the previous step, and it is never the base for the next one. */
  optional?: boolean;
  count: number | null;
  rateFromPrev: number | null;
  source: string;
}

export interface Leak {
  key: string;
  lost: number;
  text: string;
}

// ─── Helpers ───────────────────────────────────────────────────────────────

export function ratio(num: number | null | undefined, den: number | null | undefined): number | null {
  if (num === null || num === undefined || den === null || den === undefined || den <= 0) return null;
  return num / den;
}

const ms = (iso: string) => Date.parse(iso);

/** Flow sends can be logged a few seconds before the triggering event's own timestamp. */
const SIGNUP_SLACK_MS = 5 * 60_000;

// ─── Trigger filters ───────────────────────────────────────────────────────

function matchCondition(cond: Condition, props: Record<string, unknown>): boolean {
  if (cond.type !== "metric-property" || !cond.field || !cond.filter) return false;
  const actual = props[cond.field];
  const { operator, value } = cond.filter;
  switch (operator) {
    case "equals":
      return actual === value;
    case "not-equals":
      return actual !== value;
    case "in":
      return Array.isArray(value) && value.includes(actual as never);
    case "not-in":
      return Array.isArray(value) && !value.includes(actual as never);
    case "contains":
      return typeof actual === "string" && typeof value === "string" && actual.includes(value);
    default:
      // Unknown operator: fail closed so we never claim routing we can't prove.
      return false;
  }
}

/** Klaviyo trigger filters: every condition group must pass; any condition within a group may. */
export function matchesTriggerFilter(filter: TriggerFilter | null | undefined, props: Record<string, unknown>): boolean {
  const groups = filter?.condition_groups ?? [];
  return groups.every((g) => (g.conditions ?? []).some((c) => matchCondition(c, props)));
}

/** Sources named in a trigger filter's `source` condition (for display). */
export function triggerSources(filter: TriggerFilter | null | undefined): string[] {
  const out = new Set<string>();
  for (const g of filter?.condition_groups ?? []) {
    for (const c of g.conditions ?? []) {
      if (c.field !== "source" || !c.filter) continue;
      if (c.filter.operator === "equals" && typeof c.filter.value === "string") out.add(c.filter.value);
      if (c.filter.operator === "in" && Array.isArray(c.filter.value)) {
        for (const v of c.filter.value) if (typeof v === "string") out.add(v);
      }
    }
  }
  return [...out];
}

export function routingFlowsForEvent(event: SignupEvent, flows: FlowDefinition[], signupMetricId: string): string[] {
  const props = { ...event.props, source: event.source, stage: event.stage, email_consent: event.emailConsent };
  return flows
    .filter((f) => f.status === "live" && f.triggerMetricId === signupMetricId && matchesTriggerFilter(f.triggerFilter, props))
    .map((f) => f.id);
}

// ─── Cohort ────────────────────────────────────────────────────────────────

export function buildCohort(
  signups: SignupEvent[],
  opts: { excludedProfileIds: Set<string>; welcomeFlows: FlowDefinition[]; signupMetricId?: string },
): CohortProfile[] {
  const signupMetricId = opts.signupMetricId ?? KLAVIYO_METRICS.siteSignup;
  const byProfile = new Map<string, SignupEvent[]>();
  for (const e of signups) {
    if (!e.profileId || opts.excludedProfileIds.has(e.profileId) || isTestEmail(e.email)) continue;
    const list = byProfile.get(e.profileId) ?? [];
    list.push(e);
    byProfile.set(e.profileId, list);
  }
  const out: CohortProfile[] = [];
  for (const [profileId, events] of byProfile) {
    events.sort((a, b) => ms(a.datetime) - ms(b.datetime));
    const routed = new Set<string>();
    for (const e of events) for (const id of routingFlowsForEvent(e, opts.welcomeFlows, signupMetricId)) routed.add(id);
    out.push({
      profileId,
      firstSignupAt: events[0].datetime,
      events,
      sources: [...new Set(events.map((e) => e.source))],
      routedFlowIds: [...routed],
      smsOnly: events.every((e) => e.stage === "sms"),
    });
  }
  return out.sort((a, b) => ms(a.firstSignupAt) - ms(b.firstSignupAt));
}

// ─── Per-profile outcome ───────────────────────────────────────────────────

function items(props: Record<string, unknown>): string[] {
  const raw = props.Items ?? props.items;
  return Array.isArray(raw) ? raw.filter((x): x is string => typeof x === "string") : [];
}

export function isQualifyingOrder(e: ProfileEvent): boolean {
  return e.metricId === KLAVIYO_METRICS.placedOrder && e.props["Source Name"] !== RENEWAL_SOURCE_NAME;
}

export function isReserveOrder(e: ProfileEvent): boolean {
  return isQualifyingOrder(e) && items(e.props).some((name) => RESERVE_ITEM_NAMES.includes(name));
}

export function profileOutcome(profile: CohortProfile, events: ProfileEvent[], welcomeFlowIds: string[]): ProfileOutcome {
  const since = ms(profile.firstSignupAt) - SIGNUP_SLACK_MS;
  const after = events.filter((e) => ms(e.datetime) >= since);
  const welcome = new Set(welcomeFlowIds);
  const flowOf = (e: ProfileEvent) => (typeof e.props.$flow === "string" ? e.props.$flow : null);

  const enteredFlowIds = [
    ...new Set(
      after
        .filter((e) => e.metricId === KLAVIYO_METRICS.receivedEmail && welcome.has(flowOf(e) ?? ""))
        .map((e) => flowOf(e) as string),
    ),
  ];
  const entered = enteredFlowIds.length > 0;
  const engaged =
    entered &&
    after.some(
      (e) =>
        (e.metricId === KLAVIYO_METRICS.openedEmail || e.metricId === KLAVIYO_METRICS.clickedEmail) &&
        welcome.has(flowOf(e) ?? ""),
    );
  const orders = after.filter(isQualifyingOrder);
  const firstOrder = orders.length > 0;
  const repeatOrReserve =
    firstOrder &&
    (orders.length >= 2 ||
      orders.some(isReserveOrder) ||
      after.some((e) => e.metricId === KLAVIYO_METRICS.subscriptionStarted));
  return { entered, enteredFlowIds, engaged, firstOrder, repeatOrReserve };
}

// ─── Funnel ────────────────────────────────────────────────────────────────

export interface FunnelInput {
  visitors: number | null;
  popupViewers: number | null;
  cohort: CohortProfile[];
  outcomes: Map<string, ProfileOutcome>;
}

export interface FunnelResult {
  stages: FunnelStage[];
  /** Not nested: every signup that ordered, including ones that never engaged. */
  signupsWithOrder: number;
  signupsWithRepeatOrReserve: number;
}

export function buildFunnel(input: FunnelInput): FunnelResult {
  const outcomes = input.cohort.map((p) => input.outcomes.get(p.profileId));
  const entered = outcomes.filter((o) => o?.entered).length;
  const engaged = outcomes.filter((o) => o?.entered && o.engaged).length;
  const first = outcomes.filter((o) => o?.entered && o.engaged && o.firstOrder).length;
  const repeat = outcomes.filter((o) => o?.entered && o.engaged && o.firstOrder && o.repeatOrReserve).length;

  const raw: Omit<FunnelStage, "rateFromPrev">[] = [
    { key: "visitors", label: "Visitors", phase: "Capture", count: input.visitors, source: "PostHog page_view, unique persons" },
    {
      key: "popup_viewers",
      label: "Popup viewers",
      phase: "Capture",
      count: input.popupViewers,
      source: "PostHog popup_view, unique persons",
      note: input.popupViewers === null ? "Not tracked yet" : undefined,
    },
    { key: "signups", label: "Signups", phase: "Capture", count: input.cohort.length, source: "Klaviyo Mully Site Signup, unique profiles" },
    { key: "entered", label: "Entered welcome flow", phase: "Nourish", count: entered, source: "Klaviyo Received Email from a welcome flow" },
    { key: "engaged", label: "Opened or clicked", phase: "Warm", count: engaged, source: "Klaviyo Opened/Clicked Email from a welcome flow" },
    { key: "first_order", label: "First order", phase: "Convert", count: first, source: "Klaviyo Placed Order, renewals excluded" },
    { key: "repeat", label: "Repeat or Reserve", phase: "Lifecycle", count: repeat, source: "2+ orders, a Reserve item, or Loop subscription start" },
  ];
  let prev: { count: number; label: string; index: number } | null = null;
  const stages = raw.map((s, i) => {
    const rateFromPrev = s.count === null ? null : ratio(s.count, prev?.count);
    const rateBase = s.count !== null && prev && prev.index !== i - 1 ? prev.label : undefined;
    if (s.count !== null) prev = { count: s.count, label: s.label, index: i };
    return rateBase ? { ...s, rateFromPrev, rateBase } : { ...s, rateFromPrev };
  });
  return {
    stages,
    signupsWithOrder: outcomes.filter((o) => o?.firstOrder).length,
    signupsWithRepeatOrReserve: outcomes.filter((o) => o?.repeatOrReserve).length,
  };
}

// ─── Signup sources ────────────────────────────────────────────────────────

export const SMS_ONLY_SOURCE = "SMS only (any source)";

export function buildSourceTable(
  cohort: CohortProfile[],
  outcomes: Map<string, ProfileOutcome>,
  flowLabel: (id: string) => string,
): SourceRow[] {
  const rows = new Map<string, { profiles: Set<string>; consent: Set<string>; flows: Set<string>; entered: Set<string> }>();
  const row = (key: string) => {
    let r = rows.get(key);
    if (!r) {
      r = { profiles: new Set(), consent: new Set(), flows: new Set(), entered: new Set() };
      rows.set(key, r);
    }
    return r;
  };
  for (const p of cohort) {
    const entered = outcomes.get(p.profileId)?.entered === true;
    for (const e of p.events) {
      const r = row(e.source);
      r.profiles.add(p.profileId);
      if (e.emailConsent === true) r.consent.add(p.profileId);
      if (entered) r.entered.add(p.profileId);
    }
    for (const source of p.sources) {
      // Attribute a routed flow to the source whose events matched it.
      for (const flowId of p.routedFlowIds) {
        if (p.events.some((e) => e.source === source && e.stage === "email")) row(source).flows.add(flowLabel(flowId));
      }
    }
    if (p.smsOnly) {
      const r = row(SMS_ONLY_SOURCE);
      r.profiles.add(p.profileId);
      if (p.events.some((e) => e.emailConsent === true)) r.consent.add(p.profileId);
      for (const flowId of p.routedFlowIds) r.flows.add(flowLabel(flowId));
      if (entered) r.entered.add(p.profileId);
    }
  }
  const out: SourceRow[] = [];
  for (const [source, r] of rows) {
    const signups = r.profiles.size;
    const flows = [...r.flows].sort();
    out.push({
      source,
      signups,
      emailConsentRate: ratio(r.consent.size, signups),
      flows,
      entered: r.entered.size,
      noFlowShare: ratio(signups - r.entered.size, signups),
      unrouted: flows.length === 0,
    });
  }
  return out.sort((a, b) => (a.source === SMS_ONLY_SOURCE ? 1 : b.source === SMS_ONLY_SOURCE ? -1 : b.signups - a.signups));
}

// ─── Flow table ────────────────────────────────────────────────────────────

export function buildFlowTable(
  refs: FlowRef[],
  defs: Map<string, { name: string; status: string }>,
  rows: FlowReportRow[],
): FlowTableRow[] {
  return refs.map((ref) => {
    const mine = rows.filter((r) => r.flowId === ref.id);
    const sum = (k: keyof FlowReportRow) => mine.reduce((acc, r) => acc + (Number(r[k]) || 0), 0);
    const delivered = sum("delivered");
    const revenue = Math.round(sum("conversionValue") * 100) / 100;
    const def = defs.get(ref.id);
    return {
      flowId: ref.id,
      label: ref.label,
      name: def?.name ?? ref.id,
      status: def?.status ?? "unknown",
      stage: ref.stage,
      messages: new Set(mine.map((r) => r.messageId ?? r.flowId)).size,
      recipients: sum("recipients"),
      delivered,
      openRate: ratio(sum("opensUnique"), delivered),
      clickRate: ratio(sum("clicksUnique"), delivered),
      placedOrderRate: ratio(sum("conversionUniques"), delivered),
      revenue,
      revenuePerRecipient: ratio(revenue, delivered),
    };
  });
}

// ─── Popup funnel ──────────────────────────────────────────────────────────

export function buildPopupFunnel(input: {
  popupViews: number | null;
  steps: Array<{ event: string; label: string; count: number; optional?: boolean }>;
  redeemed: number | null;
}): PopupStep[] {
  const raw: Omit<PopupStep, "rateFromPrev">[] = [
    { key: "popup_view", label: "Views", count: input.popupViews, source: "PostHog popup_view" },
    ...input.steps.map((s) => ({ key: s.event, label: s.label, optional: s.optional, count: s.count, source: `PostHog ${s.event}` })),
    { key: "redeemed", label: "Code redeemed", count: input.redeemed, source: "Shopify orders with a SHOT code" },
  ];
  let prev: number | null = null;
  return raw.map((s) => {
    const rateFromPrev = s.count === null ? null : ratio(s.count, prev);
    if (s.count !== null && !s.optional) prev = s.count;
    return { ...s, rateFromPrev };
  });
}

// ─── Leaks ─────────────────────────────────────────────────────────────────

export function rankLeaks(input: {
  funnel: FunnelStage[];
  sources: SourceRow[];
  popup: PopupStep[];
  cohort: CohortProfile[];
  outcomes: Map<string, ProfileOutcome>;
  limit?: number;
}): Leak[] {
  const leaks: Leak[] = [];
  const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

  // Signups -> entered, split by source so each leak names something fixable.
  const smsOnly = input.cohort.filter((p) => p.smsOnly);
  for (const row of input.sources) {
    if (row.source === SMS_ONLY_SOURCE) continue;
    const members = input.cohort.filter((p) => p.sources.includes(row.source) && !p.smsOnly);
    const lost = members.filter((p) => !input.outcomes.get(p.profileId)?.entered).length;
    if (lost <= 0) continue;
    leaks.push(
      row.unrouted
        ? { key: `unrouted:${row.source}`, lost, text: `${row.source}: ${plural(lost, "signup")} with no welcome flow` }
        : {
            key: `gated:${row.source}`,
            lost,
            text: `${row.source}: ${lost} of ${members.length} never entered ${row.flows.join("/")} (flow filters or consent)`,
          },
    );
  }
  const smsLost = smsOnly.filter((p) => !input.outcomes.get(p.profileId)?.entered).length;
  if (smsLost > 0) leaks.push({ key: "unrouted:sms-only", lost: smsLost, text: `SMS-only signups: ${plural(smsLost, "person")} with no welcome flow` });

  const stage = (k: string) => input.funnel.find((s) => s.key === k)?.count ?? null;
  const step = (from: string, to: string, text: (lost: number, base: number) => string) => {
    const a = stage(from);
    const b = stage(to);
    if (a === null || b === null || a - b <= 0) return;
    leaks.push({ key: `${from}->${to}`, lost: a - b, text: text(a - b, a) });
  };
  step("entered", "engaged", (l, b) => `Welcome flows: ${l} of ${b} entrants never opened or clicked`);
  step("engaged", "first_order", (l, b) => `${l} of ${b} engaged signups have not placed a first order`);
  step("first_order", "repeat", (l, b) => `${l} of ${b} first-time buyers have no repeat order or Reserve yet`);

  // Popup steps after the first tracked one.
  let prev: PopupStep | null = null;
  for (const s of input.popup) {
    if (s.count === null || s.optional) continue;
    if (prev && prev.count !== null && prev.count - s.count > 0) {
      leaks.push({
        key: `popup:${prev.key}->${s.key}`,
        lost: prev.count - s.count,
        text: `Popup: ${prev.count - s.count} of ${prev.count} dropped between ${prev.label.toLowerCase()} and ${s.label.toLowerCase()}`,
      });
    }
    prev = s;
  }

  return leaks.sort((a, b) => b.lost - a.lost || a.key.localeCompare(b.key)).slice(0, input.limit ?? 3);
}
