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
  IntentSensorData,
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
  // NOTE: marketing-funnel route emits `visits/checkouts/purchases`
  // (NOT `landed/initiated/completed`). Earlier versions of this sensor
  // read the wrong keys and silently produced all zeros. We also prefer
  // `all_paths` (one row per real path) over `path_buckets` (5 coarse
  // labelled buckets) so the analyst sees per-LP detail.
  const allPaths = (funnel.all_paths ?? []) as Array<Record<string, unknown>>;
  const coarseBuckets = (funnel.path_buckets ?? []) as Array<
    Record<string, unknown>
  >;
  const channels = (funnel.channels ?? []) as Array<Record<string, unknown>>;
  const totalVisits = Number(totals.visits ?? 0);
  const totalCheckouts = Number(totals.checkouts ?? 0);
  const totalPurchases = Number(totals.purchases ?? 0);
  const shopifyCompleted = Number(funnel.shopify_completed_orders ?? 0);
  const shopifyAbandoned = Number(funnel.shopify_abandoned_checkouts ?? 0);
  const shopifyInitiated = Number(funnel.shopify_checkouts_initiated ?? 0);

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
      landed: totalVisits,
      initiated: totalCheckouts,
      abandoned: Math.max(totalCheckouts - totalPurchases, 0),
      completed: totalPurchases,
    },
    path_buckets: allPaths.map((b) => ({
      path: String(b.path ?? ""),
      landed: Number(b.visits ?? 0),
      initiated: Number(b.checkouts ?? 0),
      completed: Number(b.purchases ?? 0),
    })),
    channels: channels.map((c) => ({
      channel: String(c.channel ?? ""),
      landed: Number(c.visits ?? c.landed ?? 0),
      initiated: Number(c.checkouts ?? c.initiated ?? 0),
      completed: Number(c.purchases ?? c.completed ?? 0),
    })),
    shopify_ground_truth: {
      initiated: shopifyInitiated,
      abandoned: shopifyAbandoned,
      completed: shopifyCompleted,
    },
    // ──────────────────────────────────────────────────────────────────────
    // CONVERSION RATES — the headline insight a CMO must surface unprompted.
    // Visit→checkout is what the CEO measures every LP against. We compute
    // it both globally and per landing path so the analyst can spotlight
    // which pages are leaking funnel volume and which are converting.
    // Visit→order uses Shopify ground truth (completed first orders) so it
    // ignores PostHog purchase event drop-off from adblockers/Shopify pixel.
    // ──────────────────────────────────────────────────────────────────────
    conversion_rates: (() => {
      const rate = (n: number, d: number) =>
        d > 0 ? Math.round((n / d) * 10000) / 100 : 0;
      const perPath = allPaths
        .map((b) => {
          const visits = Number(b.visits ?? 0);
          const checkouts = Number(b.checkouts ?? 0);
          const orders = Number(b.purchases ?? 0);
          return {
            path: String(b.path ?? ""),
            visits,
            checkouts,
            orders,
            visit_to_checkout_pct: rate(checkouts, visits),
            checkout_to_order_pct: rate(orders, checkouts),
            visit_to_order_pct: rate(orders, visits),
          };
        })
        .filter((r) => r.visits >= 25) // suppress long-tail noise
        .sort((a, b) => b.visits - a.visits)
        .slice(0, 15);
      // Also expose the coarse LP buckets the funnel route already
      // computes (home / lp_subscription / lp_gift / lp_other / other).
      const perBucket = coarseBuckets.map((b) => {
        const visits = Number(b.visits ?? 0);
        const checkouts = Number(b.checkouts ?? 0);
        const orders = Number(b.purchases ?? 0);
        return {
          bucket: String(b.bucket ?? ""),
          label: String(b.label ?? b.bucket ?? ""),
          visits,
          checkouts,
          orders,
          visit_to_checkout_pct: rate(checkouts, visits),
          checkout_to_order_pct: rate(orders, checkouts),
          visit_to_order_pct: rate(orders, visits),
        };
      });
      return {
        overall: {
          visits: totalVisits,
          checkouts: totalCheckouts,
          orders_shopify: shopifyCompleted,
          visit_to_checkout_pct: rate(totalCheckouts, totalVisits),
          checkout_to_order_shopify_pct: rate(
            shopifyCompleted,
            totalCheckouts
          ),
          visit_to_order_shopify_pct: rate(shopifyCompleted, totalVisits),
        },
        per_path: perPath,
        per_bucket: perBucket,
        benchmarks: {
          // Healthy DTC subscription LPs typically land at 2–5% visit→checkout
          // and 25–40% checkout→order. Anything under 1% visit→checkout is
          // a red alert and should drive the lead recommendation.
          visit_to_checkout_healthy_min_pct: 2,
          visit_to_checkout_alert_max_pct: 1,
          checkout_to_order_healthy_min_pct: 25,
        },
      };
    })(),
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

