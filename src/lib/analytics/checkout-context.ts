import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
export type CheckoutContext = {
  v: 1; project: string; shop: string; checkoutId: string; sessionId: string;
  subjectBinding: string; issuedAt: number; expiresAt: number; nonce: string;
};
function mac(text: string, secret: string): Buffer {
  if (secret.length < 32) throw new Error("weak_context_secret");
  return createHmac("sha256", secret).update(text).digest();
}
export function signCheckoutContext(input: {
  project: string; shop: string; checkoutId: string; sessionId: string; serverSubject: string;
  analyticsPermitted: boolean; now: number; ttlSeconds: number;
}, secret: string): string | null {
  if (input.analyticsPermitted !== true) return null;
  if (![input.project, input.shop, input.checkoutId, input.serverSubject].every(s => s.length > 0 && s.length <= 200) ||
      !/^[a-f0-9-]{32,64}$/i.test(input.sessionId) || !Number.isSafeInteger(input.now) ||
      !Number.isInteger(input.ttlSeconds) || input.ttlSeconds < 60 || input.ttlSeconds > 86400) throw new Error("invalid_context");
  const context: CheckoutContext = {
    v: 1, project: input.project, shop: input.shop, checkoutId: input.checkoutId, sessionId: input.sessionId,
    subjectBinding: mac(JSON.stringify([input.project, input.shop, input.serverSubject]), secret).toString("hex"),
    issuedAt: input.now, expiresAt: input.now + input.ttlSeconds, nonce: randomUUID(),
  };
  const encoded = Buffer.from(JSON.stringify(context)).toString("base64url");
  return `${encoded}.${mac(encoded, secret).toString("base64url")}`;
}
/** A valid token proves context integrity, NOT customer identity/order ownership. */
export function verifyCheckoutContext(token: string, expected: {
  project: string; shop: string; checkoutId: string; serverSubject: string;
  analyticsPermitted: boolean; now: number;
}, secret: string): CheckoutContext | null {
  if (expected.analyticsPermitted !== true || token.length > 3000) return null;
  try {
    const parts = token.split(".");
    if (parts.length !== 2 || !/^[a-zA-Z0-9_-]+$/.test(parts[0]) || !/^[a-zA-Z0-9_-]{43}$/.test(parts[1])) return null;
    const actual = Buffer.from(parts[1], "base64url"), signature = mac(parts[0], secret);
    if (actual.length !== signature.length || !timingSafeEqual(actual, signature)) return null;
    const c: CheckoutContext = JSON.parse(Buffer.from(parts[0], "base64url").toString());
    if (c.v !== 1 || c.project !== expected.project || c.shop !== expected.shop || c.checkoutId !== expected.checkoutId ||
        c.subjectBinding !== mac(JSON.stringify([expected.project, expected.shop, expected.serverSubject]), secret).toString("hex") ||
        !Number.isSafeInteger(c.issuedAt) || !Number.isSafeInteger(c.expiresAt) ||
        c.issuedAt > expected.now || c.expiresAt <= expected.now || c.expiresAt - c.issuedAt > 86400 ||
        !/^[a-f0-9-]{32,64}$/i.test(c.sessionId) || !/^[a-f0-9-]{36}$/i.test(c.nonce)) return null;
    return c;
  } catch { return null; }
}
