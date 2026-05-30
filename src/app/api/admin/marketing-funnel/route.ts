/**
 * GET /api/admin/marketing-funnel  (v4)
 *
 * Health-first marketing dashboard — session-based funnel + per-channel funnel.
 *
 * Data sources:
 *
 *   1. Shopify Admin REST `/orders.json`  → source of truth for purchases.
 *      Bucketing (tags + line items only — no orders_count):
 *
 *        new_reserve_member  : tags include "Subscription First Order"
 *        auto_renewal        : tags include "Subscription Recurring Order"
 *        pro_shop            : no subscription tag, total ≥ $5
 *        skipped             : cancelled / unpaid / freebie ($0-$5)
 *
 *      Tier from line item title: Reserve Access | Reserve Member | Back 9 | other.
 *
 *   2. PostHog HogQL  → session-based attribution.
 *      For each `$session_id` we compute:
 *        - landing: argMin(page_view.$pathname, timestamp)
 *        - channel: first-touch utm/clid/referrer
 *        - has_checkout: session emitted checkout_clicked / lp_subscription_checkout_clicked
 *        - session_email: any properties.email on any event in that session
 *      Then we intersect session_email with Shopify new_reserve_member orders
 *      → purchase stage attributed back to its session's landing path + channel.
 *
 *      `purchase` events fire server-side without $session_id/$pathname, so we
 *      do NOT use them for attribution.
 *
 *   3. Firestore email collections — unchanged.
 *   4. Google Ads REST (live) — unchanged.
 *
 * Query params: ?start=YYYY-MM-DD&end=YYYY-MM-DD (defaults: last 7 days)
 * Auth: Firebase Bearer token, admin email allowlist.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { Timestamp } from "firebase-admin/firestore";
import { mintGoogleAccessToken } from "@/app/api/_lib/googleAuth";
import { FLOW_STEPS, type EmailFlow } from "@/lib/email/sequences";
import {
  buildFunnelCacheKey,
  latestSnapshot,
  writeSnapshot,
} from "@/app/api/_lib/funnelSnapshot";
// Rocks moved to /api/admin/marketing-funnel/rocks so the slow Loop scan
// doesn't block this route. See ./rocks/route.ts.

export const runtime = "nodejs";
export const maxDuration = 60;

const FLOW_ORDER: EmailFlow[] = ["free", "access", "member", "back9"];

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function verifyAdmin(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");

  // Cron / internal callers use CRON_SECRET so we don't need a Firebase
  // session for server-to-server snapshot refreshes.
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return;
  if (cronSecret && request.headers.get("user-agent")?.includes("vercel-cron")) {
    return;
  }

  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const isTestEmail = (email: unknown) =>
  typeof email === "string" && /^leo(\+[^@]*)?@mullybox\.com$/i.test(email);

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function defaultWindow(): { start: string; end: string } {
  const end = new Date();
  const start = new Date();
  start.setUTCDate(end.getUTCDate() - 6);
  return { start: dateKey(start), end: dateKey(end) };
}

function normalizePath(p: unknown): string {
  if (typeof p !== "string" || !p) return "(unknown)";
  let path = p;
  try {
    if (path.startsWith("http")) path = new URL(path).pathname;
  } catch {
    /* noop */
  }
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return path.toLowerCase() || "/";
}

/**
 * Path bucketing for the dashboard's primary view.
 *
 *   '/'                 → 'home'
 *   '/lp/subscription'  → 'lp_subscription'
 *   '/lp/subscription.' → 'lp_subscription'   (trailing-dot dup)
 *   '/lp/gift'          → 'lp_gift'
 *   '/lp/<other>'       → 'lp_other'
 *   everything else     → 'other'
 */
type PathBucketKey =
  | "home"
  | "lp_subscription"
  | "lp_gift"
  | "lp_other"
  | "other";

function bucketPath(path: string): PathBucketKey {
  const p = normalizePath(path);
  if (p === "/" || p === "/home") return "home";
  if (p === "/lp/subscription" || p === "/lp/subscription.")
    return "lp_subscription";
  if (p === "/lp/gift" || p.startsWith("/lp/gift/")) return "lp_gift";
  if (p.startsWith("/lp/")) return "lp_other";
  return "other";
}

const PATH_BUCKET_LABEL: Record<PathBucketKey, string> = {
  home: "/ (Homepage)",
  lp_subscription: "/lp/subscription",
  lp_gift: "/lp/gift",
  lp_other: "/lp/* (Other LPs)",
  other: "Other pages",
};

// ─── Shopify ──────────────────────────────────────────────────────────────────

interface ShopifyOrderRaw {
  id: number;
  order_number: number;
  email: string | null;
  created_at: string;
  total_price: string;
  financial_status: string | null;
  cancelled_at: string | null;
  tags: string | null;
  customer:
    | {
        id: number;
        email: string | null;
        created_at?: string;
      }
    | null;
  line_items: Array<{
    title: string;
    quantity: number;
    price: string;
    product_id: number | null;
  }>;
}

async function fetchShopifyOrdersInWindow(
  startISO: string,
  endISO: string
): Promise<ShopifyOrderRaw[]> {
  const token = process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";

  if (!token || !domain) {
    console.warn("[marketing-funnel v4] missing Shopify creds, skipping orders");
    return [];
  }

  const startFull = `${startISO}T00:00:00Z`;
  const endFull = `${endISO}T23:59:59Z`;

  const orders: ShopifyOrderRaw[] = [];
  let url: string | null =
    `https://${domain}/admin/api/${version}/orders.json?status=any` +
    `&created_at_min=${encodeURIComponent(startFull)}` +
    `&created_at_max=${encodeURIComponent(endFull)}` +
    `&limit=250`;

  while (url) {
    const res: Response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
    });
    if (!res.ok) {
      throw new Error(
        `Shopify orders.json ${res.status}: ${await res.text()}`
      );
    }
    const j = (await res.json()) as { orders: ShopifyOrderRaw[] };
    orders.push(...(j.orders ?? []));

    const link = res.headers.get("link") ?? res.headers.get("Link") ?? "";
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;

    if (orders.length >= 2000) break;
  }

  return orders;
}

type OrderBucket =
  | "new_reserve_member"
  | "auto_renewal"
  | "pro_shop"
  | "skipped";

type ReserveTier = "access" | "member" | "back9" | "other";

interface ClassifiedOrder {
  bucket: OrderBucket;
  tier: ReserveTier;
  email: string;
  totalCents: number;
  paidAt: string;
  orderNumber: number;
  customerCreatedAt: string | null;
}

function tierFromLineItems(items: ShopifyOrderRaw["line_items"]): ReserveTier {
  const titles = items.map((li) => (li.title || "").toLowerCase());
  if (titles.some((t) => t.includes("reserve access"))) return "access";
  if (titles.some((t) => t.includes("reserve member"))) return "member";
  if (titles.some((t) => t.includes("back 9"))) return "back9";
  return "other";
}

