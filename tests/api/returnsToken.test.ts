import { createHmac } from "crypto";
import { beforeEach, describe, expect, it } from "vitest";
import {
  RETURN_TOKEN_TTL_SECONDS,
  isReturnTokenConfigured,
  returnTokenError,
  signReturnToken,
  verifyReturnToken,
} from "@/lib/returns/token";

const input = { orderId: "11", orderName: "#1234", email: " Member@Example.com ", orderType: "pro_shop" as const };

describe("return token", () => {
  beforeEach(() => {
    delete process.env.RETURNS_TOKEN_SECRET;
    delete process.env.SHOPIFY_ADMIN_TOKEN;
    delete process.env.SHOPIFY_CLIENT_SECRET;
    process.env.CRON_SECRET = "cron-secret-at-least-16";
  });

  it("works with no RETURNS_TOKEN_SECRET/CRON_SECRET by deriving a key from the Shopify Admin credential", () => {
    delete process.env.CRON_SECRET;
    process.env.SHOPIFY_ADMIN_TOKEN = "shpat_example_admin_token_value";
    expect(isReturnTokenConfigured()).toBe(true);
    const t = signReturnToken(input)!;
    expect(verifyReturnToken(t)).toEqual({ ok: true, payload: expect.objectContaining({ orderId: "11" }) });
    // The raw credential is never the signing key.
    const [encoded, sig] = t.split(".");
    const rawSig = createHmac("sha256", "shpat_example_admin_token_value").update(`mully-returns:v1:${encoded}`).digest("base64url");
    expect(sig).not.toBe(rawSig);
    // A different Shopify credential cannot verify it.
    process.env.SHOPIFY_ADMIN_TOKEN = "shpat_some_other_admin_token__";
    expect(verifyReturnToken(t)).toEqual({ ok: false, reason: "invalid" });
  });

  it("falls back to SHOPIFY_CLIENT_SECRET when no admin token is set", () => {
    delete process.env.CRON_SECRET;
    process.env.SHOPIFY_CLIENT_SECRET = "client-secret-at-least-16";
    expect(isReturnTokenConfigured()).toBe(true);
    expect(verifyReturnToken(signReturnToken(input)!).ok).toBe(true);
  });

  it("CRON_SECRET still takes precedence over the derived Shopify key", () => {
    process.env.SHOPIFY_ADMIN_TOKEN = "shpat_example_admin_token_value";
    const t = signReturnToken(input)!;
    delete process.env.CRON_SECRET;
    expect(verifyReturnToken(t)).toEqual({ ok: false, reason: "invalid" });
  });

  it("falls back to CRON_SECRET and round-trips a normalized payload", () => {
    const t = signReturnToken(input)!;
    const v = verifyReturnToken(t);
    expect(v).toEqual({ ok: true, payload: expect.objectContaining({ orderId: "11", email: "member@example.com", orderName: "#1234", orderType: "pro_shop" }) });
  });

  it("prefers RETURNS_TOKEN_SECRET over CRON_SECRET", () => {
    process.env.RETURNS_TOKEN_SECRET = "dedicated-returns-secret";
    const t = signReturnToken(input)!;
    delete process.env.RETURNS_TOKEN_SECRET;
    expect(verifyReturnToken(t)).toEqual({ ok: false, reason: "invalid" });
  });

  it("is unconfigured (fail closed) with no key or a short key", () => {
    delete process.env.CRON_SECRET;
    expect(isReturnTokenConfigured()).toBe(false);
    expect(signReturnToken(input)).toBeNull();
    expect(verifyReturnToken("x.y")).toEqual({ ok: false, reason: "unconfigured" });
    process.env.CRON_SECRET = "short";
    expect(isReturnTokenConfigured()).toBe(false);
    expect(returnTokenError("unconfigured").status).toBe(503);
  });

  it("rejects missing, malformed and forged tokens", () => {
    expect(verifyReturnToken(undefined)).toEqual({ ok: false, reason: "missing" });
    expect(verifyReturnToken("abc")).toEqual({ ok: false, reason: "invalid" });
    const t = signReturnToken(input)!;
    const [encoded, sig] = t.split(".");
    const tampered = Buffer.from(
      JSON.stringify({ ...JSON.parse(Buffer.from(encoded, "base64url").toString()), orderId: "12" })
    ).toString("base64url");
    expect(verifyReturnToken(`${tampered}.${sig}`)).toEqual({ ok: false, reason: "invalid" });
    // Signed with the right key but without the domain prefix.
    const noDomain = createHmac("sha256", "cron-secret-at-least-16").update(encoded).digest("base64url");
    expect(verifyReturnToken(`${encoded}.${noDomain}`)).toEqual({ ok: false, reason: "invalid" });
  });

  it("expires after the TTL", () => {
    const now = Date.now();
    const t = signReturnToken(input, now)!;
    expect(verifyReturnToken(t, now + (RETURN_TOKEN_TTL_SECONDS - 5) * 1000).ok).toBe(true);
    expect(verifyReturnToken(t, now + (RETURN_TOKEN_TTL_SECONDS + 5) * 1000)).toEqual({ ok: false, reason: "expired" });
    expect(returnTokenError("expired").body.code).toBe("return_token_expired");
  });
});
