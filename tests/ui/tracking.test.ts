import { beforeEach, describe, expect, it, vi } from "vitest";

const authState = vi.hoisted(() => ({
  currentUser: null as
    | {
        uid: string;
        email: string | null;
        getIdToken: ReturnType<typeof vi.fn>;
      }
    | null,
}));
const posthogMock = vi.hoisted(() => ({
  identify: vi.fn(),
}));

vi.mock("@/lib/firebase", () => ({
  auth: authState,
}));

vi.mock("posthog-js", () => ({
  default: {
    identify: posthogMock.identify,
  },
}));

describe("trackEvent", () => {
  beforeEach(() => {
    authState.currentUser = null;
    posthogMock.identify.mockClear();
    localStorage.clear();
    sessionStorage.clear();
    document.cookie = "";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
      })
    );
    window.history.replaceState({}, "", "/shop?gclid=abc123");
  });

  it("sends the Firebase bearer token for authenticated analytics events", async () => {
    const getIdToken = vi.fn().mockResolvedValue("firebase-token");
    authState.currentUser = {
      uid: "uid_123",
      email: "member@example.com",
      getIdToken,
    };

    const { trackEvent } = await import("@/lib/tracking");
    await trackEvent("login", {
      properties: {
        location: "account",
      },
    });

    expect(getIdToken).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      "/api/analytics/track",
      expect.objectContaining({
        method: "POST",
        headers: expect.objectContaining({
          Authorization: "Bearer firebase-token",
          "Content-Type": "application/json",
        }),
      })
    );

    const [, requestInit] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(String(requestInit?.body));
    expect(body).toEqual(
      expect.objectContaining({
        event_name: "login",
        user_id: "uid_123",
        email: "member@example.com",
      })
    );
  });

  it("falls back to anonymous tracking when the id token cannot be resolved", async () => {
    authState.currentUser = {
      uid: "uid_123",
      email: "member@example.com",
      getIdToken: vi.fn().mockRejectedValue(new Error("token failure")),
    };

    const { trackEvent } = await import("@/lib/tracking");
    await trackEvent("page_view");

    const [, requestInit] = vi.mocked(fetch).mock.calls[0]!;
    expect(requestInit?.headers).toEqual({
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(requestInit?.body));
    expect(body.user_id).toBeUndefined();
    expect(body.event_name).toBe("page_view");
  });

  it("can skip Firebase auth resolution for anonymous page views", async () => {
    const getIdToken = vi.fn().mockResolvedValue("firebase-token");
    authState.currentUser = {
      uid: "uid_123",
      email: "member@example.com",
      getIdToken,
    };

    const { trackEvent } = await import("@/lib/tracking");
    await trackEvent("page_view", {}, { includeAuth: false });

    expect(getIdToken).not.toHaveBeenCalled();

    const [, requestInit] = vi.mocked(fetch).mock.calls[0]!;
    expect(requestInit?.headers).toEqual({
      "Content-Type": "application/json",
    });

    const body = JSON.parse(String(requestInit?.body));
    expect(body.user_id).toBeUndefined();
    expect(body.event_name).toBe("page_view");
  });

  it("sends stable anonymous, session, attribution, and browser context properties", async () => {
    document.title = "Shop";
    window.history.replaceState(
      {},
      "",
      "/shop?gclid=abc123&utm_source=newsletter&utm_campaign=spring"
    );

    const { trackEvent } = await import("@/lib/tracking");
    await trackEvent("page_view", {}, { includeAuth: false });

    const [, requestInit] = vi.mocked(fetch).mock.calls[0]!;
    const body = JSON.parse(String(requestInit?.body));

    expect(body.anonymous_id).toMatch(/^anon-/);
    expect(body.properties).toEqual(
      expect.objectContaining({
        anonymous_id: body.anonymous_id,
        session_id: expect.stringMatching(/^session-/),
        $session_id: expect.stringMatching(/^session-/),
        path: "/shop",
        query: "?gclid=abc123&utm_source=newsletter&utm_campaign=spring",
        gclid: "abc123",
        utm_source: "newsletter",
        utm_campaign: "spring",
        page_title: expect.any(String),
        timezone: expect.any(String),
        locale: expect.any(String),
      })
    );
    expect(body.properties.$session_id).toBe(body.properties.session_id);
  });

  it("identifies the PostHog browser user after login", async () => {
    const { identifyAnalyticsUser } = await import("@/lib/tracking");

    await identifyAnalyticsUser({
      reserve_user_id: "uid_123",
      email: "member@example.com",
      phone: "5551234567",
    });

    expect(posthogMock.identify).toHaveBeenCalledWith("uid_123", {
      email: "member@example.com",
      phone: "5551234567",
      reserve_user_id: "uid_123",
    });
  });
});
