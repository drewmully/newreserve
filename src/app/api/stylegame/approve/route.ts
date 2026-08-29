/**
 * POST /api/stylegame/approve
 *
 * Phase 4 endpoint. Stylist approves a Style Game customer's picks after
 * the $5 review. Advances the customer's Loop subscription to bill cycle 2
 * ($250) imminently and emails the customer that their box is on the way.
 *
 * Auth (either):
 *   Authorization: Bearer <REPORTING_API_KEY>
 *   ?api_key=<REPORTING_API_KEY>
 *
 * Body:
 *   {
 *     "lead_id": "uuid",
 *     "picks": [{ "variant_id": "...", "title": "...", ... }, ...],
 *     "stylist_notes": "optional string"
 *   }
 *
 * Preconditions:
 *   - lead exists
 *   - status is 'paid' (idempotent re-runs on 'approved' are allowed and
 *     will only re-send the email if the customer email is present)
 *   - loop_subscription_id is set
 *   - customer_email is set
 *
 * On success:
 *   - stylegame_lead row → status='approved', approved_at=now,
 *     picks=<body>, stylist_notes=<body>, next_billing_date=now
 *   - Loop next-billing-date advanced to now (triggers cycle 2 = $250)
 *   - Customer email sent via Resend
 *
 * Fails loudly (per PR #109) on any config or Loop error. DB write happens
 * BEFORE the Loop mutation so we always retain the stylist's picks even if
 * Loop hiccups; the fix in that case is a manual Loop advance from the
 * merchant console.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getLeadById,
  markLeadApproved,
  type StylistPick,
} from "@/lib/stylegame/lead";
import { updateLoopSubscriptionNextBillingDate } from "@/app/api/_lib/loopAdmin";
import { sendPlainText } from "@/lib/email/resend";
import { captureStylegameEvent } from "@/lib/stylegame/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function assertAuth(req: NextRequest): boolean {
  const authHeader = req.headers.get("Authorization") ?? "";
  const bearerKey = authHeader.replace(/^Bearer\s+/i, "").trim();
  const queryKey = req.nextUrl.searchParams.get("api_key") ?? "";
  const providedKey = bearerKey || queryKey;
  const reportingKey = process.env.REPORTING_API_KEY;
  return !!reportingKey && providedKey === reportingKey;
}

export async function POST(req: NextRequest) {
  if (!assertAuth(req)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  let body: {
    lead_id?: string;
    picks?: StylistPick[];
    stylist_notes?: string | null;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json" },
      { status: 400 },
    );
  }

  const leadId = body.lead_id?.trim();
  const picks = Array.isArray(body.picks) ? body.picks : [];
  const stylistNotes =
    typeof body.stylist_notes === "string" ? body.stylist_notes : null;

  if (!leadId) {
    return NextResponse.json(
      { ok: false, error: "lead_id required" },
      { status: 400 },
    );
  }
  if (picks.length < 1) {
    return NextResponse.json(
      { ok: false, error: "picks must be a non-empty array" },
      { status: 400 },
    );
  }

  // ── Load and validate ─────────────────────────────────────────────────────
  const lead = await getLeadById(leadId);
  if (!lead) {
    return NextResponse.json(
      { ok: false, error: "lead not found" },
      { status: 404 },
    );
  }
  const status = lead.status as string;
  if (status !== "paid" && status !== "approved") {
    return NextResponse.json(
      {
        ok: false,
        error: `lead status is '${status}'; must be 'paid' to approve`,
      },
      { status: 409 },
    );
  }
  const loopSubscriptionId = lead.loop_subscription_id as string | null;
  if (!loopSubscriptionId) {
    return NextResponse.json(
      {
        ok: false,
        error:
          "lead has no loop_subscription_id — cannot advance next bill. Check the orders-paid webhook.",
      },
      { status: 409 },
    );
  }
  const customerEmail = (lead.customer_email as string | null)?.trim() ?? null;
  if (!customerEmail) {
    return NextResponse.json(
      { ok: false, error: "lead has no customer_email — cannot notify" },
      { status: 409 },
    );
  }

  // ── Advance Loop next-billing-date to now ─────────────────────────────────
  // "Now" = current wall clock in seconds. Loop reads epoch seconds.
  const nowEpoch = Math.floor(Date.now() / 1000);
  await updateLoopSubscriptionNextBillingDate(loopSubscriptionId, nowEpoch);

  // ── Persist approval on the row ───────────────────────────────────────────
  await markLeadApproved({
    leadId,
    picks,
    stylistNotes,
    nextBillingEpochSeconds: nowEpoch,
  });

  // ── Notify the customer ───────────────────────────────────────────────────
  // Simple, direct copy. This is transactional — someone just approved
  // their picks; no marketing gate.
  const profileName =
    (lead.profile_name as string | null) ??
    (lead.profile_key as string | null) ??
    "your Style Game profile";
  const orderName = (lead.shopify_order_name as string | null) ?? null;
  const picksSummary = picks
    .map((p, i) => {
      const bits = [p.title, p.size, p.color].filter(Boolean).join(" · ");
      return `  ${i + 1}. ${bits || p.sku || p.variant_id || "Pick"}`;
    })
    .join("\n");

  const emailBody = [
    `Good news — your Style Game picks are approved and your box is on the way.`,
    ``,
    `Style profile: ${profileName}`,
    orderName ? `Review order: ${orderName}` : null,
    ``,
    `Your stylist picked:`,
    picksSummary,
    stylistNotes ? `\nNotes from your stylist:\n${stylistNotes}` : null,
    ``,
    `You'll be charged $250 for the quarterly box shortly, and we'll email you a shipping confirmation the moment it leaves the warehouse. Free size exchanges once it arrives — just reply to this email.`,
    ``,
    `Thanks for playing the Style Game.`,
    `— Mully`,
  ]
    .filter(Boolean)
    .join("\n");

  await sendPlainText({
    to: customerEmail,
    subject: "Your Style Game picks are approved",
    text: emailBody,
    idempotencyKey: `stylegame_approve_${leadId}`,
    dedupeKey: `stylegame_approve_${leadId}`,
    sendClass: "transactional",
    flow: "stylegame",
    category: "approve",
    tags: [
      { name: "flow", value: "stylegame" },
      { name: "category", value: "approve" },
    ],
  });

  // Fire PostHog server-side event. Distinct id: shopify_customer_id if we
  // have it (it's set by the orders-paid webhook), otherwise anon.
  const distinctId =
    (lead.shopify_customer_id != null
      ? String(lead.shopify_customer_id)
      : (lead.mully_anon_id as string | null)) ?? null;
  await captureStylegameEvent("sg_approved", distinctId, {
    lead_id: leadId,
    profile_key: (lead.profile_key as string | null) ?? null,
    profile_name: (lead.profile_name as string | null) ?? null,
    picks_count: picks.length,
    shopify_order_name: (lead.shopify_order_name as string | null) ?? null,
    utm_source: (lead.utm_source as string | null) ?? null,
  });

  return NextResponse.json({
    ok: true,
    lead_id: leadId,
    status: "approved",
    next_billing_at: new Date(nowEpoch * 1000).toISOString(),
  });
}

export function GET() {
  return NextResponse.json({ ok: false, error: "method not allowed" }, { status: 405 });
}
