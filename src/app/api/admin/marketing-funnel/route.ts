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
import { FLOW_STEPS, type EmailFlow } from "@/lib/email/sequences";

export const runtime = "nodejs";
export const maxDuration = 60;

const FLOW_ORDER: EmailFlow[] = ["free", "access", "member", "back9"];

// ─── Auth ─────────────────────────────────────────────────────────────────────

async function verifyAdmin(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
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

interface SessionRow {
  sid: string;
  landing: string;
  email: string | null;
  channel: Channel;
  has_checkout: boolean;
}

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

interface BucketRow extends FunnelStages {
  bucket: PathBucketKey;
  label: string;
}

interface FunnelData {
  sessions: SessionRow[];
  errors: string[];
}

async function fetchPostHogSessions(
  cfg: PostHogConfig,
  start: string,
  end: string
): Promise<FunnelData> {
  const startTs = `${start} 00:00:00`;
  const endTs = `${end} 23:59:59`;
  const errors: string[] = [];

  // Single query: per session_id, get landing path, channel signals, has_checkout, email.
  // Email is sourced from any event in the session that has properties.email
  // (checkout_clicked, email_submitted, login, identify, etc.).
  const q = `
    WITH pv AS (
      SELECT properties.$session_id AS sid,
             argMin(properties.$pathname, timestamp) AS landing,
             argMin(properties.utm_source, timestamp) AS utm_src,
             argMin(properties.utm_medium, timestamp) AS utm_med,
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
      SELECT properties.$session_id AS sid,
             1 AS has_checkout
      FROM events
      WHERE event IN ('checkout_clicked', 'lp_subscription_checkout_clicked')
        AND timestamp >= toDateTime('${startTs}')
        AND timestamp <= toDateTime('${endTs}')
        AND properties.$session_id IS NOT NULL
      GROUP BY sid
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
    SELECT pv.sid,
           pv.landing,
           em.email,
           pv.utm_src, pv.utm_med, pv.ref, pv.gclid, pv.fbclid, pv.twclid,
           coalesce(co.has_checkout, 0) AS has_checkout
    FROM pv
    LEFT JOIN co ON pv.sid = co.sid
    LEFT JOIN em ON pv.sid = em.sid
  `;

  const sessions: SessionRow[] = [];
  try {
    const rows = await runHogQL(cfg, q);
    for (const r of rows) {
      const [sid, landing, email, utmSrc, utmMed, ref, gclid, fbclid, twclid, hasCo] = r;
      sessions.push({
        sid: String(sid ?? ""),
        landing: normalizePath(landing),
        email:
          typeof email === "string" && email && email !== "null"
            ? email.toLowerCase()
            : null,
        channel: classifyChannel({
          utm_source: utmSrc,
          utm_medium: utmMed,
          referrer: ref,
          gclid,
          fbclid,
          twclid,
        }),
        has_checkout: Number(hasCo ?? 0) > 0,
      });
    }
  } catch (err) {
    errors.push(
      `sessions: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  return { sessions, errors };
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

async function fetchGoogleAdsLive(
  start: string,
  end: string
): Promise<AdPlatformSummary> {
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  const refreshToken = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_ADS_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET;

  if (
    !developerToken ||
    !loginCustomerId ||
    !customerId ||
    !refreshToken ||
    !clientId ||
    !clientSecret
  ) {
    return {
      available: false,
      reason: "Missing Google Ads env vars",
      spend_cents: 0,
      clicks: 0,
      conversions: 0,
      impressions: 0,
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
      available: false,
      reason: `OAuth refresh failed: ${tokenRes.status}`,
      spend_cents: 0,
      clicks: 0,
      conversions: 0,
      impressions: 0,
    };
  }
  const { access_token } = (await tokenRes.json()) as { access_token: string };

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
    `https://googleads.googleapis.com/v17/customers/${customerId}/googleAds:search`,
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

  const startTs = Timestamp.fromDate(new Date(`${start}T00:00:00Z`));
  const endTs = Timestamp.fromDate(new Date(`${end}T23:59:59Z`));

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

    // ── 2. PostHog sessions + funnel + channel ───────────────────────────────
    const phCfg = getPostHogConfig();
    let phData: FunnelData = {
      sessions: [],
      errors: phCfg
        ? []
        : ["POSTHOG_PERSONAL_API_KEY or POSTHOG_PROJECT_ID not set"],
    };
    if (phCfg) {
      try {
        phData = await fetchPostHogSessions(phCfg, start, end);
      } catch (err) {
        phData.errors.push(
          err instanceof Error ? err.message : String(err)
        );
      }
    }

    // Build aggregations from sessions.
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

    // (b) raw per-path (top N) for the "all paths" toggle
    const pathAgg: Record<string, FunnelStages & { bucket: PathBucketKey }> = {};

    // (c) per-channel funnel
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

    for (const s of phData.sessions) {
      const bucket = bucketPath(s.landing);
      const purchased = s.email && purchasedEmails.has(s.email);
      if (purchased && s.email) matchedEmails.add(s.email);

      // path bucket
      bucketAgg[bucket].visits += 1;
      if (s.has_checkout) bucketAgg[bucket].checkouts += 1;
      if (purchased) bucketAgg[bucket].purchases += 1;

      // raw path
      pathAgg[s.landing] ??= {
        visits: 0,
        checkouts: 0,
        purchases: 0,
        bucket,
      };
      pathAgg[s.landing].visits += 1;
      if (s.has_checkout) pathAgg[s.landing].checkouts += 1;
      if (purchased) pathAgg[s.landing].purchases += 1;

      // channel
      channelAgg[s.channel].visits += 1;
      if (s.has_checkout) channelAgg[s.channel].checkouts += 1;
      if (purchased) channelAgg[s.channel].purchases += 1;
    }

    // Unattributed new members (had a Shopify order but never showed up in a
    // tracked session in this window).
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

    const allPaths: PathRow[] = Object.entries(pathAgg)
      .map(([path, v]) => ({
        path,
        bucket: v.bucket,
        visits: v.visits,
        checkouts: v.checkouts,
        purchases: v.purchases,
      }))
      .sort((a, b) => b.visits - a.visits)
      .slice(0, 40);

    const funnelTotals: FunnelStages = {
      visits: phData.sessions.length,
      checkouts: phData.sessions.filter((s) => s.has_checkout).length,
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

    const xAds: AdPlatformSummary = {
      available: false,
      reason: "X Ads connector not configured",
      spend_cents: 0,
      clicks: 0,
      conversions: 0,
      impressions: 0,
    };

    const totalSpendCents = googleAds.spend_cents + xAds.spend_cents;

    // ── 5. Response ──────────────────────────────────────────────────────────
    return NextResponse.json({
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
        unattributed_purchases: unattributedPurchases,
        shopify_new_members: newMemberEmails.size,
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
        posthog_sessions: phData.sessions.length,
        posthog_errors: phData.errors,
        sequences_in_window: seqSnap.size,
        email_events: emailEventsDocs.length,
      },
    });
  } catch (err) {
    console.error("[admin/marketing-funnel v4] failed:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
