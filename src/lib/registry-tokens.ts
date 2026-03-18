/**
 * HMAC-signed tokens for registry review magic links.
 * Uses Node.js built-in crypto — no extra dependencies.
 *
 * Token format: base64url(JSON payload) + "." + HMAC-SHA256 signature
 * Expiry: 7 days
 */

import crypto from "crypto";

const TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function getSecret(): string {
  const secret = process.env.REGISTRY_TOKEN_SECRET;
  if (!secret) throw new Error("REGISTRY_TOKEN_SECRET env var is not set");
  return secret;
}

export type ReviewAction = "approve" | "reject";

interface TokenPayload {
  uid: string;
  action: ReviewAction;
  exp: number;
}

export function createReviewToken(uid: string, action: ReviewAction): string {
  const payload: TokenPayload = { uid, action, exp: Date.now() + TOKEN_TTL_MS };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto
    .createHmac("sha256", getSecret())
    .update(encoded)
    .digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyReviewToken(
  token: string
): { uid: string; action: ReviewAction } | null {
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const encoded = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);

  const expectedSig = crypto
    .createHmac("sha256", getSecret())
    .update(encoded)
    .digest("base64url");

  // Constant-time comparison to prevent timing attacks
  if (
    sig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
  ) {
    return null;
  }

  let payload: TokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString()) as TokenPayload;
  } catch {
    return null;
  }

  if (Date.now() > payload.exp) return null;

  return { uid: payload.uid, action: payload.action };
}
