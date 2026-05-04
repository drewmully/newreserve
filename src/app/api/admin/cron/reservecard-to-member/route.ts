/**
 * GET /api/admin/cron/reservecard-to-member
 *
 * Cron job — runs every 6 hours via Vercel cron.
 * Picks up reserve_card_submissions with selected_plan="member" that have not
 * been processed yet, then swaps their Loop subscription to the Member variant.
 *
 * Secured with CRON_SECRET (Vercel sends Authorization: Bearer <CRON_SECRET>).
 */

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { resolveCustomerByEmail } from "@/app/api/_lib/shopifyAdmin";
import {
  getLoopRawSubscriptions,
  swapLoopSubscriptionProduct,
} from "@/app/api/_lib/loopAdmin";

const MEMBER_VARIANT_SHOPIFY_ID = 47601025122496;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type ResultRow = {
  email: string;
  action: "swapped" | "skipped_no_shopify_id" | "skipped_no_active_sub" | "failed";
  error?: string;
};

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const snap = await adminDb
    .collection("reserve_card_submissions")
    .where("selected_plan", "==", "member")
    .get();

  const pending = snap.docs.filter((doc) => !doc.data().processed_at);

  const results: ResultRow[] = [];

  for (const doc of pending) {
    const { email } = doc.data() as { email: string };

    try {
      const shopifyCustomerId = await resolveCustomerByEmail(email);
      if (!shopifyCustomerId) {
        results.push({ email, action: "skipped_no_shopify_id" });
        continue;
      }

      const subs = await getLoopRawSubscriptions(shopifyCustomerId);
      const activeSub = subs.find((s) => s.status === "ACTIVE");

      if (!activeSub) {
        results.push({ email, action: "skipped_no_active_sub" });
        continue;
      }

      const lines = activeSub.lines as Array<{ id: string | number; [key: string]: unknown }> | undefined;
      const lineId = String(lines?.[0]?.id ?? "");
      if (!lineId) {
        results.push({ email, action: "failed", error: "No line found on active subscription" });
        continue;
      }

      await swapLoopSubscriptionProduct({
        shopifyCustomerId,
        subscriptionId: activeSub.id,
        lineId,
        variantShopifyId: MEMBER_VARIANT_SHOPIFY_ID,
        quantity: 1,
      });

      await doc.ref.update({ status: "processed", processed_at: Timestamp.now() });
      results.push({ email, action: "swapped" });
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      results.push({ email, action: "failed", error });
    }
  }

  const summary = {
    cron: "reservecard-to-member",
    total: pending.length,
    swapped: results.filter((r) => r.action === "swapped").length,
    skipped: results.filter((r) => r.action.startsWith("skipped")).length,
    failed: results.filter((r) => r.action === "failed").length,
    results,
  };

  await adminDb.collection("cron_logs").add({
    ...summary,
    ran_at: Timestamp.now(),
  });

  console.log("[cron/reservecard-to-member]", JSON.stringify(summary));
  return NextResponse.json(summary);
}
