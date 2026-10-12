import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

const b64url = (buf: Buffer | string) => Buffer.from(buf).toString("base64url");

/** Verify an HS256 JWT issued by Shopify for the post-purchase extension. */
export function verifyHs256<T = Record<string, unknown>>(token: string, secret: string): T {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) throw new Error("malformed token");
  const header = JSON.parse(Buffer.from(h, "base64url").toString());
  if (header.alg !== "HS256") throw new Error("unexpected alg");
  const expected = createHmac("sha256", secret).update(`${h}.${p}`).digest();
  const given = Buffer.from(s, "base64url");
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw new Error("bad signature");
  const payload = JSON.parse(Buffer.from(p, "base64url").toString()) as T & { exp?: number };
  if (payload.exp && payload.exp * 1000 < Date.now()) throw new Error("expired");
  return payload;
}

export function signHs256(payload: Record<string, unknown>, secret: string): string {
  const h = b64url(JSON.stringify({ alg: "HS256", typ: "JWT" }));
  const p = b64url(JSON.stringify(payload));
  const s = createHmac("sha256", secret).update(`${h}.${p}`).digest("base64url");
  return `${h}.${p}.${s}`;
}

export const newJti = () => randomUUID();
