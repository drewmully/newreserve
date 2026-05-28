/**
 * GET /api/admin/marketing-funnel  (v2)
 *
 * Health-first marketing dashboard. Data sources:
 *
 *   1. Shopify Admin REST `/orders.json`  → source of truth for purchases.
 *      Each order is bucketed by Shopify-native signals only:
 *        - tags contain "Subscription" + "Billing cycle #N"
 *        - customer.orders_count = lifetime order count for the customer
 *      Buckets:
 *        • brand_new        : subscription, cycle #1, customer.orders_count == 1
 *        • returning_resub  : subscription, cycle #1, customer.orders_count > 1
 *        • auto_renewal     : subscription, cycle #2+ (Loop recurring)
 *        • pro_shop         : non-subscription order
 *
 *   2. Firestore `analytics_events` → landing-page funnel.
 *      Three stages only: page_view → checkout_started → purchase.
 *      Purchases are attributed back to landing path via email match to Shopify
 *      orders in the (brand_new + returning_resub) buckets.
 *
 *   3. Firestore `email_sequences` / `email_events` / `email_replies`
 *      → per-flow active/paused/completed, per-step sent/open/click/reply
 *      → per-step purchases via email match to (brand_new + returning_resub)
 *
 *   4. Google Ads REST API (live)       → spend / clicks / conversions
 *      X Ads                            → placeholder (no connector)
 *
 * Query params: ?start=YYYY-MM-DD&end=YYYY-MM-DD  (defaults: last 7 days inclusive)
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

function normalizePath(rawUrl: unknown): string {
  if (typeof rawUrl !== "string" || !rawUrl) return "(unknown)";
  try {
    const u = new URL(rawUrl);
    let p = u.pathname || "/";
    if (p.length > 1 && p.endsWith("/")) p = p.slice(0, -1);
    return p.toLowerCase();
  } catch {
    if (rawUrl.startsWith("/")) return rawUrl.split("?")[0].toLowerCase();
    return "(unknown)";
  }
}

function classifyChannel(opts: {
  utm_source?: unknown;
  utm_medium?: unknown;
  referrer?: unknown;
  gclid?: unknown;
  fbclid?: unknown;
}): string {
  const utmSource =
    typeof opts.utm_source === "string" ? opts.utm_source.toLowerCase() : "";
  const utmMedium =
    typeof opts.utm_medium === "string" ? opts.utm_medium.toLowerCase() : "";
  const referrer =
    typeof opts.referrer === "string" ? opts.referrer.toLowerCase() : "";

  if (opts.gclid) return "google_ads";
  if (opts.fbclid) return "meta_ads";

  if (utmSource) {
    if (utmSource.includes("google") && utmMedium.includes("cpc")) return "google_ads";
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
    if (utmSource.includes("twitter") || utmSource === "x") return "x_ads";
    if (utmSource.includes("klaviyo") || utmSource === "email" || utmMedium === "email")
      return "email";
    if (utmSource.includes("resend")) return "email";
    if (utmSource === "sms" || utmMedium === "sms") return "sms";
    if (utmSource === "direct") return "direct";
    return utmSource;
  }

  if (referrer) {
    try {
      const host = new URL(referrer).hostname.replace(/^www\./, "");
      if (host.includes("google")) return "google_organic";
      if (host.includes("facebook") || host.includes("instagram"))
        return "meta_organic";
      if (host.includes("twitter") || host.includes("x.com")) return "x_organic";
      if (host.includes("youtube")) return "youtube";
      if (host.includes("mymully.com") || host.includes("mullybox"))
        return "internal";
      return host;
    } catch {
      /* noop */
    }
  }

  return "direct";
}

// ─── Shopify (source of truth for purchases) ──────────────────────────────────

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
        orders_count?: number;
        created_at?: string;
      }
    | null;
  line_items: Array<{
    title: string;
    quantity: number;
    price: string;
    product_id: number | null;
  }>;
  note_attributes?: Array<{ name: string; value: string }>;
  source_name?: string;
  referring_site?: string;
  landing_site?: string;
}

