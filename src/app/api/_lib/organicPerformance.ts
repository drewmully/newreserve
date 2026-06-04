/**
 * Organic Performance — sister module to adPerformance.ts.
 *
 * Tracks non-paid traffic through the same funnel (LP view → quiz → checkout
 * → purchase), bucketed by referring domain rather than ad group.
 *
 * Source buckets (canonical slugs in `source` column):
 *   organic_search   — google, bing, duckduckgo, brave, ecosia, yahoo
 *   meta             — facebook.com, instagram.com (any subdomain)
 *   x                — x.com, t.co, twitter.com, com.twitter.android
 *   youtube          — youtube.com, m.youtube.com
 *   reddit           — reddit.com (any subdomain)
 *   linkedin         — linkedin.com, lnkd.in
 *   ai               — chatgpt.com, perplexity.ai, claude.ai, gemini.google.com
 *   direct           — $direct (no referrer) AND no UTMs
 *   referral         — any other external domain
 *
 * Hard exclusions (so paid never leaks in):
 *   - any event with properties.gclid present
 *   - utm_medium in ('cpc','paid','ppc','paidsocial','paid_social','display')
 *   - utm_source = 'google' (only used by our paid ads)
 *   - referring_domain in (mymully.com, mully-reserve.firebaseapp.com,
 *     checkout.mymully.com, mullybox.com) — internal redirects
 *
 * Counting model:
 *   - sessions: distinct $session_id per (date, source)  — closest analog to
 *     ad clicks. One session = one user visit.
 *   - downstream events: count() of the event, matching the paid funnel's
 *     event-count semantics so the numbers compare apples-to-apples.
 *
 * Person-level attribution: the first non-paid referring_domain a person sees
 * sticks for any subsequent purchases (within 60d lookback), so a Google
 * search → return-visit-direct → purchase still credits Organic Search.
 */

import { getSupabaseService } from "@/app/api/_lib/supabaseService";

// ─── Source bucketing ───────────────────────────────────────────────────────

export const ORGANIC_SOURCES = [
  { slug: "organic_search", label: "Organic Search" },
  { slug: "meta", label: "Meta (FB/IG)" },
  { slug: "x", label: "X / Twitter" },
  { slug: "youtube", label: "YouTube" },
  { slug: "reddit", label: "Reddit" },
  { slug: "linkedin", label: "LinkedIn" },
  { slug: "ai", label: "AI (ChatGPT/Perplexity)" },
  { slug: "referral", label: "Other Referral" },
] as const;

export type OrganicSourceSlug = (typeof ORGANIC_SOURCES)[number]["slug"];

export const SOURCE_LABEL_BY_SLUG: Record<string, string> = Object.fromEntries(
  ORGANIC_SOURCES.map((s) => [s.slug, s.label])
);

// ─── Types ──────────────────────────────────────────────────────────────────

export interface OrganicFunnelRow {
  date: string;
  source: string;
  sessions: number;
  lp_views: number;
  quiz_started: number;
  quiz_completed: number;
  quiz_email_captured: number;
  checkout_clicked: number;
  begin_checkout: number;
}

export interface OrganicPurchaseRow {
  date: string;
  source: string;
  new_purchases: number;
  new_revenue_cents: number;
}

// ─── HogQL helpers ──────────────────────────────────────────────────────────

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

// ─── The source-classification CASE expression (reused everywhere) ───────────
//
// Why a giant CASE rather than a regex: HogQL/ClickHouse SQL doesn't have a
// great pattern-match story, and being explicit also makes the bucketing
// auditable. If a domain isn't in any rule, it falls into `referral`.

const SOURCE_CASE = `
  multiIf(
    rd in ('google.com','www.google.com','google.co.uk','google.ca','m.google.com',
           'bing.com','www.bing.com','duckduckgo.com','search.brave.com',
           'search.yahoo.com','yahoo.com','ecosia.org','www.ecosia.org',
           'yandex.com','baidu.com'), 'organic_search',
    rd in ('facebook.com','www.facebook.com','m.facebook.com','l.facebook.com',
           'lm.facebook.com','instagram.com','www.instagram.com','l.instagram.com'),
           'meta',
    rd in ('x.com','www.x.com','twitter.com','www.twitter.com','mobile.twitter.com',
           't.co','com.twitter.android'), 'x',
    rd in ('youtube.com','www.youtube.com','m.youtube.com','youtu.be'), 'youtube',
    rd in ('reddit.com','www.reddit.com','old.reddit.com','m.reddit.com','out.reddit.com'),
           'reddit',
    rd in ('linkedin.com','www.linkedin.com','lnkd.in'), 'linkedin',
    rd in ('chatgpt.com','chat.openai.com','perplexity.ai','www.perplexity.ai',
           'claude.ai','gemini.google.com','copilot.microsoft.com'), 'ai',
    -- Direct/null referrers are excluded from the organic tab entirely —
    -- they're not a tracked source. NULL here gets filtered downstream.
    rd = '$direct' or rd is null, NULL,
    'referral'
  )`;

