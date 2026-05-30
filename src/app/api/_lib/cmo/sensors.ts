/**
 * CMO Brain — Layer 1: Sensors.
 *
 * Deterministic data collectors. No LLM calls. Each sensor returns
 * structured data the Analyst layer consumes. Designed to fail soft —
 * any sensor error gets recorded in `errors[]` but doesn't kill the run.
 */

import type {
  FunnelSensorData,
  RetentionSensorData,
  SiteSensorData,
  AdsSensorData,
  SessionSensorData,
  SensorBundle,
} from "./types";

// ─── Funnel Sensor ─────────────────────────────────────────────────────────
//
// Re-uses the marketing-funnel snapshot we already write hourly. Reading
// from supabase keeps this sensor near-free.

import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { buildFunnelCacheKey } from "@/app/api/_lib/funnelSnapshot";

async function fetchFunnelLive(start: string, end: string): Promise<Record<string, unknown>> {
  // Live recompute through the marketing-funnel route. We hit it server-side
  // with CRON_SECRET. The base URL falls back to the public site.
  const base =
    process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.mymully.com";
  const secret = process.env.CRON_SECRET ?? "";
  const url = `${base}/api/admin/marketing-funnel?start=${start}&end=${end}`;
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${secret}` },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`marketing-funnel live: ${res.status}`);
  return (await res.json()) as Record<string, unknown>;
}

export async function collectFunnel(
  start: string,
  end: string
): Promise<FunnelSensorData> {
  const sb = getSupabaseService();
  const cacheKey = buildFunnelCacheKey(start, end);
  const { data, error } = await sb
    .from("marketing_funnel_snapshots")
    .select("payload")
    .eq("kind", "funnel")
    .eq("cache_key", cacheKey)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw new Error(`funnel snapshot read: ${error.message}`);

  let p: Record<string, unknown>;
  if (data) {
    p = data.payload as Record<string, unknown>;
  } else {
    // No snapshot — fall back to live recompute. Slower but always works.
    console.log(`[cmo/sensors] no snapshot for ${cacheKey}, falling back to live fetch`);
    p = await fetchFunnelLive(start, end);
  }

  const headline = (p.headline ?? {}) as Record<string, number>;
  const funnel = (p.funnel ?? {}) as Record<string, unknown>;
  const totals = (funnel.totals ?? {}) as Record<string, number>;
  const pathBuckets = (funnel.path_buckets ?? []) as Array<
    Record<string, unknown>
  >;
  const channels = (funnel.channels ?? []) as Array<Record<string, unknown>>;

  return {
    window: { start, end },
    headline: {
      new_reserve_members: headline.new_reserve_members ?? 0,
      new_reserve_revenue_cents: headline.new_reserve_revenue_cents ?? 0,
      renewals: headline.renewals ?? 0,
      renewal_revenue_cents: headline.renewal_revenue_cents ?? 0,
      pro_shop_orders: headline.pro_shop_orders ?? 0,
      pro_shop_revenue_cents: headline.pro_shop_revenue_cents ?? 0,
      ad_spend_cents: headline.ad_spend_cents ?? 0,
      cac_cents: headline.cac_cents ?? 0,
    },
    funnel_totals: {
      landed: totals.landed ?? 0,
      initiated: totals.initiated ?? 0,
      abandoned: totals.abandoned ?? 0,
      completed: totals.completed ?? 0,
    },
    path_buckets: pathBuckets.map((b) => ({
      path: String(b.path ?? ""),
      landed: Number(b.landed ?? 0),
      initiated: Number(b.initiated ?? 0),
      completed: Number(b.completed ?? 0),
    })),
    channels: channels.map((c) => ({
      channel: String(c.channel ?? ""),
      landed: Number(c.landed ?? 0),
      initiated: Number(c.initiated ?? 0),
      completed: Number(c.completed ?? 0),
    })),
    shopify_ground_truth: {
      initiated: Number(funnel.shopify_checkouts_initiated ?? 0),
      abandoned: Number(funnel.shopify_abandoned_checkouts ?? 0),
      completed: Number(funnel.shopify_completed_orders ?? 0),
    },
  };
}

// ─── Retention Sensor ──────────────────────────────────────────────────────
//
// 100% Shopify-driven (no Loop walk — that takes 50s). For each first-order
// in the trailing 6 months we look up whether that customer also has
// recurring orders (tag:"Subscription Recurring Order"). The count of
// recurring orders gives us retention bands per cohort.

interface ShopifyOrderLite {
  email: string | null;
  created_at: string;
  tags: string[];
}

async function fetchShopifyOrdersByTag(
  tag: string,
  startMonths: number
): Promise<ShopifyOrderLite[]> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !token) return [];
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - startMonths);
  const sinceIso = since.toISOString();

  const query = `
    query ($q: String!, $cursor: String) {
      orders(first: 250, after: $cursor, query: $q, sortKey: CREATED_AT) {
        edges {
          cursor
          node {
            createdAt
            email
            tags
          }
        }
        pageInfo { hasNextPage }
      }
    }`;
  const q = `tag:"${tag}" created_at:>=${sinceIso}`;
  const out: ShopifyOrderLite[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 40; i++) {
    const res = await fetch(
      `https://${domain}/admin/api/2024-10/graphql.json`,
      {
        method: "POST",
        headers: {
          "X-Shopify-Access-Token": token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ query, variables: { q, cursor } }),
      }
    );
    if (!res.ok) throw new Error(`shopify orders: ${res.status}`);
    const j = (await res.json()) as {
      data?: {
        orders?: {
          edges: Array<{
            cursor: string;
            node: { createdAt: string; email: string | null; tags: string[] };
          }>;
          pageInfo: { hasNextPage: boolean };
        };
      };
    };
    const edges = j.data?.orders?.edges ?? [];
    for (const e of edges) {
      out.push({
        email: e.node.email,
        created_at: e.node.createdAt,
        tags: e.node.tags ?? [],
      });
    }
    if (!j.data?.orders?.pageInfo.hasNextPage) break;
    cursor = edges[edges.length - 1]?.cursor ?? null;
    if (!cursor) break;
  }
  return out;
}

