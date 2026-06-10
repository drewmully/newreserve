/**
 * Ad Performance — shared fetchers and types for /admin/ad-performance.
 *
 * Pulls three data sources, joins them by (campaign_id, ad_group_id):
 *
 *   1. Google Ads REST  → spend, clicks, impressions, CTR per ad group + per keyword
 *   2. PostHog HogQL    → funnel counts (lp_view, quiz_started, quiz_completed,
 *                          checkout_clicked, begin_checkout) attributed via the
 *                          PERSON's first UTM (utm_campaign / utm_content)
 *   3. Shopify Admin    → NEW headless purchases only — tag:"Subscription First
 *                          Order", joined back to a PostHog person on email,
 *                          who carries the originating utm_content (ad group).
 *
 * Writes into public.ad_performance_snapshots keyed on
 * (snapshot_date, campaign_id, ad_group_id). Idempotent UPSERTs so the
 * hourly cron can re-write the trailing 48h without duplicates.
 *
 * Naming note: Google Ads stores `utm_campaign` / `utm_content` as the
 * external tracking template values configured in the campaign settings.
 * Our ads use:
 *   utm_campaign = mr_prospect_search | mr_brand_search
 *   utm_content  = ag_premium | ag_brand | ag_gift | ag_style | ag_personal
 * So Ads `campaign.id` doesn't equal the PostHog `utm_campaign` string — we
 * have to map both sides by their NAME → utm slug. The map lives below in
 * AD_GROUP_UTM_BY_ID. Whenever an ad group is added, add a row.
 */

import { mintGoogleAccessToken } from "@/app/api/_lib/googleAuth";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";

// ─── Static map: Google Ads ad_group_id → utm_content slug ──────────────────
// The cron must know which Google Ads ad group corresponds to which utm_content
// slug used by PostHog. We seed this from the live account; extend as new
// groups ship.

export const MR_CAMPAIGN_ID = "23901702384";

export const AD_GROUP_UTM_BY_ID: Record<
  string,
  { campaign_slug: string; ad_group_slug: string }
> = {
  // Campaign: MR | Prospecting | Search | Gift-Intent  (23901702384)
  "196388859839": { campaign_slug: "mr_prospect_search", ad_group_slug: "ag_gift" },        // AG1 Gift-Intent
  "197207547756": { campaign_slug: "mr_prospect_search", ad_group_slug: "ag_personal" },    // AG2 Personal-Shopper
  "195476349965": { campaign_slug: "mr_brand_search",    ad_group_slug: "ag_brand" },       // AG3 Brand-Defense
  "202771149968": { campaign_slug: "mr_prospect_search", ad_group_slug: "ag_premium" },     // AG4 Premium-Apparel
  "194914637217": { campaign_slug: "mr_prospect_search", ad_group_slug: "ag_style" },       // AG5 Style-Occasion
};

// Slug pair → ad_group_id (reverse lookup, computed once).
export const AD_GROUP_ID_BY_SLUG: Record<string, string> = Object.fromEntries(
  Object.entries(AD_GROUP_UTM_BY_ID).map(([id, s]) => [
    `${s.campaign_slug}|${s.ad_group_slug}`,
    id,
  ])
);

// Sentinel used when ad activity exists but UTMs were lost (pre-stitch, direct).
export const UNATTRIBUTED_CAMPAIGN_ID = "(unattributed)";
export const UNATTRIBUTED_AD_GROUP_ID = "(unattributed)";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface AdRow {
  campaign_id: string;
  campaign_name: string | null;
  ad_group_id: string;
  ad_group_name: string | null;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
}

export interface KeywordRow {
  campaign_id: string;
  ad_group_id: string;
  criterion_id: string;
  keyword_text: string | null;
  match_type: string | null;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  ctr: number;
  avg_cpc_micros: number;
}

