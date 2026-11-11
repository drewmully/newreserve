/**
 * Live, read-only data access for the email funnel dashboard.
 *
 * Klaviyo (REST, private key), PostHog (HogQL query API) and Shopify (Admin
 * GraphQL). Every function only reads. Each returns raw-ish rows that
 * ./compute.ts turns into counts, and records the query it ran so the page can
 * show where each number came from.
 */

import { KlaviyoError, klaviyoRequest } from "@/lib/klaviyo/client";
import { KLAVIYO_BASE_URL } from "@/lib/klaviyo/config";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";
import {
  EXCLUSION_SEGMENT_ID,
  FLOWS,
  KLAVIYO_METRICS,
  POPUP_STEPS,
  POPUP_VIEW_EVENT,
  SHOT_CODE_PREFIX,
  SITE_HOSTS,
  VISIT_EVENT,
} from "./config";
import type { FlowDefinition, FlowReportRow, ProfileEvent, SignupEvent, TriggerFilter } from "./compute";

export interface SourceIssue {
  source: "klaviyo" | "posthog" | "shopify";
  what: string;
  error: string;
}

export class Issues {
  readonly list: SourceIssue[] = [];
  add(source: SourceIssue["source"], what: string, err: unknown) {
    const error = err instanceof Error ? err.message.slice(0, 160) : String(err).slice(0, 160);
    this.list.push({ source, what, error });
  }
}

// ─── Klaviyo ───────────────────────────────────────────────────────────────

interface JsonApiDoc<T> {
  data?: T[] | T;
  links?: { next?: string | null };
  included?: Array<{ type: string; id: string; attributes?: Record<string, unknown> }>;
}
interface KEvent {
  id: string;
  attributes?: { datetime?: string; event_properties?: Record<string, unknown> };
  relationships?: {
    metric?: { data?: { id?: string } };
    profile?: { data?: { id?: string } };
  };
}

function relPath(next: string): string {
  return next.startsWith(KLAVIYO_BASE_URL) ? next.slice(KLAVIYO_BASE_URL.length) : next;
}

async function klaviyoPages<T>(path: string, maxPages: number): Promise<{ docs: JsonApiDoc<T>[]; truncated: boolean }> {
  const docs: JsonApiDoc<T>[] = [];
  let next: string | null = path;
  while (next && docs.length < maxPages) {
    const res: { body: JsonApiDoc<T> | null } = await klaviyoRequest<JsonApiDoc<T>>(next, { method: "GET" });
    const body: JsonApiDoc<T> = res.body ?? {};
    docs.push(body);
    next = body.links?.next ? relPath(body.links.next) : null;
  }
  return { docs, truncated: Boolean(next) };
}

const asList = <T,>(d: T[] | T | undefined): T[] => (Array.isArray(d) ? d : d ? [d] : []);

export async function fetchSignupEvents(sinceIso: string): Promise<{ events: SignupEvent[]; truncated: boolean }> {
  const filter = `and(equals(metric_id,"${KLAVIYO_METRICS.siteSignup}"),greater-or-equal(datetime,${sinceIso}))`;
  const path = `/api/events?filter=${encodeURIComponent(filter)}&include=profile&fields[profile]=email&page[size]=200`;
  const { docs, truncated } = await klaviyoPages<KEvent>(path, 25);
  const emails = new Map<string, string | null>();
  for (const d of docs) for (const inc of d.included ?? []) {
    if (inc.type === "profile") emails.set(inc.id, typeof inc.attributes?.email === "string" ? inc.attributes.email : null);
  }
  const events: SignupEvent[] = [];
  for (const d of docs) for (const e of asList(d.data)) {
    const props = e.attributes?.event_properties ?? {};
    const profileId = e.relationships?.profile?.data?.id ?? "";
    events.push({
      profileId,
      email: emails.get(profileId) ?? null,
      datetime: e.attributes?.datetime ?? "",
      source: typeof props.source === "string" ? props.source : "(none)",
      stage: typeof props.stage === "string" ? props.stage : "(none)",
      emailConsent: typeof props.email_consent === "boolean" ? props.email_consent : null,
      props,
    });
  }
  return { events, truncated };
}

