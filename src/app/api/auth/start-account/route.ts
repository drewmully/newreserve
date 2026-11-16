/**
 * POST /api/auth/start-account
 *
 * Creates a NEW Firebase Auth user with no password and issues a custom
 * token so the client can sign in immediately.
 *
 * Used by the low-friction onboarding flow:
 *   EmailCTA -> /api/auth/start-account -> client signs in -> /choose-plan
 *
 * SECURITY: this endpoint is unauthenticated and the caller has not proven
 * they own the email address. It must therefore NEVER issue a sign-in token
 * for an account that already exists (that would let anyone sign in as any
 * customer or admin just by knowing their email). For existing accounts it
 * returns `{ exists: true }` and the client sends the user to /login, where
 * they prove ownership with a magic link or Google.
 *
 * New users start as tier='free' with `auth_method: 'email_only'` and
 * `password_set: false`. The /home page enforces a one-time password or
 * magic-link gate on the first visit so they can come back later. We do
 * NOT require a password before payment so the EmailCTA -> Shopify path
 * is as low-friction as possible. Sessions minted here carry the
 * `mully_signup: "email_only"` claim and sign_in_provider "custom"; admin
 * APIs reject both (see src/lib/adminTokenPolicy.ts).
 *
 * Body: { email: string, source?: string, utm?: object }
 * Response (new user):      { uid: string, customToken: string, isNewUser: true }
 * Response (existing user): { exists: true }
 *
 * No auth required. Email is the only PII.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { queueKlaviyoContact } from "@/lib/klaviyo/syncState";

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

  const signupSource = source ?? "homepage_email_cta";

  // 1. Existing account? Never issue a token — the caller has not proven
  //    they own this email. Send them to /login instead.
  let alreadyExists = false;
  try {
    await adminAuth.getUserByEmail(email);
    alreadyExists = true;
  } catch (err) {
    const code = (err as { code?: string })?.code;
    if (code !== "auth/user-not-found") {
      console.error("[start-account] getUserByEmail failed:", err);
      return NextResponse.json(
        { error: "Lookup failed" },
        { status: 500 }
      );
    }
  }
  if (alreadyExists) return existingAccountResponse(email, signupSource);

  // 2. Create the new Firebase Auth user.
  let uid: string;
  try {
    const created = await adminAuth.createUser({
      email,
      emailVerified: false,
      // Intentionally no password. The user will set one on first /home
      // visit, or use magic-link sign-in.
    });
    uid = created.uid;
  } catch (createErr) {
    const createCode = (createErr as { code?: string })?.code;
    if (createCode === "auth/email-already-exists") {
      // Race: someone else created this account between the lookup and the
      // create. Treat exactly like an existing account — no token.
      return existingAccountResponse(email, signupSource);
    }
    console.error("[start-account] createUser failed:", createErr);
    return NextResponse.json(
      { error: "Could not create account" },
      { status: 500 }
    );
  }

  // 3. Create the Firestore profile. Free tier by default. We mark
  //    `password_set: false` so /home knows to prompt the user to set a
  //    password (or send a magic link) on first visit. Only brand-new
  //    users reach this point, so we never touch an existing user's doc.
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
        signup_source: signupSource,
        signup_utm: utm ?? null,
        created_at: Date.now(),
        updated_at: Date.now(),
      });
    }
  } catch (err) {
    // Firestore failure should not block sign-in. The orders-paid webhook
    // and /home loaders both upsert defensively.
    console.error("[start-account] firestore upsert failed:", err);
  }

  // 4. Issue a custom token so the client can sign in without a password.
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

  queueSignupContact(email, signupSource, true);

  return NextResponse.json({ uid, customToken, isNewUser: true });
}

/**
 * Contact only: creating an account is not marketing consent (Firebase's
 * default messaging_preferences are not consent either). Queued for both
 * new and returning emails, exactly as before, so no lead signal is lost.
 * This writes only to the `klaviyo_sync_jobs` queue, never to `users/*`.
 */
function queueSignupContact(email: string, signupSource: string, isNewUser: boolean) {
  queueKlaviyoContact({
    source: "account-start",
    email,
    properties: { mully_account_signup_source: signupSource },
    eventProperties: { signup_source: signupSource, is_new_user: isNewUser },
  });
}

function existingAccountResponse(email: string, signupSource: string) {
  queueSignupContact(email, signupSource, false);
  return NextResponse.json({ exists: true });
}
