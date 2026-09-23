import { describe, expect, it, vi } from "vitest";
import { collectionEvent, safeCapture } from "@/lib/analytics/collection";
import { signCheckoutContext, verifyCheckoutContext } from "@/lib/analytics/checkout-context";
const secret = "synthetic-secret-only".repeat(3);
const input = {
  project: "p", shop: "s", checkoutId: "checkout-1", sessionId: "a".repeat(32),
  serverSubject: "authenticated-or-anonymous-server-binding", analyticsPermitted: true, now: 1000, ttlSeconds: 300,
};
describe("consent-aware collection and bounded checkout context", () => {
  it.each([
    ["reserve", "reveal"], ["style_game", "completed"], ["text_mully", "activated"],
  ] as const)("supports %s %s without personal payloads", (journey, step) => {
    const event = collectionEvent({ journey, step, analyticsPermitted: true, sessionId: "a".repeat(32), eventId: "b".repeat(32) });
    expect(Object.keys(event!.properties).sort()).toEqual(["$insert_id", "$session_id", "collection_version", "journey", "step", "analytics_permitted"].sort());
  });
  it("uses a stable supplied event id so retries do not create a new activation", () => {
    const e = { journey: "text_mully" as const, step: "activated", analyticsPermitted: true, sessionId: "a".repeat(32), eventId: "b".repeat(32) };
    expect(collectionEvent(e)).toEqual(collectionEvent(e));
    expect(collectionEvent({ ...e, analyticsPermitted: false })).toBeNull();
  });
  it("keeps checkout/SMS independent of capture failure or hanging capture", async () => {
    const event = collectionEvent({ journey: "reserve", step: "checkout", analyticsPermitted: true, sessionId: "a".repeat(32), eventId: "b".repeat(32) });
    expect(await safeCapture(event, async () => { throw new Error("offline"); })).toBe(false);
    expect(await safeCapture(event, () => new Promise(() => {}), 1)).toBe(false);
    const capture = vi.fn();
    expect(await safeCapture(null, capture)).toBe(false);
    expect(capture).not.toHaveBeenCalled();
  });
  it("accepts only the bound project/shop/checkout/subject and consent", () => {
    const token = signCheckoutContext(input, secret)!;
    expect(verifyCheckoutContext(token, input, secret)?.checkoutId).toBe("checkout-1");
    for (const field of ["project", "shop", "checkoutId", "serverSubject"] as const) {
      expect(verifyCheckoutContext(token, { ...input, [field]: "different" }, secret)).toBeNull();
    }
    expect(verifyCheckoutContext(token, { ...input, analyticsPermitted: false }, secret)).toBeNull();
  });
  it("rejects tampering, expired/future tokens and another secret", () => {
    const token = signCheckoutContext(input, secret)!;
    expect(verifyCheckoutContext("x" + token, input, secret)).toBeNull();
    expect(verifyCheckoutContext(token, { ...input, now: 1300 }, secret)).toBeNull();
    expect(verifyCheckoutContext(token, { ...input, now: 999 }, secret)).toBeNull();
    expect(verifyCheckoutContext(token, input, "different".repeat(8))).toBeNull();
    expect(signCheckoutContext({ ...input, analyticsPermitted: false }, secret)).toBeNull();
  });
});
