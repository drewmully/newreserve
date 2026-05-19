/**
 * POST /api/webhooks/shopify/fulfillments-create
 *
 * Shopify webhook: fulfillments/create. Used by the gifting Phase 2 pipeline
 * to detect that the first gift box has shipped. If the originating order is
 * a gift, we flip the gift_orders doc to "first_box_shipped" and the
 * post-first-shipment cron picks it up to cancel the Loop subscription.
 *
 * Required env vars:
 *   SHOPIFY_WEBHOOK_SECRET — secret set on the webhook in Shopify admin
 *
 * Setup in Shopify admin:
 *   Settings → Notifications → Webhooks → Create webhook
 *     Event: Fulfillment creation
 *     Format: JSON
 *     URL: https://mymully.com/api/webhooks/shopify/fulfillments-create
 *
 * Shopify retries non-2xx responses for up to 48h, so we return 200 even on
 * non-gift orders.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebase-admin";
import {
  getGiftOrderById,
  updateGiftOrderStatus,
} from "@/lib/gifts/giftOrder";

async function verifyShopifyHmac(
  request: NextRequest,
  rawBody: string
): Promise<boolean> {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return false;

  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  if (!hmacHeader) return false;

  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, "base64"),
      Buffer.from(hmacHeader, "base64")
    );
  } catch {
    return false;
  }
}

async function isDuplicateWebhook(request: NextRequest): Promise<boolean> {
  const webhookId = request.headers.get("x-shopify-webhook-id");
  if (!webhookId) return false;

  const dedupeKey = `shopify-fulfillments-create:${webhookId}`;
  const ref = adminDb.collection("webhook_receipts").doc(dedupeKey);

  try {
    const existing = await ref.get();
    if (existing.exists) return true;
    await ref.set({
      webhook_id: webhookId,
      topic: "fulfillments/create",
      provider: "shopify",
      received_at: Date.now(),
    });
  } catch (err) {
    console.error("[fulfillments-create] dedupe check failed:", err);
  }
  return false;
}

interface FulfillmentBody {
  id: number;
  order_id: number;
  status: string;
  tracking_number?: string | null;
  tracking_url?: string | null;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!(await verifyShopifyHmac(request, rawBody))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (await isDuplicateWebhook(request)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  let body: FulfillmentBody;
  try {
    body = JSON.parse(rawBody) as FulfillmentBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const orderId = String(body.order_id);
  try {
    const gift = await getGiftOrderById(orderId);
    if (!gift) {
      // Not a gift order — fine, just acknowledge.
      return NextResponse.json({ ok: true, gift: false });
    }

    // Only flip if we haven't already shipped this gift.
    if (
      gift.status === "first_box_shipped" ||
      gift.status === "completed"
    ) {
      return NextResponse.json({ ok: true, alreadyShipped: true });
    }

    await updateGiftOrderStatus(
      orderId,
      "first_box_shipped",
      {
        first_box_shipped_at: Date.now(),
      },
      `Shopify fulfillment ${body.id} created (${body.tracking_number ?? "no tracking"})`
    );
    console.log(
      `[fulfillments-create] gift ${orderId} → first_box_shipped (Loop cancel queued)`
    );
  } catch (err) {
    console.error("[fulfillments-create] gift update failed:", err);
  }

  return NextResponse.json({ ok: true });
}
