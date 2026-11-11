import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ set: vi.fn(), fetch: vi.fn() }));
vi.mock("@/lib/firebase-admin", () => ({
  adminDb: { collection: () => ({ doc: () => ({ set: mocks.set }) }) },
}));
vi.mock("firebase-admin/firestore", () => ({
  FieldValue: { serverTimestamp: () => "timestamp", increment: () => "increment" },
  Timestamp: class {},
}));
vi.mock("next/headers", () => ({ headers: async () => new Headers() }));
vi.mock("@/lib/klaviyo/syncState", async (orig) => ({
  ...(await orig<typeof import("@/lib/klaviyo/syncState")>()),
  scheduleKlaviyoSync: vi.fn(),
}));
import { POST } from "@/app/api/editorial/drop-signup/route";
import { buildStageInputs } from "@/lib/klaviyo/syncState";
import { JOIN_SOURCES, joinSource, SHOP_NEWSLETTER_CONSENT } from "@/lib/shopSignup";

const request = (body: unknown) => new Request("https://www.mymully.com/api/editorial/drop-signup", { method: "POST", body: JSON.stringify(body) });
const posthogProps = () => JSON.parse(String(mocks.fetch.mock.calls[0][1].body)).properties;

beforeEach(() => {
  mocks.set.mockReset().mockResolvedValue(undefined);
  mocks.fetch.mockReset().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
});

describe("/join source whitelist", () => {
  it("keeps whitelisted values and falls back to forwarded", () => {
    expect(JOIN_SOURCES).toContain("forwarded");
    for (const s of JOIN_SOURCES) expect(joinSource(s)).toBe(s);
    for (const s of [undefined, "", "Forwarded", "shop-newsletter", "editorial-drop-bar", "<script>", 42]) {
      expect(joinSource(s)).toBe("forwarded");
    }
  });
});

describe("drop-signup with a /join source", () => {
  it("requires explicit consent", async () => {
    expect((await POST(request({ email: "test@example.com", source: "forwarded" }))).status).toBe(400);
    expect((await POST(request({ email: "test@example.com", source: "forwarded", consent: "on" }))).status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("stores source and the shop newsletter consent evidence", async () => {
    expect((await POST(request({ email: " Fwd@Example.com ", source: "forwarded", consent: true }))).status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({
      email: "fwd@example.com", source: "forwarded",
      emailMarketingConsent: true, emailMarketingConsentAt: "timestamp",
      emailMarketingConsentVersion: "join-2026-11",
      emailMarketingConsentText: SHOP_NEWSLETTER_CONSENT,
      lastSubmissionConsent: true,
    }), { merge: true });
  });

  it("fires PostHog email_submitted with the source", async () => {
    await POST(request({ email: "fwd@example.com", source: "share", consent: true }));
    expect(mocks.fetch.mock.calls[0][0]).toContain("/i/v0/e/");
    expect(JSON.parse(String(mocks.fetch.mock.calls[0][1].body)).event).toBe("email_submitted");
    expect(posthogProps().source).toBe("share");
  });

  it("never passes an unknown source through", async () => {
    await POST(request({ email: "fwd@example.com", source: "evil-source", consent: true }));
    expect(mocks.set.mock.calls[0][0].source).toBe("editorial-drop-bar");
    expect(posthogProps().source).toBe("editorial-drop-bar");
  });

  it("leaves the shop newsletter contract unchanged", async () => {
    await POST(request({ email: "shop@example.com", source: "shop-newsletter", consent: true }));
    expect(mocks.set.mock.calls[0][0]).toMatchObject({ source: "shop-newsletter", emailMarketingConsentVersion: "shop-newsletter-2026-09" });
    expect(posthogProps().source).toBe("shop-newsletter");
  });
});

describe("Klaviyo sync for /join signups", () => {
  it("sends source forwarded with consent and the /join landing path", () => {
    const out = buildStageInputs("editorial_drop_list", "fwd@example.com", { email: "fwd@example.com", source: "forwarded", lastSubmissionConsent: true });
    expect(out.email).toMatchObject({
      source: "forwarded", stage: "email",
      subscribe: { email: true },
      eventProperties: { email_consent: true, sms_consent: false },
      properties: { mully_email_consent_captured: true, mully_signup_landing_path: "/join" },
    });
  });

  it("maps unknown stored sources to the editorial drop bar", () => {
    const out = buildStageInputs("editorial_drop_list", "x@example.com", { email: "x@example.com", source: "evil", lastSubmissionConsent: true });
    expect(out.email).toMatchObject({ source: "editorial-drop-bar", properties: { mully_signup_landing_path: "/lp/editorial" } });
  });
});
