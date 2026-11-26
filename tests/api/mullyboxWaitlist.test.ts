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
import { MULLYBOX_WAITLIST_CONSENT } from "@/lib/shopSignup";

const request = (body: unknown) => new Request("https://www.mymully.com/api/editorial/drop-signup", { method: "POST", body: JSON.stringify(body) });
const posthogProps = () => JSON.parse(String(mocks.fetch.mock.calls[0][1].body)).properties;

beforeEach(() => {
  mocks.set.mockReset().mockResolvedValue(undefined);
  mocks.fetch.mockReset().mockResolvedValue(new Response("{}"));
  vi.stubGlobal("fetch", mocks.fetch);
  vi.stubEnv("NEXT_PUBLIC_POSTHOG_KEY", "phc_test");
});

describe("drop-signup with the Mullybox 2.0 waitlist source", () => {
  it("requires explicit consent", async () => {
    expect((await POST(request({ email: "t@example.com", source: "mullybox-waitlist" }))).status).toBe(400);
    expect(mocks.set).not.toHaveBeenCalled();
  });

  it("stores its own source, consent evidence and the sticky waitlist flag", async () => {
    expect((await POST(request({ email: " MB@Example.com ", source: "mullybox-waitlist", consent: true }))).status).toBe(200);
    expect(mocks.set).toHaveBeenCalledWith(expect.objectContaining({
      email: "mb@example.com", source: "mullybox-waitlist",
      emailMarketingConsent: true, emailMarketingConsentVersion: "mullybox-waitlist-2026-11",
      emailMarketingConsentText: MULLYBOX_WAITLIST_CONSENT, mullyboxWaitlist: true,
    }), { merge: true });
    expect(posthogProps().source).toBe("mullybox-waitlist");
  });

  it("syncs to Klaviyo with source mullybox-waitlist, /mullybox and the waitlist property", () => {
    const out = buildStageInputs("editorial_drop_list", "mb@example.com", { email: "mb@example.com", source: "mullybox-waitlist", mullyboxWaitlist: true, lastSubmissionConsent: true });
    expect(out.email).toMatchObject({
      source: "mullybox-waitlist", subscribe: { email: true },
      properties: { mully_signup_landing_path: "/mullybox", mully_mullybox_waitlist: true },
    });
  });
});
