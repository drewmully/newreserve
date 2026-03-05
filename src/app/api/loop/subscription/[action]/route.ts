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
  getActiveLoopSubscriptionId,
  pauseLoopSubscription,
  resumeLoopSubscription,
  cancelLoopSubscription,
  changeLoopSubscriptionPlan,
} from "@/app/api/_lib/loopAdmin";

async function verifyFirebaseBearer(request: NextRequest): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token);
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

  const subscriptionId = await getActiveLoopSubscriptionId(email);
  if (!subscriptionId) {
    return NextResponse.json({ error: "No active subscription found" }, { status: 404 });
  }

  const { action } = await params;
  let body: Record<string, unknown> = {};
  try {
    body = await request.json();
  } catch {
    // body is optional
  }

  try {
    switch (action) {
      case "pause":
        await pauseLoopSubscription(subscriptionId);
        break;
      case "resume":
        await resumeLoopSubscription(subscriptionId);
        break;
      case "cancel":
        await cancelLoopSubscription(subscriptionId, (body.reason as string) ?? "");
        break;
      case "change-plan":
        await changeLoopSubscriptionPlan(subscriptionId, body.sellingPlanShopifyId as number);
        break;
      default:
        return NextResponse.json({ error: `Unknown action: ${action}` }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error(`[loop/subscription/${action}] failed:`, err);
    return NextResponse.json({ error: "Loop API error" }, { status: 502 });
  }
}
