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
import { resolveCustomerByEmail } from "@/app/api/_lib/shopifyAdmin";
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

  const userData = userSnap.data()!;
  let shopifyCustomerId: string | null = userData.shopify_customer_id ?? null;

  if (!shopifyCustomerId && userData.email) {
    try {
      shopifyCustomerId = await resolveCustomerByEmail(userData.email as string);
      if (shopifyCustomerId) {
        await userRef.update({ shopify_customer_id: shopifyCustomerId });
      }
    } catch {
      // non-fatal
    }
  }

  if (!shopifyCustomerId) {
    return NextResponse.json({ subscriptions: [], source: "no_customer" });
  }

  try {
    console.log("[loop/subscriptions] shopifyCustomerId:", shopifyCustomerId);
    const subscriptions = await getLoopRawSubscriptions(shopifyCustomerId);
    return NextResponse.json({ subscriptions, source: "loop" });
  } catch (err) {
    console.error("[loop/subscriptions] fetch failed:", err);
    return NextResponse.json({ error: "Loop API unavailable" }, { status: 502 });
  }
}
