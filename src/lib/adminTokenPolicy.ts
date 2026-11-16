/**
 * Single source of truth for "is this Firebase ID token allowed to act as an
 * admin?". Used by every server-side admin check (src/app/api/_lib/adminAuth.ts
 * and the inline verifyAdmin helpers in /api/admin/*) and by the client-side
 * admin gates (AdminGate, /admin layout) so the UI never shows admin pages to
 * a session the API would reject.
 *
 * Pure function with no Firebase imports, so it works with both the Admin
 * SDK's DecodedIdToken and the client SDK's IdTokenResult.claims.
 *
 * Why each rule exists:
 *  - sign_in_provider "custom": custom tokens are minted by our own server.
 *    /api/auth/start-account used to mint one for ANY existing email without
 *    proof of ownership, and a custom-token session inherits the user record's
 *    email (and email_verified) claim. No admin flow signs in with a custom
 *    token, so any custom session is rejected for admin access.
 *  - mully_signup "email_only": the developer claim attached by start-account.
 *    Belt-and-braces with the provider check (claims persist across refresh).
 *  - sign_in_provider "anonymous": never an admin.
 *  - email_verified !== true: the app's only interactive sign-in methods are
 *    Google (Google always asserts a verified email for Google/Workspace
 *    accounts) and Firebase email link (signing in with the link marks the
 *    email verified). There is no email+password sign-in UI anywhere in the
 *    app. Requiring a verified email blocks someone who creates an
 *    unverified email/password account for an allowlisted address directly
 *    against the public Identity Toolkit API.
 */

import { isAllowedAdminEmail } from "./adminEmailAllowlist";

export type AdminTokenClaims = Record<string, unknown>;

export type AdminTokenRejection =
  | "missing_email"
  | "not_allowlisted"
  | "custom_token_session"
  | "email_only_signup"
  | "anonymous_session"
  | "email_not_verified";

const BLOCKED_PROVIDERS = new Set(["custom", "anonymous"]);

function signInProvider(claims: AdminTokenClaims): string | null {
  const firebase = claims.firebase;
  if (!firebase || typeof firebase !== "object") return null;
  const provider = (firebase as { sign_in_provider?: unknown }).sign_in_provider;
  return typeof provider === "string" ? provider : null;
}

/**
 * Returns why this token's *session* is not strong enough for admin access,
 * or null if it is. Does not check the email allowlist.
 */
export function adminSessionRejection(claims: AdminTokenClaims): AdminTokenRejection | null {
  const provider = signInProvider(claims);
  if (provider === "custom") return "custom_token_session";
  if (provider && BLOCKED_PROVIDERS.has(provider)) return "anonymous_session";
  if (claims.mully_signup === "email_only") return "email_only_signup";
  if (claims.email_verified !== true) return "email_not_verified";
  return null;
}

/**
 * Full admin decision for a decoded ID token. `email` overrides the token's
 * email claim (used when the caller had to look the email up separately).
 */
export function adminTokenRejection(
  claims: AdminTokenClaims,
  options: { email?: string | null; allowlist?: string | null } = {},
): AdminTokenRejection | null {
  const email =
    options.email ?? (typeof claims.email === "string" ? claims.email : null);
  if (!email) return "missing_email";
  if (!isAllowedAdminEmail(email, options.allowlist)) return "not_allowlisted";
  return adminSessionRejection(claims);
}

export function isAdminIdToken(
  claims: AdminTokenClaims,
  options: { email?: string | null; allowlist?: string | null } = {},
): boolean {
  return adminTokenRejection(claims, options) === null;
}
