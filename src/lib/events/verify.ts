/**
 * Inbound webhook signature verification, in one place.
 *
 * The Shopify HMAC check below was previously copy-pasted into each of the
 * three /api/webhooks/shopify/* routes. Those routes now import this instead.
 * The behaviour is byte-for-byte what all three copies did: same header, same
 * secret, same base64 digest, same timingSafeEqual, false on any error.
 */

import crypto from "crypto";

export const SHOPIFY_HMAC_HEADER = "x-shopify-hmac-sha256";
export const SHOPIFY_WEBHOOK_ID_HEADER = "x-shopify-webhook-id";
export const SHOPIFY_TOPIC_HEADER = "x-shopify-topic";
export const LOOP_TOKEN_HEADER = "x-loop-token";

interface HeaderBag {
  get(name: string): string | null;
}

/**
 * Verifies a Shopify webhook HMAC over the exact raw body.
 *
 * Callers must pass the unparsed request body — re-serialising the JSON
 * changes the bytes and the signature will not match.
 */
export function verifyShopifyHmac(
  headers: HeaderBag,
  rawBody: string,
  secret: string | undefined = process.env.SHOPIFY_WEBHOOK_SECRET,
): boolean {
  if (!secret) return false;

  const hmacHeader = headers.get(SHOPIFY_HMAC_HEADER);
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

/**
 * Constant-time string compare. Both sides are hashed first so that inputs of
 * differing length are still compared in constant time — timingSafeEqual
 * throws on a length mismatch, which would otherwise leak the secret's length.
 */
function safeEqual(a: string, b: string): boolean {
  const ha = crypto.createHash("sha256").update(a, "utf8").digest();
  const hb = crypto.createHash("sha256").update(b, "utf8").digest();
  return crypto.timingSafeEqual(ha, hb);
}

/**
 * Loop publishes no signature scheme, so the callback is authenticated with a
 * shared secret instead: header `x-loop-token`, or `?token=` for the case where
 * Loop's console will not let a custom header be configured.
 *
 * Returns false when LOOP_WEBHOOK_TOKEN is unset — an unconfigured receiver
 * must reject, not accept.
 */
export function verifyLoopToken(
  headers: HeaderBag,
  url: string,
  expected: string | undefined = process.env.LOOP_WEBHOOK_TOKEN,
): boolean {
  if (!expected) return false;

  const presented =
    headers.get(LOOP_TOKEN_HEADER) ??
    (() => {
      try {
        return new URL(url).searchParams.get("token");
      } catch {
        return null;
      }
    })();

  if (!presented) return false;
  return safeEqual(presented, expected);
}
