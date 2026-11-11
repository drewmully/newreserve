/**
 * GET /api/gifts/season-dispatch
 *
 * Gift a Season cron (daily). For every prepaid season gift:
 *   1. Next-season address emails (pure schedule in addressEmailDue):
 *      ship-to-me address request 14 days after season 1 ships (recipient,
 *      or purchaser when no recipient email), purchaser fallback after 7
 *      days without a response, purchaser reminder 14 days before season 2
 *      if still missing. Links go to /gift-address/[token].
 *   2. If the next season is due (every 3 months after season 1 shipped,
 *      previous one shipped, seasons remaining), create the $0 Shopify order
 *      so it lands in the normal fulfillment queue. Blocked until a valid
 *      next-season address exists (logged once as gift_season_address_blocked
 *      and shown as "Address needed" in /admin/gifts).
 *   3. Season notice before each season 2..N, with the update link.
 *   4. If the final season is on its way and the continue offer has not gone
 *      out, email the recipient the offer to continue as a Reserve Member.
 *
 * Emails: address + notice emails send only when
 * GIFT_SEASON_ADDRESS_EMAILS_ENABLED === "true"; the continue offer only when
 * GIFT_SEASON_OFFER_EMAILS_ENABLED === "true". Both default off. Skipped
 * sends change no state, so turning a flag on later still sends them.
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
  addressEmailDue,
  formatGiftAddress,
  isContinueOfferDue,
  isNextBoxDue,
  isValidGiftAddress,
  seasonNoticeDue,
  seasonProgress,
  boxDueOn,
} from "@/lib/gifts/giftSeason";
import {
  buildAddressReminderSubject,
  buildAddressReminderText,
  buildAddressRequestPurchaserSubject,
  buildAddressRequestPurchaserText,
  buildAddressRequestRecipientSubject,
  buildAddressRequestRecipientText,
  buildSeasonNoticeSubject,
  buildSeasonNoticeText,
} from "@/lib/email/templates/giftSeasonEmails";
import {
  captureGiftSeasonEvent,
  createSeasonBoxOrder,
  giftEventProps,
  mirrorGiftSeasonToSupabase,
} from "@/lib/gifts/giftSeasonServer";
import { missingOptionalSizing, sanitizeSizing } from "@/lib/gifts/giftSizing";

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
  action:
    | "box_created" | "box_reused" | "offer_sent" | "offer_skipped" | "would_create_box" | "would_send_offer"
    | "offer_skipped_no_email"
    | "blocked_address_needed"
    | "address_request_sent" | "address_fallback_sent" | "address_reminder_sent"
    | "would_send_address_request" | "would_send_address_fallback" | "would_send_address_reminder"
    | "address_email_skipped"
    | "notice_sent" | "would_send_notice" | "notice_skipped";
  target?: string;
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
  const addressEmailsEnabled = process.env.GIFT_SEASON_ADDRESS_EMAILS_ENABLED === "true";
  const origin = siteOrigin(request);
  const linkFor = (token: string, who: "recipient" | "purchaser", campaign: string) =>
    `${origin}/gift-address/${token}?${who === "purchaser" ? "by=p&" : ""}utm_source=gift_season&utm_medium=email&utm_campaign=${campaign}`;
  const now = Date.now();
  const gifts = await getSeasonGiftsInFlight();
  const results: Result[] = [];

  for (const { id, data: initial } of gifts) {
    let data: GiftOrderDoc = initial;

    // 1. Next-season address emails.
    const addrAction = addressEmailDue(data, now);
    if (addrAction) {
      const kind = addrAction.kind;
      const target =
        addrAction.kind === "request" ? addrAction.target : "purchaser";
      const to = target === "recipient" ? data.recipient_email : data.purchaser_email;
      const would =
        kind === "request" ? "would_send_address_request" : kind === "fallback" ? "would_send_address_fallback" : "would_send_address_reminder";
      if (dry) {
        results.push({ id, action: would, target });
      } else if (!addressEmailsEnabled || !to) {
        results.push({ id, action: "address_email_skipped", target: `${kind}:${target}` });
      } else {
        try {
          const args = {
            recipientFirstName: data.recipient_first_name,
            purchaserFirstName: data.purchaser_first_name,
            seasonsTotal: data.seasons_total ?? 1,
            nextDueOn: boxDueOn(data.first_box_shipped_at, 2),
            addressUrl: linkFor(data.sizing_token, target, `address_${kind}`),
          };
          const mail =
            kind === "reminder"
              ? { subject: buildAddressReminderSubject(args), text: buildAddressReminderText(args) }
              : target === "recipient"
                ? { subject: buildAddressRequestRecipientSubject(), text: buildAddressRequestRecipientText(args) }
                : {
                    subject: buildAddressRequestPurchaserSubject(args),
                    text: buildAddressRequestPurchaserText({ ...args, fallback: kind === "fallback" }),
                  };
          await sendPlainText({
            to,
            ...mail,
            idempotencyKey: `gift-season-address-${kind}:${id}`,
            sendClass: "transactional",
            category: `gift_season_address_${kind}`,
            tags: [
              { name: "category", value: `gift_season_address_${kind}` },
              { name: "gift_order_id", value: id },
            ],
          });
          const at = Date.now();
          const patch: Partial<GiftOrderDoc> =
            kind === "request"
              ? { address_request_sent_at: at, address_request_target: target }
              : kind === "fallback"
                ? { address_fallback_sent_at: at }
                : { address_reminder_sent_at: at };
          await patchGiftOrder(id, patch);
          data = { ...data, ...patch };
          await Promise.allSettled([
            mirrorGiftSeasonToSupabase(id, data),
            captureGiftSeasonEvent(
              kind === "reminder" ? "gift_season_address_reminder_sent" : "gift_season_address_requested",
              to,
              { ...giftEventProps(id, data), kind, target }
            ),
          ]);
          results.push({
            id,
            action: kind === "request" ? "address_request_sent" : kind === "fallback" ? "address_fallback_sent" : "address_reminder_sent",
            target,
          });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[gifts/season-dispatch] address email failed", id, msg);
          results.push({ id, action: "address_email_skipped", target: `${kind}:${target}`, error: msg });
        }
      }
    }

    // 2. Next prepaid season. Blocked until a valid address exists for
    // gifts with a ship mode (older docs fall back to the parent order).
    if (isNextBoxDue(data, now) && data.ship_mode && !isValidGiftAddress(data.next_shipping_address)) {
      const boxNumber = seasonProgress(data).nextBoxNumber!;
      results.push({ id, action: "blocked_address_needed", box_number: boxNumber });
      if (!dry && !data.last_error?.startsWith("address needed")) {
        const last_error = `address needed for season ${boxNumber}`;
        await patchGiftOrder(id, { last_error });
        data = { ...data, last_error };
        await Promise.allSettled([
          mirrorGiftSeasonToSupabase(id, data),
          captureGiftSeasonEvent("gift_season_address_blocked", data.recipient_email || data.purchaser_email, {
            ...giftEventProps(id, data),
            box_number: boxNumber,
            ship_mode: data.ship_mode,
          }),
        ]);
      }
    } else if (isNextBoxDue(data, now)) {
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

    // 3. Season notice with the update link, before each season 2..N.
    const noticeFor = seasonNoticeDue(data, now);
    if (noticeFor) {
      const toRecipient = !!data.recipient_email;
      const to = data.recipient_email || data.purchaser_email;
      const dueOn = seasonProgress(data).nextBoxDueOn!;
      if (dry) {
        results.push({ id, action: "would_send_notice", box_number: noticeFor });
      } else if (!addressEmailsEnabled || !to) {
        results.push({ id, action: "notice_skipped", box_number: noticeFor });
      } else {
        try {
          await sendPlainText({
            to,
            subject: buildSeasonNoticeSubject({ seasonNumber: noticeFor }),
            text: buildSeasonNoticeText({
              recipientFirstName: toRecipient ? data.recipient_first_name : data.purchaser_first_name,
              seasonNumber: noticeFor,
              seasonsTotal: data.seasons_total ?? 1,
              dueOn,
              shipToLine: formatGiftAddress(data.next_shipping_address),
              missingSizes: missingOptionalSizing(sanitizeSizing(data.sizing ?? {})),
              updateUrl: linkFor(data.sizing_token, toRecipient ? "recipient" : "purchaser", `season_${noticeFor}_notice`),
            }),
            idempotencyKey: `gift-season-notice:${id}:${noticeFor}`,
            sendClass: "transactional",
            category: "gift_season_notice",
            tags: [
              { name: "category", value: "gift_season_notice" },
              { name: "gift_order_id", value: id },
            ],
          });
          const season_notices_sent = [...(data.season_notices_sent ?? []), noticeFor];
          await patchGiftOrder(id, { season_notices_sent });
          data = { ...data, season_notices_sent };
          await captureGiftSeasonEvent("gift_season_notice_sent", to, {
            ...giftEventProps(id, data),
            box_number: noticeFor,
            to_recipient: toRecipient,
          });
          results.push({ id, action: "notice_sent", box_number: noticeFor });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          console.error("[gifts/season-dispatch] notice failed", id, msg);
          results.push({ id, action: "notice_skipped", box_number: noticeFor, error: msg });
        }
      }
    }

    // 4. Continue-as-member offer, once, when the final box is on its way.
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
        if (!fresh.recipient_email) {
          // Self-delivered gift where the recipient never added an email.
          results.push({ id, action: "offer_skipped_no_email" });
          continue;
        }
        const continueUrl = `${origin}/gift-continue/${fresh.sizing_token}?utm_source=gift_season&utm_medium=email&utm_campaign=continue_offer`;
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
    address_emails_enabled: addressEmailsEnabled,
    checked: gifts.length,
    results,
  });
}
