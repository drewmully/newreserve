/**
 * GET /api/gifts/post-first-shipment
 *
 * Cron route (hourly). Picks up gift_orders in status "first_box_shipped"
 * and:
 *   1. Cancels the Loop subscription on the purchaser's Shopify customer so
 *      they're never auto-rebilled for Q2 of the gift.
 *   2. Sends a "your first box is on its way" follow-up to the recipient
 *      with a soft pitch to keep the subscription going.
 *   3. Flips status to "completed".
 *
 * Auth: CRON_SECRET (same as the scheduled-send cron).
 */

import { NextRequest, NextResponse } from "next/server";
import { sendPlainText } from "@/lib/email/resend";
import {
  cancelLoopSubscription,
  getLoopRawSubscriptions,
} from "@/app/api/_lib/loopAdmin";
import {
  getGiftOrdersAwaitingCancel,
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

async function findActiveLoopSubId(
  shopifyCustomerId: string | null
): Promise<string | null> {
  if (!shopifyCustomerId) return null;
  try {
    const subs = await getLoopRawSubscriptions(shopifyCustomerId);
    const active = subs.find((s) => s.status === "ACTIVE");
    return active?.id ? String(active.id) : null;
  } catch (err) {
    console.error(
      "[gifts/post-first-shipment] Loop lookup failed for customer",
      shopifyCustomerId,
      err
    );
    return null;
  }
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const orders = await getGiftOrdersAwaitingCancel();
  const results: Array<{
    id: string;
    cancelled: boolean;
    emailed: boolean;
    error?: string;
  }> = [];

  for (const { id, data } of orders) {
    let cancelled = false;
    let emailed = false;
    let error: string | undefined;
    let loopSubId: string | null = null;

    try {
      // 1. Cancel the Loop subscription so they're never auto-rebilled.
      loopSubId = await findActiveLoopSubId(data.shopify_customer_id);
      if (loopSubId) {
        await cancelLoopSubscription(
          loopSubId,
          "Gift subscription — auto-cancelled after first box shipped"
        );
        cancelled = true;
      } else {
        console.warn(
          `[gifts/post-first-shipment] no active Loop sub for gift ${id} — proceeding without cancel`
        );
      }

      // 2. Recipient follow-up email.
      const recipient = data.recipient_first_name?.trim() ?? "there";
      const fromName =
        data.purchaser_first_name?.trim() ||
        data.purchaser_email ||
        "your gifter";
      await sendPlainText({
        to: data.recipient_email,
        subject: "Your first Mully Reserve box is on its way",
        text: [
          `Hey ${recipient},`,
          "",
          `Your first Mully Reserve box just shipped. You should have tracking in your inbox from our fulfillment partner shortly.`,
          "",
          `A few things to know:`,
          ` • Wrong fit on anything? We swap it free, no questions, no shipping fee. Just reply to this email.`,
          ` • Your gift subscription is now cancelled — you won't be charged again unless you decide to stay on.`,
          ` • Want to keep getting boxes? Reactivate in one click from your account: https://mymully.com/account`,
          "",
          `Hope ${fromName} hit the mark.`,
          "",
          `Drew · Founder, Mully`,
        ].join("\n"),
        idempotencyKey: `gift-postship:${id}`,
        sendClass: "transactional",
        category: "gift_post_first_shipment",
        tags: [
          { name: "category", value: "gift_post_first_shipment" },
          { name: "gift_order_id", value: id },
        ],
      });
      emailed = true;

      // 3. Mark completed.
      await updateGiftOrderStatus(
        id,
        "completed",
        {
          loop_subscription_id: loopSubId,
          cancellation_attempted_at: Date.now(),
          completed_at: Date.now(),
        },
        cancelled
          ? "Loop cancelled + follow-up email sent"
          : "follow-up sent (no active Loop sub to cancel)"
      );
    } catch (err) {
      error = err instanceof Error ? err.message : String(err);
      console.error("[gifts/post-first-shipment] failed for", id, error);
      await updateGiftOrderStatus(
        id,
        "errored",
        {
          loop_subscription_id: loopSubId,
          cancellation_attempted_at: Date.now(),
          last_error: error,
        },
        "post-first-shipment processing failed"
      );
    }

    results.push({ id, cancelled, emailed, error });
  }

  return NextResponse.json({
    ok: true,
    checked: orders.length,
    completed: results.filter((r) => !r.error).length,
    failed: results.filter((r) => r.error).length,
    results,
  });
}
