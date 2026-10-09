import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/firebase-admin", () => ({ adminDb: { collection: () => ({ doc: () => ({ get: async () => ({ exists: false }) }) }) } }));
vi.mock("@/app/api/_lib/supabaseService", () => ({ getSupabaseService: () => ({}) }));
vi.mock("@/app/api/_lib/shopifyAdmin", () => ({ shopifyGraphQL: async () => ({}) }));

import { decideEarnedReward, parseRewardStatus } from "@/lib/lifecycle/rewards";
import { computeReadiness, readReadinessConfig, type ReadinessInput } from "@/lib/lifecycle/readiness";
import { buildRecoveryUrl, cartIdFromParams, parseCartCheckoutUrl, recoveryRedirect } from "@/lib/lifecycle/recovery";

const now = new Date("2026-10-09T15:00:00Z");
const active = { active: true, oncePerCustomer: true };
const both = { MULLYEDIT10: active, MULLYTEXT15: active };

describe("earned rewards", () => {
  it("returns only the highest earned, unused, active code", () => {
    expect(decideEarnedReward({ leadReadOk: true, emailConsentGranted: true, smsConsentGranted: true, usedCodes: [], historyComplete: true, codeStatus: both }))
      .toMatchObject({ verified: true, code: "MULLYTEXT15", percent: 15 });
    expect(decideEarnedReward({ leadReadOk: true, emailConsentGranted: true, smsConsentGranted: false, usedCodes: [], historyComplete: true, codeStatus: both }))
      .toMatchObject({ verified: true, code: "MULLYEDIT10" });
  });
  it("never falls back from a spent 15% to 10%", () => {
    const d = decideEarnedReward({ leadReadOk: true, emailConsentGranted: true, smsConsentGranted: true, usedCodes: ["mullytext15"], historyComplete: true, codeStatus: both });
    expect(d.verified).toBe(false);
    expect(d.code).toBeNull();
  });
  it("holds on unknown status, inactive code, unreadable lead or incomplete usage read", () => {
    expect(decideEarnedReward({ leadReadOk: true, emailConsentGranted: true, smsConsentGranted: false, usedCodes: [], historyComplete: true, codeStatus: {} }).holds[0]).toMatch(/status_unknown/);
    expect(decideEarnedReward({ leadReadOk: true, emailConsentGranted: true, smsConsentGranted: false, usedCodes: [], historyComplete: true, codeStatus: { MULLYEDIT10: { active: false, oncePerCustomer: true } } }).verified).toBe(false);
    expect(decideEarnedReward({ leadReadOk: false, emailConsentGranted: true, smsConsentGranted: true, usedCodes: [], historyComplete: true, codeStatus: both }).holds).toEqual(["reward_lead_unreadable"]);
    expect(decideEarnedReward({ leadReadOk: true, emailConsentGranted: true, smsConsentGranted: false, usedCodes: [], historyComplete: false, codeStatus: both }).holds).toEqual(["reward_history_incomplete"]);
  });
  it("parses live Shopify discount status strictly", () => {
    const node = (o: Record<string, unknown>) => ({ codeDiscountNodeByCode: { codeDiscount: { __typename: "DiscountCodeBasic", status: "ACTIVE", startsAt: "2026-10-02T19:00:00Z", endsAt: null, appliesOncePerCustomer: true, ...o } } });
    expect(parseRewardStatus(node({}), now)).toEqual(active);
    expect(parseRewardStatus(node({ endsAt: "2026-10-01T00:00:00Z" }), now)?.active).toBe(false);
    expect(parseRewardStatus({ codeDiscountNodeByCode: null }, now)).toEqual({ active: false, oncePerCustomer: false });
    expect(parseRewardStatus({}, now)).toBeUndefined();
  });
});

const membership = (o: Partial<NonNullable<ReadinessInput["membership"]>> = {}) => ({
  customerId: "100", activeVerified: false, nonmemberVerified: false, activeContractKeys: [], activeContractValidUntil: {},
  evaluatedAt: now.toISOString(), holds: [], ...o,
});
const base = (o: Partial<ReadinessInput> = {}): ReadinessInput => ({
  membership: membership({ nonmemberVerified: true }), hadTerminalContract: false,
  service: { clear: true, reviewOwnerClear: true, holds: [] }, preferences: { readOk: true, hasTopAndBottomSize: true },
  reward: { verified: false, code: null, percent: null, holds: [] },
  consent: { subscribed: true, marketable: true, internal: false }, ...o,
});
const on = (programs: string) => readReadinessConfig({ LIFECYCLE_READINESS_WRITE_ENABLED: "true", LIFECYCLE_READINESS_PROGRAMS: programs });

