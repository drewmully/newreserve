/**
 * POST /api/auth/start-account
 *
 * Creates a Firebase Auth user with no password (or returns the existing one)
 * and issues a custom token so the client can sign in immediately.
 *
 * Used by the new low-friction onboarding flow:
 *   EmailCTA -> /api/auth/start-account -> client signs in -> /choose-plan
 *
 * The user starts as tier='free' with `auth_method: 'email_only'` and
 * `password_set: false`. The /home page enforces a one-time password or
 * magic-link gate on the first visit so they can come back later. We do
 * NOT require a password before payment so the EmailCTA -> Shopify path
 * is as low-friction as possible.
 *
 * Body: { email: string }
 * Response: { uid: string, customToken: string, isNewUser: boolean }
 *
 * No auth required. Email is the only PII. Rate-limited implicitly by
 * Firebase Admin SDK + downstream Firestore.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";

interface StartAccountBody {
  email?: unknown;
  source?: unknown;
  utm?: unknown;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export async function POST(request: NextRequest) {
  let email: string;
  let source: string | undefined;
  let utm: Record<string, unknown> | undefined;

  try {
    const body = (await request.json()) as StartAccountBody;
    if (typeof body.email !== "string") {
      return NextResponse.json(
        { error: "Missing email" },
        { status: 400 }
      );
    }
    email = body.email.trim().toLowerCase();
    if (!EMAIL_RE.test(email)) {
      return NextResponse.json(
        { error: "Invalid email" },
        { status: 400 }
      );
    }
    if (typeof body.source === "string") source = body.source;
    if (body.utm && typeof body.utm === "object") {
      utm = body.utm as Record<string, unknown>;
    }
  } catch {
    return NextResponse.json({ error: "Invalid body" }, { status: 400 });
  }

  let uid: string;
  let isNewUser = false;

  // 1. Create or look up the Firebase Auth user.
  try {
    const existing = await adminAuth.getUserByEmail(email);
    uid = existing.uid;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== "auth/user-not-found") {
      console.error("[start-account] getUserByEmail failed:", err);
      return NextResponse.json(
        { error: "Lookup failed" },
        { status: 500 }
      );
    }

    try {
      const created = await adminAuth.createUser({
        email,
        emailVerified: false,
        // Intentionally no password. The user will set one on first /home
        // visit, or use magic-link sign-in.
      });
      uid = created.uid;
      isNewUser = true;
    } catch (createErr) {
      const createCode = (createErr as { code?: string })?.code;
      if (createCode === "auth/email-already-exists") {
        // Race condition — fetch again.
        try {
          const after = await adminAuth.getUserByEmail(email);
          uid = after.uid;
        } catch (fetchErr) {
          console.error("[start-account] race fetch failed:", fetchErr);
          return NextResponse.json(
            { error: "Account exists" },
            { status: 500 }
          );
        }
      } else {
        console.error("[start-account] createUser failed:", createErr);
        return NextResponse.json(
          { error: "Could not create account" },
          { status: 500 }
        );
      }
    }
  }

  // 2. Ensure a Firestore profile exists. Free tier by default. We mark
  //    `password_set: false` so /home knows to prompt the user to set a
  //    password (or send a magic link) on first visit.
  try {
    const userRef = adminDb.collection("users").doc(uid);
    const snap = await userRef.get();
    if (!snap.exists) {
      await userRef.set({
        email,
        tier: "free",
        onboarding_completed: false,
        password_set: false,
        auth_method: "email_only",
        signup_source: source ?? "homepage_email_cta",
        signup_utm: utm ?? null,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    } else {
      const data = snap.data() ?? {};
      const updates: Record<string, unknown> = { updated_at: Date.now() };
      // Only set tier=free if the user has no tier yet (do NOT overwrite
      // a paid tier coming back through this endpoint).
      if (!data.tier) updates.tier = "free";
      if (data.password_set === undefined) updates.password_set = false;
      if (!data.auth_method) updates.auth_method = "email_only";
      await userRef.set(updates, { merge: true });
    }
  } catch (err) {
    // Firestore failure should not block sign-in. The orders-paid webhook
    // and /home loaders both upsert defensively.
    console.error("[start-account] firestore upsert failed:", err);
  }

  // 3. Issue a custom token so the client can sign in without a password.
  let customToken: string;
  try {
    customToken = await adminAuth.createCustomToken(uid, {
      // Optional claim so we can detect "this session was started via the
      // passwordless EmailCTA flow" downstream.
      mully_signup: "email_only",
    });
  } catch (err) {
    console.error("[start-account] createCustomToken failed:", err);
    return NextResponse.json(
      { error: "Token issuance failed" },
      { status: 500 }
    );
  }

  return NextResponse.json({ uid, customToken, isNewUser });
}
