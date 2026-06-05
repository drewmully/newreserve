/**
 * GET /api/admin/email-funnel/recipients?start&end&flow&step
 *
 * Drill-in: per-recipient state for one (flow, step) cell.
 * Pulls email_events in window, filters to (flow, step), joins with Shopify
 * orders for 14d purchase attribution. Caps at 500 recipients.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { Timestamp } from "firebase-admin/firestore";
import type { EmailFlow } from "@/lib/email/sequences";
import { FLOW_STEPS } from "@/lib/email/sequences";
import { ACCESS_TEMPLATES } from "@/lib/email/templates/access";
import { MEMBER_TEMPLATES } from "@/lib/email/templates/member";
import { RESERVE_TEMPLATES } from "@/lib/email/templates/reserve";
import { ABANDON_TEMPLATES } from "@/lib/email/templates/abandon";

type EmailTemplate = (firstName: string | null) => { subject: string; text: string };
const TEMPLATES: Record<EmailFlow, EmailTemplate[]> = {
  access: ACCESS_TEMPLATES,
  member: MEMBER_TEMPLATES,
  reserve: RESERVE_TEMPLATES,
  abandon: ABANDON_TEMPLATES,
};

// Pull out https?:// URLs from a plain-text email body so the UI can show
// the clickable links Resend would rewrite for tracking.
function extractLinks(text: string): string[] {
  const re = /https?:\/\/[^\s<>)\]"']+/g;
  const seen = new Set<string>();
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const url = m[0].replace(/[.,;:!?]+$/, "");
    if (!seen.has(url)) {
      seen.add(url);
      out.push(url);
    }
  }
  return out;
}

export const runtime = "nodejs";
export const maxDuration = 60;

const ATTRIBUTION_WINDOW_MS = 14 * 24 * 60 * 60 * 1000;

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

interface Purchase {
  email: string;
  paidAt: number;
}

async function fetchShopifyPurchases(
  start: string,
  end: string
): Promise<Purchase[]> {
  const shop = process.env.SHOPIFY_STORE_DOMAIN;
  const token = process.env.SHOPIFY_ADMIN_TOKEN;
  if (!shop || !token) return [];
  const startDate = new Date(start + "T00:00:00Z");
  const endDate = new Date(end + "T23:59:59Z");
  const extEnd = new Date(endDate.getTime() + ATTRIBUTION_WINDOW_MS);
  const purchases: Purchase[] = [];
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
      if (!r.ok) break;
      const j = (await r.json()) as {
        orders: Array<{ email: string | null; processed_at: string }>;
      };
      for (const o of j.orders) {
        const eml = (o.email || "").toLowerCase();
        if (!eml) continue;
        const t = new Date(o.processed_at).getTime();
        if (Number.isFinite(t)) purchases.push({ email: eml, paidAt: t });
      }
      const link = r.headers.get("link") || r.headers.get("Link") || "";
      const m = link.match(/<([^>]+)>;\s*rel="next"/);
      url = m ? m[1] : null;
      pages++;
    }
  } catch (err) {
    console.warn("[email-funnel/recipients] shopify orders fetch failed:", err);
  }
  return purchases;
}

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
  const today = new Date().toISOString().slice(0, 10);
  const start =
    url.searchParams.get("start") ||
    new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const end = url.searchParams.get("end") || today;
  const flow = url.searchParams.get("flow") || "";
  const stepRaw = url.searchParams.get("step");
  const step = stepRaw ? Number(stepRaw) : NaN;

  if (!flow || !Number.isFinite(step)) {
    return NextResponse.json({ error: "missing flow/step" }, { status: 400 });
  }

  // Filter on resend_timestamp (real send time) not created_at (Firestore doc
  // write time) so backfilled docs don't show up as "recent" events.
  const startIso = new Date(start + "T00:00:00Z").toISOString();
  const endIso = new Date(end + "T23:59:59.999Z").toISOString();

  // Pull events in window with matching flow+step tags
  const evSnap = await adminDb
    .collection("email_events")
    .where("resend_timestamp", ">=", startIso)
    .where("resend_timestamp", "<=", endIso)
    .get();

  type State = {
    email: string;
    sent_at: number | null;
    delivered: boolean;
    opened_at: number | null;
    clicked_at: number | null;
  };
  const byEmail = new Map<string, State>();

  for (const doc of evSnap.docs) {
    const d = doc.data() as Record<string, unknown>;
    const tags = (d.tags as Record<string, string> | null) || {};
    if (tags.flow !== flow || Number(tags.step) !== step) continue;
    const eml = typeof d.email === "string" ? d.email.toLowerCase() : "";
    if (!eml || isTestEmail(eml)) continue;
    const tsIso = (d.resend_timestamp as string | undefined) ||
      (d.created_at as Timestamp | undefined)?.toDate().toISOString();
    const ts = tsIso ? new Date(tsIso).getTime() : 0;
    const type = String(d.event_type || "");
    let cur = byEmail.get(eml);
    if (!cur) {
      cur = { email: eml, sent_at: null, delivered: false, opened_at: null, clicked_at: null };
      byEmail.set(eml, cur);
    }
    switch (type) {
      case "sent":
        if (cur.sent_at === null || ts < cur.sent_at) cur.sent_at = ts;
        break;
      case "delivered":
        cur.delivered = true;
        break;
      case "opened":
        if (cur.opened_at === null || ts < cur.opened_at) cur.opened_at = ts;
        break;
      case "clicked":
        if (cur.clicked_at === null || ts < cur.clicked_at) cur.clicked_at = ts;
        break;
    }
  }

  // Attribution: earliest paid per email
  const purchases = await fetchShopifyPurchases(start, end);
  const earliestPaid = new Map<string, number>();
  for (const p of purchases) {
    const prev = earliestPaid.get(p.email);
    if (prev === undefined || p.paidAt < prev) earliestPaid.set(p.email, p.paidAt);
  }

  const all = Array.from(byEmail.values())
    // sort: clicked first, then opened, then delivered-only, then sent-only
    .sort((a, b) => {
      const score = (r: State) =>
        (r.clicked_at ? 3 : 0) +
        (r.opened_at ? 2 : 0) +
        (r.delivered ? 1 : 0);
      return score(b) - score(a);
    });

  const truncated = all.length > 500;
  const top = all.slice(0, 500).map((r) => {
    let purchased_at: string | null = null;
    if (r.sent_at !== null) {
      const paid = earliestPaid.get(r.email);
      if (paid !== undefined && paid >= r.sent_at && paid - r.sent_at <= ATTRIBUTION_WINDOW_MS) {
        purchased_at = new Date(paid).toISOString();
      }
    }
    return {
      email: r.email,
      sent_at: r.sent_at ? new Date(r.sent_at).toISOString() : null,
      delivered: r.delivered,
      opened_at: r.opened_at ? new Date(r.opened_at).toISOString() : null,
      clicked_at: r.clicked_at ? new Date(r.clicked_at).toISOString() : null,
      purchased_at,
    };
  });

  // Render the template for this step so the UI can show what was sent.
  let template: { subject: string; text: string; links: string[]; delayDays: number | null } | null = null;
  const tplsForFlow = TEMPLATES[flow as EmailFlow];
  const stepCfgs = FLOW_STEPS[flow as EmailFlow];
  if (tplsForFlow && tplsForFlow[step]) {
    const rendered = tplsForFlow[step](null); // null name — shows the {{firstName}} fallback path
    template = {
      subject: rendered.subject,
      text: rendered.text,
      links: extractLinks(rendered.text),
      delayDays: stepCfgs?.[step]?.delayDays ?? null,
    };
  }

  return NextResponse.json({
    flow,
    step,
    total: all.length,
    recipients: top,
    template,
    truncated,
  });
}
