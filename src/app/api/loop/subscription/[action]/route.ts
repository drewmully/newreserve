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
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  getLoopRawSubscriptions,
  pauseLoopSubscription,
  resumeLoopSubscription,
  cancelLoopSubscription,
  changeLoopSubscriptionPlan,
  reactivateLoopSubscription,
} from "@/app/api/_lib/loopAdmin";
import {
  isSupportedSellingPlanId,
  normalizeShopifyNumericId,
} from "@/lib/membershipConfig";

async function verifyFirebaseBearer(request: NextRequest): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  return decoded.uid;
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

  const userSnap = await adminDb.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const email = userSnap.data()!.email as string | undefined;
  if (!email) return NextResponse.json({ error: "No email on user" }, { status: 400 });

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

  // For reactivate, match any status; for all others, require ACTIVE/PAUSED
  const subs = await getLoopRawSubscriptions(email);
  const sub =
    action === "reactivate"
      ? subs.find((s) => s.status === "CANCELLED")
      : subs.find((s) => s.status === "ACTIVE" || s.status === "PAUSED");

  if (!sub?.id) {
    return NextResponse.json({ error: "No matching subscription found" }, { status: 404 });
  }
  const subscriptionId = sub.id;
  const cancelReason = body.reason as string | undefined;

  try {
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
