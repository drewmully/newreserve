/**
 * POST /api/webhooks/shopify/checkouts-create
 *
 * Shopify webhook: checkouts/create (also handles checkouts/update — Shopify
 * sends both as it builds up the checkout). Verifies HMAC, then:
 *
 *   1. Looks up matching styleProfiles by lowercase email.
 *   2. Flips them to status='checkout_started' (markProfilesCheckoutStartedByEmail).
 *   3. Halts any active `reserve` sequence for the same profile uid.
 *   4. Starts the new `abandon` recovery sequence on the same uid.
 *
 * Idempotent on shopify checkout id via webhook_receipts dedupe AND via the
 * status-transition logic in markProfilesCheckoutStartedByEmail.
 *
 * Halt path: orders/paid → markProfilesConvertedByEmail (which now matches
 * `checkout_started` too) → completeSequence(profileId).
 *
 * Required env vars:
 *   SHOPIFY_WEBHOOK_SECRET — same secret used for orders/paid.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { adminDb } from "@/lib/firebase-admin";
import { startFlow, completeSequence } from "@/lib/email/sequences";
import { markProfilesCheckoutStartedByEmail } from "@/lib/styleProfiles/admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ── HMAC ─────────────────────────────────────────────────────────────────────

async function verifyShopifyHmac(
  request: NextRequest,
  rawBody: string,
): Promise<boolean> {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return false;
  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  if (!hmacHeader) return false;
  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, "base64"),
      Buffer.from(hmacHeader, "base64"),
    );
  } catch {
    return false;
  }
}

async function isDuplicateWebhook(request: NextRequest): Promise<boolean> {
  const webhookId = request.headers.get("x-shopify-webhook-id");
  if (!webhookId) return false;
  const dedupeKey = `shopify-checkouts-create:${webhookId}`;
  const ref = adminDb.collection("webhook_receipts").doc(dedupeKey);
  try {
    const existing = await ref.get();
    if (existing.exists) return true;
    await ref.set({
      webhook_id: webhookId,
      topic: request.headers.get("x-shopify-topic") ?? "checkouts/create",
      provider: "shopify",
      received_at: Date.now(),
    });
  } catch (err) {
    console.error("[checkouts-create] webhook dedupe check failed:", err);
  }
  return false;
}

// ── Shape ────────────────────────────────────────────────────────────────────

interface ShopifyCheckout {
  id: number;
  token: string;
  email: string | null;
  abandoned_checkout_url?: string | null;
  customer?: {
    email: string | null;
    first_name: string | null;
    last_name: string | null;
  } | null;
}

// ── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  if (!(await verifyShopifyHmac(request, rawBody))) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (await isDuplicateWebhook(request)) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  let checkout: ShopifyCheckout;
  try {
    checkout = JSON.parse(rawBody) as ShopifyCheckout;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = checkout.email ?? checkout.customer?.email ?? null;
  if (!email) {
    // Checkout without email yet (cart token only) — nothing to nurture.
    return NextResponse.json({ ok: true, skipped: "no_email" });
  }
  const checkoutToken = checkout.token ?? String(checkout.id);
  const firstName = checkout.customer?.first_name ?? null;

  try {
    const { newlyMarked, alreadyMarked } =
      await markProfilesCheckoutStartedByEmail({
        email,
        checkoutToken,
      });

    if (newlyMarked.length === 0 && alreadyMarked.length === 0) {
      // Email isn't tied to a quiz-completed profile — nothing to do. The
      // upstream Reserve nurture only targets quiz takers, so we don't enroll
      // generic Shopify shoppers in the abandon flow.
      return NextResponse.json({ ok: true, skipped: "no_matching_profile" });
    }

    // For each newly marked profile, halt the active `reserve` sequence (if
    // any) and enroll in `abandon`. Already-marked profiles get re-touched
    // (the token refresh in the helper) but we don't re-enroll them — the
    // existing sequence is already running.
    await Promise.allSettled(
      newlyMarked.map(async (profileId) => {
        try {
          await completeSequence(profileId);
        } catch (err) {
          console.error(
            `[checkouts-create] completeSequence failed for ${profileId}:`,
            err,
          );
        }
        try {
          await startFlow(profileId, email, firstName, "abandon");
        } catch (err) {
          console.error(
            `[checkouts-create] startFlow(abandon) failed for ${profileId}:`,
            err,
          );
        }
      }),
    );

    console.log(
      `[checkouts-create] email=${email} newlyMarked=${newlyMarked.length} alreadyMarked=${alreadyMarked.length} token=${checkoutToken}`,
    );
    return NextResponse.json({
      ok: true,
      newlyMarked: newlyMarked.length,
      alreadyMarked: alreadyMarked.length,
    });
  } catch (err) {
    console.error("[checkouts-create] handler failed:", err);
    // 2xx so Shopify doesn't retry forever — webhook_receipts logs the attempt.
    return NextResponse.json({ ok: false, error: "handler_failed" });
  }
}
