/**
 * Who is this visitor, for Klaviyo?
 *
 * mymully.com is headless, so Klaviyo cannot recognise visitors on its own.
 * We only attach site activity to a Klaviyo profile when we know who it is
 * from one of three sources, in priority order:
 *
 *   1. verified  – a signed-in member (Firebase ID token verified server-side,
 *                  email_verified = true).
 *   2. cookie    – a signed, httpOnly `mully_kid` cookie set by our own
 *                  signup routes right after a consented website signup.
 *   3. exchange  – Klaviyo's `_kx` exchange id, which Klaviyo appends to
 *                  links in its emails. It resolves to an existing profile
 *                  only; it never creates one.
 *
 * Anonymous visitors are never sent. Emails never appear in logs.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { IDENTITY_COOKIE, IDENTITY_MAX_AGE_SECONDS, identitySecret } from "./lifecycleConfig";

export type KlaviyoIdentity =
  | { kind: "verified" | "cookie"; email: string }
  | { kind: "exchange"; kx: string };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Klaviyo exchange ids are opaque URL-safe tokens. */
const KX_RE = /^[A-Za-z0-9._~\-]{8,256}$/;

export function normalizeEmail(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL_RE.test(email) ? email : null;
}

export function normalizeExchangeId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const kx = value.trim();
  return KX_RE.test(kx) ? kx : null;
}

const b64url = (s: string) => Buffer.from(s, "utf8").toString("base64url");
const fromB64url = (s: string) => Buffer.from(s, "base64url").toString("utf8");
const mac = (payload: string, secret: string) => createHmac("sha256", secret).update(payload).digest("base64url");

/** `v1.<email b64url>.<expires epoch s>.<hmac>` */
export function signIdentityToken(email: string, secret: string, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + IDENTITY_MAX_AGE_SECONDS;
  const payload = `v1.${b64url(email)}.${exp}`;
  return `${payload}.${mac(payload, secret)}`;
}

export function verifyIdentityToken(token: unknown, secret: string, nowMs = Date.now()): string | null {
  if (typeof token !== "string" || token.length > 600) return null;
  const parts = token.split(".");
  if (parts.length !== 4 || parts[0] !== "v1") return null;
  const payload = parts.slice(0, 3).join(".");
  const expected = Buffer.from(mac(payload, secret));
  const supplied = Buffer.from(parts[3]);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return null;
  const exp = Number(parts[2]);
  if (!Number.isFinite(exp) || exp * 1000 < nowMs) return null;
  try {
    return normalizeEmail(fromB64url(parts[1]));
  } catch {
    return null;
  }
}

export function readCookie(cookieHeader: string | null | undefined, name: string): string | null {
  if (!cookieHeader) return null;
  for (const part of cookieHeader.split(";")) {
    const [k, ...rest] = part.trim().split("=");
    if (k === name) {
      try {
        return decodeURIComponent(rest.join("="));
      } catch {
        return null;
      }
    }
  }
  return null;
}

export interface IdentityInputs {
  verifiedEmail?: string | null;
  cookieHeader?: string | null;
  exchangeId?: unknown;
}

export function resolveKlaviyoIdentity(input: IdentityInputs, nowMs = Date.now()): KlaviyoIdentity | null {
  const verified = normalizeEmail(input.verifiedEmail);
  if (verified) return { kind: "verified", email: verified };

  const secret = identitySecret();
  if (secret) {
    const fromCookie = verifyIdentityToken(readCookie(input.cookieHeader, IDENTITY_COOKIE), secret, nowMs);
    if (fromCookie) return { kind: "cookie", email: fromCookie };
  }

  const kx = normalizeExchangeId(input.exchangeId);
  if (kx) return { kind: "exchange", kx };
  return null;
}

/** Stable, non-reversible key for unique_id construction. Never log the input. */
export function identityKey(identity: KlaviyoIdentity): string {
  const raw = identity.kind === "exchange" ? `kx:${identity.kx}` : `e:${identity.email}`;
  return createHmac("sha256", "mully-klaviyo-unique-id").update(raw).digest("hex").slice(0, 24);
}

/** Klaviyo profile attributes for an event payload. */
export function profileAttributes(identity: KlaviyoIdentity): Record<string, string> {
  return identity.kind === "exchange" ? { _kx: identity.kx } : { email: identity.email };
}

/**
 * Set-Cookie attributes for the identity cookie. Returns null when no signing
 * secret is configured, in which case callers simply skip the cookie.
 */
export function identityCookie(email: string, nowMs = Date.now()) {
  const secret = identitySecret();
  const normalized = normalizeEmail(email);
  if (!secret || !normalized) return null;
  return {
    name: IDENTITY_COOKIE,
    value: signIdentityToken(normalized, secret, nowMs),
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: IDENTITY_MAX_AGE_SECONDS,
  };
}