// ─── Intent Sensor ─────────────────────────────────────────────────────────
//
// "Why aren't people even trying to check out?" — per-LP intent breakdown.
// All queries gated on `is_bot != true`. Reads PostHog directly (event name
// is `page_view`, NOT the PostHog default `$pageview`). Returns
// `available: false` with a reason if PostHog is unreachable so the
// analysts can tell the difference between "no signal" and "empty data".

const INTENT_LPS = [
  "/",
  "/lp/subscription",
  "/choose-plan",
  "/lp/gift",
  "/reserve/founders",
];

function safePct(n: number, d: number, digits = 2): number {
  if (d <= 0) return 0;
  const f = Math.pow(10, digits);
  return Math.round((n / d) * 100 * f) / f;
}

export async function collectIntent(
  start: string,
  end: string
): Promise<IntentSensorData> {
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  if (!projectId || !apiKey) {
    return {
      per_lp: [],
      audience: {
        mobile_pct: 0,
        desktop_pct: 0,
        top_referrer: "",
        top_referrer_pct: 0,
        paid_share_pct: 0,
      },
      available: false,
      reason: "POSTHOG_PROJECT_ID or POSTHOG_PERSONAL_API_KEY missing",
    };
  }

  const startDt = `toDateTime('${start}T00:00:00')`;
  const endDt = `toDateTime('${end}T23:59:59') + INTERVAL 1 DAY`;

  const perLp = await Promise.all(
    INTENT_LPS.map(async (path) => {
      // Session rollup for sessions that included this LP as a page_view.
      const visitsSql = `
        WITH s AS (
          SELECT properties.$session_id AS sid,
                 argMin(properties.$device_type, timestamp) AS device,
                 max(if(event IN ('checkout_clicked','reveal_cta_clicked','InitiateCheckout'), 1, 0)) AS checked_out,
                 countIf(event != 'page_view' AND event NOT LIKE '$%') AS engagement_events
          FROM events
          WHERE timestamp >= ${startDt}
            AND timestamp <  ${endDt}
            AND properties.is_bot != true
            AND properties.$session_id IN (
              SELECT properties.$session_id
              FROM events
              WHERE event = 'page_view'
                AND properties.$pathname = '${path}'
                AND timestamp >= ${startDt}
                AND timestamp <  ${endDt}
                AND properties.is_bot != true
            )
          GROUP BY sid
        )
        SELECT count() AS sessions,
               sum(checked_out) AS checkouts,
               countIf(device = 'Desktop') AS desktop,
               countIf(device = 'Mobile')  AS mobile,
               countIf(device = 'Tablet')  AS tablet,
               sumIf(checked_out, device = 'Desktop') AS co_desktop,
               sumIf(checked_out, device = 'Mobile')  AS co_mobile,
               sumIf(checked_out, device = 'Tablet')  AS co_tablet,
               countIf(engagement_events > 0) AS engaged
        FROM s
      `;
      const visitsRes = await runHogQL<{ results: Array<unknown[]> }>(visitsSql);
      const row = (visitsRes?.results?.[0] ?? []) as number[];
      const sessions = Number(row[0] ?? 0);
      const checkouts = Number(row[1] ?? 0);
      const desktop = Number(row[2] ?? 0);
      const mobile = Number(row[3] ?? 0);
      const tablet = Number(row[4] ?? 0);
      const coDesktop = Number(row[5] ?? 0);
      const coMobile = Number(row[6] ?? 0);
      const coTablet = Number(row[7] ?? 0);
      const engaged = Number(row[8] ?? 0);

      // Top referrers — anchored on page_view of this path.
      const refSql = `
        SELECT properties.$referring_domain AS ref, count() AS n
        FROM events
        WHERE event = 'page_view'
          AND properties.$pathname = '${path}'
          AND timestamp >= ${startDt}
          AND timestamp <  ${endDt}
          AND properties.is_bot != true
        GROUP BY ref
        ORDER BY n DESC
        LIMIT 8
      `;
      const refRes = await runHogQL<{ results: Array<[string | null, number]> }>(
        refSql
      );
      const refRows = refRes?.results ?? [];
      const refTotal = refRows.reduce((a, [, n]) => a + Number(n), 0);
      const topReferrers = refRows.map(([d, n]) => ({
        domain: d || "(none)",
        visits: Number(n),
        pct: safePct(Number(n), refTotal),
      }));

      // UTM-source split + V→C per UTM source.
      const utmSql = `
        WITH s AS (
          SELECT properties.$session_id AS sid,
                 argMin(properties.utm_source, timestamp) AS utm_source,
                 max(if(event IN ('checkout_clicked','reveal_cta_clicked','InitiateCheckout'), 1, 0)) AS checked_out
          FROM events
          WHERE timestamp >= ${startDt}
            AND timestamp <  ${endDt}
            AND properties.is_bot != true
            AND properties.$session_id IN (
              SELECT properties.$session_id
              FROM events
              WHERE event = 'page_view'
                AND properties.$pathname = '${path}'
                AND timestamp >= ${startDt}
                AND timestamp <  ${endDt}
                AND properties.is_bot != true
            )
          GROUP BY sid
        )
        SELECT coalesce(utm_source, '(none)') AS src,
               count() AS sessions,
               sum(checked_out) AS checkouts
        FROM s
        GROUP BY src
        ORDER BY sessions DESC
        LIMIT 8
      `;
      const utmRes = await runHogQL<{ results: Array<[string, number, number]> }>(
        utmSql
      );
      const utmRows = utmRes?.results ?? [];
      const utmSources = utmRows.map(([src, s, c]) => ({
        source: String(src ?? "(none)"),
        visits: Number(s),
        checkouts: Number(c),
        visit_to_checkout_pct: safePct(Number(c), Number(s)),
      }));

      // 50-session minimum for device-level V→C — anything less is noise.
      const conv = (n: number, d: number) =>
        d >= 50 ? safePct(n, d) : null;

      return {
        path,
        visits_human: sessions,
        checkouts,
        visit_to_checkout_pct: safePct(checkouts, sessions),
        devices: {
          desktop_pct: safePct(desktop, sessions),
          mobile_pct: safePct(mobile, sessions),
          tablet_pct: safePct(tablet, sessions),
        },
        visit_to_checkout_by_device_pct: {
          desktop: conv(coDesktop, desktop),
          mobile: conv(coMobile, mobile),
          tablet: conv(coTablet, tablet),
        },
        top_referrers: topReferrers,
        utm_sources: utmSources,
        hero_engagement: {
          pct_engaged: safePct(engaged, sessions),
          sample_size: sessions,
        },
      };
    })
  );

  // Audience aggregate — one query across the whole window.
  const audSql = `
    SELECT properties.$device_type AS dev,
           properties.$referring_domain AS ref,
           properties.utm_medium AS medium,
           count(DISTINCT properties.$session_id) AS s
    FROM events
    WHERE event = 'page_view'
      AND timestamp >= ${startDt}
      AND timestamp <  ${endDt}
      AND properties.is_bot != true
    GROUP BY dev, ref, medium
  `;
  const audRes = await runHogQL<{
    results: Array<[string | null, string | null, string | null, number]>;
  }>(audSql);
  const audRows = audRes?.results ?? [];
  let mobile = 0, desktop = 0, tablet = 0, paid = 0, total = 0;
  const refCounts = new Map<string, number>();
  for (const [dev, ref, medium, s] of audRows) {
    const n = Number(s);
    total += n;
    if (dev === "Mobile") mobile += n;
    else if (dev === "Desktop") desktop += n;
    else if (dev === "Tablet") tablet += n;
    const refKey = ref || "(none)";
    refCounts.set(refKey, (refCounts.get(refKey) ?? 0) + n);
    if (medium && /cpc|ppc|paid|paidsocial/i.test(medium)) paid += n;
  }
  void tablet;
  let topRef = "";
  let topRefN = 0;
  for (const [k, v] of refCounts) {
    if (v > topRefN) { topRefN = v; topRef = k; }
  }

  return {
    per_lp: perLp,
    audience: {
      mobile_pct: safePct(mobile, total),
      desktop_pct: safePct(desktop, total),
      top_referrer: topRef,
      top_referrer_pct: safePct(topRefN, total),
      paid_share_pct: safePct(paid, total),
    },
    available: true,
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

  const [retention, site, ads, sessions, intent] = await Promise.all([
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
    wrap("intent", () => collectIntent(start, end), {
      per_lp: [],
      audience: {
        mobile_pct: 0,
        desktop_pct: 0,
        top_referrer: "",
        top_referrer_pct: 0,
        paid_share_pct: 0,
      },
      available: false,
      reason: "intent sensor error",
    }),
  ]);

  return {
    funnel,
    retention,
    site,
    ads,
    sessions,
    intent,
    collected_at: new Date().toISOString(),
    errors,
  };
}