// Internal/self domains that should NEVER count as organic referrers.
const INTERNAL_DOMAINS = [
  "mymully.com",
  "www.mymully.com",
  "mullybox.com",
  "www.mullybox.com",
  "checkout.mymully.com",
  "mully-reserve.firebaseapp.com",
];
const INTERNAL_LIST = INTERNAL_DOMAINS.map((d) => `'${d}'`).join(",");

// Where-clause fragment that filters OUT paid signals + internal hops.
// Used in every organic query so the rules can't drift.
const ORGANIC_FILTER = `
  (properties.gclid is null or properties.gclid = '')
  and (properties.utm_medium is null or properties.utm_medium not in (
    'cpc','paid','ppc','paidsocial','paid_social','display'))
  and (properties.utm_source is null or properties.utm_source not in (
    'google_ads','meta_ads','facebook_ads','instagram_ads','google'))
  and (properties.$referring_domain is null or properties.$referring_domain not in (${INTERNAL_LIST}))
`;

// ─── Funnel: sessions + downstream events by (date, source) ─────────────────

export async function fetchOrganicFunnel(
  start: string,
  end: string
): Promise<OrganicFunnelRow[]> {
  // Step 1: per (date, source) sessions = distinct $session_id among
  // organic-eligible pageviews. Distinct on session_id (not person_id) so a
  // user with two visits in a day counts twice — same as Google Ads counting
  // two clicks.
  const sessionsSql = `
    with src as (
      select
        toDate(timestamp) as date,
        properties.$referring_domain as rd,
        properties.$session_id as sid
      from events
      where event = '$pageview'
        and timestamp >= '${start} 00:00:00'
        and timestamp <  '${end} 23:59:59'
        and ${ORGANIC_FILTER}
    )
    select date, ${SOURCE_CASE} as source, count(distinct sid) as sessions
    from src
    where sid is not null
    group by date, source
    having source is not null
  `;

  // Step 2: per (date, source) counts for each funnel event. Attribution:
  // an event "belongs to" a source if EITHER (a) the event itself carries a
  // referring_domain matching that source, OR (b) the person's earliest
  // organic-eligible pageview within a 60-day lookback was that source.
  // Without (b), a quiz_completed from a returning $direct visit would never
  // attribute back to the Google search that originally brought them in.
  const lookback = new Date(start);
  lookback.setUTCDate(lookback.getUTCDate() - 60);
  const lookbackStart = lookback.toISOString().slice(0, 10);

  const eventsSql = `
    with person_first_organic as (
      select
        person_id,
        argMin(properties.$referring_domain, timestamp) as rd
      from events
      where event = '$pageview'
        and timestamp >= '${lookbackStart} 00:00:00'
        and timestamp <  '${end} 23:59:59'
        and ${ORGANIC_FILTER}
      group by person_id
    )
    select
      toDate(e.timestamp) as date,
      multiIf(
        e.properties.$referring_domain is not null
          and e.properties.$referring_domain != '$direct'
          and e.properties.$referring_domain not in (${INTERNAL_LIST}),
          e.properties.$referring_domain,
        pf.rd is not null, pf.rd,
        '$direct'
      ) as rd,
      e.event,
      count() as n
    from events e
    left join person_first_organic pf on pf.person_id = e.person_id
    where e.timestamp >= '${start} 00:00:00'
      and e.timestamp <  '${end} 23:59:59'
      and e.event in ('lp_subscription_view','quiz_started','quiz_completed',
                      'quiz_email_captured','lp_subscription_checkout_clicked',
                      'begin_checkout')
      and ${ORGANIC_FILTER.replace(/properties\./g, "e.properties.")}
    group by date, rd, e.event
  `;

  const [sessRes, evRes] = await Promise.all([
    runHogQL(sessionsSql),
    runHogQL(eventsSql),
  ]);

  // Aggregate into one row per (date, source). The events query returns the
  // raw referring_domain, so we map it through SOURCE_CASE in JS for the
  // attribution path (since we joined on person, not a pre-bucketed source).
  const byKey = new Map<string, OrganicFunnelRow>();

  // Returns null for direct/internal so the caller can skip the event —
  // direct traffic is intentionally excluded from the organic tab.
  function bucketDomain(rd: string | null): string | null {
    if (!rd || rd === "$direct") return null;
    if (INTERNAL_DOMAINS.includes(rd)) return null;
    if (
      [
        "google.com",
        "www.google.com",
        "google.co.uk",
        "google.ca",
        "m.google.com",
        "bing.com",
        "www.bing.com",
        "duckduckgo.com",
        "search.brave.com",
        "search.yahoo.com",
        "yahoo.com",
        "ecosia.org",
        "www.ecosia.org",
        "yandex.com",
        "baidu.com",
      ].includes(rd)
    )
      return "organic_search";
    if (
      [
        "facebook.com",
        "www.facebook.com",
        "m.facebook.com",
        "l.facebook.com",
        "lm.facebook.com",
        "instagram.com",
        "www.instagram.com",
        "l.instagram.com",
      ].includes(rd)
    )
      return "meta";
    if (
      [
        "x.com",
        "www.x.com",
        "twitter.com",
        "www.twitter.com",
        "mobile.twitter.com",
        "t.co",
        "com.twitter.android",
      ].includes(rd)
    )
      return "x";
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(rd))
      return "youtube";
    if (
      ["reddit.com", "www.reddit.com", "old.reddit.com", "m.reddit.com", "out.reddit.com"].includes(
        rd
      )
    )
      return "reddit";
    if (["linkedin.com", "www.linkedin.com", "lnkd.in"].includes(rd)) return "linkedin";
    if (
      [
        "chatgpt.com",
        "chat.openai.com",
        "perplexity.ai",
        "www.perplexity.ai",
        "claude.ai",
        "gemini.google.com",
        "copilot.microsoft.com",
      ].includes(rd)
    )
      return "ai";
    return "referral";
  }

  function ensureRow(date: string, source: string): OrganicFunnelRow {
    const key = `${date}|${source}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        date,
        source,
        sessions: 0,
        lp_views: 0,
        quiz_started: 0,
        quiz_completed: 0,
        quiz_email_captured: 0,
        checkout_clicked: 0,
        begin_checkout: 0,
      };
      byKey.set(key, row);
    }
    return row;
  }

  for (const r of sessRes.results ?? []) {
    const [date, source, sessions] = r as [string, string, number];
    ensureRow(date, source).sessions = Number(sessions);
  }
  for (const r of evRes.results ?? []) {
    const [date, rd, event, n] = r as [string, string, string, number];
    const source = bucketDomain(rd);
    if (!source) continue; // skip direct/internal
    const row = ensureRow(date, source);
    const count = Number(n);
    switch (event) {
      case "lp_subscription_view":
        row.lp_views += count;
        break;
      case "quiz_started":
        row.quiz_started += count;
        break;
      case "quiz_completed":
        row.quiz_completed += count;
        break;
      case "quiz_email_captured":
        row.quiz_email_captured += count;
        break;
      case "lp_subscription_checkout_clicked":
        row.checkout_clicked += count;
        break;
      case "begin_checkout":
        row.begin_checkout += count;
        break;
    }
  }
  return Array.from(byKey.values());
}

// ─── Purchases: join Shopify first-orders back to person's organic source ───

interface ShopifyFirstOrder {
  email: string | null;
  createdAtDate: string;
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
  const q = `tag:"Subscription First Order" created_at:>=${start} created_at:<=${end}T23:59:59Z`;
  const out: ShopifyFirstOrder[] = [];
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const res = await fetch(`https://${domain}/admin/api/2024-10/graphql.json`, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query, variables: { q, cursor } }),
    });
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

