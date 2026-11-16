import { describe, expect, it } from "vitest";
import {
  RETURN_REASON_MAP,
  RETURN_REASONS,
  RETURN_RULES,
  UNKNOWN_DELIVERY_TRANSIT_BUFFER_DAYS,
  classifyOrder,
  isAllowedReturnReason,
  isWithinReturnWindow,
  outsideWindowMessage,
  returnShippingCostByTier,
  returnWindowStart,
} from "@/lib/returns/policy";
import { DAY, NOW } from "../fixtures/returnsOrder";

const at = (ms: number) => new Date(ms).toISOString();

describe("returns policy: order classification", () => {
  it("treats plain one-time orders as Pro Shop", () => {
    expect(classifyOrder({ tags: ["VIP"], lineItems: [{ title: "Club Polo", hasSellingPlan: false }] })).toBe("pro_shop");
  });
  it("uses selling-plan line items as the primary subscription signal", () => {
    expect(classifyOrder({ tags: [], lineItems: [{ title: "Quarterly Box", hasSellingPlan: true }] })).toBe("subscription");
  });
  it("recognises Loop subscription tags case-insensitively", () => {
    expect(classifyOrder({ tags: ["Subscription Recurring Order"], lineItems: [{ title: "Polo", hasSellingPlan: false }] })).toBe("subscription");
    expect(classifyOrder({ tags: [" subscription first order "], lineItems: [] })).toBe("subscription");
  });
  it("falls back to legacy box titles", () => {
    expect(classifyOrder({ tags: [], lineItems: [{ title: "Back 9 Box", hasSellingPlan: false }] })).toBe("subscription");
    expect(classifyOrder({ tags: [], lineItems: [{ title: "Reserve Member - Fall", hasSellingPlan: false }] })).toBe("subscription");
  });
});

describe("returns policy: per-type rules", () => {
  it("Pro Shop: 30 days from delivery, refund to original payment, exchanges allowed", () => {
    expect(RETURN_RULES.pro_shop).toMatchObject({
      windowDays: 30,
      windowStart: "delivered",
      resolution: "refund_original_payment",
      exchangeAllowed: true,
      finalSaleExcluded: true,
      pendingOwnerDecision: false,
    });
  });
  it("Subscription: 30 days from delivery, store credit, flagged pending owner decision", () => {
    expect(RETURN_RULES.subscription).toMatchObject({
      windowDays: 30,
      windowStart: "delivered",
      resolution: "store_credit",
      exchangeAllowed: true,
      pendingOwnerDecision: true,
    });
  });
  it("out-of-window copy mentions 30 days from delivery", () => {
    expect(outsideWindowMessage(RETURN_RULES.pro_shop)).toContain("30 days from delivery");
  });
});

describe("returns policy: delivery-based window", () => {
  const rules = RETURN_RULES.pro_shop;
  const delivered = NOW.getTime() - 5 * DAY;

  it("starts at the Shopify delivered date", () => {
    expect(returnWindowStart({ createdAt: at(delivered - 3 * DAY), deliveredAt: at(delivered) })).toEqual({
      start: new Date(delivered),
      basis: "delivered",
    });
  });

  it("falls back to fulfillment date + transit buffer when delivery is unknown", () => {
    expect(UNKNOWN_DELIVERY_TRANSIT_BUFFER_DAYS).toBe(7);
    const created = NOW.getTime() - 20 * DAY;
    expect(returnWindowStart({ createdAt: at(created), deliveredAt: null })).toEqual({
      start: new Date(created + 7 * DAY),
      basis: "estimated",
    });
  });

  it("is open on day 30 after delivery and closed on day 31", () => {
    const deliveredAt = at(NOW.getTime() - 30 * DAY);
    expect(isWithinReturnWindow({ createdAt: deliveredAt, deliveredAt }, rules, NOW)).toBe(true);
    const deliveredAt31 = at(NOW.getTime() - 31 * DAY);
    expect(isWithinReturnWindow({ createdAt: deliveredAt31, deliveredAt: deliveredAt31 }, rules, NOW)).toBe(false);
  });

  it("counts from delivery, not the order/fulfillment date", () => {
    // Fulfilled 40 days ago but delivered 25 days ago → still open.
    expect(
      isWithinReturnWindow({ createdAt: at(NOW.getTime() - 40 * DAY), deliveredAt: at(NOW.getTime() - 25 * DAY) }, rules, NOW)
    ).toBe(true);
  });

  it("unknown delivery: open at fulfillment + 37 days, closed at + 38", () => {
    expect(isWithinReturnWindow({ createdAt: at(NOW.getTime() - 37 * DAY), deliveredAt: null }, rules, NOW)).toBe(true);
    expect(isWithinReturnWindow({ createdAt: at(NOW.getTime() - 38 * DAY), deliveredAt: null }, rules, NOW)).toBe(false);
  });
});

describe("returns policy: reasons and fees", () => {
  it("maps size reasons to the Shopify 2024-10 ReturnReason enum", () => {
    expect(RETURN_REASON_MAP["Too small"]).toBe("SIZE_TOO_SMALL");
    expect(RETURN_REASON_MAP["Too large"]).toBe("SIZE_TOO_LARGE");
    expect(RETURN_REASON_MAP["Wrong size"]).toBe("OTHER");
    expect(RETURN_REASON_MAP["Not as described"]).toBe("NOT_AS_DESCRIBED");
    const valid = new Set(["COLOR", "DEFECTIVE", "NOT_AS_DESCRIBED", "OTHER", "SIZE_TOO_LARGE", "SIZE_TOO_SMALL", "STYLE", "UNKNOWN", "UNWANTED", "WRONG_ITEM"]);
    for (const v of Object.values(RETURN_REASON_MAP)) expect(valid.has(v)).toBe(true);
  });
  it("offers Too small / Too large in the UI and still accepts legacy Wrong size", () => {
    expect(RETURN_REASONS).toContain("Too small");
    expect(RETURN_REASONS).toContain("Too large");
    expect(RETURN_REASONS).not.toContain("Wrong size");
    expect(isAllowedReturnReason("Wrong size")).toBe(true);
    expect(isAllowedReturnReason("Free stuff please")).toBe(false);
    expect(isAllowedReturnReason("__proto__")).toBe(false);
  });
  it("keeps the existing tier fee amounts", () => {
    expect(returnShippingCostByTier("black")).toBe(0);
    expect(returnShippingCostByTier("member")).toBe(0);
    expect(returnShippingCostByTier("access")).toBe(5.95);
    expect(returnShippingCostByTier("free")).toBe(9.95);
    expect(returnShippingCostByTier(undefined)).toBe(9.95);
  });
});
