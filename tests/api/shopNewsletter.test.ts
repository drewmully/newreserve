import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ set: vi.fn() }));
vi.mock("@/lib/firebase-admin", () => ({
  adminDb: { collection: () => ({ doc: () => ({ set: mocks.set }) }) },
}));
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "timestamp", increment: () => "increment" },
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
import { POST } from "@/app/api/editorial/drop-signup/route";
const request = (body: unknown) => new Request("https://mymully.com/api/editorial/drop-signup", { method: "POST", body: JSON.stringify(body) });
beforeEach(() => {
  mocks.set.mockReset().mockResolvedValue(undefined);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "");
  vi.stubEnv("POSTHOG_KEY", "");
});
describe("shop newsletter endpoint", () => {
  it("rejects malformed bodies, bad emails and missing shop consent", async () => {
    for (const body of [null, [], "bad", { email: 42 }, { email: "bad" }, { email: "test@example.com", source: "shop-newsletter" }]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("stores the exact consent version and shop attribution", async () => {
    expect((await POST(request({ email: " Test@Example.com ", source: "shop-newsletter", consent: true }))).status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({
      email: "test@example.com", source: "shop-newsletter",
      emailMarketingConsent: true, emailMarketingConsentAt: "timestamp",
      emailMarketingConsentVersion: "shop-newsletter-2026-09",
    }), { merge: true });
  });
  it("preserves the existing editorial capture contract", async () => {
    expect((await POST(request({ email: "test@example.com" }))).status).toBe(200);
    expect(mocks.set.mock.calls[0][0].source).toBe("editorial-drop-bar");
    expect(mocks.set.mock.calls[0][0]).not.toHaveProperty("emailMarketingConsent");
  });
  it("does not persist honeypot submissions", async () => {
    expect((await POST(request({ hp: "bot" }))).status).toBe(200);
    expect(mocks.set).not.toHaveBeenCalled();
  });
  it("returns failure if storage fails", async () => {
    mocks.set.mockRejectedValueOnce(new Error("mock storage unavailable"));
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect((await POST(request({ email: "test@example.com", source: "shop-newsletter", consent: true }))).status).toBe(500);
    spy.mockRestore();
  });
});
