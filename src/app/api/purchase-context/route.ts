/**
 * GET /api/purchase-context
 *
 * Auth: Firebase ID token in the Authorization header.
 *
 * Returns the most recent paid order for the logged-in user so the
 * /auth/callback client can fire a browser-side Meta Purchase pixel with
 * the same `event_id` the server-side CAPI Purchase already used. Meta
 * dedupes the two into a single conversion — that fixes the double-count
 * problem where Meta was reporting 6 sales for 3 real orders.
 *
 * Idempotency: the first call for a given order marks
 * `latest_purchase.event_id_captured = true` in Firestore. Subsequent
 * calls (from refresh / back-button / dashboard load) return
 * `already_captured: true` so the browser skips firing again.
 *
 * The paid_at freshness gate (5 minutes) guards against firing a Purchase
 * pixel for a stale order snapshot — if the user landed on /auth/callback
 * from bookmark or old email link long after the order paid, we do NOT
 * want to send another Purchase pixel to Meta.
 *
 *   Response shapes
 *   ───────────────
 *   { has_purchase: true,  event_id, value, currency, order_id,
 *     already_captured: false }
 *     → browser fires fbq('track','Purchase', {...}, {eventID: event_id})
 *   { has_purchase: true,  already_captured: true }
 *     → browser skips (already fired earlier this session or elsewhere)
 *   { has_purchase: false, reason: 'no_recent_purchase' }
 *     → browser skips (nothing to attribute)
 *   { has_purchase: false, reason: 'stale' }
 *     → browser skips (order was too old, likely a re-visit)
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";

// How recent a paid order must be to still fire the browser Purchase
// pixel. 5 minutes covers Shopify's redirect + Firebase magic-link auth
// round trip with plenty of headroom, without letting a bookmarked
// /auth/callback re-fire a Purchase for an ancient order.
const MAX_PURCHASE_AGE_MS = 5 * 60 * 1000;

interface LatestPurchase {
  shopify_order_id?: string;
  order_number?: string;
  value?: number;
  currency?: string;
  event_id?: string;
  paid_at?: number;
  event_id_captured?: boolean;
}

async function verifyFirebaseBearer(request: NextRequest): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  return decoded.uid;
}

export async function GET(request: NextRequest) {
  let uid: string;
  try {
    uid = await verifyFirebaseBearer(request);
  } catch (err) {
    return NextResponse.json(
      { error: "unauthenticated", detail: err instanceof Error ? err.message : String(err) },
      { status: 401 }
    );
  }

  const userRef = adminDb.collection("users").doc(uid);
  const snap = await userRef.get();
  if (!snap.exists) {
    return NextResponse.json(
      { has_purchase: false, reason: "no_user_doc" },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  const data = snap.data() ?? {};
  const latest = (data.latest_purchase ?? null) as LatestPurchase | null;

  if (
    !latest ||
    !latest.event_id ||
    typeof latest.paid_at !== "number" ||
    typeof latest.value !== "number"
  ) {
    return NextResponse.json(
      { has_purchase: false, reason: "no_recent_purchase" },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  const ageMs = Date.now() - latest.paid_at;
  if (ageMs > MAX_PURCHASE_AGE_MS) {
    return NextResponse.json(
      { has_purchase: false, reason: "stale", age_ms: ageMs },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  if (latest.event_id_captured === true) {
    return NextResponse.json(
      { has_purchase: true, already_captured: true, event_id: latest.event_id },
      { status: 200, headers: { "Cache-Control": "no-store" } }
    );
  }

  // Flip the flag *before* returning so a fast second call from the same
  // browser (e.g. React strict-mode double-invoke in dev) doesn't return
  // already_captured=false twice. Firestore update is fire-and-forget from
  // the browser's perspective; failure to flip is non-fatal — sessionStorage
  // on the client provides a second layer of dedup.
  try {
    await userRef.update({
      "latest_purchase.event_id_captured": true,
      "latest_purchase.event_id_captured_at": Date.now(),
    });
  } catch (err) {
    console.error("[purchase-context] failed to mark captured:", err);
  }

  return NextResponse.json(
    {
      has_purchase: true,
      already_captured: false,
      event_id: latest.event_id,
      value: latest.value,
      currency: latest.currency ?? "USD",
      order_id: latest.shopify_order_id ?? null,
      order_number: latest.order_number ?? null,
    },
    { status: 200, headers: { "Cache-Control": "no-store" } }
  );
}
