/**
 * Firebase UID → Shopify customer → Shopify Subscription contract ids.
 *
 * Mirrors `loopUserContext.ts` structurally so the new /api/subscription/*
 * routes read like the existing /api/loop/subscription/* routes. Uses
 * `resolveCustomerByEmail` from the existing `shopifyAdmin.ts` client, which
 * only needs `read_customers` scope (safe for the current admin token).
 *
 * Contract ids are stored on `users/{uid}.subscription_contract_ids` after the
 * migration script re-creates each Loop contract under the new Partner app.
 * Until then this reader returns an empty array — every /api/subscription/*
 * route is behind the `SUBSCRIPTIONS_BACKEND` feature flag anyway.
 */

import { NextRequest } from "next/server";
import type { DocumentReference } from "firebase-admin/firestore";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { resolveCustomerByEmail } from "@/app/api/_lib/shopifyAdmin";

export interface SubscriptionUserContext {
  uid: string;
  userRef: DocumentReference;
  userData: Record<string, unknown>;
  email: string | null;
  shopifyCustomerId: string | null;
  /**
   * Shopify SubscriptionContract global ids owned by this user. Populated by
   * the migration script (Section 4 of the migration plan). Empty until then.
   */
  subscriptionContractIds: string[];
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

function normalizeContractIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (const value of raw) {
    if (typeof value === "string" && value.trim()) out.push(value.trim());
  }
  return out;
}

export async function getSubscriptionUserContext(
  uid: string
): Promise<SubscriptionUserContext | null> {
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
      // Non-fatal: /api/subscription/* routes can still 404 gracefully.
    }
  }

  const subscriptionContractIds = normalizeContractIds(
    userData.subscription_contract_ids
  );

  return {
    uid,
    userRef,
    userData,
    email,
    shopifyCustomerId,
    subscriptionContractIds,
  };
}
