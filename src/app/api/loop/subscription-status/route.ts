/**
 * GET /api/loop/subscription-status
 *
 * Returns the authenticated user's Loop subscription status.
 * Requires:  Authorization: Bearer <Firebase ID token>
 *
 * Response:
 *   { subscriptions: { mullybox_active, status, total_subscription_count,
 *                      active_subscription_ids, manage_url, next_unblock_url },
 *     source: "loop" | "cache" }
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import { resolveCustomerByEmail } from "@/app/api/_lib/shopifyAdmin";
import {
  getLoopSubscriptionStatus,
  getLoopManageSubscriptionUrl,
  getLoopNextUnblockUrl,
} from "@/app/api/_lib/loopAdmin";

async function verifyFirebaseBearer(request: NextRequest): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  return decoded.uid;
}

const EMPTY_SUBSCRIPTIONS = {
  mullybox_active: false,
  status: "none",
  total_subscription_count: 0,
  active_subscription_ids: [] as string[],
  manage_url: null,
  next_unblock_url: null,
} as const;

export async function GET(request: NextRequest) {
  // Auth
  let uid: string;
  try {
    uid = await verifyFirebaseBearer(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Load user document
  const userRef = adminDb.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userData = userSnap.data()!;
  let shopifyCustomerId: string | null =
    userData.shopify_customer_id ?? null;

  // Resolve Shopify customer ID if missing
  if (!shopifyCustomerId && userData.email) {
    try {
      shopifyCustomerId = await resolveCustomerByEmail(userData.email as string);
      if (shopifyCustomerId) {
        await userRef.update({ shopify_customer_id: shopifyCustomerId });
      }
    } catch {
      // Non-fatal
    }
  }

  // No Shopify customer: return cache
  if (!shopifyCustomerId) {
    return NextResponse.json({
      subscriptions: userData.subscriptions ?? EMPTY_SUBSCRIPTIONS,
      source: "cache",
    });
  }

  // Fetch live Loop status
  try {
    const status = await getLoopSubscriptionStatus(shopifyCustomerId);
    const manageUrl = getLoopManageSubscriptionUrl(shopifyCustomerId);
    const nextUnblockUrl = getLoopNextUnblockUrl();

    const subscriptions = {
      ...status,
      manage_url: manageUrl || null,
      next_unblock_url: nextUnblockUrl,
    };

    await userRef.update({
      subscriptions: {
        ...subscriptions,
        last_checked: FieldValue.serverTimestamp(),
      },
    });

    return NextResponse.json({ subscriptions, source: "loop" });
  } catch {
    // Loop unavailable: serve Firestore cache
    return NextResponse.json({
      subscriptions: userData.subscriptions ?? EMPTY_SUBSCRIPTIONS,
      source: "cache",
    });
  }
}