function classifyShopifyOrder(o: ShopifyOrderRaw): ClassifiedOrder {
  const tagsStr = (o.tags ?? "").toLowerCase();
  const tags = tagsStr.split(",").map((t) => t.trim());
  const isFirstOrder = tags.some((t) => t === "subscription first order");
  const isRecurring = tags.some((t) => t === "subscription recurring order");
  const hasSubTag = tags.some((t) => t === "subscription");
  const tier = tierFromLineItems(o.line_items);
  const email = (o.customer?.email ?? o.email ?? "").toLowerCase();
  const cents = Math.round(parseFloat(o.total_price || "0") * 100);
  const paidAt = o.created_at;
  const customerCreatedAt = o.customer?.created_at ?? null;

  const base = {
    tier,
    email,
    totalCents: cents,
    paidAt,
    orderNumber: o.order_number,
    customerCreatedAt,
  };

  if (o.cancelled_at) return { ...base, bucket: "skipped" };
  if (o.financial_status && o.financial_status !== "paid")
    return { ...base, bucket: "skipped" };
  if (cents < 500) return { ...base, bucket: "skipped" };

  let bucket: OrderBucket;
  if (isFirstOrder) {
    bucket = "new_reserve_member";
  } else if (isRecurring) {
    bucket = "auto_renewal";
  } else if (!hasSubTag) {
    bucket = "pro_shop";
  } else {
    bucket = "auto_renewal";
  }

  return { ...base, bucket };
}

// ─── PostHog (HogQL) ──────────────────────────────────────────────────────────

interface PostHogConfig {
  projectId: string;
  apiKey: string;
  host: string;
}

function getPostHogConfig(): PostHogConfig | null {
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
  if (!projectId || !apiKey) return null;
  return { projectId, apiKey, host };
}

