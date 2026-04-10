/**
 * POST /api/shopify/checkout
 *
 * Returns a Shopify checkout URL. For paid members, appends the discount code
 * server-side so it never appears in the client bundle or cart state.
 *
 * Body: { checkoutUrl: string }
 * Auth: Authorization: Bearer <Firebase ID token>
 *
 * Response: { checkoutUrl: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

async function verifyFirebaseBearer(request: NextRequest): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  return decoded.uid;
}

export async function POST(request: NextRequest) {
  let uid: string;
  try {
    uid = await verifyFirebaseBearer(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let checkoutUrl: string;
  try {
    const body = await request.json() as { checkoutUrl?: string };
    if (!body.checkoutUrl) throw new Error("Missing checkoutUrl");
    checkoutUrl = body.checkoutUrl;
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  // Check tier in Firestore
  const discountCode = process.env.MEMBER_DISCOUNT_CODE;
  if (discountCode) {
    try {
      const userDoc = await adminDb.collection("users").doc(uid).get();
      const tier = userDoc.data()?.tier as string | undefined;
      if (tier && tier !== "free") {
        const url = new URL(checkoutUrl);
        url.searchParams.set("discount", discountCode);
        checkoutUrl = url.toString();
      }
    } catch {
      // Non-fatal: return checkout URL without discount rather than failing
    }
  }

  return NextResponse.json({ checkoutUrl });
}
