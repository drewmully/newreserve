/**
 * POST /api/loop/subscription/[action]
 *
 * Handles subscription mutations for the authenticated user.
 * Supported actions: pause | resume | cancel | change-plan
 *
 * Body for cancel:      { reason: string }
 * Body for change-plan: { sellingPlanShopifyId: number }
 *
 * Requires: Authorization: Bearer <Firebase ID token>
 */

import { NextRequest, NextResponse } from "next/server";
import {
  type LoopSubscription,
  getLoopRawSubscriptions,
  pauseLoopSubscription,
  resumeLoopSubscription,
  cancelLoopSubscription,
  changeLoopSubscriptionPlan,
  reactivateLoopSubscription,
  swapLoopSubscriptionProduct,
} from "@/app/api/_lib/loopAdmin";
import {
  getLoopUserContext,
  verifyFirebaseBearer,
} from "@/app/api/_lib/loopUserContext";
import {
  isSupportedSellingPlanId,
  normalizeShopifyNumericId,
  resolveMemberTierFromVariantId,
  SHOPIFY_MEMBERSHIP_PLANS,
} from "@/lib/membershipConfig";
import { startFlow, type EmailFlow } from "@/lib/email/sequences";

function getMatchingSubscriptions(
  subscriptions: LoopSubscription[],
  action: string
): LoopSubscription[] {
  if (action === "reactivate") {
    return subscriptions.filter((subscription) => subscription.status === "CANCELLED");
  }

  return subscriptions.filter(
    (subscription) =>
      subscription.status === "ACTIVE" || subscription.status === "PAUSED"
  );
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ action: string }> }
) {
  let uid: string;
  try {
    uid = await verifyFirebaseBearer(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const context = await getLoopUserContext(uid);
  if (!context) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const { action } = await params;
  const VALID_ACTIONS = new Set([
    "pause",
    "resume",
    "cancel",
    "change-plan",
    "reactivate",
    "swap-product",
  ]);
  if (!VALID_ACTIONS.has(action)) {
    return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
  }

  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // body is optional
  }

  const sellingPlanShopifyId =
    action === "change-plan"
      ? normalizeShopifyNumericId(body.sellingPlanShopifyId)
      : null;

  if (action === "change-plan") {
    if (!sellingPlanShopifyId || !isSupportedSellingPlanId(sellingPlanShopifyId)) {
      return NextResponse.json({ error: "Invalid sellingPlanShopifyId" }, { status: 400 });
    }
  }

  const swapVariantShopifyId =
    action === "swap-product"
      ? normalizeShopifyNumericId(body.variantShopifyId)
      : null;

  if (action === "swap-product") {
    if (!swapVariantShopifyId || !resolveMemberTierFromVariantId(swapVariantShopifyId)) {
      return NextResponse.json({ error: "Invalid variantShopifyId" }, { status: 400 });
    }
  }

  if (action === "cancel" && body.reason !== undefined && typeof body.reason !== "string") {
    return NextResponse.json({ error: "Invalid cancel reason" }, { status: 400 });
  }

  if (
    body.subscriptionId !== undefined &&
    (typeof body.subscriptionId !== "string" || !body.subscriptionId.trim())
  ) {
    return NextResponse.json({ error: "Invalid subscriptionId" }, { status: 400 });
  }

  if (!context.loopCustomerIdentifier) {
    return NextResponse.json({ error: "No Loop customer found" }, { status: 400 });
  }

  if (!context.shopifyCustomerId && action === "swap-product") {
    return NextResponse.json({ error: "No Shopify customer ID found" }, { status: 400 });
  }

  try {
    const subs = await getLoopRawSubscriptions(context.loopCustomerIdentifier);
    const matchingSubscriptions = getMatchingSubscriptions(subs, action);
    const requestedSubscriptionId =
      typeof body.subscriptionId === "string" ? body.subscriptionId.trim() : null;

    const sub = requestedSubscriptionId
      ? matchingSubscriptions.find(
          (subscription) => subscription.id === requestedSubscriptionId
        ) ?? null
      : matchingSubscriptions.length === 1
        ? matchingSubscriptions[0]!
        : null;

    if (!sub?.id) {
      if (!requestedSubscriptionId && matchingSubscriptions.length > 1) {
        return NextResponse.json(
          {
            error: "Multiple matching subscriptions found",
            subscriptionIds: matchingSubscriptions.map((subscription) => subscription.id),
          },
          { status: 409 }
        );
      }
      return NextResponse.json(
        { error: "No matching subscription found" },
        { status: 404 }
      );
    }

    const subscriptionId = sub.id;
    const cancelReason = body.reason as string | undefined;

    switch (action) {
      case "pause":
        await pauseLoopSubscription(subscriptionId);
        break;
      case "resume":
        await resumeLoopSubscription(subscriptionId);
        break;
      case "cancel":
        await cancelLoopSubscription(subscriptionId, cancelReason ?? "");
        break;
      case "change-plan":
        await changeLoopSubscriptionPlan(subscriptionId, sellingPlanShopifyId!);
        break;
      case "reactivate":
        await reactivateLoopSubscription(subscriptionId);
        break;
      case "swap-product": {
        const lines = (sub as any).lines as Array<{ id: string | number }> | undefined;
        const lineId = lines?.[0]?.id;
        if (!lineId) {
          return NextResponse.json({ error: "No subscription line found" }, { status: 400 });
        }

        const targetTier = resolveMemberTierFromVariantId(swapVariantShopifyId!);
        if (!targetTier) {
          return NextResponse.json({ error: "Could not resolve tier from variantShopifyId" }, { status: 400 });
        }

        await swapLoopSubscriptionProduct({
          shopifyCustomerId: context.shopifyCustomerId!,
          subscriptionId,
          lineId: String(lineId),
          variantShopifyId: swapVariantShopifyId!,
          quantity: 1,
          // sellingPlanGroupId omitted: Loop auto-assigns the plan from the variant.
          // Passing the Shopify SellingPlanGroup ID causes a 422.
        });

        // Sync Firestore tier
        await context.userRef.update({ tier: targetTier, updated_at: Date.now() });

        // Trigger email flow for the new tier (non-fatal)
        try {
          const email = context.email;
          const firstName = (context.userData.username as string | undefined) ?? null;
          const emailFlow: EmailFlow = targetTier === "member" ? "member" : "access";
          if (email) {
            await startFlow(uid, email, firstName, emailFlow);
          }
        } catch (err) {
          console.error("[swap-product] email flow trigger failed:", err);
        }

        break;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[loop/subscription/${action}] failed:`, err);
    return NextResponse.json({ error: "Loop API error" }, { status: 502 });
  }
}