/** Every event for one profile since `sinceIso` (signup-cohort profiles only, so the volume is small). */
export async function fetchProfileEvents(
  profileId: string,
  sinceIso: string,
): Promise<{ events: ProfileEvent[]; truncated: boolean; missing?: boolean }> {
  const filter = `and(equals(profile_id,"${profileId}"),greater-or-equal(datetime,${sinceIso}))`;
  const path = `/api/events?filter=${encodeURIComponent(filter)}&page[size]=200`;
  let docs: JsonApiDoc<KEvent>[];
  let truncated: boolean;
  try {
    ({ docs, truncated } = await klaviyoPages<KEvent>(path, 5));
  } catch (err) {
    // Merged or deleted profiles answer 400 "Profile ID … does not exist".
    if (err instanceof KlaviyoError && err.code === "bad_request") return { events: [], truncated: false, missing: true };
    throw err;
  }
  const events: ProfileEvent[] = [];
  for (const d of docs) for (const e of asList(d.data)) {
    events.push({
      metricId: e.relationships?.metric?.data?.id ?? "",
      datetime: e.attributes?.datetime ?? "",
      props: e.attributes?.event_properties ?? {},
    });
  }
  return { events, truncated };
}

export async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
}

export async function fetchExclusionProfileIds(): Promise<Set<string>> {
  const { docs } = await klaviyoPages<{ id: string }>(
    `/api/segments/${EXCLUSION_SEGMENT_ID}/profiles?fields[profile]=email&page[size]=100`,
    20,
  );
  return new Set(docs.flatMap((d) => asList(d.data).map((p) => p.id)));
}

interface KFlow {
  id: string;
  attributes?: {
    name?: string;
    status?: string;
    definition?: { triggers?: Array<{ type?: string; id?: string; trigger_filter?: TriggerFilter | null }> };
  };
}

export async function fetchFlowDefinitions(): Promise<FlowDefinition[]> {
  return mapLimit(FLOWS, 4, async (ref) => {
    const res = await klaviyoRequest<{ data?: KFlow }>(`/api/flows/${ref.id}?additional-fields[flow]=definition`, { method: "GET" });
    const a = res.body?.data?.attributes ?? {};
    const trigger = a.definition?.triggers?.find((t) => t.type === "metric") ?? a.definition?.triggers?.[0];
    return {
      id: ref.id,
      name: a.name ?? ref.id,
      status: a.status ?? "unknown",
      triggerMetricId: trigger?.type === "metric" ? trigger.id ?? null : null,
      triggerFilter: trigger?.trigger_filter ?? null,
    };
  });
}

interface KFlowReport {
  data?: {
    attributes?: {
      results?: Array<{ groupings?: Record<string, string>; statistics?: Record<string, number> }>;
    };
  };
  links?: { next?: string | null };
}

export async function fetchFlowReport(startIso: string, endIso: string): Promise<{ rows: FlowReportRow[]; truncated: boolean }> {
  const res = await klaviyoRequest<KFlowReport>("/api/flow-values-reports", {
    method: "POST",
    body: {
      data: {
        type: "flow-values-report",
        attributes: {
          statistics: ["recipients", "delivered", "opens_unique", "clicks_unique", "conversion_uniques", "conversion_value"],
          timeframe: { start: startIso, end: endIso },
          conversion_metric_id: KLAVIYO_METRICS.placedOrder,
          filter: `contains-any(flow_id,[${FLOWS.map((f) => `"${f.id}"`).join(",")}])`,
          group_by: ["flow_id", "flow_message_id"],
        },
      },
    },
  });
  const results = res.body?.data?.attributes?.results ?? [];
  const rows = results.map((r) => {
    const s = r.statistics ?? {};
    return {
      flowId: r.groupings?.flow_id ?? "",
      messageId: r.groupings?.flow_message_id,
      recipients: s.recipients ?? 0,
      delivered: s.delivered ?? 0,
      opensUnique: s.opens_unique ?? 0,
      clicksUnique: s.clicks_unique ?? 0,
      conversionUniques: s.conversion_uniques ?? 0,
      conversionValue: s.conversion_value ?? 0,
    };
  });
  return { rows, truncated: Boolean(res.body?.links?.next) };
}