export async function collectRetention(): Promise<RetentionSensorData> {
  const [firstOrders, recurringOrders] = await Promise.all([
    fetchShopifyOrdersByTag("Subscription First Order", 6),
    fetchShopifyOrdersByTag("Subscription Recurring Order", 6),
  ]);

  // Map each email → set of recurring order created_at timestamps.
  const recurringByEmail = new Map<string, Date[]>();
  for (const o of recurringOrders) {
    if (!o.email) continue;
    const key = o.email.toLowerCase();
    const cur = recurringByEmail.get(key) ?? [];
    cur.push(new Date(o.created_at));
    recurringByEmail.set(key, cur);
  }

  const cohortMap = new Map<
    string,
    { size: number; r30: number; r60: number; r90: number }
  >();
  for (const o of firstOrders) {
    if (!o.email) continue;
    const cohortMonth = o.created_at.slice(0, 7);
    const cur = cohortMap.get(cohortMonth) ?? {
      size: 0,
      r30: 0,
      r60: 0,
      r90: 0,
    };
    cur.size += 1;
    const firstDate = new Date(o.created_at);
    const recurrences = recurringByEmail.get(o.email.toLowerCase()) ?? [];
    // Did this customer have at least one recurring order >=30 / 60 / 90
    // days after their first order? That's the retention signal.
    const hasAt = (days: number) =>
      recurrences.some(
        (d) => (d.getTime() - firstDate.getTime()) / 86_400_000 >= days
      );
    if (hasAt(30)) cur.r30 += 1;
    if (hasAt(60)) cur.r60 += 1;
    if (hasAt(90)) cur.r90 += 1;
    cohortMap.set(cohortMonth, cur);
  }

  const cohorts = Array.from(cohortMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, v]) => ({
      cohort_month: month,
      cohort_size: v.size,
      retained_30d: v.r30,
      retained_60d: v.r60,
      retained_90d: v.r90,
    }));

  // 90-day renewal rate: only cohorts that have had enough time.
  const now = Date.now();
  const eligible = cohorts.filter((c) => {
    const cohortDate = Date.parse(`${c.cohort_month}-01T00:00:00Z`);
    return (now - cohortDate) / 86_400_000 >= 90;
  });
  const eligibleSize = eligible.reduce((a, c) => a + c.cohort_size, 0);
  const eligibleRetained = eligible.reduce((a, c) => a + c.retained_90d, 0);
  const avgRenewalPct =
    eligibleSize > 0 ? (eligibleRetained / eligibleSize) * 100 : 0;

  return {
    cohorts,
    avg_renewal_rate_pct: Math.round(avgRenewalPct * 10) / 10,
    // Without Loop walk we can't split paused/cancelled — leave at 0 for now.
    paused_subs: 0,
    cancelled_subs: 0,
    active_subs: 0,
  };
}