describe("readiness", () => {
  it("keeps every program flag off unless the writer and program are switched on", () => {
    const off = computeReadiness(base(), readReadinessConfig({}), now).properties;
    expect(off.mully_wave2_reserve_ready).toBe(false);
    expect(off.mully_wave1_nonmember_verified).toBe(true); // Evidence is still a fact.
    const p = computeReadiness(base(), on("reserve,browse"), now).properties;
    expect(p.mully_wave2_reserve_ready).toBe(true);
    expect(p.mully_wave2_browse_ready).toBe(true);
    expect(p.mully_wave2_cart_ready).toBe(false);
  });
  it("never enables sunset, even when listed", () => {
    expect(readReadinessConfig({ LIFECYCLE_READINESS_PROGRAMS: "sunset" }).programs.size).toBe(0);
  });
  it("fails closed on unreadable sources, internal profiles and missing consent", () => {
    for (const o of [{ membership: null }, { service: null }, { consent: null }, { consent: { subscribed: true, marketable: true, internal: true } },
      { consent: { subscribed: false, marketable: true, internal: false } }] as Partial<ReadinessInput>[]) {
      expect(computeReadiness(base(o), on("welcome,reserve,campaign"), now).properties.mully_wave1_welcome_launch_ready).toBe(false);
    }
  });
  it("support pause blocks promotional programs", () => {
    const p = computeReadiness(base({ service: { clear: false, reviewOwnerClear: false, holds: ["unresolved_service_issue"] } }), on("browse,welcome"), now);
    expect(p.properties.mully_wave2_browse_ready).toBe(false);
    expect(p.holds).toContain("service:unresolved_service_issue");
  });
  it("members: verified start, setup incomplete only from a readable preference source", () => {
    const m = base({ membership: membership({ activeVerified: true }), preferences: { readOk: true, hasTopAndBottomSize: false } });
    const p = computeReadiness(m, on("member_start,reserve"), now).properties;
    expect(p.mully_wave1_paid_start_ready).toBe(true);
    expect(p.mully_wave1_setup_incomplete).toBe(false); // Size reminder skipped this pass.
    expect(p.mully_wave2_reserve_ready).toBe(false); // Members never get Reserve intent.
    expect(computeReadiness({ ...m, preferences: null }, on("member_start"), now).properties.mully_wave1_setup_incomplete).toBe(false);
  });
  it("win-back needs a verified nonmember who actually cancelled", () => {
    expect(computeReadiness(base({ hadTerminalContract: true }), on("winback"), now).properties.mully_wave1_winback_ready).toBe(true);
    expect(computeReadiness(base(), on("winback"), now).properties.mully_wave1_winback_ready).toBe(false);
    expect(computeReadiness(base({ hadTerminalContract: true, membership: membership() }), on("winback"), now).properties.mully_wave1_winback_ready).toBe(false);
  });
  it("clears a spent or unverified reward code", () => {
    const p = computeReadiness(base(), on(""), now).properties;
    expect(p.mully_reward_code).toBeNull();
    const r = computeReadiness(base({ reward: { verified: true, code: "MULLYTEXT15", percent: 15, holds: [] } }), on(""), now).properties;
    expect(r).toMatchObject({ mully_wave1_reward_verified: true, mully_reward_code: "MULLYTEXT15", mully_reward_percent: 15 });
  });
});

describe("cart recovery links", () => {
  const key = "a".repeat(150) + "_-" + "b".repeat(40);
  const checkout = `https://checkout.mymully.com/cart/c/hWN4abcdEFGH1234567890ab?key=${key}&_s=sess&_y=yy`;
  it("builds a first-party link only from a real cart checkout URL", () => {
    const url = buildRecoveryUrl(checkout, "stitch-birdie-bag")!;
    expect(url.startsWith("https://www.mymully.com/cart/recover?")).toBe(true);
    expect(url).not.toContain("_s=");
    expect(buildRecoveryUrl("https://evil.example/cart/c/hWN4abcdEFGH1234567890ab?key=" + key, "x")).toBeUndefined();
    expect(parseCartCheckoutUrl("https://checkout.mymully.com/checkouts/abc")).toBeNull();
  });
  it("redirects to a live cart without tracking params, else product page, else shop-all", () => {
    const params = new URL(buildRecoveryUrl(checkout, "stitch-birdie-bag")!).searchParams;
    expect(cartIdFromParams(params)).toBe(`gid://shopify/Cart/hWN4abcdEFGH1234567890ab?key=${key}`);
    expect(recoveryRedirect(params, { exists: true, totalQuantity: 2, checkoutUrl: checkout })).toBe(`https://checkout.mymully.com/cart/c/hWN4abcdEFGH1234567890ab?key=${key}`);
    expect(recoveryRedirect(params, { exists: true, totalQuantity: 0, checkoutUrl: checkout })).toBe("https://www.mymully.com/shop/stitch-birdie-bag");
    expect(recoveryRedirect(params, null)).toBe("https://www.mymully.com/shop/stitch-birdie-bag");
    expect(recoveryRedirect(new URLSearchParams("p=../../x"), null)).toBe("https://www.mymully.com/shop/collection/shop-all");
  });
});