// ─── PostHog ───────────────────────────────────────────────────────────────

export async function runHogQL(query: string): Promise<Array<unknown[]>> {
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
  if (!projectId || !apiKey) throw new Error("posthog_not_configured");
  const res = await fetch(`${host}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    signal: AbortSignal.timeout(20_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`posthog_${res.status}`);
  const json = (await res.json()) as { results?: Array<unknown[]> };
  return json.results ?? [];
}

const sqlList = (xs: readonly string[]) => xs.map((x) => `'${x.replace(/'/g, "")}'`).join(", ");

export function posthogQueries(days: number) {
  const since = `now() - INTERVAL ${Math.floor(days)} DAY`;
  const popupEvents = [POPUP_VIEW_EVENT, ...POPUP_STEPS.map((s) => s.event)];
  return {
    visitors: `SELECT uniq(person_id) FROM events WHERE event = '${VISIT_EVENT}' AND properties.$host IN (${sqlList(SITE_HOSTS)}) AND timestamp >= ${since}`,
    popup: `SELECT event, uniq(person_id) FROM events WHERE event IN (${sqlList(popupEvents)}) AND timestamp >= ${since} GROUP BY event`,
    firstPopupView: `SELECT min(timestamp) FROM events WHERE event = '${POPUP_VIEW_EVENT}'`,
  };
}

export async function fetchPosthog(days: number): Promise<{
  visitors: number;
  popupCounts: Record<string, number>;
  popupViewTracked: boolean;
  queries: ReturnType<typeof posthogQueries>;
}> {
  const queries = posthogQueries(days);
  const [v, p, first] = await Promise.all([runHogQL(queries.visitors), runHogQL(queries.popup), runHogQL(queries.firstPopupView)]);
  const popupCounts: Record<string, number> = {};
  for (const [event, n] of p) popupCounts[String(event)] = Number(n) || 0;
  const firstAt = first?.[0]?.[0];
  // min() over no rows returns the epoch, so treat 1970 as "never seen".
  const popupViewTracked = typeof firstAt === "string" && !firstAt.startsWith("1970");
  return { visitors: Number(v?.[0]?.[0]) || 0, popupCounts, popupViewTracked, queries };
}

// ─── Shopify ───────────────────────────────────────────────────────────────

export function shotOrdersQuery(sinceDate: string): string {
  return `discount_code:${SHOT_CODE_PREFIX}* created_at:>=${sinceDate}`;
}

export async function fetchShotRedemptions(sinceDate: string): Promise<{ orders: number; codes: string[]; query: string }> {
  const query = shotOrdersQuery(sinceDate);
  const codes: string[] = [];
  let orders = 0;
  let after: string | null = null;
  for (let page = 0; page < 10; page++) {
    const data: {
      orders: { pageInfo: { hasNextPage: boolean; endCursor: string | null }; nodes: Array<{ discountCodes: string[] }> };
    } = await shopifyGraphQL(
      `query ShotOrders($q: String!, $after: String) {
        orders(first: 100, query: $q, after: $after) {
          pageInfo { hasNextPage endCursor }
          nodes { discountCodes }
        }
      }`,
      { q: query, after },
    );
    for (const o of data.orders.nodes) {
      const shot = (o.discountCodes ?? []).filter((c) => c.toUpperCase().startsWith(SHOT_CODE_PREFIX));
      if (shot.length) {
        orders++;
        codes.push(...shot);
      }
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    after = data.orders.pageInfo.endCursor;
  }
  return { orders, codes, query };
}