export interface FunnelRow {
  campaign_slug: string;
  ad_group_slug: string;
  lp_views: number;
  quiz_started: number;
  quiz_completed: number;
  quiz_email_captured: number;
  checkout_clicked: number;
  begin_checkout: number;
  reveal_cta_clicked: number;
}

export interface PurchaseRow {
  campaign_slug: string;
  ad_group_slug: string;
  new_purchases: number;
  new_revenue_cents: number;
}

// ─── Google Ads auth ────────────────────────────────────────────────────────

async function mintAdsToken(): Promise<string | null> {
  const saB64 =
    process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64 ??
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (saB64) {
    try {
      return await mintGoogleAccessToken({
        scope: "https://www.googleapis.com/auth/adwords",
        sub: process.env.GOOGLE_ADS_IMPERSONATE_EMAIL,
      });
    } catch {
      /* fall through */
    }
  }
  // OAuth refresh-token fallback
  const refresh = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_ADS_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET;
  if (!refresh || !clientId || !clientSecret) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { access_token?: string };
  return j.access_token ?? null;
}

async function adsQuery(query: string): Promise<unknown[]> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  if (!developerToken || !loginCustomerId || !customerId) return [];
  const token = await mintAdsToken();
  if (!token) return [];

  const res = await fetch(
    `https://googleads.googleapis.com/v21/customers/${customerId}/googleAds:search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "developer-token": developerToken,
        "login-customer-id": loginCustomerId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: query.replace(/\s+/g, " ").trim() }),
    }
  );
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Google Ads query failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const j = (await res.json()) as { results?: unknown[] };
  return j.results ?? [];
}

// ─── Google Ads: ad-group-level metrics ─────────────────────────────────────

export async function fetchAdsByDate(start: string, end: string): Promise<
  Record<string, AdRow & { date: string }>
> {
  const query = `
    SELECT
      segments.date,
      campaign.id, campaign.name,
      ad_group.id, ad_group.name,
      metrics.impressions, metrics.clicks,
      metrics.cost_micros, metrics.conversions
    FROM ad_group
    WHERE segments.date BETWEEN '${start}' AND '${end}'
      AND ad_group.status != 'REMOVED'
      AND campaign.status != 'REMOVED'
      AND campaign.id = ${MR_CAMPAIGN_ID}
  `;
  const rows = await adsQuery(query);
  const out: Record<string, AdRow & { date: string }> = {};
  for (const raw of rows) {
    const r = raw as {
      segments?: { date?: string };
      campaign?: { id?: string; name?: string };
      adGroup?: { id?: string; name?: string };
      metrics?: {
        impressions?: string | number;
        clicks?: string | number;
        costMicros?: string | number;
        conversions?: string | number;
      };
    };
    const date = r.segments?.date;
    const campaignId = r.campaign?.id?.toString();
    const adGroupId = r.adGroup?.id?.toString();
    if (!date || !campaignId || !adGroupId) continue;
    const key = `${date}|${campaignId}|${adGroupId}`;
    out[key] = {
      date,
      campaign_id: campaignId,
      campaign_name: r.campaign?.name ?? null,
      ad_group_id: adGroupId,
      ad_group_name: r.adGroup?.name ?? null,
      impressions: Number(r.metrics?.impressions ?? 0),
      clicks: Number(r.metrics?.clicks ?? 0),
      cost_micros: Number(r.metrics?.costMicros ?? 0),
      conversions: Number(r.metrics?.conversions ?? 0),
    };
  }
  return out;
}

export async function fetchKeywordsByDate(
  start: string,
  end: string
): Promise<Array<KeywordRow & { date: string }>> {
  const query = `
    SELECT
      segments.date,
      campaign.id,
      ad_group.id,
      ad_group_criterion.criterion_id,
      ad_group_criterion.keyword.text,
      ad_group_criterion.keyword.match_type,
      metrics.impressions, metrics.clicks,
      metrics.cost_micros, metrics.conversions,
      metrics.ctr, metrics.average_cpc
    FROM keyword_view
    WHERE segments.date BETWEEN '${start}' AND '${end}'
      AND ad_group_criterion.status != 'REMOVED'
      AND campaign.id = ${MR_CAMPAIGN_ID}
  `;
  const rows = await adsQuery(query);
  const out: Array<KeywordRow & { date: string }> = [];
  for (const raw of rows) {
    const r = raw as {
      segments?: { date?: string };
      campaign?: { id?: string };
      adGroup?: { id?: string };
      adGroupCriterion?: {
        criterionId?: string | number;
        keyword?: { text?: string; matchType?: string };
      };
      metrics?: {
        impressions?: string | number;
        clicks?: string | number;
        costMicros?: string | number;
        conversions?: string | number;
        ctr?: string | number;
        averageCpc?: string | number;
      };
    };
    const date = r.segments?.date;
    const campaignId = r.campaign?.id?.toString();
    const adGroupId = r.adGroup?.id?.toString();
    const criterionId = r.adGroupCriterion?.criterionId?.toString();
    if (!date || !campaignId || !adGroupId || !criterionId) continue;
    out.push({
      date,
      campaign_id: campaignId,
      ad_group_id: adGroupId,
      criterion_id: criterionId,
      keyword_text: r.adGroupCriterion?.keyword?.text ?? null,
      match_type: r.adGroupCriterion?.keyword?.matchType ?? null,
      impressions: Number(r.metrics?.impressions ?? 0),
      clicks: Number(r.metrics?.clicks ?? 0),
      cost_micros: Number(r.metrics?.costMicros ?? 0),
      conversions: Number(r.metrics?.conversions ?? 0),
      ctr: Number(r.metrics?.ctr ?? 0),
      avg_cpc_micros: Number(r.metrics?.averageCpc ?? 0),
    });
  }
  return out;
}

// ─── PostHog: funnel by (utm_campaign, utm_content), per day ────────────────

interface HogQLResponse {
  results?: Array<Array<string | number | null>>;
}

async function runHogQL(query: string): Promise<HogQLResponse> {
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
  if (!projectId || !apiKey) return {};
  const res = await fetch(`${host}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PostHog HogQL failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as HogQLResponse;
}

