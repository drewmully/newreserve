/**
 * GET /api/loop/subscriptions
 *
 * Returns the authenticated user's raw Loop subscriptions (all fields).
 * Used to inspect the Loop API response shape and resolve member tier.
 *
 * Requires: Authorization: Bearer <Firebase ID token>
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { getLoopRawSubscriptions } from "@/app/api/_lib/loopAdmin";

async function verifyFirebaseBearer(request: NextRequest): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token);
  return decoded.uid;
}

export async function GET(request: NextRequest) {
  let uid: string;
  try {
    uid = await verifyFirebaseBearer(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const userRef = adminDb.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const email = userSnap.data()!.email as string | undefined;
  if (!email) {
    return NextResponse.json({ subscriptions: [], source: "no_email" });
  }

  try {
    const subscriptions = await getLoopRawSubscriptions(email);
    return NextResponse.json({ subscriptions, source: "loop" });
  } catch (err) {
    console.error("[loop/subscriptions] fetch failed:", err);
    return NextResponse.json({ error: "Loop API unavailable" }, { status: 502 });
  }
}