// ─── Site Sensor ───────────────────────────────────────────────────────────
//
// Fetches top pages on mymully.com and extracts H1 / CTA / body. PostHog
// session-conversion is joined per-path. No browser — server-side `fetch`
// and a tiny HTML parser keep this < 5s.

// Routes that actually exist in this Next.js app. Shopify hosts the real
// cart/checkout off-domain so we don't probe those — they would always 404
// on www and trick the analyst into flagging fake broken pages.
const TOP_PATHS = [
  "/",
  "/lp/subscription",
  "/lp/gift",
  "/reserve/founders",
  "/shop",
  "/back9-welcome",
  "/handoff",
  "/choose-plan",
  "/account",
  "/faq",
];

function extractTag(html: string, tag: string): string {
  const re = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "i");
  const m = html.match(re);
  if (!m) return "";
  return m[1]
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 200);
}

function extractFirstCTA(html: string): string {
  // First <button> or <a class*="btn|cta|primary">
  const buttons = html.match(/<(?:button|a)[^>]*>([\s\S]*?)<\/(?:button|a)>/gi) ?? [];
  for (const b of buttons.slice(0, 30)) {
    const txt = b
      .replace(/<[^>]+>/g, " ")
      .replace(/\s+/g, " ")
      .trim();
    if (txt && txt.length < 60 && /[a-z]/i.test(txt)) return txt;
  }
  return "";
}

