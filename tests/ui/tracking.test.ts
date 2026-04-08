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

vi.mock("@/lib/firebase", () => ({
  auth: authState,
}));

describe("trackEvent", () => {
  beforeEach(() => {
    authState.currentUser = null;
    localStorage.clear();
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
});
