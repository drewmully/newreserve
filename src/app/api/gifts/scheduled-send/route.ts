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
} from "@/lib/email/templates/giftRecipient";
import {
  getDueGiftOrders,
  updateGiftOrderStatus,
} from "@/lib/gifts/giftOrder";

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
      await sendPlainText({
        to: data.recipient_email,
        subject: buildGiftRecipientSubject({
          purchaserFirstName: data.purchaser_first_name,
        }),
        text: buildGiftRecipientText({
          recipientFirstName: data.recipient_first_name,
          purchaserFirstName: data.purchaser_first_name,
          purchaserEmail: data.purchaser_email,
          giftMessage: data.gift_message,
          sizingUrl,
        }),
        idempotencyKey: `gift-recipient:${id}`,
        sendClass: "transactional",
        category: "gift_recipient_announcement",
        tags: [
          { name: "category", value: "gift_recipient_announcement" },
          { name: "gift_order_id", value: id },
        ],
      });

      await updateGiftOrderStatus(
        id,
        "recipient_emailed",
        { recipient_emailed_at: Date.now() },
        `recipient email sent to ${data.recipient_email}`
      );
      results.push({ id, recipient: data.recipient_email, ok: true });
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