async function runHogQL(
  cfg: PostHogConfig,
  query: string
): Promise<unknown[][]> {
  const res = await fetch(`${cfg.host}/api/projects/${cfg.projectId}/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${cfg.apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
  });
  if (!res.ok) {
    throw new Error(`PostHog HogQL ${res.status}: ${await res.text()}`);
  }
  const j = (await res.json()) as { results?: unknown[][] };
  return j.results ?? [];
}

// ─── Channel classification ───────────────────────────────────────────────────

type Channel =
  | "google_ads"
  | "meta_ads"
  | "x_ads"
  | "google_organic"
  | "meta_organic"
  | "x_organic"
  | "email"
  | "sms"
  | "internal"
  | "direct"
  | "other_referral";

const CHANNEL_ORDER: Channel[] = [
  "google_ads",
  "meta_ads",
  "x_ads",
  "google_organic",
  "meta_organic",
  "x_organic",
  "email",
  "sms",
  "internal",
  "direct",
  "other_referral",
];

const CHANNEL_LABEL: Record<Channel, string> = {
  google_ads: "Google Ads",
  meta_ads: "Meta Ads",
  x_ads: "X Ads",
  google_organic: "Google Organic",
  meta_organic: "Meta Organic",
  x_organic: "X Organic",
  email: "Email",
  sms: "SMS",
  internal: "Internal / Cross-site",
  direct: "Direct",
  other_referral: "Other Referral",
};

function classifyChannel(opts: {
  utm_source?: unknown;
  utm_medium?: unknown;
  referrer?: unknown;
  gclid?: unknown;
  fbclid?: unknown;
  twclid?: unknown;
}): Channel {
  const utmSource =
    typeof opts.utm_source === "string" ? opts.utm_source.toLowerCase() : "";
  const utmMedium =
    typeof opts.utm_medium === "string" ? opts.utm_medium.toLowerCase() : "";
  const referrer =
    typeof opts.referrer === "string" ? opts.referrer.toLowerCase() : "";

  const has = (v: unknown) => typeof v === "string" && v.length > 0;
  if (has(opts.gclid)) return "google_ads";
  if (has(opts.fbclid)) return "meta_ads";
  if (has(opts.twclid)) return "x_ads";

  if (utmSource) {
    if (utmSource.includes("google") && utmMedium.includes("cpc"))
      return "google_ads";
    if (
      utmSource.includes("google") &&
      (utmMedium.includes("paid") || utmMedium === "ads")
    )
      return "google_ads";
    if (utmSource.includes("google")) return "google_organic";
    if (
      utmSource.includes("facebook") ||
      utmSource.includes("meta") ||
      utmSource === "ig" ||
      utmSource === "instagram"
    ) {
      return utmMedium.includes("cpc") || utmMedium.includes("paid")
        ? "meta_ads"
        : "meta_organic";
    }
    if (utmSource.includes("twitter") || utmSource === "x") {
      return utmMedium.includes("cpc") || utmMedium.includes("paid")
        ? "x_ads"
        : "x_organic";
    }
    if (
      utmSource.includes("klaviyo") ||
      utmSource === "email" ||
      utmMedium === "email" ||
      utmSource.includes("resend")
    )
      return "email";
    if (utmSource === "sms" || utmMedium === "sms") return "sms";
    if (utmSource === "direct" || utmSource === "$direct") return "direct";
    return "other_referral";
  }

  if (referrer && referrer !== "$direct") {
    if (referrer.includes("google")) return "google_organic";
    if (
      referrer.includes("facebook") ||
      referrer.includes("instagram") ||
      referrer.includes("fb.com")
    )
      return "meta_organic";
    if (
      referrer.includes("twitter") ||
      referrer.includes("x.com") ||
      referrer.includes("t.co") ||
      referrer.includes("com.twitter")
    )
      return "x_organic";
    if (
      referrer.includes("mymully") ||
      referrer.includes("mullybox") ||
      referrer.includes("firebaseapp")
    )
      return "internal";
    return "other_referral";
  }

  return "direct";
}

// ─── Session-based funnel ─────────────────────────────────────────────────────
//
// IMPORTANT: PostHog HogQL has a default LIMIT of 100 on raw SELECTs over the
// REST API. We CANNOT pull individual session rows — we'd be capped at 100
// sessions per query. Instead, we aggregate inside HogQL and pull at most a
// few hundred grouped rows (paths × channels). Emails are returned as a
// comma-separated string per bucket so we can intersect with Shopify in JS.

interface FunnelStages {
  visits: number;
  checkouts: number;
  purchases: number;
}

interface PathRow extends FunnelStages {
  path: string;
  bucket: PathBucketKey;
}

interface ChannelRow extends FunnelStages {
  channel: Channel;
  label: string;
}

interface CampaignRow extends FunnelStages {
  utm_campaign: string;
  utm_source: string;
  channel: Channel;
  channel_label: string;
}

interface AttributionHealth {
  // Each is a fraction 0..1 of sessions (in window) carrying that signal.
  gclid_pct: number;
  fbclid_pct: number;
  twclid_pct: number;
  utm_source_pct: number;
  utm_campaign_pct: number;
  total_sessions: number;
}

interface BucketRow extends FunnelStages {
  bucket: PathBucketKey;
  label: string;
}

interface HogQLPathBucket {
  path: string;
  visits: number;
  checkouts: number;
  emails: string[]; // session-emails seen on this path
}

interface HogQLChannelBucket {
  utm_src: unknown;
  utm_med: unknown;
  ref: unknown;
  gclid: unknown;
  fbclid: unknown;
  twclid: unknown;
  visits: number;
  checkouts: number;
  emails: string[];
}

/**
 * One row per (utm_source, utm_campaign) seen on a session's first page_view
 * in the window. utm_source is included so we can split e.g. resend vs
 * klaviyo campaigns that happen to share a name. utm_content carries the
 * recipient id from the email link (for per-person attribution drill-in
 * later); we don't aggregate by it here.
 *
 * NOTE: this row is only useful if email links carry UTMs. Pre-fix
 * broadcasts won't show up here — they'll roll into the "direct" channel.
 */
interface HogQLCampaignBucket {
  utm_src: string;
  utm_camp: string;
  visits: number;
  checkouts: number;
  emails: string[];
}

interface FunnelData {
  paths: HogQLPathBucket[];
  channels: HogQLChannelBucket[];
  campaigns: HogQLCampaignBucket[];
  total_sessions: number;
  total_checkouts: number;
  errors: string[];
}

async function fetchPostHogFunnel(
  cfg: PostHogConfig,
  start: string,
  end: string
): Promise<FunnelData> {
  const startTs = `${start} 00:00:00`;
  const endTs = `${end} 23:59:59`;
  const errors: string[] = [];

  // Shared CTE prefix — pv (per-session landing + first-touch utms),
  // co (sessions with checkout), em (per-session email).
  // utm_campaign is added so we can break out specific Resend broadcasts
  // and lifecycle flows (now that mymully.com links carry attribution).
  const ctes = `
    WITH pv AS (
      SELECT properties.$session_id AS sid,
             argMin(properties.$pathname, timestamp) AS landing,
             argMin(properties.utm_source, timestamp) AS utm_src,
             argMin(properties.utm_medium, timestamp) AS utm_med,
             argMin(properties.utm_campaign, timestamp) AS utm_camp,
             argMin(properties.$referring_domain, timestamp) AS ref,
             argMin(properties.gclid, timestamp) AS gclid,
             argMin(properties.fbclid, timestamp) AS fbclid,
             argMin(properties.twclid, timestamp) AS twclid
      FROM events
      WHERE event = 'page_view'
        AND timestamp >= toDateTime('${startTs}')
        AND timestamp <= toDateTime('${endTs}')
        AND properties.$session_id IS NOT NULL
        AND properties.$pathname IS NOT NULL
      GROUP BY sid
    ),
    co AS (
      -- A session counts as "reached checkout" if EITHER:
      --   1. it fired our internal checkout-click event, OR
      --   2. it loaded a cart/checkout pathname (handles direct cart
      --      links from retargeting emails, Shopify cart pages still
      --      tagged with PostHog, and sessions where the click event
      --      got eaten by adblockers/bots), OR
      --   3. it fired the standard Shopify checkout_started event
      --      that the storefront pixel emits.
      -- Without this, paid ad channels look like 0 checkouts because
      -- their users tend to deep-link straight into checkout.
      SELECT DISTINCT properties.$session_id AS sid
      FROM events
      WHERE timestamp >= toDateTime('${startTs}')
        AND timestamp <= toDateTime('${endTs}')
        AND properties.$session_id IS NOT NULL
        AND (
          event IN (
            'checkout_clicked',
            'lp_subscription_checkout_clicked',
            'checkout_started',
            '$checkout_started',
            'begin_checkout',
            'InitiateCheckout',
            'initiate_checkout'
          )
          OR match(coalesce(toString(properties.$pathname), ''),
                   '(?i)^/(cart|checkout|checkouts)(/|$|\\?)')
          OR match(coalesce(toString(properties.$current_url), ''),
                   '(?i)/(cart|checkout|checkouts)(/|$|\\?)')
        )
    ),
    em AS (
      SELECT properties.$session_id AS sid,
             argMin(lower(toString(properties.email)), timestamp) AS email
      FROM events
      WHERE timestamp >= toDateTime('${startTs}')
        AND timestamp <= toDateTime('${endTs}')
        AND properties.$session_id IS NOT NULL
        AND properties.email IS NOT NULL
        AND toString(properties.email) != ''
      GROUP BY sid
    )
  `;

  // ── Totals ────────────────────────────────────────────────────────────────
  let total_sessions = 0;
  let total_checkouts = 0;
  try {
    const totQ = `${ctes}
      SELECT count() AS visits,
             countIf(co.sid IS NOT NULL) AS checkouts
      FROM pv LEFT JOIN co ON pv.sid = co.sid
    `;
    const rows = await runHogQL(cfg, totQ);
    if (rows[0]) {
      total_sessions = Number(rows[0][0] ?? 0);
      total_checkouts = Number(rows[0][1] ?? 0);
    }
  } catch (err) {
    errors.push(`totals: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Per-path aggregation ──────────────────────────────────────────────────
  const paths: HogQLPathBucket[] = [];
  try {
    const pathQ = `${ctes}
      SELECT pv.landing AS path,
             count() AS visits,
             countIf(co.sid IS NOT NULL) AS checkouts,
             arrayStringConcat(arrayDistinct(groupArray(em.email)), ',') AS emails_csv
      FROM pv
      LEFT JOIN co ON pv.sid = co.sid
      LEFT JOIN em ON pv.sid = em.sid
      GROUP BY pv.landing
      ORDER BY visits DESC
      LIMIT 300
    `;
    for (const r of await runHogQL(cfg, pathQ)) {
      const path = normalizePath(r[0]);
      const visits = Number(r[1] ?? 0);
      const checkouts = Number(r[2] ?? 0);
      const emailsCsv = typeof r[3] === "string" ? r[3] : "";
      const emails = emailsCsv
        ? emailsCsv
            .split(",")
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e && e !== "null")
        : [];
      paths.push({ path, visits, checkouts, emails });
    }
  } catch (err) {
    errors.push(`paths: ${err instanceof Error ? err.message : String(err)}`);
  }

  // ── Per-channel aggregation ───────────────────────────────────────────────
  const channels: HogQLChannelBucket[] = [];
  try {
    const chQ = `${ctes}
      SELECT pv.utm_src AS utm_src,
             pv.utm_med AS utm_med,
             pv.ref AS ref,
             pv.gclid AS gclid,
             pv.fbclid AS fbclid,
             pv.twclid AS twclid,
             count() AS visits,
             countIf(co.sid IS NOT NULL) AS checkouts,
             arrayStringConcat(arrayDistinct(groupArray(em.email)), ',') AS emails_csv
      FROM pv
      LEFT JOIN co ON pv.sid = co.sid
      LEFT JOIN em ON pv.sid = em.sid
      GROUP BY utm_src, utm_med, ref, gclid, fbclid, twclid
      ORDER BY visits DESC
      LIMIT 500
    `;
    for (const r of await runHogQL(cfg, chQ)) {
      const emailsCsv = typeof r[8] === "string" ? r[8] : "";
      const emails = emailsCsv
        ? emailsCsv
            .split(",")
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e && e !== "null")
        : [];
      channels.push({
        utm_src: r[0],
        utm_med: r[1],
        ref: r[2],
        gclid: r[3],
        fbclid: r[4],
        twclid: r[5],
        visits: Number(r[6] ?? 0),
        checkouts: Number(r[7] ?? 0),
        emails,
      });
    }
  } catch (err) {
    errors.push(
      `channels: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // ── Per-campaign aggregation ────────────────────────────────────────
  // One row per (utm_source, utm_campaign) on first page_view. Empty
  // campaign values are coalesced to '(none)' so HogQL groups them
  // together rather than dropping them. Empty utm_source rolls into the
  // "direct" bucket for the chart.
  const campaigns: HogQLCampaignBucket[] = [];
  try {
    const campQ = `${ctes}
      SELECT coalesce(toString(pv.utm_src), '') AS utm_src,
             coalesce(toString(pv.utm_camp), '') AS utm_camp,
             count() AS visits,
             countIf(co.sid IS NOT NULL) AS checkouts,
             arrayStringConcat(arrayDistinct(groupArray(em.email)), ',') AS emails_csv
      FROM pv
      LEFT JOIN co ON pv.sid = co.sid
      LEFT JOIN em ON pv.sid = em.sid
      WHERE toString(pv.utm_camp) != ''
      GROUP BY utm_src, utm_camp
      ORDER BY visits DESC
      LIMIT 200
    `;
    for (const r of await runHogQL(cfg, campQ)) {
      const emailsCsv = typeof r[4] === "string" ? r[4] : "";
      const emails = emailsCsv
        ? emailsCsv
            .split(",")
            .map((e) => e.trim().toLowerCase())
            .filter((e) => e && e !== "null")
        : [];
      campaigns.push({
        utm_src: String(r[0] ?? ""),
        utm_camp: String(r[1] ?? ""),
        visits: Number(r[2] ?? 0),
        checkouts: Number(r[3] ?? 0),
        emails,
      });
    }
  } catch (err) {
    errors.push(
      `campaigns: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return { paths, channels, campaigns, total_sessions, total_checkouts, errors };
}

// ─── Live Google Ads spend ────────────────────────────────────────────────────

interface AdPlatformSummary {
  available: boolean;
  reason?: string;
  spend_cents: number;
  clicks: number;
  conversions: number;
  impressions: number;
}

async function mintGoogleAdsAccessToken(): Promise<{
  token: string | null;
  reason: string | null;
}> {
  // Preferred: domain-wide-delegated service-account JSON. Cleaner ops,
  // no per-user refresh tokens to rotate.
  const saB64 =
    process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64 ??
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  const impersonate = process.env.GOOGLE_ADS_IMPERSONATE_EMAIL;
  if (saB64) {
    try {
      const token = await mintGoogleAccessToken({
        scope: "https://www.googleapis.com/auth/adwords",
        sub: impersonate,
      });
      if (token) return { token, reason: null };
      return { token: null, reason: "Service-account JSON unreadable" };
    } catch (err) {
      return {
        token: null,
        reason: `Service-account token: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  }

  // Fallback: legacy OAuth refresh-token flow.
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_ADS_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET;
  if (!refreshToken || !clientId || !clientSecret) {
    return {
      token: null,
      reason:
        "Set GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64 (+ optionally GOOGLE_ADS_IMPERSONATE_EMAIL) or the OAuth refresh-token trio",
    };
  }
  const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!tokenRes.ok) {
    return {
      token: null,
      reason: `OAuth refresh failed: ${tokenRes.status}`,
    };
  }
  return {
    token: ((await tokenRes.json()) as { access_token: string }).access_token,
    reason: null,
  };
}

async function fetchGoogleAdsLive(
  start: string,
  end: string
): Promise<AdPlatformSummary> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;

  if (!developerToken || !loginCustomerId || !customerId) {
    return {
      available: false,
      reason:
        "Missing Google Ads env vars (GOOGLE_ADS_DEVELOPER_TOKEN, GOOGLE_ADS_LOGIN_CUSTOMER_ID, GOOGLE_ADS_CUSTOMER_ID)",
      spend_cents: 0,
      clicks: 0,
      conversions: 0,
      impressions: 0,
    };
  }

  const { token: access_token, reason: authReason } =
    await mintGoogleAdsAccessToken();
  if (!access_token) {
    return {
      available: false,
      reason: authReason ?? "Google Ads auth unavailable",
      spend_cents: 0,
      clicks: 0,
      conversions: 0,
      impressions: 0,
    };
  }

  const query = `
    SELECT segments.date,
           metrics.cost_micros,
           metrics.clicks,
           metrics.conversions,
           metrics.impressions
    FROM customer
    WHERE segments.date BETWEEN '${start}' AND '${end}'
  `
    .replace(/\s+/g, " ")
    .trim();

  const queryRes = await fetch(
    `https://googleads.googleapis.com/v21/customers/${customerId}/googleAds:search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${access_token}`,
        "developer-token": developerToken,
        "login-customer-id": loginCustomerId,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    }
  );
  if (!queryRes.ok) {
    return {
      available: false,
      reason: `Google Ads query failed: ${queryRes.status}`,
      spend_cents: 0,
      clicks: 0,
      conversions: 0,
      impressions: 0,
    };
  }
  const payload = (await queryRes.json()) as {
    results?: Array<{
      metrics?: {
        costMicros?: string | number;
        clicks?: string | number;
        conversions?: number;
        impressions?: string | number;
      };
    }>;
  };

  let micros = 0;
  let clicks = 0;
  let conversions = 0;
  let impressions = 0;
  for (const r of payload.results ?? []) {
    const m = r.metrics ?? {};
    micros += Number(m.costMicros ?? 0);
    clicks += Number(m.clicks ?? 0);
    conversions += Number(m.conversions ?? 0);
    impressions += Number(m.impressions ?? 0);
  }
  return {
    available: true,
    spend_cents: Math.round(micros / 10_000),
    clicks,
    conversions,
    impressions,
  };
}

// ─── X (Twitter) Ads ──────────────────────────────────────────────────────────
//
// OAuth 1.0a HMAC-SHA1 signed request against the X Ads API. Pulls
// spend/impressions/clicks/conversions for the configured account over the
// supplied window. Returns `available: false` (with a helpful reason) when
// any credential or response prerequisite is missing — never throws.

function percentEncode(v: string): string {
  return encodeURIComponent(v).replace(
    /[!*'()]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

async function signOAuth1aGet(
  url: string,
  params: Record<string, string>,
  creds: {
    consumerKey: string;
    consumerSecret: string;
    accessToken: string;
    accessTokenSecret: string;
  }
): Promise<string> {
  const { createHmac, randomBytes } = await import("node:crypto");
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: creds.consumerKey,
    oauth_nonce: randomBytes(16).toString("hex"),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: creds.accessToken,
    oauth_version: "1.0",
  };
  // Combine query params + oauth params, sort, encode
  const all: Record<string, string> = { ...params, ...oauthParams };
  const paramString = Object.keys(all)
    .sort()
    .map((k) => `${percentEncode(k)}=${percentEncode(all[k])}`)
    .join("&");
  const signatureBase = [
    "GET",
    percentEncode(url),
    percentEncode(paramString),
  ].join("&");
  const signingKey = `${percentEncode(creds.consumerSecret)}&${percentEncode(
    creds.accessTokenSecret
  )}`;
  const signature = createHmac("sha1", signingKey)
    .update(signatureBase)
    .digest("base64");
  oauthParams.oauth_signature = signature;
  // Build Authorization header — only oauth_* params, percent-encoded, quoted
  return (
    "OAuth " +
    Object.keys(oauthParams)
      .sort()
      .map(
        (k) => `${percentEncode(k)}="${percentEncode(oauthParams[k])}"`
      )
      .join(", ")
  );
}

async function fetchXAdsLive(
  start: string,
  end: string
): Promise<AdPlatformSummary> {
  const consumerKey = process.env.X_ADS_CONSUMER_KEY;
  const consumerSecret = process.env.X_ADS_CONSUMER_SECRET;
  const accessToken = process.env.X_ADS_ACCESS_TOKEN;
  const accessTokenSecret = process.env.X_ADS_ACCESS_TOKEN_SECRET;
  const accountId = process.env.X_ADS_ACCOUNT_ID;

  if (
    !consumerKey ||
    !consumerSecret ||
    !accessToken ||
    !accessTokenSecret ||
    !accountId
  ) {
    return {
      available: false,
      reason:
        "Missing X Ads env vars (X_ADS_CONSUMER_KEY, X_ADS_CONSUMER_SECRET, X_ADS_ACCESS_TOKEN, X_ADS_ACCESS_TOKEN_SECRET, X_ADS_ACCOUNT_ID)",
      spend_cents: 0,
      clicks: 0,
      conversions: 0,
      impressions: 0,
    };
  }

  // X Ads stats API requires ISO-8601 with hour granularity (UTC). Use
  // 00:00Z for start, end-exclusive 00:00Z next-day for end.
  const startIso = `${start}T00:00:00Z`;
  const endDate = new Date(`${end}T00:00:00Z`);
  endDate.setUTCDate(endDate.getUTCDate() + 1);
  const endIso = endDate.toISOString().replace(/\.\d{3}Z$/, "Z");

  const url = `https://ads-api.x.com/12/stats/accounts/${accountId}`;
  const params: Record<string, string> = {
    entity: "ACCOUNT",
    entity_ids: accountId,
    metric_groups: "BILLING,ENGAGEMENT",
    start_time: startIso,
    end_time: endIso,
    granularity: "TOTAL",
    placement: "ALL_ON_TWITTER",
  };

  let authHeader: string;
  try {
    authHeader = await signOAuth1aGet(url, params, {
      consumerKey,
      consumerSecret,
      accessToken,
      accessTokenSecret,
    });
  } catch (err) {
    return {
      available: false,
      reason: `X Ads signing failed: ${err instanceof Error ? err.message : String(err)}`,
      spend_cents: 0,
      clicks: 0,
      conversions: 0,
      impressions: 0,
    };
  }

  const qs = new URLSearchParams(params).toString();
  const res = await fetch(`${url}?${qs}`, {
    method: "GET",
    headers: { Authorization: authHeader, Accept: "application/json" },
  });
  if (!res.ok) {
    return {
      available: false,
      reason: `X Ads query failed: ${res.status}`,
      spend_cents: 0,
      clicks: 0,
      conversions: 0,
      impressions: 0,
    };
  }
  const payload = (await res.json()) as {
    data?: Array<{
      id_data?: Array<{
        metrics?: {
          billed_charge_local_micro?: Array<number | null> | null;
          impressions?: Array<number | null> | null;
          clicks?: Array<number | null> | null;
          conversion_purchases?: Array<number | null> | null;
        };
      }>;
    }>;
  };

  const sumFirst = (arr?: Array<number | null> | null): number =>
    Array.isArray(arr)
      ? arr.reduce<number>((acc, v) => acc + (typeof v === "number" ? v : 0), 0)
      : 0;

  let micros = 0;
  let clicks = 0;
  let conversions = 0;
  let impressions = 0;
  for (const row of payload.data ?? []) {
    for (const idd of row.id_data ?? []) {
      const m = idd.metrics ?? {};
      micros += sumFirst(m.billed_charge_local_micro);
      clicks += sumFirst(m.clicks);
      conversions += sumFirst(m.conversion_purchases);
      impressions += sumFirst(m.impressions);
    }
  }
  return {
    available: true,
    // X Ads returns local-currency micros (1e6). cents = micros / 10_000.
    spend_cents: Math.round(micros / 10_000),
    clicks,
    conversions,
    impressions,
  };
}

// ─── Shopify ground-truth "sessions reaching checkout" ────────────────────────
//
// PostHog only sees mymully.com sessions. Anyone hitting checkout via a
// direct cart link, retargeting email, or any Shopify-hosted entry point
// is invisible to PostHog. We therefore augment the funnel with a Shopify-
// side count: every checkout that reached payment shows up either as a
// completed order or as an abandonedCheckout. The sum is the ground-truth
// "sessions reaching checkout" for the window.

interface ShopifyCheckoutGroundTruth {
  abandoned_checkouts: number;
  orders: number;
  total: number;
  error: string | null;
}

async function fetchShopifyCheckoutGroundTruth(
  start: string,
  end: string
): Promise<ShopifyCheckoutGroundTruth> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const token =
    process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;
  const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";
  const empty: ShopifyCheckoutGroundTruth = {
    abandoned_checkouts: 0,
    orders: 0,
    total: 0,
    error: null,
  };
  if (!domain || !token) {
    return { ...empty, error: "Missing Shopify credentials" };
  }

  // GraphQL ordersCount + abandonedCheckouts pagination.
  //
  // "Completed orders" here means **headless subscription first-orders only**
  // — the orders that actually flowed through the storefront checkout
  // funnel and became new reserve members. This excludes:
  //   - Loop auto-renewals (tag: 'Subscription Recurring Order')
  //   - Pro-shop one-offs, gifts, anything that isn't a new subscription
  // The matching positive filter is tag: 'Subscription First Order', which
  // is the same tag the headline `new_reserve_members` count keys on.
  const dateRange = `created_at:>=${start} created_at:<=${end}`;
  const headlessFirstOrderRange = `${dateRange} tag:"Subscription First Order"`;
  const headers = {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token,
  };
  const endpoint = `https://${domain}/admin/api/${apiVersion}/graphql.json`;

  // Orders count — cheap. Headless subscription first-orders only.
  let orders = 0;
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers,
      body: JSON.stringify({
        query: `query { ordersCount(query: ${JSON.stringify(headlessFirstOrderRange)}) { count } }`,
      }),
    });
    const j = (await res.json()) as {
      data?: { ordersCount?: { count?: number } };
    };
    orders = Number(j.data?.ordersCount?.count ?? 0);
  } catch (err) {
    return { ...empty, error: `orders: ${err}` };
  }

  // Abandoned checkouts — paginate through GIDs (id only, cheapest cost).
  let abandoned = 0;
  let cursor: string | null = null;
  try {
    for (let i = 0; i < 50; i++) {
      const afterArg: string = cursor ? `, after: ${JSON.stringify(cursor)}` : "";
      const q = `query { abandonedCheckouts(first: 250, query: ${JSON.stringify(dateRange)}${afterArg}) { edges { cursor node { id } } pageInfo { hasNextPage endCursor } } }`;
      const res = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify({ query: q }),
      });
      const j = (await res.json()) as {
        data?: {
          abandonedCheckouts?: {
            edges?: Array<{ cursor: string; node: { id: string } }>;
            pageInfo?: { hasNextPage?: boolean; endCursor?: string | null };
          };
        };
      };
      const edges = j.data?.abandonedCheckouts?.edges ?? [];
      abandoned += edges.length;
      const hasNext = j.data?.abandonedCheckouts?.pageInfo?.hasNextPage;
      const endCursor = j.data?.abandonedCheckouts?.pageInfo?.endCursor ?? null;
      if (!hasNext || !endCursor) break;
      cursor = endCursor;
    }
  } catch (err) {
    return { abandoned_checkouts: 0, orders, total: orders, error: `abandoned: ${err}` };
  }

  return {
    abandoned_checkouts: abandoned,
    orders,
    total: orders + abandoned,
    error: null,
  };
}

