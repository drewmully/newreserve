/**
 * GET /api/gifts/scheduled-send
 *
 * Cron route (runs hourly via vercel.json). Sends the recipient announcement
 * email for any gift_orders that are due — either:
 *   - deliver_on is null (send immediately)
 *   - deliver_on <= today (UTC)
 *
 * Auth: protected by Vercel's CRON_SECRET. Vercel automatically adds
 * `Authorization: Bearer <CRON_SECRET>` to cron requests, and we also accept
 * the secret via `?key=` for manual testing.
 *
 * Idempotency: a gift order only moves to "recipient_emailed" after the email
 * is sent successfully, so re-runs are safe.
 */

import { NextRequest, NextResponse } from "next/server";
import { sendPlainText } from "@/lib/email/resend";
import {
  buildGiftRecipientSubject,
  buildGiftRecipientText,
  buildGiftSelfDeliverSubject,
  buildGiftSelfDeliverText,
} from "@/lib/email/templates/giftRecipient";
import {
  getDueGiftOrders,
  getGiftOrderById,
  updateGiftOrderStatus,
} from "@/lib/gifts/giftOrder";
import {
  captureGiftSeasonEvent,
  giftEventProps,
  mirrorGiftSeasonToSupabase,
} from "@/lib/gifts/giftSeasonServer";

function isAuthorized(request: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;

  const header = request.headers.get("authorization");
  if (header === `Bearer ${secret}`) return true;

  const query = request.nextUrl.searchParams.get("key");
  return query === secret;
}

function siteOrigin(request: NextRequest): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    request.nextUrl.origin ??
    "https://mymully.com"
  );
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Date.now();
  const due = await getDueGiftOrders(now);
  const results: Array<{
    id: string;
    recipient: string;
    ok: boolean;
    error?: string;
  }> = [];

  for (const { id, data } of due) {
    const sizingUrl = `${siteOrigin(request)}/gift-sizing/${data.sizing_token}`;
    try {
      // "I'll give it myself": the reveal + printable card go to the gifter.
      const selfDeliver = data.gift_kind === "season" && !!data.self_deliver;
      const to = selfDeliver ? data.purchaser_email : data.recipient_email;
      if (!to) throw new Error("gift has no delivery email");
      const giftCardUrl = `${siteOrigin(request)}/gift-card/${data.sizing_token}`;
      await sendPlainText(
        selfDeliver
          ? {
              to,
              subject: buildGiftSelfDeliverSubject({
                purchaserFirstName: data.purchaser_first_name,
                recipientFirstName: data.recipient_first_name,
                seasonsTotal: data.seasons_total ?? 1,
                sizingUrl,
                giftCardUrl,
              }),
              text: buildGiftSelfDeliverText({
                purchaserFirstName: data.purchaser_first_name,
                recipientFirstName: data.recipient_first_name,
                seasonsTotal: data.seasons_total ?? 1,
                sizingUrl,
                giftCardUrl,
              }),
              idempotencyKey: `gift-recipient:${id}`,
              sendClass: "transactional",
              category: "gift_self_deliver_card",
              tags: [
                { name: "category", value: "gift_self_deliver_card" },
                { name: "gift_order_id", value: id },
              ],
            }
          : {
              to,
              subject: buildGiftRecipientSubject({
                purchaserFirstName: data.purchaser_first_name,
                seasonsTotal: data.gift_kind === "season" ? data.seasons_total : null,
              }),
              text: buildGiftRecipientText({
                recipientFirstName: data.recipient_first_name,
                purchaserFirstName: data.purchaser_first_name,
                purchaserEmail: data.purchaser_email,
                giftMessage: data.gift_message,
                sizingUrl,
                seasonsTotal: data.gift_kind === "season" ? data.seasons_total : null,
              }),
              idempotencyKey: `gift-recipient:${id}`,
              sendClass: "transactional",
              category: "gift_recipient_announcement",
              tags: [
                { name: "category", value: "gift_recipient_announcement" },
                { name: "gift_order_id", value: id },
              ],
            }
      );

      await updateGiftOrderStatus(
        id,
        "recipient_emailed",
        { recipient_emailed_at: Date.now() },
        selfDeliver ? `gift card sent to purchaser ${to}` : `recipient email sent to ${to}`
      );
      if (data.gift_kind === "season") {
        const fresh = await getGiftOrderById(id);
        await Promise.allSettled([
          fresh ? mirrorGiftSeasonToSupabase(id, fresh) : Promise.resolve(),
          captureGiftSeasonEvent("gift_season_recipient_notified", to, {
            ...giftEventProps(id, data),
            scheduled: !!data.deliver_on,
            self_deliver: selfDeliver,
          }),
        ]);
      }
      results.push({ id, recipient: to, ok: true });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error("[gifts/scheduled-send] failed for", id, msg);
      await updateGiftOrderStatus(
        id,
        "errored",
        { last_error: msg },
        "recipient send failed"
      );
      results.push({ id, recipient: data.recipient_email, ok: false, error: msg });
    }
  }

  return NextResponse.json({
    ok: true,
    checked: due.length,
    sent: results.filter((r) => r.ok).length,
    failed: results.filter((r) => !r.ok).length,
    results,
  });
}
