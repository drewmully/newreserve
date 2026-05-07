/**
 * POST /api/users/sync-hub
 *
 * Server-side route called by MembershipContext after every Firebase
 * sign-in / profile update. It re-reads the user's Firestore doc and
 * forwards a signed payload to mully-hub's Firebase webhook so that
 * Supabase customers stay in lock-step with Firestore in real time.
 *
 * Auth: caller passes a Firebase ID token (Authorization: Bearer …)
 *       which we verify server-side via firebase-admin. The shared
 *       HMAC secret never leaves the server.
 *
 * Fire-and-forget from the client. We return 200 fast; on hub error
 * we still 200 so we don't block sign-in UX. Logged for visibility.
 */
import { NextRequest, NextResponse } from "next/server";
import { createHmac } from "node:crypto";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  // 1. Verify Firebase ID token
  const authHeader = request.headers.get("authorization") ?? "";
  const idToken = authHeader.replace(/^Bearer\s+/i, "").trim();
  if (!idToken) {
    return NextResponse.json({ error: "Missing token" }, { status: 401 });
  }

  let uid: string;
  let email: string | undefined;
  try {
    const decoded = await adminAuth.verifyIdToken(idToken, true);
    uid = decoded.uid;
    email = decoded.email;
  } catch (err) {
    console.warn("[sync-hub] verifyIdToken failed:", err);
    return NextResponse.json({ error: "Invalid token" }, { status: 401 });
  }

  // 2. Read latest Firestore profile (best effort — we can still
  //    notify with just uid+email if the doc isn't there yet)
  let profile: Record<string, unknown> = {};
  try {
    const snap = await adminDb.collection("users").doc(uid).get();
    if (snap.exists) {
      profile = (snap.data() ?? {}) as Record<string, unknown>;
    }
  } catch (err) {
    console.warn("[sync-hub] firestore read failed:", err);
  }

  const payloadEmail =
    (typeof profile.email === "string" && profile.email) || email || "";
  if (!payloadEmail) {
    // Hub requires email; nothing to do (e.g. anonymous user).
    return NextResponse.json({ ok: true, skipped: "no_email" });
  }

  // 3. Build payload matching mully-hub's webhook contract
  //    (see mully-hub/src/app/api/firebase/webhook/route.ts).
  //    Firestore Timestamps stringify cleanly; the hub mapper
  //    handles the various shapes via FirestoreUserDoc.
  const payload = {
    uid,
    email: payloadEmail,
    created_at: profile.created_at,
    updated_at: profile.updated_at,
    last_login: profile.last_login,
    shopify_customer_id: profile.shopify_customer_id ?? null,
    username: profile.username,
    onboarding_completed: profile.onboarding_completed,
    tier: profile.tier,
    segments: profile.segments,
    messaging_preferences: profile.messaging_preferences,
    onboarding_profile: profile.onboarding_profile,
    store_credit: profile.store_credit,
    subscriptions: profile.subscriptions,
  };
  const body = JSON.stringify(payload);

  // 4. Sign + POST to mully-hub
  const url = process.env.MULLY_HUB_WEBHOOK_URL;
  const secret = process.env.FIREBASE_WEBHOOK_SECRET;
  if (!url || !secret) {
    console.warn("[sync-hub] MULLY_HUB_WEBHOOK_URL or FIREBASE_WEBHOOK_SECRET not set");
    return NextResponse.json({ ok: true, skipped: "not_configured" });
  }

  const sig = createHmac("sha256", secret).update(body, "utf8").digest("hex");

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-firebase-signature": sig,
      },
      body,
      // Hub responds in ~50-150ms; cap conservatively.
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      console.warn(`[sync-hub] hub responded ${res.status}: ${text.slice(0, 300)}`);
      return NextResponse.json({ ok: true, hub_status: res.status });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.warn("[sync-hub] fetch to hub failed:", err);
    return NextResponse.json({ ok: true, error: "hub_unreachable" });
  }
}