/**
 * For each (date, campaign_slug, ad_group_slug, event) returns the unique
 * person count. Attribution uses the person's earliest non-empty
 * utm_campaign / utm_content across ANY event in the window — so a quiz
 * completer whose UTM only lived on their LP view still gets credited.
 */
export async function fetchFunnelByUtm(
  start: string,
  end: string
): Promise<Array<FunnelRow & { date: string }>> {
  const events = [
    "lp_subscription_view",
    "quiz_started",
    "quiz_completed",
    "quiz_email_captured",
    "begin_checkout",
    "reveal_cta_clicked",
    "checkout_clicked",
  ];
  // Note: lp_subscription_checkout_clicked was retired 2026-06-03 when the
  // LP shifted from direct-to-checkout to quiz-first flow. Removed here to
  // stop polluting the bucket with stale fires (last 7d: 2 fires).

  const eventList = events.map((e) => `'${e}'`).join(",");
  const mrSlugs = Object.values(AD_GROUP_UTM_BY_ID);
  const campaignSlugList = Array.from(new Set(mrSlugs.map((s) => `'${s.campaign_slug}'`))).join(",");

  // Step 1: bucket each MR event by its OWN utm if present, else by the
  // person's earliest MR-tagged UTM in a 60-day lookback.
  //
  // Why: people who click an ad once and come back days later usually
  // arrive UTM-less. Person-level lookback recovers them. Events that still
  // have no MR slug (organic, direct, or pre-stitch) fall into the
  // `(unattributed)` bucket so they remain visible.
  //
  // Why count() rather than count(distinct person_id): Drew compares this
  // to Google Ads `clicks`, which is event-count (not unique-people).
  // PostHog `lp_subscription_view` fires once per page load, so this
  // matches the click-equivalent metric.

  const lookbackStart = new Date(start);
  lookbackStart.setUTCDate(lookbackStart.getUTCDate() - 60);
  const lookbackStartStr = lookbackStart.toISOString().slice(0, 10);

  const sql = `
    with person_mr_attrib as (
      select
        person_id,
        argMin(properties.utm_campaign, timestamp) as campaign,
        argMin(properties.utm_content, timestamp) as ad_group
      from events
      where timestamp >= '${lookbackStartStr} 00:00:00'
        and timestamp <  '${end} 23:59:59'
        and properties.utm_campaign in (${campaignSlugList})
      group by person_id
    )
    select
      toDate(e.timestamp) as date,
      coalesce(
        nullif(if(e.properties.utm_campaign in (${campaignSlugList}), e.properties.utm_campaign, ''), ''),
        nullif(pa.campaign, ''),
        '(unattributed)'
      ) as campaign,
      coalesce(
        nullif(if(e.properties.utm_campaign in (${campaignSlugList}), e.properties.utm_content, ''), ''),
        nullif(pa.ad_group, ''),
        '(unattributed)'
      ) as ad_group,
      e.event,
      count() as evts
    from events e
    left join person_mr_attrib pa on pa.person_id = e.person_id
    where e.timestamp >= '${start} 00:00:00'
      and e.timestamp <  '${end} 23:59:59'
      and e.event in (${eventList})
    group by date, campaign, ad_group, e.event
  `;

  const res = await runHogQL(sql);
  const rows = res.results ?? [];

  // Index by (date, campaign, ad_group)
  const byKey = new Map<
    string,
    FunnelRow & { date: string }
  >();
  for (const r of rows) {
    const [date, campaign, adGroup, event, count] = r as [
      string,
      string,
      string,
      string,
      number
    ];
    const key = `${date}|${campaign}|${adGroup}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        date,
        campaign_slug: campaign,
        ad_group_slug: adGroup,
        lp_views: 0,
        quiz_started: 0,
        quiz_completed: 0,
        quiz_email_captured: 0,
        checkout_clicked: 0,
        begin_checkout: 0,
        reveal_cta_clicked: 0,
      };
      byKey.set(key, row);
    }
    const n = Number(count);
    switch (event) {
      case "lp_subscription_view": row.lp_views = n; break;
      case "quiz_started": row.quiz_started = n; break;
      case "quiz_completed": row.quiz_completed = n; break;
      case "quiz_email_captured": row.quiz_email_captured = n; break;
      // Roll two checkout-intent events into one bucket: the generic
      // GA-style begin_checkout and the modern reveal-page CTA
      // (reveal_cta_clicked, fires from the personalized reveal page that
      // Meta and Resend cohorts hit).
      case "checkout_clicked": row.checkout_clicked += n; break;
      case "reveal_cta_clicked": row.reveal_cta_clicked += n; row.checkout_clicked += n; break;
      case "begin_checkout": row.begin_checkout = n; break;
    }
  }
  return Array.from(byKey.values());
}

// ─── Shopify: new-customer purchases joined back to UTM via PostHog ─────────

interface ShopifyFirstOrder {
  email: string | null;
  createdAtDate: string; // YYYY-MM-DD
  totalCents: number;
}

async function fetchShopifyFirstOrders(
  start: string,
  end: string
): Promise<ShopifyFirstOrder[]> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!domain || !token) return [];

  const query = `
    query ($q: String!, $cursor: String) {
      orders(first: 100, after: $cursor, query: $q, sortKey: CREATED_AT) {
        edges {
          cursor
          node {
            createdAt
            email
            totalPriceSet { shopMoney { amount } }
          }
        }
        pageInfo { hasNextPage }
      }
    }`;
  // "Subscription First Order" tag = headless first-time member orders.
  // We deliberately EXCLUDE "Subscription Recurring Order" (renewals).
  const q = `tag:"Subscription First Order" created_at:>=${start} created_at:<=${end}T23:59:59Z`;
  const out: ShopifyFirstOrder[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
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
    if (!res.ok) break;
    const j = (await res.json()) as {
      data?: {
        orders?: {
          edges: Array<{
            cursor: string;
            node: {
              createdAt: string;
              email: string | null;
              totalPriceSet?: { shopMoney?: { amount?: string } };
            };
          }>;
          pageInfo: { hasNextPage: boolean };
        };
      };
    };
    const orders = j.data?.orders;
    if (!orders) break;
    for (const e of orders.edges) {
      const amt = parseFloat(e.node.totalPriceSet?.shopMoney?.amount ?? "0");
      out.push({
        email: e.node.email?.toLowerCase() ?? null,
        createdAtDate: e.node.createdAt.slice(0, 10),
        totalCents: Math.round(amt * 100),
      });
      cursor = e.cursor;
    }
    if (!orders.pageInfo.hasNextPage) break;
  }
  return out;
}

/**
 * For each new headless purchaser, look up their utm_campaign/utm_content
 * in PostHog (any event ever) and bucket the purchase under that ad group.
 */
export async function fetchPurchasesByUtm(
  start: string,
  end: string
): Promise<Array<PurchaseRow & { date: string }>> {
  const orders = await fetchShopifyFirstOrders(start, end);
  if (orders.length === 0) return [];

  const emails = orders
    .map((o) => o.email)
    .filter((e): e is string => Boolean(e));
  if (emails.length === 0) return [];

  // Look up each purchaser's first MR-tagged UTM in PostHog.
  const mrSlugs = Object.values(AD_GROUP_UTM_BY_ID);
  const campaignSlugList = Array.from(
    new Set(mrSlugs.map((s) => `'${s.campaign_slug}'`))
  ).join(",");
  const escaped = emails.map((e) => `'${e.replace(/'/g, "''")}'`).join(",");
  const sql = `
    select
      lower(person.properties.email) as email,
      argMin(properties.utm_campaign, timestamp) as campaign,
      argMin(properties.utm_content, timestamp) as ad_group
    from events
    where lower(person.properties.email) in (${escaped})
      and properties.utm_campaign in (${campaignSlugList})
    group by email
  `;
  const phRes = await runHogQL(sql).catch(() => ({} as HogQLResponse));
  const attribByEmail = new Map<string, { campaign: string; ad_group: string }>();
  for (const r of phRes.results ?? []) {
    const [email, campaign, adGroup] = r as [string, string, string];
    if (email) {
      attribByEmail.set(email, {
        campaign: campaign || "(unattributed)",
        ad_group: adGroup || "(unattributed)",
      });
    }
  }

  // Aggregate by (date, campaign, ad_group). Purchases without a known MR
  // UTM go into the (unattributed) bucket so revenue still appears.
  const byKey = new Map<string, PurchaseRow & { date: string }>();
  for (const o of orders) {
    const attrib = (o.email && attribByEmail.get(o.email)) || {
      campaign: "(unattributed)",
      ad_group: "(unattributed)",
    };
    const key = `${o.createdAtDate}|${attrib.campaign}|${attrib.ad_group}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        date: o.createdAtDate,
        campaign_slug: attrib.campaign,
        ad_group_slug: attrib.ad_group,
        new_purchases: 0,
        new_revenue_cents: 0,
      };
      byKey.set(key, row);
    }
    row.new_purchases += 1;
    row.new_revenue_cents += o.totalCents;
  }
  return Array.from(byKey.values());
}

// ─── Refresh orchestrator: write snapshots into Supabase ────────────────────

/**
 * Refresh trailing N days of snapshots. Idempotent — re-running the same
 * window overwrites all rows for those dates. Returns counts for logging.
 */
export async function refreshAdPerformance(days = 2): Promise<{
  dates: string[];
  snapshots_written: number;
  keywords_written: number;
}> {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);

  const [adsByDate, keywordRows, funnelRows, purchaseRows] = await Promise.all([
    fetchAdsByDate(startStr, endStr).catch((e) => {
      console.error("[ad-perf] ads fetch failed", e);
      return {} as Record<string, AdRow & { date: string }>;
    }),
    fetchKeywordsByDate(startStr, endStr).catch((e) => {
      console.error("[ad-perf] keywords fetch failed", e);
      return [] as Array<KeywordRow & { date: string }>;
    }),
    fetchFunnelByUtm(startStr, endStr).catch((e) => {
      console.error("[ad-perf] funnel fetch failed", e);
      return [] as Array<FunnelRow & { date: string }>;
    }),
    fetchPurchasesByUtm(startStr, endStr).catch((e) => {
      console.error("[ad-perf] purchases fetch failed", e);
      return [] as Array<PurchaseRow & { date: string }>;
    }),
  ]);

  // Build snapshots: one row per (date, campaign_id, ad_group_id).
  // We index by the Google Ads ID (canonical), then attach funnel/purchase
  // numbers via AD_GROUP_UTM_BY_ID. Ad groups with no Ads spend but with
  // PostHog activity (rare — direct/referral) are skipped here — they're
  // surfaced separately in the "unattributed" bucket on the UI.

  const snapshotsByKey = new Map<
    string,
    {
      snapshot_date: string;
      campaign_id: string;
      ad_group_id: string;
      campaign_name: string | null;
      ad_group_name: string | null;
      impressions: number;
      clicks: number;
      cost_micros: number;
      conversions: number;
      lp_views: number;
      quiz_started: number;
      quiz_completed: number;
      quiz_email_captured: number;
      checkout_clicked: number;
      begin_checkout: number;
      new_purchases: number;
      new_revenue_cents: number;
    }
  >();

  for (const ads of Object.values(adsByDate)) {
    const key = `${ads.date}|${ads.campaign_id}|${ads.ad_group_id}`;
    snapshotsByKey.set(key, {
      snapshot_date: ads.date,
      campaign_id: ads.campaign_id,
      ad_group_id: ads.ad_group_id,
      campaign_name: ads.campaign_name,
      ad_group_name: ads.ad_group_name,
      impressions: ads.impressions,
      clicks: ads.clicks,
      cost_micros: ads.cost_micros,
      conversions: ads.conversions,
      lp_views: 0,
      quiz_started: 0,
      quiz_completed: 0,
      quiz_email_captured: 0,
      checkout_clicked: 0,
      begin_checkout: 0,
      new_purchases: 0,
      new_revenue_cents: 0,
    });
  }

  // Build a reverse map slug → ad_group_id so we can merge funnel + purchase
  // rows back onto the right Ads row.
  const slugToAdGroupId = new Map<string, string>(
    Object.entries(AD_GROUP_ID_BY_SLUG)
  );

  function applyToSnapshot<T extends { date: string; campaign_slug: string; ad_group_slug: string }>(
    row: T,
    apply: (target: NonNullable<ReturnType<typeof snapshotsByKey.get>>) => void
  ) {
    // `(unattributed)` rows go into a single per-date bucket so they remain
    // visible in the UI rather than silently dropped.
    const isUnattrib =
      row.campaign_slug === "(unattributed)" ||
      row.ad_group_slug === "(unattributed)";
    const slugKey = `${row.campaign_slug}|${row.ad_group_slug}`;
    const adGroupId = isUnattrib
      ? UNATTRIBUTED_AD_GROUP_ID
      : slugToAdGroupId.get(slugKey);
    if (!adGroupId) return; // a non-MR slug we don't track
    // Find the snapshot for this date+ad group. The Ads row tells us
    // campaign_id; we look it up across all snapshots for this ad group.
    let target: NonNullable<ReturnType<typeof snapshotsByKey.get>> | undefined;
    for (const v of snapshotsByKey.values()) {
      if (v.snapshot_date === row.date && v.ad_group_id === adGroupId) {
        target = v;
        break;
      }
    }
    if (!target) {
      // No Ads row for this date+ad group (e.g. funnel activity on a day
      // with no spend reported yet — Ads has a few-hour lag, or the row is
      // an `(unattributed)` bucket). Seed a row with zero spend so the
      // funnel numbers aren't lost.
      const campaignId = isUnattrib ? UNATTRIBUTED_CAMPAIGN_ID : "(pending)";
      const seed = {
        snapshot_date: row.date,
        campaign_id: campaignId,
        ad_group_id: adGroupId,
        campaign_name: isUnattrib ? "Unattributed" : null,
        ad_group_name: isUnattrib ? "Unattributed" : null,
        impressions: 0,
        clicks: 0,
        cost_micros: 0,
        conversions: 0,
        lp_views: 0,
        quiz_started: 0,
        quiz_completed: 0,
        quiz_email_captured: 0,
        checkout_clicked: 0,
        begin_checkout: 0,
        new_purchases: 0,
        new_revenue_cents: 0,
      };
      snapshotsByKey.set(
        `${row.date}|${campaignId}|${adGroupId}`,
        seed
      );
      target = seed;
    }
    apply(target);
  }

  for (const f of funnelRows) {
    applyToSnapshot(f, (t) => {
      t.lp_views += f.lp_views;
      t.quiz_started += f.quiz_started;
      t.quiz_completed += f.quiz_completed;
      t.quiz_email_captured += f.quiz_email_captured;
      t.checkout_clicked += f.checkout_clicked;
      t.begin_checkout += f.begin_checkout;
    });
  }
  for (const p of purchaseRows) {
    applyToSnapshot(p, (t) => {
      t.new_purchases += p.new_purchases;
      t.new_revenue_cents += p.new_revenue_cents;
    });
  }

  const rows = Array.from(snapshotsByKey.values()).map((s) => ({
    ...s,
    impressions: Math.round(s.impressions || 0),
    clicks: Math.round(s.clicks || 0),
    cost_micros: Math.round(s.cost_micros || 0),
    lp_views: Math.round(s.lp_views || 0),
    quiz_started: Math.round(s.quiz_started || 0),
    quiz_completed: Math.round(s.quiz_completed || 0),
    quiz_email_captured: Math.round(s.quiz_email_captured || 0),
    checkout_clicked: Math.round(s.checkout_clicked || 0),
    begin_checkout: Math.round(s.begin_checkout || 0),
    new_purchases: Math.round(s.new_purchases || 0),
    new_revenue_cents: Math.round(s.new_revenue_cents || 0),
    refreshed_at: new Date().toISOString(),
  }));

  const sb = getSupabaseService();
  if (rows.length > 0) {
    const { error } = await sb
      .from("ad_performance_snapshots")
      .upsert(rows, { onConflict: "snapshot_date,campaign_id,ad_group_id" });
    if (error) throw new Error(`upsert snapshots: ${error.message}`);
  }

  // Keyword rows
  const kwRows = keywordRows.map((k) => ({
    snapshot_date: k.date,
    campaign_id: k.campaign_id,
    ad_group_id: k.ad_group_id,
    criterion_id: k.criterion_id,
    keyword_text: k.keyword_text,
    match_type: k.match_type,
    impressions: Math.round(k.impressions || 0),
    clicks: Math.round(k.clicks || 0),
    cost_micros: Math.round(k.cost_micros || 0),
    conversions: k.conversions || 0,
    ctr: k.ctr,
    avg_cpc_micros: Math.round(k.avg_cpc_micros || 0),
    refreshed_at: new Date().toISOString(),
  }));
  if (kwRows.length > 0) {
    const { error } = await sb
      .from("ad_performance_keywords")
      .upsert(kwRows, {
        onConflict: "snapshot_date,campaign_id,ad_group_id,criterion_id",
      });
    if (error) throw new Error(`upsert keywords: ${error.message}`);
  }

  return {
    dates: [startStr, endStr],
    snapshots_written: rows.length,
    keywords_written: kwRows.length,
  };
}