export async function collectSite(
  funnel: FunnelSensorData
): Promise<SiteSensorData> {
  const root = "https://mymully.com";
  // Conversion per path comes from the funnel sensor (path_buckets).
  const pathConv = new Map<string, number>();
  for (const b of funnel.path_buckets) {
    pathConv.set(
      b.path,
      b.landed > 0 ? (b.completed / b.landed) * 100 : 0
    );
  }

  const pages = await Promise.all(
    TOP_PATHS.map(async (p) => {
      const url = `${root}${p}`;
      const t0 = Date.now();
      try {
        const res = await fetch(url, {
          headers: { "User-Agent": "Mullybox-CMO-Brain/1.0" },
          // Mymully runs behind Shopify storefront — 6s timeout safety net.
          signal: AbortSignal.timeout(6000),
        });
        const html = await res.text();
        const title = extractTag(html, "title");
        const h1 = extractTag(html, "h1");
        const cta = extractFirstCTA(html);
        const text = html
          .replace(/<script[\s\S]*?<\/script>/gi, " ")
          .replace(/<style[\s\S]*?<\/style>/gi, " ")
          .replace(/<[^>]+>/g, " ")
          .replace(/\s+/g, " ")
          .trim();
        const wordCount = text.split(/\s+/).length;
        return {
          url,
          title,
          h1,
          primary_cta: cta,
          body_excerpt: text.slice(0, 600),
          word_count: wordCount,
          sessions_7d:
            funnel.path_buckets.find((b) => b.path === p)?.landed ?? 0,
          conversion_rate_pct:
            Math.round((pathConv.get(p) ?? 0) * 100) / 100,
          fetch_ms: Date.now() - t0,
          status: res.status,
        };
      } catch (err) {
        return {
          url,
          title: "",
          h1: "",
          primary_cta: "",
          body_excerpt: `fetch failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
          word_count: 0,
          sessions_7d: 0,
          conversion_rate_pct: 0,
          fetch_ms: Date.now() - t0,
          status: 0,
        };
      }
    })
  );

  return { pages };
}

// ─── Ads Sensor ────────────────────────────────────────────────────────────
//
// Re-uses the ad_platforms block from the funnel snapshot for live totals,
// and pulls per-campaign Google Ads breakdown via a second GAQL query.

import { mintGoogleAccessToken } from "@/app/api/_lib/googleAuth";

async function fetchGoogleAdsCampaigns(
  start: string,
  end: string
): Promise<NonNullable<AdsSensorData["google_ads"]["campaigns"]> | null> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!developerToken || !loginCustomerId || !customerId) return null;

  const impersonate = process.env.GOOGLE_ADS_IMPERSONATE_EMAIL;
  const accessToken = await mintGoogleAccessToken({
    scope: "https://www.googleapis.com/auth/adwords",
    sub: impersonate,
  }).catch(() => null);
  if (!accessToken) return null;

  const query = `
    SELECT campaign.name, campaign.status,
           metrics.cost_micros, metrics.clicks, metrics.conversions,
           metrics.impressions
    FROM campaign
    WHERE segments.date BETWEEN '${start}' AND '${end}'
  `
    .replace(/\s+/g, " ")
    .trim();
  const res = await fetch(
    `https://googleads.googleapis.com/v21/customers/${customerId}/googleAds:search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": developerToken,
        "login-customer-id": loginCustomerId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  if (!res.ok) return null;
  const payload = (await res.json()) as {
    results?: Array<{
      campaign?: { name?: string; status?: string };
      metrics?: {
        costMicros?: string | number;
        clicks?: string | number;
        conversions?: number;
        impressions?: string | number;
      };
    }>;
  };
  const agg = new Map<
    string,
    {
      status: string;
      cost_micros: number;
      clicks: number;
      conversions: number;
      impressions: number;
    }
  >();
  for (const r of payload.results ?? []) {
    const name = r.campaign?.name ?? "(unnamed)";
    const cur = agg.get(name) ?? {
      status: r.campaign?.status ?? "UNKNOWN",
      cost_micros: 0,
      clicks: 0,
      conversions: 0,
      impressions: 0,
    };
    cur.cost_micros += Number(r.metrics?.costMicros ?? 0);
    cur.clicks += Number(r.metrics?.clicks ?? 0);
    cur.conversions += Number(r.metrics?.conversions ?? 0);
    cur.impressions += Number(r.metrics?.impressions ?? 0);
    agg.set(name, cur);
  }
  return Array.from(agg.entries())
    .map(([name, v]) => ({
      name,
      status: v.status,
      spend_cents: Math.round(v.cost_micros / 10_000),
      clicks: v.clicks,
      conversions: v.conversions,
      impressions: v.impressions,
      ctr_pct:
        v.impressions > 0
          ? Math.round((v.clicks / v.impressions) * 10_000) / 100
          : 0,
      cpc_cents:
        v.clicks > 0 ? Math.round(v.cost_micros / 10_000 / v.clicks) : 0,
    }))
    .sort((a, b) => b.spend_cents - a.spend_cents);
}

export async function collectAds(
  start: string,
  end: string,
  funnel: FunnelSensorData
): Promise<AdsSensorData> {
  // Pull the ad_platforms block from the funnel snapshot we just read.
  const sb = getSupabaseService();
  const cacheKey = buildFunnelCacheKey(start, end);
  const { data } = await sb
    .from("marketing_funnel_snapshots")
    .select("payload")
    .eq("kind", "funnel")
    .eq("cache_key", cacheKey)
    .order("generated_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  const adPlatforms =
    ((data?.payload as Record<string, unknown> | undefined)?.ad_platforms as
      | Record<string, unknown>
      | undefined) ?? {};

  void funnel; // keep signature stable for future per-channel cross-ref
  const ga = (adPlatforms.google_ads ?? {}) as Record<string, unknown>;
  const xa = (adPlatforms.x_ads ?? {}) as Record<string, unknown>;

  // Per-campaign breakdown (best-effort; null on failure)
  const campaigns = await fetchGoogleAdsCampaigns(start, end).catch(() => null);

  return {
    google_ads: {
      available: Boolean(ga.available),
      reason: ga.reason as string | undefined,
      spend_cents: Number(ga.spend_cents ?? 0),
      clicks: Number(ga.clicks ?? 0),
      conversions: Number(ga.conversions ?? 0),
      impressions: Number(ga.impressions ?? 0),
      campaigns: campaigns ?? undefined,
    },
    x_ads: {
      available: Boolean(xa.available),
      reason: xa.reason as string | undefined,
      spend_cents: Number(xa.spend_cents ?? 0),
      clicks: Number(xa.clicks ?? 0),
      conversions: Number(xa.conversions ?? 0),
      impressions: Number(xa.impressions ?? 0),
    },
  };
}

// ─── Session Sensor ────────────────────────────────────────────────────────
//
// Derived from PostHog HogQL: top entry pages, worst-converting paths,
// device split. The funnel route already runs heavy HogQL — we keep this
// lightweight (one query) and only when PostHog is reachable.

async function runHogQL<T>(query: string): Promise<T | null> {
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
  if (!projectId || !apiKey) return null;
  try {
    const res = await fetch(`${host}/api/projects/${projectId}/query/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
      signal: AbortSignal.timeout(15000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function collectSessions(
  start: string,
  end: string
): Promise<SessionSensorData> {
  // Worst-converting paths (≥20 sessions) and top entries, in one query.
  const sql = `
    WITH session_data AS (
      SELECT $session_id AS sid,
             argMin(properties.$pathname, timestamp) AS landing,
             argMin(properties.$device_type, timestamp) AS device,
             max(if(event IN ('purchase','checkout_clicked','InitiateCheckout'), 1, 0)) AS converted
      FROM events
      WHERE timestamp >= toDateTime('${start}T00:00:00')
        AND timestamp <  toDateTime('${end}T23:59:59') + INTERVAL 1 DAY
        AND $session_id IS NOT NULL
      GROUP BY sid
    )
    SELECT
      landing AS path,
      count() AS sessions,
      sum(converted) AS converted,
      argMax(device, sessions) AS device
    FROM session_data
    GROUP BY landing
    ORDER BY sessions DESC
    LIMIT 30
  `;
  const out = await runHogQL<{ results: Array<unknown[]> }>(sql);
  if (!out) {
    return {
      worst_paths: [],
      top_entries: [],
      device_split: { desktop_pct: 0, mobile_pct: 0, tablet_pct: 0 },
    };
  }
  const rows = (out.results ?? []) as Array<
    [string, number, number, string | null]
  >;
  const enriched = rows.map(([path, sessions, converted]) => ({
    path: path || "(none)",
    sessions: Number(sessions),
    converted: Number(converted),
    conversion_rate_pct:
      sessions > 0 ? Math.round((converted / sessions) * 10000) / 100 : 0,
  }));

  const topEntries = enriched.slice(0, 10).map((r) => ({
    path: r.path,
    sessions: r.sessions,
    bounce_rate_pct: 0, // not computed yet — placeholder
  }));

  const worst = enriched
    .filter((r) => r.sessions >= 10)
    .sort((a, b) => a.conversion_rate_pct - b.conversion_rate_pct)
    .slice(0, 8)
    .map((r) => ({
      path: r.path,
      sessions: r.sessions,
      conversion_rate_pct: r.conversion_rate_pct,
    }));

  // Cheap device-split query
  const devSql = `
    SELECT properties.$device_type AS d, count(DISTINCT $session_id) AS s
    FROM events
    WHERE timestamp >= toDateTime('${start}T00:00:00')
      AND timestamp <  toDateTime('${end}T23:59:59') + INTERVAL 1 DAY
    GROUP BY d
  `;
  const devOut = await runHogQL<{ results: Array<[string | null, number]> }>(
    devSql
  );
  const devCounts = { desktop: 0, mobile: 0, tablet: 0, total: 0 };
  for (const [d, s] of devOut?.results ?? []) {
    const n = Number(s);
    devCounts.total += n;
    if (d === "Desktop") devCounts.desktop += n;
    else if (d === "Mobile") devCounts.mobile += n;
    else if (d === "Tablet") devCounts.tablet += n;
  }
  const pct = (n: number) =>
    devCounts.total > 0
      ? Math.round((n / devCounts.total) * 10000) / 100
      : 0;

  return {
    worst_paths: worst,
    top_entries: topEntries,
    device_split: {
      desktop_pct: pct(devCounts.desktop),
      mobile_pct: pct(devCounts.mobile),
      tablet_pct: pct(devCounts.tablet),
    },
  };
}

// ─── Orchestrator ──────────────────────────────────────────────────────────

export async function collectAllSensors(
  start: string,
  end: string
): Promise<SensorBundle> {
  const errors: SensorBundle["errors"] = [];
  const wrap = async <T>(
    name: string,
    fn: () => Promise<T>,
    fallback: T
  ): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      errors.push({
        sensor: name,
        error: err instanceof Error ? err.message : String(err),
      });
      return fallback;
    }
  };

  // Funnel must succeed — it's the foundation. Run it first.
  const funnel = await collectFunnel(start, end);

  const [retention, site, ads, sessions] = await Promise.all([
    wrap("retention", () => collectRetention(), {
      cohorts: [],
      avg_renewal_rate_pct: 0,
      paused_subs: 0,
      cancelled_subs: 0,
      active_subs: 0,
    }),
    wrap("site", () => collectSite(funnel), { pages: [] }),
    wrap("ads", () => collectAds(start, end, funnel), {
      google_ads: {
        available: false,
        reason: "sensor error",
        spend_cents: 0,
        clicks: 0,
        conversions: 0,
        impressions: 0,
      },
      x_ads: {
        available: false,
        reason: "sensor error",
        spend_cents: 0,
        clicks: 0,
        conversions: 0,
        impressions: 0,
      },
    }),
    wrap("sessions", () => collectSessions(start, end), {
      worst_paths: [],
      top_entries: [],
      device_split: { desktop_pct: 0, mobile_pct: 0, tablet_pct: 0 },
    }),
  ]);

  return {
    funnel,
    retention,
    site,
    ads,
    sessions,
    collected_at: new Date().toISOString(),
    errors,
  };
}
