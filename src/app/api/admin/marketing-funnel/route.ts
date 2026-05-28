/**
 * GET /api/admin/marketing-funnel
 *
 * Aggregates marketing performance across the funnel for an admin dashboard.
 * Combines four data sources:
 *
 *   1. Firestore `email_sequences`     → new signups by tier + signup date
 *   2. Firestore `analytics_events`    → channel attribution (utm_source / referrer)
 *                                        for each signup uid
 *   3. Firestore `kpi_daily`           → website funnel (sessions / add-to-cart /
 *                                        checkout / purchases / revenue)
 *   4. Firestore `email_events`        → opens / clicks per flow + step
 *   5. Firestore `email_replies`       → replies per flow + step
 *   6. Shopify Admin REST `/orders`    → pro-shop orders + line items by member
 *   7. Supabase `marketing_spend_daily`→ ad spend by channel
 *
 * Query params:
 *   ?start=YYYY-MM-DD&end=YYYY-MM-DD   (defaults to last 7 days, inclusive)
 *
 * Auth: Firebase Bearer token, admin email allowlist.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { FieldPath, Timestamp } from "firebase-admin/firestore";
import { FLOW_STEPS, type EmailFlow } from "@/lib/email/sequences";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";

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
  start.setUTCDate(end.getUTCDate() - 6); // 7 days inclusive
  return { start: dateKey(start), end: dateKey(end) };
}

/**
 * Normalize a raw utm_source / referrer / page_url into a channel bucket.
 * Order matters: explicit utm_source > known referrer domains > direct.
 */
function classifyChannel(opts: {
  utm_source?: unknown;
  utm_medium?: unknown;
  referrer?: unknown;
  page_url?: unknown;
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
    if (utmSource.includes("facebook") || utmSource.includes("meta") || utmSource === "ig" || utmSource === "instagram") {
      return utmMedium.includes("cpc") || utmMedium.includes("paid") ? "meta_ads" : "meta_organic";
    }
    if (utmSource.includes("klaviyo") || utmSource === "email" || utmMedium === "email") return "email";
    if (utmSource.includes("resend")) return "email";
    if (utmSource === "sms" || utmMedium === "sms") return "sms";
    if (utmSource === "direct") return "direct";
    return utmSource;
  }

  if (referrer) {
    try {
      const host = new URL(referrer).hostname.replace(/^www\./, "");
      if (host.includes("google")) return "google_organic";
      if (host.includes("facebook") || host.includes("instagram")) return "meta_organic";
      if (host.includes("youtube")) return "youtube";
      if (host.includes("mymully.com") || host.includes("mullybox")) return "internal";
      return host;
    } catch {
      // fall through
    }
  }

  return "direct";
}

// ─── Shopify orders (window) ──────────────────────────────────────────────────

interface ShopifyOrderRaw {
  id: number;
  order_number: number;
  email: string | null;
  created_at: string;
  total_price: string;
  financial_status: string;
  customer: { id: number; email: string | null } | null;
  line_items: Array<{ title: string; quantity: number; price: string; product_id: number | null }>;
  note_attributes?: Array<{ name: string; value: string }>;
  source_name?: string;
  referring_site?: string;
  landing_site?: string;
}

async function fetchShopifyOrdersInWindow(
  startISO: string,
  endISO: string
): Promise<ShopifyOrderRaw[]> {
  const token =
    process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";

  if (!token || !domain) {
    console.warn("[marketing-funnel] missing Shopify creds, skipping orders");
    return [];
  }

  // end-of-day for the `end` boundary so the whole day is included
  const startISOFull = `${startISO}T00:00:00Z`;
  const endISOFull = `${endISO}T23:59:59Z`;

  const orders: ShopifyOrderRaw[] = [];
  let url: string | null =
    `https://${domain}/admin/api/${version}/orders.json?status=any` +
    `&created_at_min=${encodeURIComponent(startISOFull)}` +
    `&created_at_max=${encodeURIComponent(endISOFull)}` +
    `&limit=250`;

  // paginate via Link header (Shopify cursor pagination)
  while (url) {
    const res: Response = await fetch(url, {
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
    });
    if (!res.ok) {
      throw new Error(`Shopify orders.json ${res.status}: ${await res.text()}`);
    }
    const j = (await res.json()) as { orders: ShopifyOrderRaw[] };
    orders.push(...(j.orders ?? []));

    const link = res.headers.get("link") ?? res.headers.get("Link") ?? "";
    const nextMatch = link.match(/<([^>]+)>;\s*rel="next"/);
    url = nextMatch ? nextMatch[1] : null;

    // safety: cap at ~2k orders / 8 pages to avoid run-away
    if (orders.length >= 2000) break;
  }

  return orders;
}

