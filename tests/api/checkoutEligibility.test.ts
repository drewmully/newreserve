import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase-admin", () => ({ adminDb: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) } }));
vi.mock("@/app/api/_lib/supabaseService", () => ({ getSupabaseService: () => ({}) }));
vi.mock("@/app/api/_lib/shopifyAdmin", () => ({ shopifyGraphQL: async () => ({}) }));
vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { computeReadiness, readReadinessConfig, type ReadinessInput } from "@/lib/lifecycle/readiness";
import { recentCheckoutEmails } from "@/lib/lifecycle/readinessSources";
import { popupPageKind } from "@/app/shop/components/ShopSignupPopup";

const now = new Date("2026-10-12T15:00:00Z");
const config = readReadinessConfig({ LIFECYCLE_READINESS_WRITE_ENABLED: "true", LIFECYCLE_READINESS_PROGRAMS: "checkout,welcome,cart,browse" });

function input(consent: ReadinessInput["consent"]): ReadinessInput {
  return {
    membership: { customerId: null, activeVerified: false, nonmemberVerified: true, activeContractKeys: [], activeContractValidUntil: {}, evaluatedAt: now.toISOString(), holds: [] },
    hadTerminalContract: false,
    service: { clear: true, reviewOwnerClear: true, holds: [] },
    preferences: { readOk: true, hasTopAndBottomSize: false },
    reward: { verified: false, code: null, percent: null, holds: [] },
    consent,
  };
}

describe("checkout recovery eligibility", () => {
  it("a first-time shopper who entered an email at checkout (never subscribed) gets checkout recovery only", () => {
    const p = computeReadiness(input({ subscribed: false, marketable: true, internal: false, contactable: true }), config, now).properties;
    expect(p.mully_wave1_checkout_launch_ready).toBe(true);
    expect(p.mully_wave1_welcome_launch_ready).toBe(false);
    expect(p.mully_wave2_cart_ready).toBe(false);
    expect(p.mully_wave2_browse_ready).toBe(false);
  });
  it("subscribed shoppers stay eligible for everything", () => {
    const p = computeReadiness(input({ subscribed: true, marketable: true, internal: false, contactable: true }), config, now).properties;
    expect(p.mully_wave1_checkout_launch_ready).toBe(true);
    expect(p.mully_wave1_welcome_launch_ready).toBe(true);
  });
  it("unsubscribed, suppressed, internal or unreadable profiles are never eligible", () => {
    for (const c of [
      { subscribed: false, marketable: false, internal: false, contactable: false },
      { subscribed: false, marketable: true, internal: false, contactable: false },
      { subscribed: false, marketable: true, internal: true, contactable: true },
      null,
    ]) expect(computeReadiness(input(c), config, now).properties.mully_wave1_checkout_launch_ready).toBe(false);
  });
  it("still respects the support pause", () => {
    const i = { ...input({ subscribed: false, marketable: true, internal: false, contactable: true }), service: { clear: false, reviewOwnerClear: false, holds: ["unresolved_service_issue"] } };
    expect(computeReadiness(i, config, now).properties.mully_wave1_checkout_launch_ready).toBe(false);
  });
});

describe("recent checkout starters", () => {
  it("reads every page and maps profile emails", async () => {
    const pages: Record<string, unknown> = {
      first: { data: [{ relationships: { profile: { data: { id: "p1" } } } }, { relationships: { profile: { data: { id: "p2" } } } }],
        included: [{ type: "profile", id: "p1", attributes: { email: "A@Example.com " } }, { type: "profile", id: "p2", attributes: { email: null } }],
        links: { next: "https://a.klaviyo.com/api/events/?page[cursor]=2" } },
      second: { data: [{ relationships: { profile: { data: { id: "p3" } } } }], included: [{ type: "profile", id: "p3", attributes: { email: "b@example.com" } }], links: { next: null } },
    };
    const seen: string[] = [];
    const emails = await recentCheckoutEmails(now, async (path) => { seen.push(path); return { body: path.includes("cursor") ? pages.second : pages.first }; });
    expect(emails).toEqual(["a@example.com", "b@example.com"]);
    expect(seen[0]).toContain(encodeURIComponent('equals(metric_id,"UA34PQ")'));
    expect(seen[1]).toBe("/api/events/?page[cursor]=2");
  });
  it("throws instead of returning a partial list", async () => {
    await expect(recentCheckoutEmails(now, async () => { throw new Error("503"); })).rejects.toThrow();
    await expect(recentCheckoutEmails(now, async () => ({ body: { data: [], links: { next: "https://a.klaviyo.com/api/events/?x" } } }), 2)).rejects.toThrow("checkout_events_truncated");
  });
});

describe("signup popup pages", () => {
  it("runs on the shop home and product pages only", () => {
    expect(popupPageKind("/")).toBe("home");
    expect(popupPageKind("/shop")).toBe("home");
    expect(popupPageKind("/shop/rhone-commuter-polo")).toBe("product");
    for (const p of ["/shop/gifts", "/shop/new-arrivals", "/shop/collection", "/shop/collection/outerwear", "/subscription", "/lp/editorial", null]) {
      expect(popupPageKind(p)).toBeNull();
    }
  });
});
