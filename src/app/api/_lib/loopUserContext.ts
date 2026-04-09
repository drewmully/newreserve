import { NextRequest } from "next/server";
import type { DocumentReference } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { resolveCustomerByEmail } from "@/app/api/_lib/shopifyAdmin";

export interface LoopUserContext {
  uid: string;
  userRef: DocumentReference;
  userData: Record<string, unknown>;
  email: string | null;
  shopifyCustomerId: string | null;
  loopCustomerIdentifier: string | null;
  identifierType: "shopify_customer_id" | "email" | null;
}

export async function verifyFirebaseBearer(
  request: NextRequest
): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  return decoded.uid;
}

export async function getLoopUserContext(
  uid: string
): Promise<LoopUserContext | null> {
  const userRef = adminDb.collection("users").doc(uid);
  const userSnap = await userRef.get();
  if (!userSnap.exists) return null;

  const userData = (userSnap.data() ?? {}) as Record<string, unknown>;
  const email =
    typeof userData.email === "string" && userData.email.trim()
      ? userData.email.trim()
      : null;

  let shopifyCustomerId =
    typeof userData.shopify_customer_id === "string" &&
    userData.shopify_customer_id.trim()
      ? userData.shopify_customer_id.trim()
      : null;

  if (!shopifyCustomerId && email) {
    try {
      const resolvedCustomerId = await resolveCustomerByEmail(email);
      if (resolvedCustomerId) {
        shopifyCustomerId = resolvedCustomerId;
        await userRef.update({ shopify_customer_id: resolvedCustomerId });
      }
    } catch {
      // Non-fatal: routes can still fall back to email where supported.
    }
  }

  return {
    uid,
    userRef,
    userData,
    email,
    shopifyCustomerId,
    loopCustomerIdentifier: shopifyCustomerId ?? email,
    identifierType: shopifyCustomerId ? "shopify_customer_id" : email ? "email" : null,
  };
}