async function fetchShopifyOrdersInWindow(
  startISO: string,
  endISO: string
): Promise<ShopifyOrderRaw[]> {
  const token = process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";

  if (!token || !domain) {
    console.warn("[marketing-funnel v2] missing Shopify creds, skipping orders");
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
  | "brand_new"
  | "returning_resub"
  | "auto_renewal"
  | "pro_shop"
  | "skipped";

interface ClassifiedOrder {
  bucket: OrderBucket;
  email: string;
  totalCents: number;
  paidAt: string;
  billingCycle: number | null;
  ordersCount: number;
}

function classifyShopifyOrder(o: ShopifyOrderRaw): ClassifiedOrder {
  const tagsStr = (o.tags ?? "").toLowerCase();
  const tags = tagsStr.split(",").map((t) => t.trim());
  const isSubscription = tags.some((t) => /^subscription(\b|$)/i.test(t));
  const cycleTag = tags.find((t) => /^billing cycle #\d+/i.test(t));
  const billingCycle = cycleTag
    ? Number(cycleTag.replace(/[^\d]/g, "")) || null
    : null;
  const ordersCount = o.customer?.orders_count ?? 0;
  const email = (o.customer?.email ?? o.email ?? "").toLowerCase();
  const cents = Math.round(parseFloat(o.total_price || "0") * 100);
  const paidAt = o.created_at;

  // exclude cancelled / unpaid orders from headline counts
  if (o.cancelled_at) {
    return {
      bucket: "skipped",
      email,
      totalCents: cents,
      paidAt,
      billingCycle,
      ordersCount,
    };
  }
  if (o.financial_status && o.financial_status !== "paid") {
    return {
      bucket: "skipped",
      email,
      totalCents: cents,
      paidAt,
      billingCycle,
      ordersCount,
    };
  }

  let bucket: OrderBucket;
  if (!isSubscription) {
    bucket = "pro_shop";
  } else if (billingCycle && billingCycle >= 2) {
    bucket = "auto_renewal";
  } else if (billingCycle === 1 || billingCycle === null) {
    // First-cycle subscription. Use orders_count to split brand_new vs returning.
    bucket = ordersCount > 1 ? "returning_resub" : "brand_new";
  } else {
    bucket = "skipped";
  }

  return { bucket, email, totalCents: cents, paidAt, billingCycle, ordersCount };
}

// ─── Live Google Ads spend ────────────────────────────────────────────────────

interface GoogleAdsSummary {
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
): Promise<GoogleAdsSummary> {
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
        console.warn("[marketing-funnel v2] Shopify fetch failed:", err);
        return [] as ShopifyOrderRaw[];
      }
    );

    const classified: ClassifiedOrder[] = [];
    for (const o of rawOrders) {
      const c = classifyShopifyOrder(o);
      if (isTestEmail(c.email)) continue;
      classified.push(c);
    }

    let brandNewCount = 0;
    let brandNewCents = 0;
    let returningCount = 0;
    let returningCents = 0;
    let renewalCount = 0;
    let renewalCents = 0;
    let proShopCount = 0;
    let proShopCents = 0;

    // emails of buyers we consider "active new sales" — used for funnel + email step credit
    const purchasingEmails = new Map<
      string,
      { bucket: "brand_new" | "returning_resub"; paidAt: string }
    >();

    for (const c of classified) {
      switch (c.bucket) {
        case "brand_new":
          brandNewCount++;
          brandNewCents += c.totalCents;
          if (c.email) purchasingEmails.set(c.email, { bucket: "brand_new", paidAt: c.paidAt });
          break;
        case "returning_resub":
          returningCount++;
          returningCents += c.totalCents;
          if (c.email)
            purchasingEmails.set(c.email, { bucket: "returning_resub", paidAt: c.paidAt });
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

    const activeNewSales = brandNewCount + returningCount;
    const activeNewRevenueCents = brandNewCents + returningCents;

    // ── 2. Analytics events: landing-page funnel + channel mix ───────────────
    let evtDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    try {
      const snap = await adminDb
        .collection("analytics_events")
        .where("stored_at", ">=", startTs)
        .where("stored_at", "<=", endTs)
        .get();
      evtDocs = snap.docs;
    } catch (err) {
      console.warn("[marketing-funnel v2] analytics_events range query failed:", err);
    }

    interface PathBucket {
      page_views: number;
      checkout_started: number;
      purchases: number;
    }
    const pathStats: Record<string, PathBucket> = {};
    const ensurePath = (p: string): PathBucket => {
      pathStats[p] ??= { page_views: 0, checkout_started: 0, purchases: 0 };
      return pathStats[p];
    };

    // email → earliest landing path observed in window
    interface FirstTouch {
      path: string;
      channel: string;
      ts: number;
    }
    const firstTouchByEmail: Record<string, FirstTouch> = {};
    const channelTotals: Record<string, number> = {};

    for (const doc of evtDocs) {
      const e = doc.data() as Record<string, unknown>;
      const eventName = e.event_name as string | undefined;
      if (!eventName) continue;
      const props = (e.properties ?? {}) as Record<string, unknown>;
      const path = normalizePath(
        e.page_url ?? props.page_url ?? props.pathname
      );
      const bucket = ensurePath(path);
      if (eventName === "page_view") bucket.page_views++;
      else if (eventName === "checkout_started") bucket.checkout_started++;

      const ts =
        (e.stored_at as Timestamp | undefined)?.toMillis() ??
        (typeof e.timestamp === "number" ? e.timestamp * 1000 : 0);
      const channel = classifyChannel({
        utm_source: props.utm_source,
        utm_medium: props.utm_medium,
        referrer: props.referrer ?? props.$referrer,
        gclid: props.gclid,
        fbclid: props.fbclid,
      });

      const eml =
        typeof props.email === "string" ? props.email.toLowerCase() : "";
      if (eml) {
        const existing = firstTouchByEmail[eml];
        const isBetter =
          !existing ||
          (existing.channel === "direct" && channel !== "direct") ||
          (existing.channel === channel && ts < existing.ts);
        if (isBetter) firstTouchByEmail[eml] = { path, channel, ts };
      }

      channelTotals[channel] = (channelTotals[channel] ?? 0) + 1;
    }

    // Attribute Shopify purchases back to landing path via email match
    for (const email of purchasingEmails.keys()) {
      const t = firstTouchByEmail[email];
      if (t) ensurePath(t.path).purchases++;
      else ensurePath("(unknown)").purchases++;
    }

    const landingPages = Object.entries(pathStats)
      .map(([path, b]) => ({
        path,
        page_views: b.page_views,
        checkout_started: b.checkout_started,
        purchases: b.purchases,
        cvr_pv_to_purchase:
          b.page_views > 0 ? +(b.purchases / b.page_views).toFixed(4) : 0,
        cvr_pv_to_checkout:
          b.page_views > 0
            ? +(b.checkout_started / b.page_views).toFixed(4)
            : 0,
      }))
      .sort((a, b) => b.page_views - a.page_views)
      .slice(0, 12);

    const funnelTotals = Object.values(pathStats).reduce(
      (acc, b) => {
        acc.page_views += b.page_views;
        acc.checkout_started += b.checkout_started;
        acc.purchases += b.purchases;
        return acc;
      },
      { page_views: 0, checkout_started: 0, purchases: 0 }
    );

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

    // email_events: opens / clicks per step
    let emailEventsDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    try {
      const ev = await adminDb
        .collection("email_events")
        .where("created_at", ">=", startTs)
        .where("created_at", "<=", endTs)
        .get();
      emailEventsDocs = ev.docs;
    } catch (err) {
      console.warn("[marketing-funnel v2] email_events range query failed:", err);
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

    // email_replies: replies per step
    let replyDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    try {
      const rep = await adminDb
        .collection("email_replies")
        .where("createdAt", ">=", startTs)
        .where("createdAt", "<=", endTs)
        .get();
      replyDocs = rep.docs;
    } catch (err) {
      console.warn("[marketing-funnel v2] email_replies range query failed:", err);
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

    // Per-step PURCHASES via email match to brand_new + returning_resub
    const purchaseCounts: Record<string, Record<number, number>> = {};
    for (const email of purchasingEmails.keys()) {
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
      console.warn("[marketing-funnel v2] Google Ads live fetch failed:", err);
      return {
        available: false,
        reason: err instanceof Error ? err.message : "unknown",
        spend_cents: 0,
        clicks: 0,
        conversions: 0,
        impressions: 0,
      } as GoogleAdsSummary;
    });

    const xAds: GoogleAdsSummary = {
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
        brand_new: brandNewCount,
        brand_new_revenue_cents: brandNewCents,
        returning_resub: returningCount,
        returning_resub_revenue_cents: returningCents,
        active_new_sales: activeNewSales,
        active_new_revenue_cents: activeNewRevenueCents,
        renewals: renewalCount,
        renewal_revenue_cents: renewalCents,
        pro_shop_orders: proShopCount,
        pro_shop_revenue_cents: proShopCents,
        ad_spend_cents: totalSpendCents,
        cac_cents:
          activeNewSales > 0
            ? Math.round(totalSpendCents / activeNewSales)
            : 0,
      },
      landing_pages: landingPages,
      funnel_totals: funnelTotals,
      channels: Object.entries(channelTotals)
        .map(([channel, sessions]) => ({ channel, sessions }))
        .sort((a, b) => b.sessions - a.sessions),
      ad_platforms: {
        google_ads: googleAds,
        x_ads: xAds,
      },
      email_flows: emailFlows,
      meta: {
        shopify_orders: rawOrders.length,
        brand_new: brandNewCount,
        returning_resub: returningCount,
        auto_renewals: renewalCount,
        pro_shop: proShopCount,
        analytics_events: evtDocs.length,
        sequences_in_window: seqSnap.size,
        email_events: emailEventsDocs.length,
      },
    });
  } catch (err) {
    console.error("[admin/marketing-funnel v2] failed:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
