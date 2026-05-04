/**
 * GET /api/admin/cron/mulligan-to-member
 *
 * Cron job — runs every 6 hours via Vercel cron.
 * Picks up mulligan_submissions with reactivation_choice="member" and
 * status="pending_reactivation", then:
 *   1. Reactivates their cancelled Loop subscription
 *   2. Swaps the product to the Member variant ($250/quarter)
 *   3. Sets the next billing date to May 21, 2026
 *
 * Secured with CRON_SECRET (Vercel sends Authorization: Bearer <CRON_SECRET>).
 */

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { resolveCustomerByEmail } from "@/app/api/_lib/shopifyAdmin";
import {
  getLoopRawSubscriptions,
  reactivateLoopSubscription,
  swapLoopSubscriptionProduct,
  updateLoopSubscriptionNextBillingDate,
} from "@/app/api/_lib/loopAdmin";

const MEMBER_VARIANT_SHOPIFY_ID = 47601025122496;

// 2026-05-21 00:00:00 UTC
const MAY_21_2026_EPOCH = 1747785600;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type ResultRow = {
  email: string;
  action:
    | "processed"
    | "skipped_no_shopify_id"
    | "skipped_no_cancelled_sub"
    | "failed";
  error?: string;
};

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snap = await adminDb
    .collection("mulligan_submissions")
    .where("reactivation_choice", "==", "member")
    .where("status", "==", "pending_reactivation")
    .get();

  const results: ResultRow[] = [];

  for (const doc of snap.docs) {
    const { email } = doc.data() as { email: string };

    try {
      const shopifyCustomerId = await resolveCustomerByEmail(email);
      if (!shopifyCustomerId) {
        results.push({ email, action: "skipped_no_shopify_id" });
        continue;
      }

      const subs = await getLoopRawSubscriptions(shopifyCustomerId);
      const cancelledSub = subs.find((s) => s.status === "CANCELLED");

      if (!cancelledSub) {
        results.push({ email, action: "skipped_no_cancelled_sub" });
        continue;
      }

      await reactivateLoopSubscription(cancelledSub.id);

      const lines = cancelledSub.lines as Array<{ id: string | number; [key: string]: unknown }> | undefined;
      const lineId = String(lines?.[0]?.id ?? "");
      if (!lineId) {
        throw new Error("No line found on subscription after reactivation");
      }

      await swapLoopSubscriptionProduct({
        shopifyCustomerId,
        subscriptionId: cancelledSub.id,
        lineId,
        variantShopifyId: MEMBER_VARIANT_SHOPIFY_ID,
        quantity: 1,
      });

      await updateLoopSubscriptionNextBillingDate(cancelledSub.id, MAY_21_2026_EPOCH);

      await doc.ref.update({ status: "processed", processed_at: Timestamp.now() });
      results.push({ email, action: "processed" });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ email, action: "failed", error });
    }
  }

  const summary = {
    total: snap.size,
    processed: results.filter((r) => r.action === "processed").length,
    skipped: results.filter((r) => r.action.startsWith("skipped")).length,
    failed: results.filter((r) => r.action === "failed").length,
    results,
  };

  console.log("[cron/mulligan-to-member]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
