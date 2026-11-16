/**
 * Short-lived signed "return token" (server-only).
 *
 * /api/returns/lookup mints it after the shopper proves they know the order
 * number AND the order's email. /api/returns/create and
 * /api/returns/exchange-request require it, so neither can be called for an
 * order the caller hasn't looked up.
 *
 * Format: `<base64url(JSON payload)>.<base64url HMAC-SHA256>`; the MAC covers
 * a fixed domain prefix + the encoded payload, so it can't be confused with
 * any other signature in the app even though the key may be shared.
 *
 * Key: RETURNS_TOKEN_SECRET (preferred), falling back to the existing
 * server-only CRON_SECRET, mirroring CHECKOUT_IDENTITY_SECRET in
 * src/lib/checkoutIdentity.ts. Keys shorter than 16 chars are ignored. With
 * no key, signing returns null and create/exchange fail closed with a
 * friendly "email us" message.
 */
import { createHmac, timingSafeEqual } from "crypto";
import type { OrderReturnType } from "./policy";

const DOMAIN = "mully-returns:v1";
export const RETURN_TOKEN_TTL_SECONDS = 45 * 60;
const MAX_TOKEN_LENGTH = 2000;

export interface ReturnTokenPayload {
  /** Numeric Shopify order id. */
  orderId: string;
  /** Order name, e.g. "#1234". */
  orderName: string;
  /** Order email, trimmed + lowercased. */
  email: string;
  orderType: OrderReturnType;
  /** Expiry, epoch seconds. */
  exp: number;
}

export type ReturnTokenResult =
  | { ok: true; payload: ReturnTokenPayload }
  | { ok: false; reason: "missing" | "invalid" | "expired" | "unconfigured" };

function signingKey(): string | null {
  const key = process.env.RETURNS_TOKEN_SECRET || process.env.CRON_SECRET || "";
  return key.length >= 16 ? key : null;
}

export function isReturnTokenConfigured(): boolean {
  return signingKey() !== null;
}

function mac(key: string, encoded: string): Buffer {
  return createHmac("sha256", key).update(`${DOMAIN}:${encoded}`).digest();
}

export function signReturnToken(
  input: Omit<ReturnTokenPayload, "exp">,
  nowMs = Date.now()
): string | null {
  const key = signingKey();
  if (!key) return null;
  const payload: ReturnTokenPayload = {
    orderId: input.orderId,
    orderName: input.orderName,
    email: input.email.trim().toLowerCase(),
    orderType: input.orderType,
    exp: Math.floor(nowMs / 1000) + RETURN_TOKEN_TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${encoded}.${mac(key, encoded).toString("base64url")}`;
}

export function verifyReturnToken(token: unknown, nowMs = Date.now()): ReturnTokenResult {
  const key = signingKey();
  if (!key) return { ok: false, reason: "unconfigured" };
  if (typeof token !== "string" || !token) return { ok: false, reason: "missing" };
  if (token.length > MAX_TOKEN_LENGTH) return { ok: false, reason: "invalid" };
  const parts = token.split(".");
  if (parts.length !== 2) return { ok: false, reason: "invalid" };
  const [encoded, sigRaw] = parts;
  if (!/^[A-Za-z0-9_-]+$/.test(encoded) || !/^[A-Za-z0-9_-]{43}$/.test(sigRaw)) {
    return { ok: false, reason: "invalid" };
  }
  const expected = mac(key, encoded);
  const actual = Buffer.from(sigRaw, "base64url");
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
    return { ok: false, reason: "invalid" };
  }
  let payload: ReturnTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8")) as ReturnTokenPayload;
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (
    !payload ||
    typeof payload.orderId !== "string" ||
    !/^\d{1,20}$/.test(payload.orderId) ||
    typeof payload.email !== "string" ||
    !payload.email ||
    typeof payload.orderName !== "string" ||
    (payload.orderType !== "pro_shop" && payload.orderType !== "subscription") ||
    typeof payload.exp !== "number"
  ) {
    return { ok: false, reason: "invalid" };
  }
  if (Math.floor(nowMs / 1000) > payload.exp) return { ok: false, reason: "expired" };
  return { ok: true, payload };
}

/** Client-facing errors for token failures (stable `code` for the UI). */
export function returnTokenError(reason: Exclude<ReturnTokenResult, { ok: true }>["reason"]): {
  status: number;
  body: { error: string; code: string };
} {
  if (reason === "unconfigured") {
    return {
      status: 503,
      body: {
        error: "Online returns are temporarily unavailable. Please email info@mymully.com and we'll help.",
        code: "returns_unavailable",
      },
    };
  }
  if (reason === "expired") {
    return {
      status: 401,
      body: {
        error: "Your session expired. Please look up your order again.",
        code: "return_token_expired",
      },
    };
  }
  return {
    status: 401,
    body: {
      error: "Please look up your order again to continue.",
      code: "return_token_invalid",
    },
  };
}
