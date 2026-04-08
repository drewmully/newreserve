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
} from "@/app/api/_lib/loopAdmin";
import {
  getLoopUserContext,
  verifyFirebaseBearer,
} from "@/app/api/_lib/loopUserContext";
import {
  isSupportedSellingPlanId,
  normalizeShopifyNumericId,
} from "@/lib/membershipConfig";

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
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[loop/subscription/${action}] failed:`, err);
    return NextResponse.json({ error: "Loop API error" }, { status: 502 });
  }
}
