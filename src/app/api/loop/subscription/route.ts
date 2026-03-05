/**
 * GET /api/loop/subscription
 * Returns the first ACTIVE Loop subscription for the authenticated user.
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

  const userSnap = await adminDb.collection("users").doc(uid).get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const email = userSnap.data()!.email as string | undefined;
  if (!email) return NextResponse.json({ subscription: null });

  try {
    const subs = await getLoopRawSubscriptions(email);
    const sub = subs.find((s) => ["ACTIVE", "PAUSED", "CANCELLED"].includes(s.status)) ?? null;
    return NextResponse.json({ subscription: sub });
  } catch (err) {
    console.error("[loop/subscription] GET failed:", err);
    return NextResponse.json({ error: "Loop API unavailable" }, { status: 502 });
  }
}
