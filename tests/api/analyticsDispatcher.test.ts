import { beforeEach, describe, expect, it, vi } from "vitest";
import { dispatchAnalyticsEvent } from "@/app/api/_lib/analytics";

const posthogMock = vi.hoisted(() => {
  const capture = vi.fn();
  const identify = vi.fn();
  const shutdown = vi.fn().mockResolvedValue(undefined);
  const PostHog = vi.fn(function PostHog() {
    return {
      capture,
      identify,
      shutdown,
    };
  });

  return {
    capture,
    identify,
    shutdown,
    PostHog,
  };
});

vi.mock("posthog-node", () => ({
  PostHog: posthogMock.PostHog,
}));

describe("dispatchAnalyticsEvent PostHog identity", () => {
  beforeEach(() => {
    delete process.env.META_PIXEL_ID;
    delete process.env.META_ACCESS_TOKEN;
    delete process.env.GA4_MEASUREMENT_ID;
    delete process.env.GA4_API_SECRET;
    delete process.env.GOOGLE_ADS_CONVERSION_ID;
    delete process.env.NEXT_PUBLIC_POSTHOG_KEY;
    delete process.env.NEXT_PUBLIC_POSTHOG_HOST;

    process.env.POSTHOG_PROJECT_API_KEY = "phc_test";
    process.env.POSTHOG_HOST = "https://us.i.posthog.com";

    posthogMock.PostHog.mockClear();
    posthogMock.capture.mockClear();
    posthogMock.identify.mockClear();
    posthogMock.shutdown.mockClear();
    posthogMock.shutdown.mockResolvedValue(undefined);
  });

  it("uses anonymous_id as the PostHog distinct id for anonymous traffic", async () => {
    await dispatchAnalyticsEvent({
      event_name: "page_view",
      anonymous_id: "anon-123",
      ip: "203.0.113.20",
      page_url: "https://example.com/shop",
      properties: {
        path: "/shop",
        session_id: "session-123",
        $session_id: "session-123",
      },
      timestamp: 1710000000,
    });

    expect(posthogMock.PostHog).toHaveBeenCalledWith("phc_test", {
      host: "https://us.i.posthog.com",
    });
    expect(posthogMock.identify).not.toHaveBeenCalled();
    expect(posthogMock.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "anon-123",
        event: "page_view",
        timestamp: new Date(1710000000 * 1000),
        properties: expect.objectContaining({
          anonymous_id: "anon-123",
          is_authenticated: false,
          path: "/shop",
          $ip: "203.0.113.20",
          $current_url: "https://example.com/shop",
          $session_id: "session-123",
        }),
      })
    );
    expect(posthogMock.shutdown).toHaveBeenCalled();
  });

  it("identifies authenticated users and links the prior anonymous id", async () => {
    await dispatchAnalyticsEvent({
      event_name: "login",
      user_id: "uid_123",
      anonymous_id: "anon-123",
      email: "member@example.com",
      phone: "5551234567",
      page_url: "https://example.com/account",
      segments: ["member", "vip"],
      properties: {
        auth_provider: "google.com",
      },
      timestamp: 1710000123,
    });

    expect(posthogMock.identify).toHaveBeenCalledWith({
      distinctId: "uid_123",
      properties: expect.objectContaining({
        $anon_distinct_id: "anon-123",
        $set: expect.objectContaining({
          email: "member@example.com",
          phone: "5551234567",
          reserve_user_id: "uid_123",
          segments: ["member", "vip"],
          last_event_name: "login",
          last_seen_url: "https://example.com/account",
        }),
        $set_once: expect.objectContaining({
          first_anonymous_id: "anon-123",
        }),
      }),
    });
    expect(posthogMock.capture).toHaveBeenCalledWith(
      expect.objectContaining({
        distinctId: "uid_123",
        event: "login",
        properties: expect.objectContaining({
          anonymous_id: "anon-123",
          auth_provider: "google.com",
          email: "member@example.com",
          is_authenticated: true,
          reserve_user_id: "uid_123",
          segments: ["member", "vip"],
        }),
      })
    );
  });
});
