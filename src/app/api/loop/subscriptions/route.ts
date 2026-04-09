/**
 * GET /api/loop/subscriptions
 *
 * Returns the authenticated user's raw Loop subscriptions (all fields).
 * Used to inspect the Loop API response shape and resolve member tier.
 *
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
    return NextResponse.json({ subscriptions: [], source: "no_customer" });
  }

  try {
    const subscriptions = await getLoopRawSubscriptions(
      context.loopCustomerIdentifier
    );
    return NextResponse.json({ subscriptions, source: "loop" });
  } catch (err) {
    console.error("[loop/subscriptions] fetch failed:", err);
    return NextResponse.json({ error: "Loop API unavailable" }, { status: 502 });
  }
}
