import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.fn();
const getUserDocMock = vi.fn();
const dispatchAnalyticsEventMock = vi.fn();
const persistAnalyticsEventMock = vi.fn();
const aggregateKpiDailyMock = vi.fn();
const aggregateSegmentActivityMock = vi.fn();
const recordAISalesSignalMock = vi.fn();
const checkRateLimitMock = vi.fn();
const sendSiteEventMock = vi.fn();
const afterCallbacks: Array<() => unknown> = [];

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => afterCallbacks.push(fn),
}));

vi.mock("@/lib/klaviyo/siteEvents", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/klaviyo/siteEvents")>()),
  sendSiteEventToKlaviyo: sendSiteEventMock,
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: {
    verifyIdToken: verifyIdTokenMock,
  },
  adminDb: {
    collection: vi.fn((name: string) => {
      if (name !== "users") {
        throw new Error(`Unexpected collection ${name}`);
      }

      return {
        doc: vi.fn((uid: string) => ({
          get: () => getUserDocMock(uid),
        })),
      };
    }),
  },
}));

vi.mock("@/app/api/_lib/analytics", () => ({
  dispatchAnalyticsEvent: dispatchAnalyticsEventMock,
}));

vi.mock("@/app/api/_lib/kpiReporting", () => ({
  persistAnalyticsEvent: persistAnalyticsEventMock,
  aggregateKpiDaily: aggregateKpiDailyMock,
  aggregateSegmentActivity: aggregateSegmentActivityMock,
}));

vi.mock("@/app/api/_lib/aiSalesAgents", () => ({
  recordAISalesSignal: recordAISalesSignalMock,
}));

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: checkRateLimitMock,
}));

function makeRequest(
  body: Record<string, unknown>,
  headers?: Record<string, string>
) {
  return new NextRequest("http://localhost/api/analytics/track", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(headers ?? {}),
    },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/analytics/track/route");
}

