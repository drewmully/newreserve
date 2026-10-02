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
import { FieldValue } from "firebase-admin/firestore";
import { readShopifyOutfitMembership } from "@/lib/shopifyOutfitMembership";
import {
  getLoopSubscriptionStatus,
  getLoopManageSubscriptionUrl,
  getLoopNextUnblockUrl,
} from "@/app/api/_lib/loopAdmin";
import {
  getLoopUserContext,
  verifyFirebaseBearer,
} from "@/app/api/_lib/loopUserContext";

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
  const context = await getLoopUserContext(uid);
  if (!context) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }
  // This paid-order receipt is server-managed and independent of Loop's cache.
  // Never invent an ACTIVE contract status or pass Shopify contracts to Loop.
  const outfit = readShopifyOutfitMembership(context.userData.shopify_outfit_membership);
  const withOutfit = (subscriptions: unknown) => ({
    ...((subscriptions ?? EMPTY_SUBSCRIPTIONS) as Record<string, unknown>),
    ...(outfit ? { shopify_outfit: outfit } : {}),
  });

  // No Shopify customer: return cache
  if (!context.loopCustomerIdentifier) {
    return NextResponse.json({
      subscriptions: withOutfit(context.userData.subscriptions),
      source: "cache",
    });
  }

  // Fetch live Loop status
  try {
    const status = await getLoopSubscriptionStatus(context.loopCustomerIdentifier);
    const manageUrl = context.shopifyCustomerId
      ? getLoopManageSubscriptionUrl(context.shopifyCustomerId)
      : null;
    const nextUnblockUrl = getLoopNextUnblockUrl();

    const subscriptions = {
      ...status,
      manage_url: manageUrl || null,
      next_unblock_url: nextUnblockUrl,
    };

    await context.userRef.update({
      subscriptions: {
        ...subscriptions,
        last_checked: FieldValue.serverTimestamp(),
      },
    });

    return NextResponse.json({ subscriptions: withOutfit(subscriptions), source: "loop" });
  } catch {
    // Loop unavailable: serve Firestore cache
    return NextResponse.json({
      subscriptions: withOutfit(context.userData.subscriptions),
      source: "cache",
    });
  }
}
