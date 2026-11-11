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
import { adminDb } from "@/lib/firebase-admin";
import {
  getGiftOrderById,
  getSeasonGiftByBoxOrderId,
  updateGiftOrderStatus,
  type GiftOrderDoc,
} from "@/lib/gifts/giftOrder";
import { seasonProgress } from "@/lib/gifts/giftSeason";
import {
  captureGiftSeasonEvent,
  giftEventProps,
  mirrorGiftSeasonToSupabase,
} from "@/lib/gifts/giftSeasonServer";
import { verifyShopifyHmac } from "@/lib/events/verify";
import { mirrorLegacyShopifyDelivery } from "@/lib/events/ingest";

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

  if (!verifyShopifyHmac(request.headers, rawBody)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  await mirrorLegacyShopifyDelivery(request.headers, rawBody, "fulfillments/create");

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
    // Gift a Season: box 1 is the paid order, boxes 2..N are $0 child
    // orders. Either one shipping counts down the prepaid balance.
    const season = await getSeasonGiftByBoxOrderId(orderId);
    if (season?.data.gift_kind === "season") {
      const result = await recordSeasonBoxShipped(season.id, season.data, orderId, body);
      return NextResponse.json({ ok: true, gift_season: result });
    }

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

/**
 * Mark one prepaid box shipped. Idempotent per box order: a second
 * fulfillment on the same order (split shipment) does not count twice.
 */
async function recordSeasonBoxShipped(
  giftId: string,
  gift: GiftOrderDoc,
  boxOrderId: string,
  body: FulfillmentBody
): Promise<string> {
  const boxes = gift.box_orders ?? [];
  const box = boxes.find((b) => b.shopify_order_id === boxOrderId);
  if (!box) return "box_not_found";
  if (box.shipped_at) return "already_counted";

  const now = Date.now();
  const nextBoxes = boxes.map((b) =>
    b.shopify_order_id === boxOrderId
      ? { ...b, shipped_at: now, fulfillment_id: String(body.id) }
      : b
  );
  const firstShippedAt = gift.first_box_shipped_at ?? (box.box_number === 1 ? now : null);
  const progress = seasonProgress({
    seasons_total: gift.seasons_total,
    box_orders: nextBoxes,
    first_box_shipped_at: firstShippedAt,
  });
  const done = progress.boxesRemaining === 0;
  const updates: Partial<GiftOrderDoc> = {
    box_orders: nextBoxes,
    boxes_shipped: progress.boxesShipped,
    boxes_remaining: progress.boxesRemaining,
    next_box_due_on: progress.nextBoxDueOn,
    first_box_shipped_at: firstShippedAt,
    ...(done ? { completed_at: now } : {}),
  };
  await updateGiftOrderStatus(
    giftId,
    done ? "completed" : "season_active",
    updates,
    `box ${box.box_number} of ${progress.seasonsTotal} shipped (fulfillment ${body.id}, ${body.tracking_number ?? "no tracking"})`
  );
  const merged = { ...gift, ...updates, status: done ? "completed" : "season_active" } as GiftOrderDoc;
  await Promise.allSettled([
    mirrorGiftSeasonToSupabase(giftId, merged),
    captureGiftSeasonEvent("gift_season_box_shipped", gift.recipient_email, {
      ...giftEventProps(giftId, merged),
      box_number: box.box_number,
      box_order_id: boxOrderId,
    }),
    done
      ? captureGiftSeasonEvent("gift_season_completed", gift.recipient_email, giftEventProps(giftId, merged))
      : Promise.resolve(),
  ]);
  console.log(
    `[fulfillments-create] gift season ${giftId}: box ${box.box_number} shipped, ${progress.boxesRemaining} remaining`
  );
  return done ? "completed" : "counted";
}
