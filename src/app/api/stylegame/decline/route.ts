/**
 * POST /api/stylegame/decline
 *
 * Phase 4 endpoint. Stylist declines a Style Game customer's follow-through
 * — either the customer replied "no thanks" or the review is unresolvable.
 * Cancels the customer's Loop subscription so cycle 2 never bills, and
 * emails the customer a short confirming note. They keep the $5 review;
 * no further charge.
 *
 * Auth (either):
 *   Authorization: Bearer <REPORTING_API_KEY>
 *   ?api_key=<REPORTING_API_KEY>
 *
 * Body:
 *   {
 *     "lead_id": "uuid",
 *     "reason": "optional short string, stored on the row"
 *   }
 *
 * Preconditions:
 *   - lead exists
 *   - status is 'paid' or 'played' (idempotent re-runs on 'declined' allowed)
 *   - loop_subscription_id is set IF status is 'paid'; if the customer
 *     bailed before paying we just mark declined and skip Loop
 *   - customer_email is set (soft — we skip the email if not)
 *
 * On success:
 *   - stylegame_lead row → status='declined', stylist_notes=<reason>
 *   - Loop subscription cancelled with reason (only if loop_subscription_id
 *     is set)
 *   - Customer email sent via Resend if customer_email present
 *
 * Fails loudly on Loop errors after status is already 'paid'. If the Loop
 * cancel fails, DB is still written to 'declined' so the stylist has a
 * record — you'll need to hand-cancel from the Loop merchant console.
 */

import { NextRequest, NextResponse } from "next/server";
import { getLeadById, markLeadDeclined } from "@/lib/stylegame/lead";
import { cancelLoopSubscription } from "@/app/api/_lib/loopAdmin";
import { sendPlainText } from "@/lib/email/resend";

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

  let body: { lead_id?: string; reason?: string | null };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { ok: false, error: "invalid json" },
      { status: 400 },
    );
  }

  const leadId = body.lead_id?.trim();
  const reason = typeof body.reason === "string" ? body.reason.trim() : null;

  if (!leadId) {
    return NextResponse.json(
      { ok: false, error: "lead_id required" },
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
  if (status !== "paid" && status !== "played" && status !== "declined") {
    return NextResponse.json(
      {
        ok: false,
        error: `lead status is '${status}'; cannot decline from this state`,
      },
      { status: 409 },
    );
  }

  const loopSubscriptionId = lead.loop_subscription_id as string | null;
  const customerEmail = (lead.customer_email as string | null)?.trim() ?? null;

  // ── Cancel Loop subscription (only if one exists) ─────────────────────────
  // Do this BEFORE DB write so we don't mark declined and then leave a live
  // subscription behind. On a re-run (status already 'declined') skip.
  if (loopSubscriptionId && status !== "declined") {
    await cancelLoopSubscription(
      loopSubscriptionId,
      reason || "Style Game — customer declined follow-through",
    );
  }

  // ── Persist decline on the row ────────────────────────────────────────────
  await markLeadDeclined({ leadId, reason });

  // ── Notify the customer (best effort) ─────────────────────────────────────
  if (customerEmail) {
    const emailBody = [
      `Thanks — we've closed out your Style Game review. No further charge, and your $5 covered the stylist's work.`,
      ``,
      `If you'd like to try again with a different profile down the road, the game lives at https://www.mymully.com/lp/stylegame.`,
      ``,
      `— Mully`,
    ].join("\n");

    try {
      await sendPlainText({
        to: customerEmail,
        subject: "Your Style Game review is closed",
        text: emailBody,
        idempotencyKey: `stylegame_decline_${leadId}`,
        dedupeKey: `stylegame_decline_${leadId}`,
        sendClass: "transactional",
        flow: "stylegame",
        category: "decline",
        tags: [
          { name: "flow", value: "stylegame" },
          { name: "category", value: "decline" },
        ],
      });
    } catch (err) {
      // Email failure should NOT block the decline. Log and move on.
      console.error("[stylegame/decline] email send failed", {
        leadId,
        err: (err as Error)?.message,
      });
    }
  }

  return NextResponse.json({
    ok: true,
    lead_id: leadId,
    status: "declined",
    loop_cancelled: !!loopSubscriptionId,
    emailed: !!customerEmail,
  });
}

export function GET() {
  return NextResponse.json({ ok: false, error: "method not allowed" }, { status: 405 });
}
