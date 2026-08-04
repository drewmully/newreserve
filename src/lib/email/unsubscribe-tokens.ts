/**
 * HMAC-signed tokens for the unsubscribe / preference flow.
 * Mirrors the pattern in src/lib/registry-tokens.ts (base64url JSON payload
 * + HMAC-SHA256 signature, no external JWT dependency).
 *
 * Token format: base64url(JSON payload) + "." + HMAC-SHA256 signature
 * Expiry: 180 days (long-lived — these links sit in inboxes indefinitely).
 */

import crypto from "crypto";

const TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000; // 180 days

function getSecret(): string {
  const secret = process.env.UNSUBSCRIBE_TOKEN_SECRET || process.env.REGISTRY_TOKEN_SECRET;
  if (!secret) {
    throw new Error(
      "UNSUBSCRIBE_TOKEN_SECRET (or REGISTRY_TOKEN_SECRET) env var is not set"
    );
  }
  return secret;
}

export interface UnsubscribeTokenPayload {
  /** Recipient email, lowercased. */
  email: string;
  /** Origin reference — e.g. campaign_recipients.id ("rid") — for audit only. */
  rid?: string;
  exp: number;
}

export function createUnsubscribeToken(email: string, rid?: string): string {
  const payload: UnsubscribeTokenPayload = {
    email: email.trim().toLowerCase(),
    rid,
    exp: Date.now() + TOKEN_TTL_MS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", getSecret()).update(encoded).digest("base64url");
  return `${encoded}.${sig}`;
}

export function verifyUnsubscribeToken(token: string): UnsubscribeTokenPayload | null {
  const dotIndex = token.lastIndexOf(".");
  if (dotIndex === -1) return null;

  const encoded = token.slice(0, dotIndex);
  const sig = token.slice(dotIndex + 1);

  const expectedSig = crypto.createHmac("sha256", getSecret()).update(encoded).digest("base64url");

  if (
    sig.length !== expectedSig.length ||
    !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expectedSig))
  ) {
    return null;
  }

  let payload: UnsubscribeTokenPayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString()) as UnsubscribeTokenPayload;
  } catch {
    return null;
  }

  if (typeof payload.email !== "string" || !payload.email) return null;
  if (Date.now() > payload.exp) return null;

  return payload;
}
