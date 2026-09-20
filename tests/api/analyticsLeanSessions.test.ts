import { describe, expect, it } from "vitest";
import { normalizeEvents, deriveSessions, linkCheckoutOrders, finalizeSessionConversions, type ObservedEvent } from "@/lib/analytics/sessions";
import { key } from "@/lib/analytics/primitives";
const event: ObservedEvent = {
  project: "p", producer: "browser", actionId: "action", nativeUuid: "uuid1", family: "reveal", schemaVersion: "v1",
  occurredAt: "2026-01-01T12:00:00Z", receivedAt: null, sourceSessionId: "session",
  distinctId: "anonymous", identityNamespace: "p:site", customerId: null, analyticsPermitted: true,
};
const config = { project: "p", families: new Set(["reveal"]), schemaVersions: new Set(["v1"]), sessionVersion: "v1", normalizationVersion: "v1", publication: "pub" };
const sessionKey = key("p", "v1", "session");
function sessions(now = "2026-01-08T13:00:00Z") {
  return deriveSessions(normalizeEvents([event], config), {
    ...config, funnelVersion: "f1", sourceSessionIds: new Map([[sessionKey, "session"]]),
    stages: new Map([["reveal", "reveal"]]), now,
    coverage: { behaviorComplete: true, completeThrough: now, graceSeconds: 3600, approvalRef: "approved" },
  });
}
describe("native-event logical normalization and independent checkout links", () => {
  it("deduplicates only an event-family occurrence, not every action on an order", () => {
    expect(normalizeEvents([event, { ...event, nativeUuid: "uuid2" }], config)).toHaveLength(1);
    expect(normalizeEvents([event, { ...event, actionId: "second" }], config)).toHaveLength(2);
    expect(() => normalizeEvents([{ ...event, project: "other" }], config)).toThrow("cross_project");
  });
  it("retains non-buyers and unknown receipt times without inventing order links", () => {
    expect(normalizeEvents([event], config)[0]).toMatchObject({ received_at: null, order_id: null, customer_id: null });
    expect(normalizeEvents([{ ...event, sourceSessionId: null }], config)[0].session_link_status).toBe("missing");
  });
  it("withholds conversion before seven days plus approved grace", () => {
    expect(sessions("2026-01-08T12:59:59Z")[0].conversion_window_complete).toBe(false);
    expect(sessions()[0].conversion_window_complete).toBe(true);
    expect(finalizeSessionConversions(sessions(), [], false)[0].converted_session).toBeNull();
  });
  const order = { order_id: "order", publication_id: "pub", customer_id: null, paid_at: "2026-01-02T12:00:00Z", eligibility_status: "eligible" };
  it("does not infer a checkout link from an order lifecycle event or nearby timestamp", () => {
    expect(linkCheckoutOrders([order], sessions(), [], "pub")[0].checkout_session_key).toBeNull();
  });
  it("counts two qualifying orders in the same checkout session once", () => {
    const linked = linkCheckoutOrders([order], sessions(), [{
      orderId: "order", sessionKey, publication: "pub", method: "corroborated_checkout_id", evidenceRef: "source",
    }], "pub");
    const final = finalizeSessionConversions(sessions(), [...linked, { ...linked[0], order_id: "second" }], true);
    expect(final[0].converted_session).toBe(true);
  });
  it("uses a half-open seven-day conversion window", () => {
    const boundary = { ...order, paid_at: "2026-01-08T12:00:00Z", checkout_link_status: "matched", checkout_session_key: sessionKey };
    expect(finalizeSessionConversions(sessions(), [boundary], true)[0].converted_session).toBe(false);
  });
  it("never links mismatched resolved customers", () => {
    const linked = linkCheckoutOrders([{ ...order, customer_id: "customer-a" }], [{ ...sessions()[0], customer_id: "customer-b" }], [{
      orderId: "order", sessionKey, publication: "pub", method: "verified_first_party_context", evidenceRef: "source",
    }], "pub");
    expect(linked[0].checkout_session_key).toBeNull();
  });
});
