import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.fn();
vi.mock("@/lib/firebase-admin", () => ({ adminAuth: { verifyIdToken: verifyIdTokenMock }, adminDb: {} }));

import {
  CHECKOUT_UID_MAX_AGE_SECONDS,
  normalizeAccountEmail,
  signCheckoutUid,
  verifyCheckoutUid,
} from "@/lib/checkoutIdentity";

describe("checkout uid signing", () => {
  beforeEach(() => {
    process.env.CHECKOUT_IDENTITY_SECRET = "test_checkout_identity_secret_123";
    delete process.env.CRON_SECRET;
  });

  it("round-trips a uid", () => {
    const token = signCheckoutUid("abcDEF123_-")!;
    expect(token).toMatch(/^abcDEF123_-\.\d+\.[A-Za-z0-9_-]{43}$/);
    expect(verifyCheckoutUid(token)).toBe("abcDEF123_-");
  });

  it("rejects tampered uid, signature, or timestamp", () => {
    const token = signCheckoutUid("uid_a")!;
    const [, ts, sig] = token.split(".");
    expect(verifyCheckoutUid(`uid_b.${ts}.${sig}`)).toBeNull();
    expect(verifyCheckoutUid(`uid_a.${Number(ts) - 1}.${sig}`)).toBeNull();
    expect(verifyCheckoutUid(`uid_a.${ts}.${sig.slice(0, -1)}${sig.endsWith("A") ? "B" : "A"}`)).toBeNull();
    expect(verifyCheckoutUid("garbage")).toBeNull();
    expect(verifyCheckoutUid(null)).toBeNull();
  });

  it("rejects tokens signed with another key", () => {
    const token = signCheckoutUid("uid_a")!;
    process.env.CHECKOUT_IDENTITY_SECRET = "a_completely_different_secret";
    expect(verifyCheckoutUid(token)).toBeNull();
  });

  it("expires tokens and rejects future-dated ones", () => {
    const now = Date.UTC(2026, 10, 1);
    const token = signCheckoutUid("uid_a", now)!;
    expect(verifyCheckoutUid(token, now + (CHECKOUT_UID_MAX_AGE_SECONDS - 60) * 1000)).toBe("uid_a");
    expect(verifyCheckoutUid(token, now + (CHECKOUT_UID_MAX_AGE_SECONDS + 60) * 1000)).toBeNull();
    expect(verifyCheckoutUid(token, now - 60 * 60 * 1000)).toBeNull();
  });

  it("falls back to CRON_SECRET and disables signing without a usable key", () => {
    delete process.env.CHECKOUT_IDENTITY_SECRET;
    process.env.CRON_SECRET = "cron_secret_long_enough";
    expect(verifyCheckoutUid(signCheckoutUid("uid_a"))).toBe("uid_a");
    process.env.CRON_SECRET = "short";
    expect(signCheckoutUid("uid_a")).toBeNull();
    expect(verifyCheckoutUid("uid_a.1.xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx")).toBeNull();
  });

  it("refuses to sign malformed uids", () => {
    expect(signCheckoutUid("has.dot")).toBeNull();
    expect(signCheckoutUid("")).toBeNull();
  });

  it("normalizes emails", () => {
    expect(normalizeAccountEmail("  Jane.Doe@Example.COM ")).toBe("jane.doe@example.com");
    expect(normalizeAccountEmail("")).toBeNull();
    expect(normalizeAccountEmail(undefined)).toBeNull();
  });
});

describe("POST /api/checkout/identity", () => {
  beforeEach(() => {
    process.env.CHECKOUT_IDENTITY_SECRET = "test_checkout_identity_secret_123";
    verifyIdTokenMock.mockReset();
  });

  const req = (auth?: string) =>
    new NextRequest("http://localhost/api/checkout/identity", {
      method: "POST",
      headers: auth ? { Authorization: auth } : {},
    });

  it("401s without a bearer token", async () => {
    const { POST } = await import("@/app/api/checkout/identity/route");
    expect((await POST(req())).status).toBe(401);
    expect(verifyIdTokenMock).not.toHaveBeenCalled();
  });

  it("401s on an invalid or revoked token", async () => {
    verifyIdTokenMock.mockRejectedValue(new Error("auth/id-token-revoked"));
    const { POST } = await import("@/app/api/checkout/identity/route");
    expect((await POST(req("Bearer bad"))).status).toBe(401);
    expect(verifyIdTokenMock).toHaveBeenCalledWith("bad", true);
  });

  it("returns the lowercased email and a verifiable uid token", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "uid_42", email: "Member@Example.com" });
    const { POST } = await import("@/app/api/checkout/identity/route");
    const res = await POST(req("Bearer good"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    const body = await res.json();
    expect(body.email).toBe("member@example.com");
    expect(verifyCheckoutUid(body.uidToken)).toBe("uid_42");
  });
});
