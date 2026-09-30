/** Encrypted continuation, not provider identity/completeness proof. No I/O. */
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes, timingSafeEqual } from "node:crypto";
type Context = { projectRef: string; planId: string; cycle: number; page: number };
function context(c: Context) {
  if (!/^[a-z]{20}$/.test(c.projectRef) || !/^[A-Za-z0-9_-]{1,60}$/.test(c.planId) || !Number.isSafeInteger(c.cycle) || c.cycle < 1 || c.cycle > 96 ||
      !Number.isSafeInteger(c.page) || c.page < 1 || c.page > 21) throw new Error("subscription_cursor_context");
  return JSON.stringify([c.projectRef, "mullybox-store.myshopify.com", c.planId, c.cycle, c.page]);
}
function keys(token: string) {
  if (typeof window !== "undefined" || token.length < 16 || token.length > 4096) throw new Error("subscription_cursor_configuration");
  return {
    encryption: Buffer.from(hkdfSync("sha256", token, "lean-loop-cursor-v1", "encryption", 32)),
    fingerprint: Buffer.from(hkdfSync("sha256", token, "lean-loop-cursor-v1", "cycle-detection", 32)),
  };
}
function fingerprint(token: string, cursor: string, c: Context) {
  return createHmac("sha256", keys(token).fingerprint).update(JSON.stringify([c.projectRef, c.planId, c.cycle, cursor])).digest("hex");
}
export function sealSubscriptionCursor(token: string, cursor: string | null, c: Context) {
  const aad = context(c);
  if (cursor === null) return { ciphertext: null, fingerprint: null };
  if (!cursor || Buffer.byteLength(cursor) > 4096) throw new Error("subscription_cursor_bounds");
  const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", keys(token).encryption, iv);
  cipher.setAAD(Buffer.from(aad));
  const encrypted = Buffer.concat([cipher.update(cursor, "utf8"), cipher.final()]);
  return { ciphertext: "v1." + Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString("base64url"),
    fingerprint: fingerprint(token, cursor, c) };
}
export function openSubscriptionCursor(token: string, ciphertext: unknown, digest: unknown, c: Context) {
  const aad = context(c);
  if (ciphertext === null && digest === null) return null;
  try {
    if (typeof ciphertext !== "string" || !/^v1\.[A-Za-z0-9_-]{40,8192}$/.test(ciphertext) ||
        typeof digest !== "string" || !/^[a-f0-9]{64}$/.test(digest)) throw new Error();
    const bytes = Buffer.from(ciphertext.slice(3), "base64url");
    const decipher = createDecipheriv("aes-256-gcm", keys(token).encryption, bytes.subarray(0, 12));
    decipher.setAAD(Buffer.from(aad)); decipher.setAuthTag(bytes.subarray(12, 28));
    const cursor = Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8");
    if (!cursor || Buffer.byteLength(cursor) > 4096 ||
      !timingSafeEqual(Buffer.from(fingerprint(token, cursor, c), "hex"), Buffer.from(digest, "hex"))) throw new Error();
    return cursor;
  } catch { throw new Error("subscription_cursor_unavailable"); }
}
