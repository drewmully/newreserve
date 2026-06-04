/**
 * GET /api/admin/email-funnel?start=YYYY-MM-DD&end=YYYY-MM-DD
 *
 * Unified email funnel data — drip + broadcast — for the Ad Performance
 * dashboard's Email tab.
 *
 * Per Drew (2026-06-04):
 *   - Cohort: emails SENT in the window (not sequences started)
 *   - Include step 0
 *   - Purchase attribution: 14 days post-send
 *   - Per-flow funnel: sent → delivered → opened → clicked → purchased(14d)
 *   - Broadcast funnel: sent → delivered → opened → clicked → purchased(14d)
 *   - Mapped to the two drop-off stages Drew cares about:
 *       a) profile-complete → checkout-started (reserve + access + member nurture)
 *       b) checkout-started → purchase (abandon)
 *
 * Data sources:
 *   - Firestore email_events (drip + broadcast, sent/delivered/opened/clicked)
 *   - Firestore email_sequences (per-user flow state, for "in-flow" totals)
 *   - Shopify Admin REST orders (for purchased attribution within 14d)
 *
 * Auth: Firebase Bearer token (admin allowlist) OR CRON_SECRET.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { Timestamp } from "firebase-admin/firestore";
import { FLOW_STEPS, type EmailFlow } from "@/lib/email/sequences";

export const runtime = "nodejs";
export const maxDuration = 60;

const FLOW_ORDER: EmailFlow[] = ["access", "member", "reserve", "abandon"];

// Drop-off stage each flow primarily targets (used by the UI to bucket flows
// against the two drop-off stages Drew called out).
const FLOW_STAGE: Record<EmailFlow, "profile_to_checkout" | "checkout_to_purchase" | "post_purchase"> = {
  access: "post_purchase",
  member: "post_purchase",
  reserve: "profile_to_checkout",
  abandon: "checkout_to_purchase",
};

const isTestEmail = (email: unknown) =>
  typeof email === "string" && /^leo(\+[^@]*)?@mullybox\.com$/i.test(email);

async function verifyAdmin(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return;
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

interface StepStat {
  step: number;
  delayDays: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  purchased: number; // unique emails on this step that purchased within 14d of send
}

interface FlowSummary {
  flow: EmailFlow;
  stage: "profile_to_checkout" | "checkout_to_purchase" | "post_purchase";
  in_flow: { active: number; paused: number; completed: number; total: number };
  steps: StepStat[];
  totals: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    purchased: number;
  };
}

interface BroadcastSummary {
  // Aggregated across all broadcast campaigns whose events landed in window
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  purchased: number;
  campaigns: Array<{
    campaign_id: string;
    label: string;
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    purchased: number;
  }>;
}

interface ApiResponse {
  window: { start: string; end: string };
  attribution: { window_days: number; cohort: "sent_in_range" };
  flows: FlowSummary[];
  broadcast: BroadcastSummary;
  // Drew's two stages of interest, with email-attributable purchases bucketed
  drop_off_stages: {
    profile_to_checkout: {
      flows: EmailFlow[];
      sent: number;
      clicked: number;
      checkouts_attributed: number; // checkouts started within 14d of any send
    };
    checkout_to_purchase: {
      flows: EmailFlow[];
      sent: number;
      clicked: number;
      purchases_attributed: number;
    };
  };
  meta: {
    events_in_window: number;
    sequences_with_send_in_window: number;
    computed_in_ms: number;
    generated_at: string;
  };
}

const ATTRIBUTION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

// ─── Shopify helpers ──────────────────────────────────────────────────────────

interface ShopifyCheckout {
  email: string;
  startedAt: number; // ms
}
interface ShopifyPurchase {
  email: string;
  paidAt: number; // ms
}

async function fetchShopifyOrders(
  start: string,
  end: string
): Promise<{ purchases: ShopifyPurchase[]; error: string | null }> {
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) {
    return { purchases: [], error: "shopify_env_missing" };
  }
  // Pull paid orders with paid_at in the extended window (start-0d to end+14d)
  // so we can attribute sends late in window to purchases within their 14d.
  const startDate = new Date(start + "T00:00:00Z");
  const endDate = new Date(end + "T23:59:59Z");
  const extEnd = new Date(endDate.getTime() + ATTRIBUTION_WINDOW_MS);
  const purchases: ShopifyPurchase[] = [];
  try {
    let url: string | null =
      `https://${shop}/admin/api/2024-10/orders.json?status=any&financial_status=paid` +
      `&processed_at_min=${startDate.toISOString()}&processed_at_max=${extEnd.toISOString()}` +
      `&limit=250&fields=id,email,processed_at,financial_status`;
    let pages = 0;
    while (url && pages < 20) {
      const r: Response = await fetch(url, {
        headers: { "X-Shopify-Access-Token": token },
      });
      if (!r.ok) {
        return { purchases, error: `shopify_${r.status}` };
      }
      const j = (await r.json()) as {
        orders: Array<{ email: string | null; processed_at: string }>;
      };
      for (const o of j.orders) {
        const eml = (o.email || "").toLowerCase();
        if (!eml) continue;
        const t = new Date(o.processed_at).getTime();
        if (Number.isFinite(t)) purchases.push({ email: eml, paidAt: t });
      }
      // Link-header pagination
      const link = r.headers.get("link") || r.headers.get("Link") || "";
      const m = link.match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
      pages++;
    }
    return { purchases, error: null };
  } catch (err) {
    return {
      purchases,
      error: err instanceof Error ? err.message : "shopify_unknown",
    };
  }
}

async function fetchShopifyCheckouts(
  start: string,
  end: string
): Promise<{ checkouts: ShopifyCheckout[]; error: string | null }> {
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) {
    return { checkouts: [], error: "shopify_env_missing" };
  }
  const startDate = new Date(start + "T00:00:00Z");
  const endDate = new Date(end + "T23:59:59Z");
  const extEnd = new Date(endDate.getTime() + ATTRIBUTION_WINDOW_MS);
  const checkouts: ShopifyCheckout[] = [];
  try {
    let url: string | null =
      `https://${shop}/admin/api/2024-10/checkouts.json` +
      `?created_at_min=${startDate.toISOString()}&created_at_max=${extEnd.toISOString()}` +
      `&limit=250&fields=email,created_at,token`;
    let pages = 0;
    while (url && pages < 10) {
      const r: Response = await fetch(url, {
        headers: { "X-Shopify-Access-Token": token },
      });
      if (!r.ok) {
        return { checkouts, error: `shopify_${r.status}` };
      }
      const j = (await r.json()) as {
        checkouts: Array<{ email: string | null; created_at: string }>;
      };
      for (const c of j.checkouts) {
        const eml = (c.email || "").toLowerCase();
        if (!eml) continue;
        const t = new Date(c.created_at).getTime();
        if (Number.isFinite(t)) checkouts.push({ email: eml, startedAt: t });
      }
      const link = r.headers.get("link") || r.headers.get("Link") || "";
      const m = link.match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
      pages++;
    }
    return { checkouts, error: null };
  } catch (err) {
    return {
      checkouts,
      error: err instanceof Error ? err.message : "shopify_unknown",
    };
  }
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const startedAt = Date.now();
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
  const today = new Date().toISOString().slice(0, 10);
  const start =
    url.searchParams.get("start") ||
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const end = url.searchParams.get("end") || today;

  const startTs = Timestamp.fromDate(new Date(start + "T00:00:00Z"));
  const endTs = Timestamp.fromDate(new Date(end + "T23:59:59Z"));

  // ── 1. Read all email_events in window ────────────────────────────────────
  let events: Array<{
    type: string;
    email: string;
    ts: number;
    tags: Record<string, string>;
  }> = [];
  try {
    const snap = await adminDb
      .collection("email_events")
      .where("created_at", ">=", startTs)
      .where("created_at", "<=", endTs)
      .get();
    for (const doc of snap.docs) {
      const d = doc.data() as Record<string, unknown>;
      const eml = typeof d.email === "string" ? d.email.toLowerCase() : "";
      if (!eml || isTestEmail(eml)) continue;
      const tags = (d.tags as Record<string, string> | null) || {};
      const createdAt = d.created_at as Timestamp | undefined;
      const tsIso = (d.resend_timestamp as string | undefined) || createdAt?.toDate().toISOString();
      const ts = tsIso ? new Date(tsIso).getTime() : (createdAt?.toMillis() ?? 0);
      events.push({
        type: String(d.event_type || ""),
        email: eml,
        ts,
        tags,
      });
    }
  } catch (err) {
    console.warn("[email-funnel] email_events query failed:", err);
  }

  // ── 2. In-flow user counts (sequence state right now) ────────────────────
  const userCounts: Record<EmailFlow, { active: number; paused: number; completed: number }> = {
    access: { active: 0, paused: 0, completed: 0 },
    member: { active: 0, paused: 0, completed: 0 },
    reserve: { active: 0, paused: 0, completed: 0 },
    abandon: { active: 0, paused: 0, completed: 0 },
  };
  // Track emails currently in each flow → for purchase attribution against flow
  const emailsByFlow: Record<EmailFlow, Set<string>> = {
    access: new Set(),
    member: new Set(),
    reserve: new Set(),
    abandon: new Set(),
  };
  try {
    // sequences that had a send in window: use lastSentStep>=0 + lastSentAt in window,
    // but simpler — just pull current state and intersect emails with send events.
    const seqSnap = await adminDb.collection("email_sequences").get();
    for (const doc of seqSnap.docs) {
      const d = doc.data() as Record<string, unknown>;
      const eml = typeof d.email === "string" ? d.email.toLowerCase() : "";
      if (!eml || isTestEmail(eml)) continue;
      const flow = d.flow as EmailFlow | undefined;
      if (!flow || !FLOW_ORDER.includes(flow)) continue;
      const status = d.status as string | undefined;
      if (status === "active") userCounts[flow].active++;
      else if (status === "paused") userCounts[flow].paused++;
      else if (status === "completed") userCounts[flow].completed++;
      emailsByFlow[flow].add(eml);
    }
  } catch (err) {
    console.warn("[email-funnel] email_sequences query failed:", err);
  }

  // ── 3. Shopify orders/checkouts in extended window ───────────────────────
  const [purchasesRes, checkoutsRes] = await Promise.all([
    fetchShopifyOrders(start, end),
    fetchShopifyCheckouts(start, end),
  ]);

  // Build email → earliest purchase/checkout timestamp lookups for fast attribution.
  const earliestPaidByEmail = new Map<string, number>();
  for (const p of purchasesRes.purchases) {
    const prev = earliestPaidByEmail.get(p.email);
    if (prev === undefined || p.paidAt < prev) earliestPaidByEmail.set(p.email, p.paidAt);
  }
  const earliestCheckoutByEmail = new Map<string, number>();
  for (const c of checkoutsRes.checkouts) {
    const prev = earliestCheckoutByEmail.get(c.email);
    if (prev === undefined || c.startedAt < prev) earliestCheckoutByEmail.set(c.email, c.startedAt);
  }

  // ── 4. Per-flow per-step aggregation ─────────────────────────────────────
  type StepKey = `${EmailFlow}|${number}`;
  const stepStats: Record<StepKey, { sent: number; delivered: number; opened: number; clicked: number; purchased: number; sentEmails: Map<string, number>; }> = {} as any;

  function getBucket(flow: EmailFlow, step: number) {
    const k = `${flow}|${step}` as StepKey;
    if (!stepStats[k]) {
      stepStats[k] = { sent: 0, delivered: 0, opened: 0, clicked: 0, purchased: 0, sentEmails: new Map() };
    }
    return stepStats[k];
  }

  let broadcastSent = 0, broadcastDelivered = 0, broadcastOpened = 0, broadcastClicked = 0;
  const broadcastCampaigns = new Map<string, { sent: number; delivered: number; opened: number; clicked: number; sentEmails: Map<string, number>; }>();

  for (const ev of events) {
    const tags = ev.tags || {};
    const flowTag = tags.flow as EmailFlow | undefined;
    const stepRaw = tags.step;
    const isDrip = flowTag && FLOW_ORDER.includes(flowTag) && stepRaw !== undefined;
    const campaignId = tags.mully_campaign_id || tags.campaign_id;
    if (isDrip) {
      const step = Number(stepRaw);
      if (!Number.isFinite(step)) continue;
      const b = getBucket(flowTag!, step);
      switch (ev.type) {
        case "sent":
          b.sent++;
          // earliest send per email for attribution
          const prev = b.sentEmails.get(ev.email);
          if (prev === undefined || ev.ts < prev) b.sentEmails.set(ev.email, ev.ts);
          break;
        case "delivered":
          b.delivered++;
          break;
        case "opened":
          b.opened++;
          break;
        case "clicked":
          b.clicked++;
          break;
      }
    } else if (campaignId) {
      const c = broadcastCampaigns.get(campaignId) ?? {
        sent: 0, delivered: 0, opened: 0, clicked: 0, sentEmails: new Map(),
      };
      switch (ev.type) {
        case "sent":
          c.sent++; broadcastSent++;
          const prev = c.sentEmails.get(ev.email);
          if (prev === undefined || ev.ts < prev) c.sentEmails.set(ev.email, ev.ts);
          break;
        case "delivered": c.delivered++; broadcastDelivered++; break;
        case "opened": c.opened++; broadcastOpened++; break;
        case "clicked": c.clicked++; broadcastClicked++; break;
      }
      broadcastCampaigns.set(campaignId, c);
    }
  }

  // Attribution: 14d purchase per (flow, step)
  for (const [key, bucket] of Object.entries(stepStats)) {
    for (const [email, sentTs] of bucket.sentEmails.entries()) {
      const paid = earliestPaidByEmail.get(email);
      if (paid !== undefined && paid >= sentTs && paid - sentTs <= ATTRIBUTION_WINDOW_MS) {
        bucket.purchased++;
      }
    }
  }
  // Broadcast attribution
  let broadcastPurchased = 0;
  for (const [, c] of broadcastCampaigns) {
    let p = 0;
    for (const [email, sentTs] of c.sentEmails.entries()) {
      const paid = earliestPaidByEmail.get(email);
      if (paid !== undefined && paid >= sentTs && paid - sentTs <= ATTRIBUTION_WINDOW_MS) {
        p++;
      }
    }
    (c as any).purchased = p;
    broadcastPurchased += p;
  }

  // ── 5. Build per-flow summaries ──────────────────────────────────────────
  const flows: FlowSummary[] = FLOW_ORDER.map((flow) => {
    const cfgSteps = FLOW_STEPS[flow];
    const steps: StepStat[] = cfgSteps.map((cfg) => {
      const b = stepStats[`${flow}|${cfg.step}` as StepKey];
      return {
        step: cfg.step,
        delayDays: cfg.delayDays,
        sent: b?.sent ?? 0,
        delivered: b?.delivered ?? 0,
        opened: b?.opened ?? 0,
        clicked: b?.clicked ?? 0,
        purchased: b?.purchased ?? 0,
      };
    });
    const tot = steps.reduce(
      (acc, s) => {
        acc.sent += s.sent;
        acc.delivered += s.delivered;
        acc.opened += s.opened;
        acc.clicked += s.clicked;
        acc.purchased += s.purchased;
        return acc;
      },
      { sent: 0, delivered: 0, opened: 0, clicked: 0, purchased: 0 }
    );
    const uc = userCounts[flow];
    return {
      flow,
      stage: FLOW_STAGE[flow],
      in_flow: { ...uc, total: uc.active + uc.paused + uc.completed },
      steps,
      totals: tot,
    };
  });

  // ── 6. Drop-off stage rollups (Drew's two stages) ────────────────────────
  function aggStage(stage: "profile_to_checkout" | "checkout_to_purchase") {
    const matching = FLOW_ORDER.filter((f) => FLOW_STAGE[f] === stage);
    let sent = 0, clicked = 0;
    const attributableEmails = new Map<string, number>(); // earliest send for any matching flow
    for (const flow of matching) {
      for (const cfg of FLOW_STEPS[flow]) {
        const b = stepStats[`${flow}|${cfg.step}` as StepKey];
        if (!b) continue;
        sent += b.sent;
        clicked += b.clicked;
        for (const [email, ts] of b.sentEmails.entries()) {
          const prev = attributableEmails.get(email);
          if (prev === undefined || ts < prev) attributableEmails.set(email, ts);
        }
      }
    }
    let attributed = 0;
    if (stage === "profile_to_checkout") {
      for (const [email, sentTs] of attributableEmails) {
        const co = earliestCheckoutByEmail.get(email);
        if (co !== undefined && co >= sentTs && co - sentTs <= ATTRIBUTION_WINDOW_MS) {
          attributed++;
        }
      }
      return { flows: matching, sent, clicked, checkouts_attributed: attributed };
    } else {
      for (const [email, sentTs] of attributableEmails) {
        const paid = earliestPaidByEmail.get(email);
        if (paid !== undefined && paid >= sentTs && paid - sentTs <= ATTRIBUTION_WINDOW_MS) {
          attributed++;
        }
      }
      return { flows: matching, sent, clicked, purchases_attributed: attributed };
    }
  }

  const profileToCheckout = aggStage("profile_to_checkout") as {
    flows: EmailFlow[]; sent: number; clicked: number; checkouts_attributed: number;
  };
  const checkoutToPurchase = aggStage("checkout_to_purchase") as {
    flows: EmailFlow[]; sent: number; clicked: number; purchases_attributed: number;
  };

  const broadcast: BroadcastSummary = {
    sent: broadcastSent,
    delivered: broadcastDelivered,
    opened: broadcastOpened,
    clicked: broadcastClicked,
    purchased: broadcastPurchased,
    campaigns: Array.from(broadcastCampaigns.entries())
      .map(([id, c]) => ({
        campaign_id: id,
        label: id,
        sent: c.sent,
        delivered: c.delivered,
        opened: c.opened,
        clicked: c.clicked,
        purchased: (c as any).purchased ?? 0,
      }))
      .sort((a, b) => b.sent - a.sent),
  };

  // sequences-with-send-in-window count = number of unique emails that have a sent event with a flow tag
  const seqEmails = new Set<string>();
  for (const ev of events) {
    if (ev.type === "sent" && ev.tags?.flow) seqEmails.add(ev.email);
  }

  const response: ApiResponse = {
    window: { start, end },
    attribution: { window_days: 14, cohort: "sent_in_range" },
    flows,
    broadcast,
    drop_off_stages: {
      profile_to_checkout: profileToCheckout,
      checkout_to_purchase: checkoutToPurchase,
    },
    meta: {
      events_in_window: events.length,
      sequences_with_send_in_window: seqEmails.size,
      computed_in_ms: Date.now() - startedAt,
      generated_at: new Date().toISOString(),
    },
  };

  return NextResponse.json(response);
}
