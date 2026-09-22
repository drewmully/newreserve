/**
 * POST /api/nechv/grant-credit
 *
 * Issues the one-time $25 USD Shopify store-credit perk to a member who
 * signed up via the /nechv landing page. Called client-side from
 * NechvEmailCTA immediately after the EmailCTA → start-account → custom
 * token sign-in flow completes.
 *
 * Flow:
 *   1. Verify Firebase ID token from Authorization: Bearer …
 *   2. Load the user document.
 *   3. Idempotency guard: if `nechv_credit_granted` is already true, no-op.
 *   4. Eligibility guard: signup_source must be "nechv" (set by NechvEmailCTA
 *      via /api/auth/start-account). This stops a random signed-in user
 *      from POSTing to this endpoint and granting themselves credit.
 *   5. Resolve-or-create the Shopify customer for the user's email.
 *   6. Credit $25 USD via storeCreditAccountCredit (creates the account
 *      if needed — matches Mully-Hub's pattern).
 *   7. Persist `shopify_customer_id`, `nechv_credit_granted`,
 *      `nechv_credit_amount`, `nechv_credit_granted_at`,
 *      `nechv_credit_transaction_id` on the user doc so a backfill job
 *      can reconcile later if anything fails.
 *
 * Failure semantics: on Shopify failure we return 502 but leave the user
 * doc unchanged so a retry (manual or cron) can succeed later. The
 * front-end should not block the user's redirect on this request.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import {
  creditCustomerStoreCredit,
  resolveOrCreateCustomerByEmail,
} from "@/app/api/_lib/shopifyAdmin";

export const NECHV_CREDIT_AMOUNT = 25;
export const NECHV_SIGNUP_SOURCE = "nechv";

interface GrantCreditResponseOk {
  ok: true;
  already_granted: boolean;
  amount: number;
  shopify_customer_id: string;
  account_id?: string;
  balance_after?: number;
}

interface GrantCreditResponseErr {
  ok: false;
  error: string;
}

type GrantCreditResponse = GrantCreditResponseOk | GrantCreditResponseErr;

async function verifyBearer(req: NextRequest): Promise<string | null> {
  const header = req.headers.get("authorization") ?? "";
  if (!header.toLowerCase().startsWith("bearer ")) return null;
  const token = header.slice(7).trim();
  if (!token) return null;
  try {
    const decoded = await adminAuth.verifyIdToken(token, true);
    return decoded.uid;
  } catch {
    return null;
  }
}

export async function POST(request: NextRequest): Promise<NextResponse<GrantCreditResponse>> {
  const uid = await verifyBearer(request);
  if (!uid) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const userRef = adminDb.collection("users").doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) {
    return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
  }

  const data = (snap.data() ?? {}) as Record<string, unknown>;
  const email =
    typeof data.email === "string" && data.email.trim() ? data.email.trim().toLowerCase() : null;
  if (!email) {
    return NextResponse.json({ ok: false, error: "User has no email" }, { status: 400 });
  }

  // Idempotency — already granted? Return success without touching Shopify.
  if (data.nechv_credit_granted === true) {
    const existingShopifyId =
      typeof data.shopify_customer_id === "string" ? data.shopify_customer_id : "";
    return NextResponse.json({
      ok: true,
      already_granted: true,
      amount:
        typeof data.nechv_credit_amount === "number"
          ? (data.nechv_credit_amount as number)
          : NECHV_CREDIT_AMOUNT,
      shopify_customer_id: existingShopifyId,
    });
  }

  // Eligibility — must have signed up through /nechv. signup_source is set
  // by /api/auth/start-account when called from NechvEmailCTA.
  if (data.signup_source !== NECHV_SIGNUP_SOURCE) {
    return NextResponse.json(
      { ok: false, error: "User did not sign up through the NECHV landing page" },
      { status: 403 }
    );
  }

  // Look up or create the Shopify customer. Most NECHV users will not
  // have a Shopify customer yet because they joined via the free tier.
  let shopifyCustomerId: string;
  try {
    const existingId =
      typeof data.shopify_customer_id === "string" && data.shopify_customer_id.trim()
        ? data.shopify_customer_id.trim()
        : null;
    if (existingId) {
      shopifyCustomerId = existingId;
    } else {
      const res = await resolveOrCreateCustomerByEmail({
        email,
        tags: ["nechv-signup", "newreserve"],
      });
      shopifyCustomerId = res.customerId;
    }
  } catch (err) {
    console.error("[nechv/grant-credit] resolveOrCreateCustomerByEmail failed:", err);
    return NextResponse.json(
      { ok: false, error: "Could not resolve Shopify customer" },
      { status: 502 }
    );
  }

  // Credit $25 USD. creditCustomerStoreCredit returns ok:false instead of
  // throwing so we can preserve the rich error message.
  const creditResult = await creditCustomerStoreCredit({
    customerId: shopifyCustomerId,
    amount: NECHV_CREDIT_AMOUNT,
    currencyCode: "USD",
  });

  if (!creditResult.ok) {
    console.error(
      "[nechv/grant-credit] storeCreditAccountCredit failed:",
      creditResult.error,
      creditResult.userErrors
    );
    // Persist the Shopify customer id even on credit failure so a retry
    // doesn't have to look it up again.
    try {
      await userRef.set(
        { shopify_customer_id: shopifyCustomerId, updated_at: Date.now() },
        { merge: true }
      );
    } catch {
      // Swallow — Firestore write failure shouldn't change the response.
    }
    return NextResponse.json(
      { ok: false, error: `Shopify credit failed: ${creditResult.error}` },
      { status: 502 }
    );
  }

  // Persist success. Write atomically so a partial retry can detect it.
  try {
    await userRef.set(
      {
        shopify_customer_id: shopifyCustomerId,
        nechv_credit_granted: true,
        nechv_credit_amount: NECHV_CREDIT_AMOUNT,
        nechv_credit_granted_at: Date.now(),
        nechv_credit_account_id: creditResult.accountId,
        updated_at: Date.now(),
      },
      { merge: true }
    );
  } catch (err) {
    // The credit DID succeed in Shopify — surface success to the caller
    // but log loudly so we can fix the Firestore drift.
    console.error(
      "[nechv/grant-credit] Firestore update failed after successful credit:",
      err
    );
  }

  return NextResponse.json({
    ok: true,
    already_granted: false,
    amount: NECHV_CREDIT_AMOUNT,
    shopify_customer_id: shopifyCustomerId,
    account_id: creditResult.accountId,
    balance_after: creditResult.balanceAmount,
  });
}
