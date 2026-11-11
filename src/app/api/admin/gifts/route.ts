/**
 * GET /api/admin/gifts
 *
 * Returns the gift_orders collection for the admin dashboard.
 * Auth: Firebase Bearer token (admin email allowlist enforced server-side).
 *
 * Query params:
 *   status — optional gift status filter
 *   limit  — max results (default 100, max 500)
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import type { GiftOrderDoc } from "@/lib/gifts/giftOrder";
import { formatGiftAddress, needsNextAddress, seasonProgress } from "@/lib/gifts/giftSeason";

async function verifyAdmin(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

export async function GET(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    const status = msg === "Forbidden" ? 403 : 401;
    return NextResponse.json({ error: msg }, { status });
  }

  const params = request.nextUrl.searchParams;
  const statusFilter = params.get("status");
  const limit = Math.min(
    Math.max(parseInt(params.get("limit") ?? "100", 10), 1),
    500
  );

  let query = adminDb
    .collection("gift_orders")
    .orderBy("created_at", "desc") as FirebaseFirestore.Query;
  if (statusFilter) {
    query = adminDb
      .collection("gift_orders")
      .where("status", "==", statusFilter)
      .orderBy("created_at", "desc");
  }

  const snap = await query.limit(limit).get();
  const orders = snap.docs.map((d) => {
    const data = d.data() as GiftOrderDoc;
    const isSeason = data.gift_kind === "season";
    const progress = isSeason ? seasonProgress(data) : null;
    return {
      shopify_order_id: d.id,
      shopify_order_number: data.shopify_order_number,
      purchaser_email: data.purchaser_email,
      purchaser_first_name: data.purchaser_first_name,
      recipient_email: data.recipient_email,
      recipient_first_name: data.recipient_first_name,
      gift_message: data.gift_message,
      deliver_on: data.deliver_on,
      sizing_token: data.sizing_token,
      total_price: data.total_price,
      currency: data.currency,
      status: data.status,
      created_at: data.created_at,
      updated_at: data.updated_at,
      recipient_emailed_at: data.recipient_emailed_at,
      sizing_collected_at: data.sizing_collected_at,
      first_box_shipped_at: data.first_box_shipped_at,
      completed_at: data.completed_at,
      sizing: data.sizing,
      loop_subscription_id: data.loop_subscription_id,
      last_error: data.last_error,
      // Gift a Season: prepaid count and per-box orders for ops.
      gift_kind: data.gift_kind ?? "subscription",
      seasons_total: progress?.seasonsTotal ?? null,
      boxes_dispatched: progress?.boxesDispatched ?? null,
      boxes_shipped: progress?.boxesShipped ?? null,
      boxes_remaining: progress?.boxesRemaining ?? null,
      next_box_number: progress?.nextBoxNumber ?? null,
      next_box_due_on: progress?.nextBoxDueOn ?? null,
      box_orders: isSeason ? data.box_orders ?? [] : [],
      continue_offer_sent_at: data.continue_offer_sent_at ?? null,
      converted_at: data.converted_at ?? null,
      converted_order_id: data.converted_order_id ?? null,
      ship_mode: data.ship_mode ?? null,
      address_needed: isSeason ? needsNextAddress(data) : false,
      next_address_line: isSeason ? formatGiftAddress(data.next_shipping_address) || null : null,
      address_source: data.address_source ?? null,
      address_request_sent_at: data.address_request_sent_at ?? null,
      address_reminder_sent_at: data.address_reminder_sent_at ?? null,
      gifter_confirmation_sent_at: data.gifter_confirmation_sent_at ?? null,
    };
  });

  return NextResponse.json({ orders, count: orders.length });
}
