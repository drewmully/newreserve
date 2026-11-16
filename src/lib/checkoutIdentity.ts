/**
 * Signed Firebase uid carried on Shopify checkouts (server-only).
 *
 * Why: the orders-paid webhook used to find the buyer's MyMully account only
 * by Shopify customer id or checkout email. A signed-in member who checked
 * out with a different (or differently-cased) email ended up with a second
 * account, or overwrote their own profile. Membership carts created by a
 * signed-in user now carry `_mully_uid_token`, which the webhook verifies and
 * uses first.
 *
 * Format: `<uid>.<issuedAtSeconds>.<base64url HMAC-SHA256>`.
 * The MAC covers a fixed domain prefix + uid + issuedAt, so the token can't
 * be replayed for a different uid or reused as any other signature in the
 * app even though the key may be shared with other server features.
 *
 * Key: CHECKOUT_IDENTITY_SECRET (preferred), falling back to the existing
 * server-only CRON_SECRET so this works without a new env var. If neither is
 * set (or is shorter than 16 chars) signing returns null and the webhook
 * keeps its email/customer-id matching, i.e. the previous behaviour.
 *
 * The client never sees the key: the token is minted by
 * POST /api/checkout/identity for the bearer of a valid Firebase ID token.
 */
import { createHmac, timingSafeEqual } from "crypto";

export { CHECKOUT_UID_ATTRIBUTE } from "./checkoutIdentityConstants";

const DOMAIN = "mully-checkout-uid:v1";
/** Carts can be recovered from Shopify abandoned-checkout emails for weeks. */
export const CHECKOUT_UID_MAX_AGE_SECONDS = 60 * 60 * 24 * 45;
const CLOCK_SKEW_SECONDS = 5 * 60;
const UID_RE = /^[A-Za-z0-9_-]{1,128}$/;

function signingKey(): string | null {
  const key = process.env.CHECKOUT_IDENTITY_SECRET || process.env.CRON_SECRET || "";
  return key.length >= 16 ? key : null;
}

function mac(key: string, uid: string, issuedAt: number): Buffer {
  return createHmac("sha256", key).update(`${DOMAIN}:${uid}:${issuedAt}`).digest();
}

export function signCheckoutUid(uid: string, nowMs = Date.now()): string | null {
  const key = signingKey();
  if (!key || !UID_RE.test(uid)) return null;
  const issuedAt = Math.floor(nowMs / 1000);
  return `${uid}.${issuedAt}.${mac(key, uid, issuedAt).toString("base64url")}`;
}

/** Returns the uid when the token is authentic and fresh, otherwise null. */
export function verifyCheckoutUid(token: string | null | undefined, nowMs = Date.now()): string | null {
  const key = signingKey();
  if (!key || typeof token !== "string" || token.length > 400) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [uid, issuedRaw, sigRaw] = parts;
  if (!UID_RE.test(uid) || !/^\d{1,12}$/.test(issuedRaw) || !/^[A-Za-z0-9_-]{43}$/.test(sigRaw)) return null;
  const issuedAt = Number(issuedRaw);
  const now = Math.floor(nowMs / 1000);
  if (issuedAt > now + CLOCK_SKEW_SECONDS || now - issuedAt > CHECKOUT_UID_MAX_AGE_SECONDS) return null;
  const expected = mac(key, uid, issuedAt);
  const actual = Buffer.from(sigRaw, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return null;
  return uid;
}

/** Lowercased, trimmed email or null. Firebase Auth stores emails lowercased. */
export function normalizeAccountEmail(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email || null;
}
