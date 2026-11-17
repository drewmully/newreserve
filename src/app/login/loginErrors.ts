/**
 * Pure helpers for /login: Firebase Auth error copy, email normalisation and
 * email-link URL cleanup. Kept free of React/Firebase imports so they can be
 * unit tested directly.
 */

export type AuthErrorContext = "send" | "link" | "google";

/** Shown whenever an email sign-in link can no longer be used. */
export const DEAD_LINK_MESSAGE =
  "This link expired or was already used — we can send you a fresh one.";

export const WRONG_EMAIL_FOR_LINK_MESSAGE =
  "This link was sent to a different email. Enter the address the email was sent to.";

export const IN_APP_BROWSER_GOOGLE_HINT =
  "Google sign-in doesn't work inside this app's browser. Open this page in Safari or Chrome, or use the email link below.";

const GENERIC = "Something went wrong. Please try again.";

const COMMON: Record<string, string> = {
  "auth/invalid-email": "Please enter a valid email address.",
  "auth/missing-email": "Enter your email address to continue.",
  "auth/too-many-requests": "Too many attempts. Please wait a few minutes and try again.",
  // Firebase's daily email-link send cap (only reachable on the fallback sender).
  "auth/quota-exceeded":
    "We've hit our sign-in email limit for now. Please try again later, or sign in with Google.",
  "auth/unauthorized-continue-uri": "Sign-in is not configured for this domain.",
  "auth/expired-action-code": DEAD_LINK_MESSAGE,
  "auth/invalid-action-code": DEAD_LINK_MESSAGE,
  "auth/user-disabled": "This account has been disabled. Contact info@mymully.com for help.",
  "auth/network-request-failed":
    "We couldn't reach the sign-in service. Check your connection and try again.",
  "auth/popup-blocked":
    "Your browser blocked the Google sign-in window. Allow pop-ups for this site and try again, or use the email link below.",
  "auth/popup-closed-by-user":
    "The Google sign-in window was closed before it finished. Try again, or use the email link below.",
  "auth/cancelled-popup-request":
    "The Google sign-in window was closed before it finished. Try again, or use the email link below.",
  "auth/operation-not-supported-in-this-environment": IN_APP_BROWSER_GOOGLE_HINT,
  "auth/web-storage-unsupported": IN_APP_BROWSER_GOOGLE_HINT,
  "auth/account-exists-with-different-credential":
    "This email already has a Mully account with a different sign-in method. Use the email link below to sign in.",
};

/** User-facing copy for a Firebase Auth error code. */
export function mapAuthError(code: string, context: AuthErrorContext = "send"): string {
  if (code === "auth/invalid-email" && context === "link") return WRONG_EMAIL_FOR_LINK_MESSAGE;
  return COMMON[code] ?? GENERIC;
}

/** Errors where retrying the same email-link sign-in can never succeed. */
const NON_RETRYABLE = new Set([
  "auth/invalid-action-code",
  "auth/expired-action-code",
  "auth/invalid-email",
  "auth/missing-email",
  "auth/user-disabled",
  "auth/argument-error",
]);

export function isRetryableAuthError(err: unknown): boolean {
  const code = (err as { code?: string })?.code ?? "";
  return !NON_RETRYABLE.has(code);
}

/**
 * A wrong email (auth/invalid-email) leaves the link's one-time code unused,
 * so the user can try again with the right address. Every other confirm
 * failure means this link is dead and we should offer a fresh one.
 */
export function isWrongEmailForLink(err: unknown): boolean {
  return ((err as { code?: string })?.code ?? "") === "auth/invalid-email";
}

/** Popup flow failures where a full-page redirect is worth trying. */
export function shouldFallBackToGoogleRedirect(code: string, inAppBrowser: boolean): boolean {
  // Google refuses OAuth inside embedded webviews (disallowed_useragent), so
  // a redirect cannot help in Instagram/Facebook/TikTok in-app browsers.
  if (inAppBrowser) return false;
  return code === "auth/operation-not-supported-in-this-environment" || code === "auth/popup-blocked";
}

const IN_APP_UA = /(Instagram|FBAN|FBAV|FB_IAB|FBIOS|FB4A|Messenger|Line\/|TikTok|musical_ly|Bytedance|Snapchat|Pinterest|LinkedInApp|; wv\))/i;

export function isInAppBrowser(userAgent: string | undefined | null): boolean {
  return !!userAgent && IN_APP_UA.test(userAgent);
}

// Deliberately simple: one "@", no spaces, a dot in the domain.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}

export function isValidEmail(value: string): boolean {
  return value.length <= 254 && EMAIL_RE.test(value);
}

/** Query params Firebase appends to an email sign-in link. */
const EMAIL_LINK_PARAMS = ["apiKey", "oobCode", "mode", "lang", "continueUrl", "tenantId"];

/**
 * Returns the URL with the Firebase one-time-code params removed but every
 * other param (returnTo, paid, utm_*) kept, so a refresh never retries a
 * dead link and the post-sign-in routing still works.
 */
export function stripEmailLinkParams(href: string): string {
  const url = new URL(href);
  for (const key of EMAIL_LINK_PARAMS) url.searchParams.delete(key);
  const search = url.searchParams.toString();
  return `${url.pathname}${search ? `?${search}` : ""}${url.hash}`;
}
