import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  readTrustedOrderAnon,
  signStylegameContext,
} from "@/lib/stylegame/context";
import { captureStylegameEvent } from "@/lib/stylegame/analytics";

const posthogMock = vi.hoisted(() => ({
  capture: vi.fn(),
  shutdown: vi.fn().mockResolvedValue(undefined),
  PostHog: vi.fn(function PostHog() {
    return {
      capture: posthogMock.capture,
      shutdown: posthogMock.shutdown,
    };
  }),
}));

vi.mock("posthog-node", () => ({ PostHog: posthogMock.PostHog }));

describe("trusted Style Game context", () => {
  beforeEach(() => {
    process.env.POSTHOG_PROJECT_API_KEY = "fixture-posthog-key";
    posthogMock.capture.mockClear();
    posthogMock.shutdown.mockClear();
    posthogMock.PostHog.mockClear();
  });

  it("rejects a v1 anon without the server-issued ownership marker", () => {
    expect(
      readTrustedOrderAnon([
        { name: "stylegame_context_version", value: "1" },
        { name: "mully_anon_id", value: "anon-tampered" },
      ], "fixture-secret")
    ).toBeNull();
    expect(
      readTrustedOrderAnon([
        { name: "stylegame_context_version", value: "1" },
        { name: "stylegame_identity_source", value: "first_party_cookie" },
        { name: "mully_anon_id", value: "anon-owner" },
        {
          name: "stylegame_context_signature",
          value: signStylegameContext("anon-owner", null, "fixture-secret"),
        },
      ], "fixture-secret")
    ).toBe("anon-owner");
  });

  it("does not create a shared PostHog person when identity is missing", async () => {
    await captureStylegameEvent("sg_checkout_start", null, {
      context_version: "1",
    });

    expect(posthogMock.PostHog).not.toHaveBeenCalled();
    expect(posthogMock.capture).not.toHaveBeenCalled();
  });
});