describe("POST /api/analytics/track", () => {
  beforeEach(() => {
    verifyIdTokenMock.mockReset().mockResolvedValue({ uid: "uid_123" });
    getUserDocMock.mockReset().mockResolvedValue({
      exists: true,
      data: () => ({
        segments: ["vip", "member"],
      }),
    });
    dispatchAnalyticsEventMock.mockReset().mockResolvedValue(undefined);
    persistAnalyticsEventMock.mockReset().mockResolvedValue(undefined);
    aggregateKpiDailyMock.mockReset().mockResolvedValue(undefined);
    aggregateSegmentActivityMock.mockReset().mockResolvedValue(undefined);
    recordAISalesSignalMock.mockReset().mockResolvedValue(undefined);
    checkRateLimitMock.mockReset().mockReturnValue({
      allowed: true,
      remaining: 99,
      retryAfterSeconds: 0,
    });
  });

  it("requires a verified bearer token when user_id is supplied", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({
        event_name: "login",
        user_id: "uid_123",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({
      error: "Authenticated events require a valid bearer token.",
    });
    expect(dispatchAnalyticsEventMock).not.toHaveBeenCalled();
  });

  it("rejects mismatched authenticated user ids", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "uid_other" });

    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest(
        {
          event_name: "wallet_viewed",
          user_id: "uid_123",
        },
        {
          Authorization: "Bearer token-123",
        }
      )
    );
    const json = await res.json();

    expect(res.status).toBe(403);
    expect(json).toEqual({
      error: "Authenticated user does not match user_id.",
    });
    expect(dispatchAnalyticsEventMock).not.toHaveBeenCalled();
  });

  it("overrides client segments with server segments for verified users", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest(
        {
          event_name: "add_to_cart",
          user_id: "uid_123",
          email: "Member@Example.com",
          phone: "(555) 123-4567",
          page_url: "https://example.com/shop",
          anonymous_id: "anon-123",
          segments: ["forged"],
          properties: {
            product: "club-cap",
            value: 38,
            nested: { bad: true },
          },
        },
        {
          Authorization: "Bearer token-123",
          "x-forwarded-for": "203.0.113.10",
          "user-agent": "Vitest",
        }
      )
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.ok).toBe(true);
    expect(verifyIdTokenMock).toHaveBeenCalledWith("token-123", true);
    expect(checkRateLimitMock).toHaveBeenCalledWith(
      "analytics_track",
      "uid_123",
      expect.objectContaining({ maxHits: 120, windowMs: 60000 })
    );
    expect(dispatchAnalyticsEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: "add_to_cart",
        user_id: "uid_123",
        email: "member@example.com",
        phone: "5551234567",
        ip: "203.0.113.10",
        page_url: "https://example.com/shop",
        segments: ["vip", "member"],
        properties: {
          product: "club-cap",
          value: 38,
        },
      })
    );
    expect(persistAnalyticsEventMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        uid: "uid_123",
        segments: ["vip", "member"],
      })
    );
    expect(recordAISalesSignalMock).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        user_id: "uid_123",
        event_name: "add_to_cart",
        properties: {
          product: "club-cap",
          value: 38,
        },
      })
    );
  });

  it("rate limits anonymous analytics bursts", async () => {
    checkRateLimitMock.mockReturnValue({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 17,
    });

    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest(
        {
          event_name: "page_view",
          anonymous_id: "anon-123",
        },
        {
          "x-forwarded-for": "203.0.113.11",
        }
      )
    );
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("17");
    expect(json).toEqual({
      error: "Too many analytics events. Please try again later.",
    });
    expect(dispatchAnalyticsEventMock).not.toHaveBeenCalled();
  });

  describe("Klaviyo lifecycle mirror", () => {
    const view = {
      event_name: "proshop_product_viewed",
      properties: { product_slug: "rhone-polo", name: "Rhone Polo", price: 108 },
    };

    beforeEach(() => {
      afterCallbacks.length = 0;
      sendSiteEventMock.mockReset().mockResolvedValue("sent");
      vi.stubEnv("KLAVIYO_PRIVATE_API_KEY", "pk_test");
      vi.stubEnv("KLAVIYO_SITE_EVENTS_ENABLED", "true");
    });

    async function post(body: Record<string, unknown>, headers?: Record<string, string>) {
      const { POST } = await loadRoute();
      const res = await POST(makeRequest(body, headers));
      for (const fn of afterCallbacks) await fn();
      return res;
    }

    it("sends nothing when the flag is off", async () => {
      vi.stubEnv("KLAVIYO_SITE_EVENTS_ENABLED", "false");
      verifyIdTokenMock.mockResolvedValue({ uid: "uid_123", email: "m@example.com", email_verified: true });
      expect((await post(view, { Authorization: "Bearer t" })).status).toBe(200);
      expect(sendSiteEventMock).not.toHaveBeenCalled();
    });

    it("identifies signed-in members by their verified email only", async () => {
      verifyIdTokenMock.mockResolvedValue({ uid: "uid_123", email: "M@Example.com", email_verified: true });
      await post(view, { Authorization: "Bearer t" });
      expect(sendSiteEventMock).toHaveBeenCalledTimes(1);
      expect(sendSiteEventMock.mock.calls[0][0]).toEqual({ kind: "verified", email: "m@example.com" });
      expect(sendSiteEventMock.mock.calls[0][1].metric).toBe("Mully Viewed Product");
    });

    it("never trusts an unverified token email or an email in the request body", async () => {
      verifyIdTokenMock.mockResolvedValue({ uid: "uid_123", email: "m@example.com", email_verified: false });
      await post(view, { Authorization: "Bearer t" });
      await post({ ...view, email: "victim@example.com" });
      expect(sendSiteEventMock).not.toHaveBeenCalled();
    });

    it("uses the Klaviyo exchange id for anonymous visitors from Klaviyo emails", async () => {
      await post({ ...view, klaviyo_kx: "abcDEF123_kx" });
      expect(sendSiteEventMock.mock.calls[0][0]).toEqual({ kind: "exchange", kx: "abcDEF123_kx" });
    });

    it("ignores events that are not mirrored", async () => {
      await post({ event_name: "page_view", klaviyo_kx: "abcDEF123_kx" });
      expect(sendSiteEventMock).not.toHaveBeenCalled();
    });
  });
});
