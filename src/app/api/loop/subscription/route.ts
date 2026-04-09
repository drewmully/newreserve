/**
 * GET /api/loop/subscription
 * Returns the authenticated user's actionable Loop subscriptions.
 * Requires: Authorization: Bearer <Firebase ID token>
 */

import { NextRequest, NextResponse } from "next/server";
import { getLoopRawSubscriptions } from "@/app/api/_lib/loopAdmin";
import {
  getLoopUserContext,
  verifyFirebaseBearer,
} from "@/app/api/_lib/loopUserContext";

export async function GET(request: NextRequest) {
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

  if (!context.loopCustomerIdentifier) {
    return NextResponse.json({ subscription: null, subscriptions: [], source: "no_customer" });
  }

  try {
    const subscriptions = (await getLoopRawSubscriptions(
      context.loopCustomerIdentifier
    )).filter((sub) =>
      ["ACTIVE", "PAUSED", "CANCELLED"].includes(String(sub.status))
    );
    return NextResponse.json({
      subscription: subscriptions[0] ?? null,
      subscriptions,
      source: "loop",
    });
  } catch (err) {
    console.error("[loop/subscription] GET failed:", err);
    return NextResponse.json({ error: "Loop API unavailable" }, { status: 502 });
  }
}
