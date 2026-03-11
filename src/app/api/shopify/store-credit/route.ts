/**
 * GET /api/shopify/store-credit
 *
 * Returns the authenticated user's Shopify store-credit balance.
 * Requires:  Authorization: Bearer <Firebase ID token>
 *
 * Response:
 *   { store_credit: { balance_cents, currency }, shopify_customer_id, source }
 *   source: "shopify" | "cache"
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";
import {
  resolveCustomerByEmail,
  getStoreCreditByCustomerId,
} from "@/app/api/_lib/shopifyAdmin";

async function verifyFirebaseBearer(request: NextRequest): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  return decoded.uid;
}

export async function GET(request: NextRequest) {
  // Auth
  let uid: string;
  try {
    uid = await verifyFirebaseBearer(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Load user document
  const userRef = adminDb.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const userData = userSnap.data()!;
  let shopifyCustomerId: string | null =
    userData.shopify_customer_id ?? null;

  // Resolve Shopify customer ID if missing
  if (!shopifyCustomerId && userData.email) {
    try {
      shopifyCustomerId = await resolveCustomerByEmail(userData.email as string);
      if (shopifyCustomerId) {
        await userRef.update({ shopify_customer_id: shopifyCustomerId });
      }
    } catch {
      // Non-fatal: continue with cache fallback
    }
  }

  // No Shopify customer: return cache
  if (!shopifyCustomerId) {
    return NextResponse.json({
      store_credit: userData.store_credit ?? {
        balance_cents: 0,
        currency: "USD",
      },
      shopify_customer_id: null,
      source: "cache",
    });
  }

  // Fetch live balance
  try {
    const storeCredit = await getStoreCreditByCustomerId(shopifyCustomerId);

    await userRef.update({
      store_credit: {
        ...storeCredit,
        last_synced: FieldValue.serverTimestamp(),
      },
    });

    return NextResponse.json({
      store_credit: storeCredit,
      shopify_customer_id: shopifyCustomerId,
      source: "shopify",
    });
  } catch {
    // Shopify unavailable: serve from Firestore cache
    return NextResponse.json({
      store_credit: userData.store_credit ?? {
        balance_cents: 0,
        currency: "USD",
      },
      shopify_customer_id: shopifyCustomerId,
      source: "cache",
    });
  }
}
