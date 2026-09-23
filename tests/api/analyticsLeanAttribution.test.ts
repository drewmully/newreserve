import { describe, expect, it } from "vitest";
import { attributeOrders, firstCustomerCredits, type CampaignContext } from "@/lib/analytics/attribution";
const order = { order_id: "o", publication_id: "p", paid_at: "2026-02-01T12:00:00Z", customer_id: "customer", eligibility_status: "eligible", acquisition_eligible: true };
const session = (id: string, at: string) => ({ session_key: id, started_at: at, customer_id: "customer", publication_id: "p", analytics_eligible: true, behavior_complete: true, identity_status: "resolved" });
const input = () => ({
  orders: [order], sessions: [session("paid", "2026-01-15T12:00:00Z"), session("direct", "2026-02-01T11:00:00Z")],
  events: [], publication: "p", policy: { modelVersion: "reviewed-v1", lookbackDays: 30, approvalRef: "approval", allowObservedDirectFallback: true },
  coverage: new Map([["o", { lookbackComplete: true, identityComplete: true, graceComplete: true }]]),
  campaigns: new Map<string, CampaignContext>([
    ["paid", { channel: "google_ads", campaignKey: "qualified-campaign", direct: false, evidenceRef: "e" }],
    ["direct", { channel: "direct", campaignKey: null, direct: true, evidenceRef: "e" }],
  ]),
});
describe("reviewed single-touch attribution", () => {
  it("chooses last non-direct acquisition, not the later direct checkout session", () => {
    expect(attributeOrders(input())[0]).toMatchObject({ acquisition_session_key: "paid", credit_weight: "1.000000000", conversion_date: "2026-02-01" });
  });
  it("rejects after-conversion and out-of-window touches", () => {
    const x = input(); x.sessions = [session("paid", "2026-02-02T12:00:00Z"), session("direct", "2025-12-01T00:00:00Z")];
    expect(attributeOrders(x)[0].attribution_status).toBe("unattributed");
  });
  it("never changes missing context to organic or direct", () => {
    expect(attributeOrders({ ...input(), campaigns: new Map() })[0].channel).toBe("unattributed");
  });
  it("keeps renewals in an explicit not-applicable bucket with one credit", () => {
    const x = input(); x.orders = [{ ...order, acquisition_eligible: false }];
    expect(attributeOrders(x)[0]).toMatchObject({ channel: "not_applicable", attribution_complete: true, credit_weight: "1.000000000" });
  });
  it("does not finalize incomplete lookback", () => {
    expect(attributeOrders({ ...input(), coverage: new Map() })[0].attribution_status).toBe("pending");
  });
  it("counts a certified first customer once, not for every renewal", () => {
    const customers = [{ customer_id: "customer", publication_id: "p", analytics_permitted: true,
      history_complete: true, identity_status: "resolved", first_eligible_order_id: "o" }];
    const attribution = attributeOrders(input());
    expect(firstCustomerCredits(customers, [...attribution, { ...attribution[0], order_id: "renewal" }], "p", "reviewed-v1")).toHaveLength(1);
    expect(() => firstCustomerCredits([...customers, ...customers], attribution, "p", "reviewed-v1")).toThrow("duplicate_customer");
  });
  it("requires policy approval and one eligible-order row", () => {
    expect(() => attributeOrders({ ...input(), policy: { ...input().policy, approvalRef: "" } })).toThrow();
    expect(() => attributeOrders({ ...input(), orders: [order, order] })).toThrow();
  });
});