// ─── Main GET ─────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  const url = new URL(request.url);
  const { start: defaultStart, end: defaultEnd } = defaultWindow();
  const start = url.searchParams.get("start") || defaultStart;
  const end = url.searchParams.get("end") || defaultEnd;

  const startTs = Timestamp.fromDate(new Date(`${start}T00:00:00Z`));
  const endTs = Timestamp.fromDate(new Date(`${end}T23:59:59Z`));

  try {
    // ── 1. Signups: email_sequences where startedAt in window ────────────────
    const seqSnap = await adminDb
      .collection("email_sequences")
      .where("startedAt", ">=", startTs)
      .where("startedAt", "<=", endTs)
      .get();

    // Capture uid + flow + email
    interface SignupRow {
      uid: string;
      flow: EmailFlow;
      email: string | null;
      startedAtMs: number;
    }
    const signups: SignupRow[] = [];
    for (const doc of seqSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (isTestEmail(d.email)) continue;
      const flow = d.flow as EmailFlow | undefined;
      if (!flow || !FLOW_ORDER.includes(flow)) continue;
      const startedAt = d.startedAt as Timestamp | undefined;
      signups.push({
        uid: doc.id,
        flow,
        email: typeof d.email === "string" ? d.email : null,
        startedAtMs: startedAt ? startedAt.toMillis() : 0,
      });
    }

    // ── 2. Attribution per signup uid: earliest analytics_events with UTM ────
    // Firestore `in` query supports up to 30 values; chunk uid list.
    const uidsToLookup = signups.map((s) => s.uid);
    const attribution: Record<string, string> = {}; // uid → channel

    if (uidsToLookup.length > 0) {
      // chunk into batches of 30
      const chunks: string[][] = [];
      for (let i = 0; i < uidsToLookup.length; i += 30) {
        chunks.push(uidsToLookup.slice(i, i + 30));
      }

      const all = await Promise.all(
        chunks.map((chunk) =>
          adminDb
            .collection("analytics_events")
            .where("uid", "in", chunk)
            .get()
            .catch((err) => {
              console.warn("[marketing-funnel] analytics_events chunk failed:", err);
              return { docs: [] };
            })
        )
      );

      // For each uid, pick the earliest event w/ utm_source or referrer.
      type EvtCandidate = { ts: number; channel: string };
      const byUid: Record<string, EvtCandidate> = {};
      for (const snap of all) {
        for (const doc of snap.docs) {
          const e = doc.data() as Record<string, unknown>;
          const uid = e.uid as string | undefined;
          if (!uid) continue;
          const ts =
            (e.stored_at as Timestamp | undefined)?.toMillis() ??
            (typeof e.timestamp === "number" ? e.timestamp * 1000 : 0);
          const props = (e.properties ?? {}) as Record<string, unknown>;
          const channel = classifyChannel({
            utm_source: props.utm_source,
            utm_medium: props.utm_medium,
            referrer: props.referrer ?? props.$referrer,
            page_url: e.page_url,
            gclid: props.gclid,
            fbclid: props.fbclid,
          });
          // Prefer non-direct attribution; otherwise keep earliest.
          const existing = byUid[uid];
          const isBetter =
            !existing ||
            (existing.channel === "direct" && channel !== "direct") ||
            (existing.channel === channel && ts < existing.ts);
          if (isBetter) byUid[uid] = { ts, channel };
        }
      }
      for (const [uid, cand] of Object.entries(byUid)) {
        attribution[uid] = cand.channel;
      }
    }

    // Bucket signups: tier → channel → count
    const signupsByTierChannel: Record<EmailFlow, Record<string, number>> = {
      free: {}, access: {}, member: {}, back9: {},
    };
    const signupsByTierTotal: Record<EmailFlow, number> = {
      free: 0, access: 0, member: 0, back9: 0,
    };
    for (const s of signups) {
      const ch = attribution[s.uid] || "direct";
      signupsByTierChannel[s.flow][ch] = (signupsByTierChannel[s.flow][ch] ?? 0) + 1;
      signupsByTierTotal[s.flow]++;
    }

    // ── 3. Website funnel: aggregate kpi_daily in range ──────────────────────
    const kpiSnap = await adminDb
      .collection("kpi_daily")
      .where(FieldPath.documentId(), ">=", start)
      .where(FieldPath.documentId(), "<=", end)
      .get();

    let pageViews = 0;
    let walletViews = 0;
    let addToCart = 0;
    let checkoutStarted = 0;
    let purchases = 0;
    let revenueCents = 0;

    const sumKey = (d: Record<string, unknown>, nested: string, flat: string): number => {
      const obj = (d[nested.split(".")[0]] ?? {}) as Record<string, number>;
      const nestedVal = obj[nested.split(".")[1]];
      const flatVal = d[flat] as number | undefined;
      return (nestedVal ?? flatVal ?? 0) as number;
    };

    for (const doc of kpiSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      const ec = { ...((d.event_counts ?? {}) as Record<string, number>) };
      for (const [k, v] of Object.entries(d)) {
        if (k.startsWith("event_counts.")) {
          const sub = k.slice(13);
          if (!(sub in ec)) ec[sub] = v as number;
        }
      }
      pageViews += ec.page_view ?? 0;
      walletViews += sumKey(d, "funnel.wallet_views", "funnel.wallet_views");
      addToCart += sumKey(d, "funnel.add_to_cart", "funnel.add_to_cart");
      checkoutStarted += sumKey(d, "funnel.checkout_started", "funnel.checkout_started");
      purchases += sumKey(d, "funnel.purchases", "funnel.purchases");
      revenueCents += sumKey(d, "revenue.total_cents", "revenue.total_cents");
    }

    const websiteFunnel = {
      page_views: pageViews,
      wallet_views: walletViews,
      add_to_cart: addToCart,
      checkout_started: checkoutStarted,
      purchases,
      revenue_cents: revenueCents,
    };

    // ── 4. Pro shop purchases by existing members ────────────────────────────
    // Members = users with shopify_customer_id and any subscription tier set.
    const orders = await fetchShopifyOrdersInWindow(start, end).catch((err) => {
      console.warn("[marketing-funnel] Shopify orders fetch failed:", err);
      return [] as ShopifyOrderRaw[];
    });

    // Build a quick lookup: shopify_customer_id → user tier
    // Pulling all `users` is acceptable at our scale (~hundreds-low thousands).
    const usersSnap = await adminDb.collection("users").get();
    const customerIdToTier: Record<string, EmailFlow> = {};
    const emailToTier: Record<string, EmailFlow> = {};
    for (const doc of usersSnap.docs) {
      const u = doc.data() as Record<string, unknown>;
      if (isTestEmail(u.email)) continue;
      const tier = (u.tier as EmailFlow) || "free";
      if (!FLOW_ORDER.includes(tier)) continue;
      const shopifyId = u.shopify_customer_id;
      if (typeof shopifyId === "string" && shopifyId) {
        customerIdToTier[String(shopifyId)] = tier;
      }
      if (typeof u.email === "string" && u.email) {
        emailToTier[u.email.toLowerCase()] = tier;
      }
    }

    interface ProShopBucket {
      tier: EmailFlow | "non_member";
      orders: number;
      units: number;
      revenue_cents: number;
      channels: Record<string, number>;
    }

    const proShopBuckets: Record<string, ProShopBucket> = {
      free: { tier: "free", orders: 0, units: 0, revenue_cents: 0, channels: {} },
      access: { tier: "access", orders: 0, units: 0, revenue_cents: 0, channels: {} },
      member: { tier: "member", orders: 0, units: 0, revenue_cents: 0, channels: {} },
      back9: { tier: "back9", orders: 0, units: 0, revenue_cents: 0, channels: {} },
      non_member: { tier: "non_member", orders: 0, units: 0, revenue_cents: 0, channels: {} },
    };

    for (const o of orders) {
      // skip subscription-billing orders (those are membership fees, not pro shop).
      // A simple heuristic: if any line item is a subscription / billing SKU, exclude.
      // We'll keep all here and let the dashboard distinguish if needed; for now,
      // tag membership orders so we can filter.
      const isMembershipOrder = (o.line_items ?? []).some((li) =>
        /reserve|mullybox|subscription|membership/i.test(li.title || "")
      );
      if (isMembershipOrder) continue;

      const customerId = o.customer?.id ? String(o.customer.id) : null;
      const emailNorm = (o.customer?.email ?? o.email ?? "").toLowerCase();
      const tier: EmailFlow | "non_member" =
        (customerId && customerIdToTier[customerId]) ||
        (emailNorm && emailToTier[emailNorm]) ||
        "non_member";

      const bucket = proShopBuckets[tier];
      bucket.orders++;
      bucket.units += (o.line_items ?? []).reduce((acc, li) => acc + (li.quantity || 0), 0);
      bucket.revenue_cents += Math.round(parseFloat(o.total_price || "0") * 100);

      // Try to infer attribution channel from order's landing_site / referring_site / note_attributes
      const noteAttrs = o.note_attributes ?? [];
      const utmSource = noteAttrs.find((a) => /utm_source/i.test(a.name))?.value;
      const utmMedium = noteAttrs.find((a) => /utm_medium/i.test(a.name))?.value;
      const channel = classifyChannel({
        utm_source: utmSource,
        utm_medium: utmMedium,
        referrer: o.referring_site,
        page_url: o.landing_site,
      });
      bucket.channels[channel] = (bucket.channels[channel] ?? 0) + 1;
    }

    const proShopByMembers = Object.values(proShopBuckets).map((b) => {
      // Find top channel for this bucket
      let topChannel = "direct";
      let topCount = 0;
      for (const [ch, c] of Object.entries(b.channels)) {
        if (c > topCount) {
          topCount = c;
          topChannel = ch;
        }
      }
      return {
        tier: b.tier,
        orders: b.orders,
        units: b.units,
        revenue_cents: b.revenue_cents,
        top_acquisition_channel: b.orders > 0 ? topChannel : null,
        channels: b.channels,
      };
    });

    // ── 5. Email flow performance ────────────────────────────────────────────
    // Sent: count unique users whose lastSentStep >= step AND startedAt in window.
    // Opens/clicks: email_events where created_at in window AND tags.flow/step present.
    // Replies: email_replies where createdAt in window AND lastSentStep present.

    const sentCounts: Record<string, Record<number, number>> = {};
    const userCounts: Record<string, { active: number; paused: number; completed: number }> = {};
    for (const doc of seqSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      if (isTestEmail(d.email)) continue;
      const flow = d.flow as EmailFlow | undefined;
      const status = d.status as string | undefined;
      const lastSentStep = typeof d.lastSentStep === "number" ? d.lastSentStep : -1;
      if (!flow) continue;

      userCounts[flow] ??= { active: 0, paused: 0, completed: 0 };
      if (status === "active") userCounts[flow].active++;
      else if (status === "paused") userCounts[flow].paused++;
      else if (status === "completed") userCounts[flow].completed++;

      sentCounts[flow] ??= {};
      for (let i = 0; i <= lastSentStep; i++) {
        sentCounts[flow][i] = (sentCounts[flow][i] ?? 0) + 1;
      }
    }

    // email_events: need a created_at range. Query w/ index; fall back to full scan.
    let emailEventsDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    try {
      const ev = await adminDb
        .collection("email_events")
        .where("created_at", ">=", startTs)
        .where("created_at", "<=", endTs)
        .get();
      emailEventsDocs = ev.docs;
    } catch (err) {
      console.warn("[marketing-funnel] email_events range query failed, full scan:", err);
      const ev = await adminDb.collection("email_events").get();
      emailEventsDocs = ev.docs.filter((d) => {
        const ca = (d.data().created_at as Timestamp | undefined)?.toMillis() ?? 0;
        return ca >= startTs.toMillis() && ca <= endTs.toMillis();
      });
    }

    const engagementCounts: Record<string, Record<number, { opened: number; clicked: number }>> = {};
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

    // replies in window
    let replyDocs: FirebaseFirestore.QueryDocumentSnapshot[] = [];
    try {
      const rep = await adminDb
        .collection("email_replies")
        .where("createdAt", ">=", startTs)
        .where("createdAt", "<=", endTs)
        .get();
      replyDocs = rep.docs;
    } catch (err) {
      console.warn("[marketing-funnel] email_replies range query failed, full scan:", err);
      const rep = await adminDb.collection("email_replies").get();
      replyDocs = rep.docs.filter((d) => {
        const ca = (d.data().createdAt as Timestamp | undefined)?.toMillis() ?? 0;
        return ca >= startTs.toMillis() && ca <= endTs.toMillis();
      });
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

    const emailFlows: Record<string, {
      users: { active: number; paused: number; completed: number; total: number };
      steps: Array<{ step: number; delayDays: number; sent: number; opened: number; clicked: number; replied: number }>;
    }> = {};
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
        })),
      };
    }

    // ── 6. Ad spend from Supabase marketing_spend_daily ──────────────────────
    let adSpend: Array<{ channel: string; spend_cents: number; days: number }> = [];
    try {
      const sb = getSupabaseService();
      const { data, error } = await sb
        .from("marketing_spend_daily")
        .select("channel, amount, spend_date")
        .gte("spend_date", start)
        .lte("spend_date", end);
      if (error) {
        console.warn("[marketing-funnel] supabase spend fetch error:", error);
      } else {
        const byChannel: Record<string, { spend_cents: number; days: Set<string> }> = {};
        for (const row of data ?? []) {
          const ch = (row.channel as string) || "unknown";
          byChannel[ch] ??= { spend_cents: 0, days: new Set() };
          byChannel[ch].spend_cents += Math.round(Number(row.amount || 0) * 100);
          if (row.spend_date) byChannel[ch].days.add(String(row.spend_date));
        }
        adSpend = Object.entries(byChannel).map(([channel, v]) => ({
          channel,
          spend_cents: v.spend_cents,
          days: v.days.size,
        }));
      }
    } catch (err) {
      console.warn("[marketing-funnel] supabase unavailable:", err);
    }

    // ── 7. Build response ────────────────────────────────────────────────────
    return NextResponse.json({
      window: { start, end },
      membership_signups: {
        total_by_tier: signupsByTierTotal,
        by_tier_and_channel: signupsByTierChannel,
      },
      website_funnel: websiteFunnel,
      pro_shop_by_members: proShopByMembers,
      email_flows: emailFlows,
      ad_spend_by_channel: adSpend,
      meta: {
        signups_count: signups.length,
        orders_count: orders.length,
        kpi_days_loaded: kpiSnap.size,
        email_events_loaded: emailEventsDocs.length,
        users_indexed: usersSnap.size,
      },
    });
  } catch (err) {
    console.error("[admin/marketing-funnel] failed:", err);
    const msg = err instanceof Error ? err.message : "Internal error";
    return NextResponse.json({ error: msg }, { status: 500 });
  }
}