export async function fetchOrganicPurchases(
  start: string,
  end: string
): Promise<OrganicPurchaseRow[]> {
  const orders = await fetchShopifyFirstOrders(start, end);
  if (orders.length === 0) return [];
  const emails = orders.map((o) => o.email).filter((e): e is string => Boolean(e));
  if (emails.length === 0) return [];

  // Look up each purchaser's earliest non-paid referring_domain. If they
  // were originally a paid click, this query returns no row for them — and
  // they correctly do NOT get attributed to organic.
  const escaped = emails.map((e) => `'${e.replace(/'/g, "''")}'`).join(",");
  const sql = `
    select
      lower(person.properties.email) as email,
      argMin(properties.$referring_domain, timestamp) as rd
    from events
    where lower(person.properties.email) in (${escaped})
      and event = '$pageview'
      and ${ORGANIC_FILTER}
    group by email
  `;
  const phRes = await runHogQL(sql).catch(() => ({} as HogQLResponse));
  const attribByEmail = new Map<string, string>();
  for (const r of phRes.results ?? []) {
    const [email, rd] = r as [string, string];
    if (email) attribByEmail.set(email, rd ?? "$direct");
  }

  // Returns null for direct so the caller skips the purchase — direct
  // purchasers are not attributed to the organic tab.
  function bucket(rd: string | null): string | null {
    if (!rd || rd === "$direct") return null;
    if (
      [
        "google.com",
        "www.google.com",
        "google.co.uk",
        "google.ca",
        "m.google.com",
        "bing.com",
        "www.bing.com",
        "duckduckgo.com",
        "search.brave.com",
        "search.yahoo.com",
        "yahoo.com",
        "ecosia.org",
        "www.ecosia.org",
        "yandex.com",
        "baidu.com",
      ].includes(rd)
    )
      return "organic_search";
    if (
      [
        "facebook.com",
        "www.facebook.com",
        "m.facebook.com",
        "l.facebook.com",
        "lm.facebook.com",
        "instagram.com",
        "www.instagram.com",
        "l.instagram.com",
      ].includes(rd)
    )
      return "meta";
    if (
      [
        "x.com",
        "www.x.com",
        "twitter.com",
        "www.twitter.com",
        "mobile.twitter.com",
        "t.co",
        "com.twitter.android",
      ].includes(rd)
    )
      return "x";
    if (["youtube.com", "www.youtube.com", "m.youtube.com", "youtu.be"].includes(rd))
      return "youtube";
    if (
      ["reddit.com", "www.reddit.com", "old.reddit.com", "m.reddit.com", "out.reddit.com"].includes(
        rd
      )
    )
      return "reddit";
    if (["linkedin.com", "www.linkedin.com", "lnkd.in"].includes(rd)) return "linkedin";
    if (
      [
        "chatgpt.com",
        "chat.openai.com",
        "perplexity.ai",
        "www.perplexity.ai",
        "claude.ai",
        "gemini.google.com",
        "copilot.microsoft.com",
      ].includes(rd)
    )
      return "ai";
    return "referral";
  }

  const byKey = new Map<string, OrganicPurchaseRow>();
  for (const o of orders) {
    const rd = (o.email && attribByEmail.get(o.email)) || null;
    // If we have no organic attribution for this purchaser, they were paid
    // (or we never saw them in PostHog at all). Skip — paid funnel handles
    // those, and we don't want to inflate organic with paid-attributed
    // buyers.
    if (!rd) continue;
    const source = bucket(rd);
    if (!source) continue; // direct purchases are not tracked organic
    const key = `${o.createdAtDate}|${source}`;
    let row = byKey.get(key);
    if (!row) {
      row = {
        date: o.createdAtDate,
        source,
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

// ─── Refresh orchestrator ───────────────────────────────────────────────────

export async function refreshOrganicPerformance(days = 2): Promise<{
  dates: string[];
  snapshots_written: number;
}> {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(start.getUTCDate() - (days - 1));
  const startStr = start.toISOString().slice(0, 10);
  const endStr = end.toISOString().slice(0, 10);

  const [funnelRows, purchaseRows] = await Promise.all([
    fetchOrganicFunnel(startStr, endStr).catch((e) => {
      console.error("[organic-perf] funnel fetch failed", e);
      return [] as OrganicFunnelRow[];
    }),
    fetchOrganicPurchases(startStr, endStr).catch((e) => {
      console.error("[organic-perf] purchases fetch failed", e);
      return [] as OrganicPurchaseRow[];
    }),
  ]);

  // Merge into one row per (date, source).
  const byKey = new Map<
    string,
    {
      snapshot_date: string;
      source: string;
      source_label: string;
      sessions: number;
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

  function ensure(date: string, source: string) {
    const k = `${date}|${source}`;
    let v = byKey.get(k);
    if (!v) {
      v = {
        snapshot_date: date,
        source,
        source_label: SOURCE_LABEL_BY_SLUG[source] ?? source,
        sessions: 0,
        lp_views: 0,
        quiz_started: 0,
        quiz_completed: 0,
        quiz_email_captured: 0,
        checkout_clicked: 0,
        begin_checkout: 0,
        new_purchases: 0,
        new_revenue_cents: 0,
      };
      byKey.set(k, v);
    }
    return v;
  }

  for (const f of funnelRows) {
    const v = ensure(f.date, f.source);
    v.sessions += f.sessions;
    v.lp_views += f.lp_views;
    v.quiz_started += f.quiz_started;
    v.quiz_completed += f.quiz_completed;
    v.quiz_email_captured += f.quiz_email_captured;
    v.checkout_clicked += f.checkout_clicked;
    v.begin_checkout += f.begin_checkout;
  }
  for (const p of purchaseRows) {
    const v = ensure(p.date, p.source);
    v.new_purchases += p.new_purchases;
    v.new_revenue_cents += p.new_revenue_cents;
  }

  const rows = Array.from(byKey.values()).map((s) => ({
    ...s,
    sessions: Math.round(s.sessions || 0),
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
      .from("organic_performance_snapshots")
      .upsert(rows, { onConflict: "snapshot_date,source" });
    if (error) throw new Error(`upsert organic snapshots: ${error.message}`);
  }

  return {
    dates: [startStr, endStr],
    snapshots_written: rows.length,
  };
}
