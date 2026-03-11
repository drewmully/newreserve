/**
 * GET /api/shopify/orders
 *
 * Returns the authenticated user's last 10 Shopify orders.
 * Requires:  Authorization: Bearer <Firebase ID token>
 *
 * Response:
 *   { orders: ShopifyOrderSummary[] }
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { resolveCustomerByEmail, getCustomerOrders } from "@/app/api/_lib/shopifyAdmin";

async function verifyFirebaseBearer(request: NextRequest): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  return decoded.uid;
}

export async function GET(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  let uid: string;
  try {
    uid = await verifyFirebaseBearer(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ── Load user document ────────────────────────────────────────────────────
  const userRef = adminDb.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userData = userSnap.data()!;
  let shopifyCustomerId: string | null = userData.shopify_customer_id ?? null;

  // ── Resolve Shopify customer ID if missing ────────────────────────────────
  if (!shopifyCustomerId && userData.email) {
    try {
      shopifyCustomerId = await resolveCustomerByEmail(userData.email as string);
      if (shopifyCustomerId) {
        await userRef.update({ shopify_customer_id: shopifyCustomerId });
      }
    } catch {
      // Non-fatal
    }
  }

  // ── No Shopify customer → return empty list ───────────────────────────────
  if (!shopifyCustomerId) {
    return NextResponse.json({ orders: [] });
  }

  // ── Fetch orders from Shopify ─────────────────────────────────────────────
  try {
    const orders = await getCustomerOrders(shopifyCustomerId, 10);
    return NextResponse.json({ orders });
  } catch (err) {
    console.error("[shopify/orders] fetch failed:", err);
    return NextResponse.json({ orders: [] });
  }
}
