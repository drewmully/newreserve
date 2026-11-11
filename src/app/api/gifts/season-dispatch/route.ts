/**
 * GET /api/gifts/season-dispatch
 *
 * Gift a Season cron (daily). For every prepaid season gift:
 *   1. If the next box is due (every 3 months after box 1 shipped, previous
 *      box shipped, boxes remaining), create the $0 Shopify box order so it
 *      lands in the normal fulfillment queue.
 *   2. If the final box is on its way and the continue offer has not gone
 *      out, email the recipient the offer to continue as a Reserve Member.
 *      Emails only send when GIFT_SEASON_OFFER_EMAILS_ENABLED === "true".
 *
 * Auth: CRON_SECRET (Bearer header from Vercel cron, or ?key= for manual).
 * Dry run: ?dry=1 reports what would happen without writing anything.
 */

import { NextRequest, NextResponse } from "next/server";
import { sendPlainText } from "@/lib/email/resend";
import {
  buildGiftContinueSubject,
  buildGiftContinueText,
} from "@/lib/email/templates/giftRecipient";
import {
  getGiftOrderById,
  getSeasonGiftsInFlight,
  patchGiftOrder,
  type GiftOrderDoc,
} from "@/lib/gifts/giftOrder";
import {
  isContinueOfferDue,
  isNextBoxDue,
  seasonProgress,
} from "@/lib/gifts/giftSeason";
import {
  captureGiftSeasonEvent,
  createSeasonBoxOrder,
  giftEventProps,
  mirrorGiftSeasonToSupabase,
} from "@/lib/gifts/giftSeasonServer";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (request.headers.get("authorization") === `Bearer ${secret}`) return true;
  return request.nextUrl.searchParams.get("key") === secret;
}

function siteOrigin(request: NextRequest): string {
  return process.env.NEXT_PUBLIC_SITE_URL ?? request.nextUrl.origin ?? "https://mymully.com";
}

type Result = {
  id: string;
  action: "box_created" | "box_reused" | "offer_sent" | "offer_skipped" | "would_create_box" | "would_send_offer";
  box_number?: number;
  order?: string;
  error?: string;
};

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const dry = request.nextUrl.searchParams.get("dry") === "1";
  const offersEnabled = process.env.GIFT_SEASON_OFFER_EMAILS_ENABLED === "true";
  const now = Date.now();
  const gifts = await getSeasonGiftsInFlight();
  const results: Result[] = [];

  for (const { id, data: initial } of gifts) {
    let data: GiftOrderDoc = initial;

    // 1. Next prepaid box.
    if (isNextBoxDue(data, now)) {
      const p = seasonProgress(data);
      const boxNumber = p.nextBoxNumber!;
      if (dry) {
        results.push({ id, action: "would_create_box", box_number: boxNumber });
      } else {
        try {
          const order = await createSeasonBoxOrder(id, data, boxNumber);
          const box_orders = [
            ...(data.box_orders ?? []),
            {
              box_number: boxNumber,
              shopify_order_id: order.id,
              shopify_order_name: order.name,
              created_at: Date.now(),
              due_on: p.nextBoxDueOn,
              shipped_at: null,
              fulfillment_id: null,
            },
          ];
          const after = seasonProgress({ ...data, box_orders });
          const patch: Partial<GiftOrderDoc> = {
            box_orders,
            box_order_ids: box_orders.map((b) => b.shopify_order_id),
            boxes_remaining: after.boxesRemaining,
            next_box_due_on: after.nextBoxDueOn,
            last_error: null,
          };
          await patchGiftOrder(id, patch);
          data = { ...data, ...patch };
          await Promise.allSettled([
            mirrorGiftSeasonToSupabase(id, data),
            captureGiftSeasonEvent("gift_season_box_dispatched", data.recipient_email, {
              ...giftEventProps(id, data),
              box_number: boxNumber,
              box_order_id: order.id,
              reused: order.reused,
            }),
          ]);
          results.push({
            id,
            action: order.reused ? "box_reused" : "box_created",
            box_number: boxNumber,
            order: order.name,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[gifts/season-dispatch] box create failed", id, msg);
          await patchGiftOrder(id, { last_error: `box ${boxNumber}: ${msg}` });
          await captureGiftSeasonEvent("gift_season_error", data.recipient_email, {
            ...giftEventProps(id, data),
            stage: "box_dispatch",
            box_number: boxNumber,
            error: msg.slice(0, 300),
          });
          results.push({ id, action: "box_created", box_number: boxNumber, error: msg });
          continue;
        }
      }
    }

    // 2. Continue-as-member offer, once, when the final box is on its way.
    if (isContinueOfferDue(data)) {
      if (dry) {
        results.push({ id, action: "would_send_offer" });
        continue;
      }
      if (!offersEnabled) {
        results.push({ id, action: "offer_skipped" });
        continue;
      }
      try {
        const fresh = (await getGiftOrderById(id)) ?? data;
        if (fresh.continue_offer_sent_at || fresh.converted_at) continue;
        const continueUrl = `${siteOrigin(request)}/gift-continue/${fresh.sizing_token}?utm_source=gift_season&utm_medium=email&utm_campaign=continue_offer`;
        await sendPlainText({
          to: fresh.recipient_email,
          subject: buildGiftContinueSubject({
            recipientFirstName: fresh.recipient_first_name,
            purchaserFirstName: fresh.purchaser_first_name,
            seasonsTotal: fresh.seasons_total ?? 1,
            continueUrl,
          }),
          text: buildGiftContinueText({
            recipientFirstName: fresh.recipient_first_name,
            purchaserFirstName: fresh.purchaser_first_name,
            seasonsTotal: fresh.seasons_total ?? 1,
            continueUrl,
          }),
          idempotencyKey: `gift-season-continue:${id}`,
          sendClass: "transactional",
          category: "gift_season_continue_offer",
          tags: [
            { name: "category", value: "gift_season_continue_offer" },
            { name: "gift_order_id", value: id },
          ],
        });
        const continue_offer_sent_at = Date.now();
        await patchGiftOrder(id, { continue_offer_sent_at });
        data = { ...fresh, continue_offer_sent_at };
        await Promise.allSettled([
          mirrorGiftSeasonToSupabase(id, data),
          captureGiftSeasonEvent("gift_season_continue_offer_sent", data.recipient_email, giftEventProps(id, data)),
        ]);
        results.push({ id, action: "offer_sent" });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[gifts/season-dispatch] offer failed", id, msg);
        await patchGiftOrder(id, { last_error: `continue offer: ${msg}` });
        results.push({ id, action: "offer_sent", error: msg });
      }
    }
  }

  return NextResponse.json({
    ok: true,
    dry,
    offers_enabled: offersEnabled,
    checked: gifts.length,
    results,
  });
}