// ─── Main GET ─────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json(
      { error: msg },
      { status: msg === "Forbidden" ? 403 : 401 }
    );
  }

  const url = new URL(request.url);
  const { start: defaultStart, end: defaultEnd } = defaultWindow();
  const start = url.searchParams.get("start") || defaultStart;
  const end = url.searchParams.get("end") || defaultEnd;
  const wantsCached = url.searchParams.get("snapshot") === "cached";
  const cacheKey = buildFunnelCacheKey(start, end);

  // ─── Cached read ──────────────────────────────────────────────────────
  // The dashboard fires this first for instant load (~50ms read), then
  // fires a fresh recompute in the background to update the snapshot.
  if (wantsCached) {
    try {
      const snap = await latestSnapshot<Record<string, unknown>>(
        "funnel",
        cacheKey
      );
      if (snap) {
        return NextResponse.json({
          ...snap.payload,
          generated_at: snap.generated_at,
          computed_in_ms: snap.computed_in_ms,
          snapshot: { age_ms: Date.now() - Date.parse(snap.generated_at) },
        });
      }
    } catch (err) {
      console.warn("[marketing-funnel] snapshot read failed:", err);
    }
    // Fall through to live compute when no snapshot yet.
  }

  const startTs = Timestamp.fromDate(new Date(`${start}T00:00:00Z`));
  const endTs = Timestamp.fromDate(new Date(`${end}T23:59:59Z`));
  const startedAt = Date.now();

  try {
    // ── 1. Shopify orders (source of truth) ──────────────────────────────────
    const rawOrders = await fetchShopifyOrdersInWindow(start, end).catch(
      (err) => {
        console.warn("[marketing-funnel v4] Shopify fetch failed:", err);
        return [] as ShopifyOrderRaw[];
      }
    );

    const classified: ClassifiedOrder[] = [];
    for (const o of rawOrders) {
      const c = classifyShopifyOrder(o);
      if (isTestEmail(c.email)) continue;
      classified.push(c);
    }

    let newCount = 0;
    let newCents = 0;
    let newAccessCount = 0;
    let newMemberCount = 0;
    let newOtherCount = 0;
    let renewalCount = 0;
    let renewalCents = 0;
    let proShopCount = 0;
    let proShopCents = 0;

    const newMemberEmails = new Map<
      string,
      { tier: ReserveTier; paidAt: string; orderNumber: number }
    >();

    for (const c of classified) {
      switch (c.bucket) {
        case "new_reserve_member":
          newCount++;
          newCents += c.totalCents;
          if (c.tier === "access") newAccessCount++;
          else if (c.tier === "member") newMemberCount++;
          else if (c.tier === "back9") newMemberCount++;
          else newOtherCount++;
          if (c.email)
            newMemberEmails.set(c.email, {
              tier: c.tier,
              paidAt: c.paidAt,
              orderNumber: c.orderNumber,
            });
          break;
        case "auto_renewal":
          renewalCount++;
          renewalCents += c.totalCents;
          break;
        case "pro_shop":
          proShopCount++;
          proShopCents += c.totalCents;
          break;
        case "skipped":
          break;
      }
    }

    // ── 2. PostHog session funnel + Shopify ground-truth checkouts ──────────────────
    //
    // PostHog only sees sessions on mymully.com — it misses everyone who
    // jumps straight to a Shopify-hosted cart/checkout (e.g. via email
    // links, retargeting ads, direct URL). Shopify's own data is the
    // ground truth for "sessions reaching checkout": every checkout that
    // gets to the payment screen materializes as either a completed order
    // or an abandoned checkout. We surface this alongside PostHog so the
    // dashboard shows the real upper bound and the gap PostHog is missing.
    const phCfg = getPostHogConfig();
    let phData: FunnelData = {
      paths: [],
      channels: [],
      campaigns: [],
      total_sessions: 0,
      total_checkouts: 0,
      errors: phCfg
        ? []
        : ["POSTHOG_PERSONAL_API_KEY or POSTHOG_PROJECT_ID not set"],
    };
    const [phResult, shopifyCheckouts] = await Promise.all([
      phCfg ? fetchPostHogFunnel(phCfg, start, end).then(
        (d) => ({ ok: true as const, data: d }),
        (err: unknown) => ({ ok: false as const, err })
      ) : Promise.resolve({ ok: false as const, err: null }),
      fetchShopifyCheckoutGroundTruth(start, end).catch((err) => ({
        abandoned_checkouts: 0,
        orders: 0,
        total: 0,
        error: err instanceof Error ? err.message : String(err),
      })),
    ]);
    if (phResult.ok) {
      phData = phResult.data;
    } else if (phCfg && phResult.err) {
      phData.errors.push(
        phResult.err instanceof Error
          ? phResult.err.message
          : String(phResult.err)
      );
    }

    // A session "purchased" if its email matches a new_reserve_member email.
    const purchasedEmails = new Set(newMemberEmails.keys());
    const matchedEmails = new Set<string>();

    // (a) per-path bucket aggregations
    const bucketAgg: Record<PathBucketKey, FunnelStages> = {
      home: { visits: 0, checkouts: 0, purchases: 0 },
      lp_subscription: { visits: 0, checkouts: 0, purchases: 0 },
      lp_gift: { visits: 0, checkouts: 0, purchases: 0 },
      lp_other: { visits: 0, checkouts: 0, purchases: 0 },
      other: { visits: 0, checkouts: 0, purchases: 0 },
    };
    // Unique purchase-emails per bucket (so a single email seen on multiple
    // paths within the bucket counts once).
    const bucketEmails: Record<PathBucketKey, Set<string>> = {
      home: new Set(),
      lp_subscription: new Set(),
      lp_gift: new Set(),
      lp_other: new Set(),
      other: new Set(),
    };

    const allPathRows: PathRow[] = [];

    for (const p of phData.paths) {
      const bucket = bucketPath(p.path);
      let pathPurchases = 0;
      const seen = new Set<string>();
      for (const e of p.emails) {
        if (seen.has(e)) continue;
        seen.add(e);
        if (purchasedEmails.has(e)) {
          pathPurchases++;
          matchedEmails.add(e);
        }
        bucketEmails[bucket].add(e);
      }

      bucketAgg[bucket].visits += p.visits;
      bucketAgg[bucket].checkouts += p.checkouts;

      allPathRows.push({
        path: p.path,
        bucket,
        visits: p.visits,
        checkouts: p.checkouts,
        purchases: pathPurchases,
      });
    }
    for (const b of Object.keys(bucketAgg) as PathBucketKey[]) {
      let count = 0;
      for (const e of bucketEmails[b]) if (purchasedEmails.has(e)) count++;
      bucketAgg[b].purchases = count;
    }

    // (b) per-channel funnel — merge HogQL rows by classified channel
    const channelAgg: Record<Channel, FunnelStages> = {
      google_ads: { visits: 0, checkouts: 0, purchases: 0 },
      meta_ads: { visits: 0, checkouts: 0, purchases: 0 },
      x_ads: { visits: 0, checkouts: 0, purchases: 0 },
      google_organic: { visits: 0, checkouts: 0, purchases: 0 },
      meta_organic: { visits: 0, checkouts: 0, purchases: 0 },
      x_organic: { visits: 0, checkouts: 0, purchases: 0 },
      email: { visits: 0, checkouts: 0, purchases: 0 },
      sms: { visits: 0, checkouts: 0, purchases: 0 },
      internal: { visits: 0, checkouts: 0, purchases: 0 },
      direct: { visits: 0, checkouts: 0, purchases: 0 },
      other_referral: { visits: 0, checkouts: 0, purchases: 0 },
    };
    const channelEmails: Record<Channel, Set<string>> = {
      google_ads: new Set(),
      meta_ads: new Set(),
      x_ads: new Set(),
      google_organic: new Set(),
      meta_organic: new Set(),
      x_organic: new Set(),
      email: new Set(),
      sms: new Set(),
      internal: new Set(),
      direct: new Set(),
      other_referral: new Set(),
    };

    for (const c of phData.channels) {
      const channel = classifyChannel({
        utm_source: c.utm_src,
        utm_medium: c.utm_med,
        referrer: c.ref,
        gclid: c.gclid,
        fbclid: c.fbclid,
        twclid: c.twclid,
      });
      channelAgg[channel].visits += c.visits;
      channelAgg[channel].checkouts += c.checkouts;
      for (const e of c.emails) channelEmails[channel].add(e);
    }
    for (const ch of Object.keys(channelAgg) as Channel[]) {
      let count = 0;
      for (const e of channelEmails[ch]) {
        if (purchasedEmails.has(e)) {
          count++;
          matchedEmails.add(e);
        }
      }
      channelAgg[ch].purchases = count;
    }

    // Unattributed new members (Shopify order, never appeared in a session).
    const unattributedPurchases = Math.max(
      0,
      newMemberEmails.size - matchedEmails.size
    );

    // Shape outputs
    const bucketRows: BucketRow[] = (
      [
        "home",
        "lp_subscription",
        "lp_gift",
        "lp_other",
        "other",
      ] as PathBucketKey[]
    ).map((b) => ({
      bucket: b,
      label: PATH_BUCKET_LABEL[b],
      ...bucketAgg[b],
    }));

    const channelRows: ChannelRow[] = CHANNEL_ORDER.filter(
      (c) => channelAgg[c].visits > 0 || channelAgg[c].purchases > 0
    )
      .map((c) => ({
        channel: c,
        label: CHANNEL_LABEL[c],
        ...channelAgg[c],
      }))
      .sort((a, b) => b.visits - a.visits);

    const allPaths = allPathRows
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 40);

    // Top 12 paths inside the catch-all "Other pages" bucket — so the dashboard
    // can tell us _what_ is generating those visits (blog posts, /back-9, etc.)
    const otherPaths = allPathRows
      .filter((p) => p.bucket === "other")
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 12);

    // (c) per-campaign rollup (Resend broadcasts / flows / etc.)
    // We classify each campaign by its (utm_src, utm_med-unknown→email) so the
    // UI can group by channel. Purchases = unique session-emails on the
    // campaign that also bought in the window.
    const campaignRows: CampaignRow[] = [];
    for (const c of phData.campaigns) {
      // Most resend/email campaigns carry utm_medium=email already; if it's
      // missing we still want to classify them as email when the source is
      // resend/klaviyo/postmark. classifyChannel handles utm_source=resend
      // → email already.
      const channel = classifyChannel({
        utm_source: c.utm_src,
        utm_medium: "email",
        referrer: null,
        gclid: null,
        fbclid: null,
        twclid: null,
      });
      let purchases = 0;
      const seen = new Set<string>();
      for (const e of c.emails) {
        if (seen.has(e)) continue;
        seen.add(e);
        if (purchasedEmails.has(e)) purchases++;
      }
      campaignRows.push({
        utm_campaign: c.utm_camp || "(none)",
        utm_source: c.utm_src || "(none)",
        channel,
        channel_label: CHANNEL_LABEL[channel],
        visits: c.visits,
        checkouts: c.checkouts,
        purchases,
      });
    }
    campaignRows.sort((a, b) => b.visits - a.visits);

    // (d) attribution-health: % of sessions carrying each ID type. Computed
    // from per-channel rows (one row per unique utm/click-id combo, weighted
    // by visits). gclid/fbclid/twclid columns are HogQL string-or-null.
    let gclidSessions = 0;
    let fbclidSessions = 0;
    let twclidSessions = 0;
    let utmSrcSessions = 0;
    for (const c of phData.channels) {
      const hasGclid =
        typeof c.gclid === "string" && c.gclid && c.gclid !== "null";
      const hasFbclid =
        typeof c.fbclid === "string" && c.fbclid && c.fbclid !== "null";
      const hasTwclid =
        typeof c.twclid === "string" && c.twclid && c.twclid !== "null";
      const hasUtmSrc =
        typeof c.utm_src === "string" && c.utm_src && c.utm_src !== "null";
      if (hasGclid) gclidSessions += c.visits;
      if (hasFbclid) fbclidSessions += c.visits;
      if (hasTwclid) twclidSessions += c.visits;
      if (hasUtmSrc) utmSrcSessions += c.visits;
    }
    const utmCampSessions = phData.campaigns.reduce(
      (sum, c) => sum + (c.utm_camp ? c.visits : 0),
      0
    );
    const denom = phData.total_sessions || 1;
    const attributionHealth: AttributionHealth = {
      gclid_pct: gclidSessions / denom,
      fbclid_pct: fbclidSessions / denom,
      twclid_pct: twclidSessions / denom,
      utm_source_pct: utmSrcSessions / denom,
      utm_campaign_pct: utmCampSessions / denom,
      total_sessions: phData.total_sessions,
    };

    const funnelTotals: FunnelStages = {
      visits: phData.total_sessions,
      checkouts: phData.total_checkouts,
      purchases: matchedEmails.size,
    };

    // ── 3. Email sequences ───────────────────────────────────────────────────
    const seqSnap = await adminDb
      .collection("email_sequences")
      .where("startedAt", ">=", startTs)
      .where("startedAt", "<=", endTs)
      .get();

    const userCounts: Record<
      string,
      { active: number; paused: number; completed: number }
    > = {};
    const sentCounts: Record<string, Record<number, number>> = {};
    interface SeqUser {
      email: string;
      flow: EmailFlow;
      lastSentStep: number;
    }
    const seqUsersByEmail: Record<string, SeqUser> = {};

    for (const doc of seqSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (isTestEmail(d.email)) continue;
      const flow = d.flow as EmailFlow | undefined;
      if (!flow || !FLOW_ORDER.includes(flow)) continue;
      const status = d.status as string | undefined;
      const lastSentStep =
        typeof d.lastSentStep === "number" ? d.lastSentStep : -1;

      userCounts[flow] ??= { active: 0, paused: 0, completed: 0 };
      if (status === "active") userCounts[flow].active++;
      else if (status === "paused") userCounts[flow].paused++;
      else if (status === "completed") userCounts[flow].completed++;

      sentCounts[flow] ??= {};
      for (let i = 0; i <= lastSentStep; i++) {
        sentCounts[flow][i] = (sentCounts[flow][i] ?? 0) + 1;
      }

      const eml = typeof d.email === "string" ? d.email.toLowerCase() : "";
      if (eml) seqUsersByEmail[eml] = { email: eml, flow, lastSentStep };
    }

    let emailEventsDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    try {
      const ev = await adminDb
        .collection("email_events")
        .where("created_at", ">=", startTs)
        .where("created_at", "<=", endTs)
        .get();
      emailEventsDocs = ev.docs;
    } catch (err) {
      console.warn("[marketing-funnel v4] email_events range query failed:", err);
    }
    const engagementCounts: Record<
      string,
      Record<number, { opened: number; clicked: number }>
    > = {};
    for (const doc of emailEventsDocs) {
      const d = doc.data() as Record<string, unknown>;
      if (isTestEmail(d.email)) continue;
      const eventType = d.event_type as string | undefined;
      if (eventType !== "opened" && eventType !== "clicked") continue;
      const tags = d.tags as Record<string, string> | null | undefined;
      if (!tags?.flow || tags.step === undefined) continue;
      const flow = tags.flow;
      const step = Number(tags.step);
      if (!Number.isFinite(step)) continue;
      engagementCounts[flow] ??= {};
      engagementCounts[flow][step] ??= { opened: 0, clicked: 0 };
      if (eventType === "opened") engagementCounts[flow][step].opened++;
      else engagementCounts[flow][step].clicked++;
    }

    let replyDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    try {
      const rep = await adminDb
        .collection("email_replies")
        .where("createdAt", ">=", startTs)
        .where("createdAt", "<=", endTs)
        .get();
      replyDocs = rep.docs;
    } catch (err) {
      console.warn("[marketing-funnel v4] email_replies range query failed:", err);
    }
    const replyCounts: Record<string, Record<number, number>> = {};
    for (const doc of replyDocs) {
      const d = doc.data() as Record<string, unknown>;
      if (isTestEmail(d.email)) continue;
      const flow = d.flow as string | undefined;
      const step = d.lastSentStep as number | undefined;
      if (!flow || step === undefined || step === null) continue;
      replyCounts[flow] ??= {};
      replyCounts[flow][step] = (replyCounts[flow][step] ?? 0) + 1;
    }

    const purchaseCounts: Record<string, Record<number, number>> = {};
    for (const email of newMemberEmails.keys()) {
      const seq = seqUsersByEmail[email];
      if (!seq) continue;
      purchaseCounts[seq.flow] ??= {};
      const step = Math.max(0, seq.lastSentStep);
      purchaseCounts[seq.flow][step] = (purchaseCounts[seq.flow][step] ?? 0) + 1;
    }

    const emailFlows: Record<
      string,
      {
        users: { active: number; paused: number; completed: number; total: number };
        steps: Array<{
          step: number;
          delayDays: number;
          sent: number;
          opened: number;
          clicked: number;
          replied: number;
          purchased: number;
        }>;
      }
    > = {};
    for (const flow of FLOW_ORDER) {
      const uc = userCounts[flow] ?? { active: 0, paused: 0, completed: 0 };
      emailFlows[flow] = {
        users: { ...uc, total: uc.active + uc.paused + uc.completed },
        steps: FLOW_STEPS[flow].map((s) => ({
          step: s.step,
          delayDays: s.delayDays,
          sent: sentCounts[flow]?.[s.step] ?? 0,
          opened: engagementCounts[flow]?.[s.step]?.opened ?? 0,
          clicked: engagementCounts[flow]?.[s.step]?.clicked ?? 0,
          replied: replyCounts[flow]?.[s.step] ?? 0,
          purchased: purchaseCounts[flow]?.[s.step] ?? 0,
        })),
      };
    }

    // ── 4. Live ad spend ─────────────────────────────────────────────────────
    const googleAds = await fetchGoogleAdsLive(start, end).catch((err) => {
      console.warn("[marketing-funnel v4] Google Ads live fetch failed:", err);
      return {
        available: false,
        reason: err instanceof Error ? err.message : "unknown",
        spend_cents: 0,
        clicks: 0,
        conversions: 0,
        impressions: 0,
      } as AdPlatformSummary;
    });

    const xAds = await fetchXAdsLive(start, end).catch((err) => {
      console.warn("[marketing-funnel v4] X Ads live fetch failed:", err);
      return {
        available: false,
        reason: err instanceof Error ? err.message : "unknown",
        spend_cents: 0,
        clicks: 0,
        conversions: 0,
        impressions: 0,
      } as AdPlatformSummary;
    });

    const totalSpendCents = googleAds.spend_cents + xAds.spend_cents;

    // ── 5. Response ──────────────────────────────────────────────────────────
    // Rocks are fetched in parallel by the client via /rocks subroute.
    const computedInMs = Date.now() - startedAt;
    const generatedAtIso = new Date().toISOString();
    const responseBody = {
      window: { start, end },
      headline: {
        new_reserve_members: newCount,
        new_reserve_revenue_cents: newCents,
        new_reserve_access: newAccessCount,
        new_reserve_member: newMemberCount,
        new_reserve_other: newOtherCount,
        renewals: renewalCount,
        renewal_revenue_cents: renewalCents,
        pro_shop_orders: proShopCount,
        pro_shop_revenue_cents: proShopCents,
        ad_spend_cents: totalSpendCents,
        cac_cents: newCount > 0 ? Math.round(totalSpendCents / newCount) : 0,
      },
      funnel: {
        totals: funnelTotals,
        path_buckets: bucketRows,
        channels: channelRows,
        all_paths: allPaths,
        other_paths: otherPaths,
        campaigns: campaignRows,
        attribution_health: attributionHealth,
        unattributed_purchases: unattributedPurchases,
        shopify_new_members: newMemberEmails.size,
        // Shopify ground truth — captures sessions that bypass PostHog
        // (direct cart links, email retargeting, etc.). PostHog only sees
        // mymully.com pageviews; Shopify-hosted checkout is invisible to it.
        shopify_checkouts_initiated:
          shopifyCheckouts.total,
        shopify_abandoned_checkouts: shopifyCheckouts.abandoned_checkouts,
        shopify_completed_orders: shopifyCheckouts.orders,
        shopify_checkouts_error: shopifyCheckouts.error,
      },
      ad_platforms: {
        google_ads: googleAds,
        x_ads: xAds,
      },
      email_flows: emailFlows,
      meta: {
        shopify_orders: rawOrders.length,
        new_reserve_members: newCount,
        auto_renewals: renewalCount,
        pro_shop: proShopCount,
        posthog_sessions: phData.total_sessions,
        posthog_errors: phData.errors,
        sequences_in_window: seqSnap.size,
        email_events: emailEventsDocs.length,
      },
      generated_at: generatedAtIso,
      computed_in_ms: computedInMs,
      snapshot: { age_ms: 0 },
    };

    // Fire-and-forget snapshot persistence so subsequent reads with
    // ?snapshot=cached return in ~50ms.
    void writeSnapshot("funnel", cacheKey, responseBody, {
      computedInMs,
      source: "live",
    }).catch((err) =>
      console.warn("[marketing-funnel] snapshot write failed:", err)
    );

    return NextResponse.json(responseBody);
  } catch (err) {
    console.error("[admin/marketing-funnel v4] failed:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
