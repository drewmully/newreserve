/**
 * GET /api/admin/cron/mulligan-to-member
 *
 * Cron job — runs every 6 hours via Vercel cron.
 * Picks up mulligan_submissions with status="pending_reactivation" for
 * both "member" and "access" reactivation choices, then:
 *   1. Finds the best Reserve-related cancelled (or active) Loop subscription
 *   2. Reactivates it if cancelled
 *   3. Swaps the product to the correct variant
 *   4. For member: sets the next billing date to May 21, 2026
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
  type LoopSubscription,
} from "@/app/api/_lib/loopAdmin";

const VARIANT_BY_TIER: Record<string, number> = {
  member: 47601025122496,
  access: 47601025482944,
};

// Reserve-related keywords to identify the right subscription when multiple exist
const RESERVE_KEYWORDS = ["reserve", "back 9", "mullybox", "mully"];

// 2026-05-21 00:00:00 UTC
const MAY_21_2026_EPOCH = 1779321600;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

function isReserveSub(sub: LoopSubscription): boolean {
  const lines = sub.lines as Array<Record<string, unknown>> | undefined;
  const title = String(lines?.[0]?.productTitle ?? "").toLowerCase();
  return RESERVE_KEYWORDS.some((kw) => title.includes(kw));
}

function pickBestSub(
  subs: LoopSubscription[],
  status: "CANCELLED" | "ACTIVE"
): LoopSubscription | undefined {
  const matching = subs.filter((s) => s.status === status);
  // Prefer Reserve-related sub; fall back to first match
  return matching.find(isReserveSub) ?? matching[0];
}

async function createReviewTask(email: string, reason: string, cron: string): Promise<void> {
  await adminDb.collection("review_tasks").add({
    source: "cron",
    cron,
    email,
    reason,
    status: "open",
    createdAt: Timestamp.now(),
  });
}

type ResultRow = {
  email: string;
  reactivation_choice: string;
  action:
    | "processed"
    | "processed_no_date"
    | "skipped_no_shopify_id"
    | "skipped_no_sub"
    | "failed";
  error?: string;
  billing_date_error?: string;
};

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snap = await adminDb
    .collection("mulligan_submissions")
    .where("status", "==", "pending_reactivation")
    .get();

  const results: ResultRow[] = [];

  for (const doc of snap.docs) {
    const data = doc.data() as { email: string; reactivation_choice: string };
    const { email, reactivation_choice } = data;

    const variantShopifyId = VARIANT_BY_TIER[reactivation_choice];
    if (!variantShopifyId) {
      // Unknown choice — skip silently (shouldn't happen after form cleanup)
      continue;
    }

    try {
      const shopifyCustomerId = await resolveCustomerByEmail(email);
      if (!shopifyCustomerId) {
        results.push({ email, reactivation_choice, action: "skipped_no_shopify_id" });
        await createReviewTask(email, "No Shopify account found", "mulligan-to-member");
        continue;
      }

      const subs = await getLoopRawSubscriptions(shopifyCustomerId);
      const cancelledSub = pickBestSub(subs, "CANCELLED");
      const activeSub = pickBestSub(subs, "ACTIVE");
      const targetSub = cancelledSub ?? activeSub;

      if (!targetSub) {
        results.push({ email, reactivation_choice, action: "skipped_no_sub" });
        await createReviewTask(email, "No Loop subscription found (cancelled or active)", "mulligan-to-member");
        continue;
      }

      if (cancelledSub) {
        await reactivateLoopSubscription(cancelledSub.id);
      }

      const lines = targetSub.lines as Array<{ id: string | number; [key: string]: unknown }> | undefined;
      const lineId = String(lines?.[0]?.id ?? "");
      if (!lineId) {
        throw new Error("No line found on subscription");
      }

      await swapLoopSubscriptionProduct({
        shopifyCustomerId,
        subscriptionId: targetSub.id,
        lineId,
        variantShopifyId,
        quantity: 1,
      });

      let billingDateError: string | undefined;
      if (reactivation_choice === "member") {
        try {
          await updateLoopSubscriptionNextBillingDate(targetSub.id, MAY_21_2026_EPOCH);
        } catch (err) {
          billingDateError = err instanceof Error ? err.message : String(err);
          console.warn(`[cron/mulligan-to-member] billing date failed for ${email}:`, billingDateError);
        }
      }

      const action = billingDateError ? "processed_no_date" : "processed";
      await doc.ref.update({ status: "processed", processed_at: Timestamp.now() });
      results.push({ email, reactivation_choice, action, ...(billingDateError ? { billing_date_error: billingDateError } : {}) });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ email, reactivation_choice, action: "failed", error });
      await createReviewTask(email, `Processing failed: ${error}`, "mulligan-to-member");
    }
  }

  const summary = {
    cron: "mulligan-to-member",
    total: snap.size,
    processed: results.filter((r) => r.action === "processed" || r.action === "processed_no_date").length,
    processed_no_date: results.filter((r) => r.action === "processed_no_date").length,
    skipped: results.filter((r) => r.action.startsWith("skipped")).length,
    failed: results.filter((r) => r.action === "failed").length,
    results,
  };

  await adminDb.collection("cron_logs").add({
    ...summary,
    ran_at: Timestamp.now(),
  });

  console.log("[cron/mulligan-to-member]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
