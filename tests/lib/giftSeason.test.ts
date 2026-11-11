import { describe, it, expect, vi } from "vitest";

// giftSeasonCheckout pulls in browser-only analytics; stub them for node.
vi.mock("@/lib/analytics/journeyClient", () => ({ recordJourneyCart: vi.fn() }));
vi.mock("@/lib/analytics/journeySourceSessionClient", () => ({
  recordSourceSessionCart: vi.fn(),
}));
vi.mock("@/lib/attribution", () => ({
  getStoredAttribution: () => null,
  attributionToCartAttributes: () => [],
}));
vi.mock("@/lib/shopifyCheckoutOrigin", () => ({
  buildCheckoutOriginAttributes: () => [],
}));

import {
  GIFT_SEASON_OPTIONS,
  RESERVE_SEASON_PRICE,
  boxDueOn,
  formatUsd,
  perSeasonPrice,
  seasonSavings,
  withLivePrices,
  giftSeasonChildTags,
  giftSeasonParentTags,
  isContinueOfferDue,
  isGiftSeasonChildOrder,
  isNextBoxDue,
  parseSeasonCount,
  seasonCountFromLineItems,
  seasonProgress,
} from "@/lib/gifts/giftSeason";
import {
  buildGiftSeasonCart,
  validateGiftSeasonInput,
  type GiftSeasonCheckoutInput,
} from "@/lib/giftSeasonCheckout";
import {
  buildGiftContinueSubject,
  buildGiftContinueText,
  buildGiftRecipientSubject,
  buildGiftRecipientText,
  buildGiftSelfDeliverSubject,
  buildGiftSelfDeliverText,
} from "@/lib/email/templates/giftRecipient";
import {
  GIFT_SEASON_SHOW_FREE_SHIPPING_EXCHANGES,
  isPastGiftSeasonCutoff,
  formatGiftSeasonCutoff,
  parseGiftSeasonCutoff,
  giftSeasonTimingLine,
  pendingGiftSeasonPlaceholders,
} from "@/lib/gifts/giftSeasonConfig";

const DAY = 24 * 60 * 60 * 1000;
const SHIP1 = Date.UTC(2026, 11, 1, 15, 0); // 2026-12-01

describe("pricing", () => {
  it("matches Drew's gift prices ($299 / $550 / $1,000)", () => {
    expect(GIFT_SEASON_OPTIONS.map((o) => [o.seasons, o.price, o.sku])).toEqual([
      [1, 299, "RES-GIFT-1S"],
      [2, 550, "RES-GIFT-2S"],
      [4, 1000, "RES-GIFT-4S"],
    ]);
  });
  it("keeps regular Reserve Member at $250 for the continue offer", () => {
    expect(RESERVE_SEASON_PRICE).toBe(250);
  });
  it("derives per-season price from the variant price", () => {
    expect(perSeasonPrice(299, 1)).toBe(299);
    expect(perSeasonPrice(550, 2)).toBe(275);
    expect(perSeasonPrice(1000, 4)).toBe(250);
    expect(perSeasonPrice(549, 2)).toBe(274.5);
    expect(formatUsd(1000)).toBe("$1,000");
    expect(formatUsd(274.5)).toBe("$274.50");
  });
  it("live Storefront prices override defaults; bad values are ignored", () => {
    const live = withLivePrices(GIFT_SEASON_OPTIONS, { "50765708853440": 600, "50765708886208": NaN });
    expect(live.map((o) => o.price)).toEqual([299, 600, 1000]);
    expect(withLivePrices(GIFT_SEASON_OPTIONS, null)).toBe(GIFT_SEASON_OPTIONS);
  });
  it("only accepts 1, 2 or 4", () => {
    expect(parseSeasonCount("2")).toBe(2);
    expect(parseSeasonCount(3)).toBeNull();
    expect(parseSeasonCount("x")).toBeNull();
  });
});

describe("seasonCountFromLineItems", () => {
  it("matches by variant id (numeric or gid)", () => {
    expect(seasonCountFromLineItems([{ variant_id: 50765708853440 }])).toBe(2);
    expect(
      seasonCountFromLineItems([{ variant_id: "gid://shopify/ProductVariant/50765708886208" }])
    ).toBe(4);
  });
  it("falls back to SKU", () => {
    expect(seasonCountFromLineItems([{ variant_id: 1, sku: "res-gift-1s" }])).toBe(1);
  });
  it("ignores regular Reserve lines", () => {
    expect(seasonCountFromLineItems([{ variant_id: 47601025122496, sku: "RES-MEM" }])).toBeNull();
  });
});

describe("child order detection", () => {
  it("uses attribute or tag", () => {
    expect(isGiftSeasonChildOrder([{ name: "gift_season_child", value: "true" }])).toBe(true);
    expect(isGiftSeasonChildOrder([], "gift-season, gift-season-box, x")).toBe(true);
    expect(isGiftSeasonChildOrder([], "gift-season, gift-season-4")).toBe(false);
  });
  it("tags are stable", () => {
    expect(giftSeasonParentTags(4)).toEqual(["gift-season", "gift-season-4", "gift-season-box-1-of-4"]);
    expect(giftSeasonChildTags(3, 4)).toContain("gift-season-box-3-of-4");
  });
});

describe("schedule and countdown", () => {
  it("box N is due 3*(N-1) months after box 1 ships", () => {
    expect(boxDueOn(SHIP1, 1)).toBeNull();
    expect(boxDueOn(SHIP1, 2)).toBe("2027-03-01");
    expect(boxDueOn(SHIP1, 4)).toBe("2027-09-01");
    expect(boxDueOn(null, 2)).toBeNull();
  });
  it("clamps month end", () => {
    expect(boxDueOn(Date.UTC(2026, 10, 30), 2)).toBe("2027-02-28");
  });

  const paidOnly = { seasons_total: 4, box_orders: [{ box_number: 1, shipped_at: null }], first_box_shipped_at: null };
  const shipped1 = { seasons_total: 4, box_orders: [{ box_number: 1, shipped_at: SHIP1 }], first_box_shipped_at: SHIP1 };

  it("tracks remaining = total - shipped", () => {
    expect(seasonProgress(paidOnly)).toMatchObject({ boxesDispatched: 1, boxesShipped: 0, boxesRemaining: 4, nextBoxNumber: 2, nextBoxDueOn: null });
    expect(seasonProgress(shipped1)).toMatchObject({ boxesShipped: 1, boxesRemaining: 3, nextBoxDueOn: "2027-03-01" });
    const done = { seasons_total: 2, first_box_shipped_at: SHIP1, box_orders: [{ box_number: 1, shipped_at: SHIP1 }, { box_number: 2, shipped_at: SHIP1 + 90 * DAY }] };
    expect(seasonProgress(done)).toMatchObject({ boxesRemaining: 0, nextBoxNumber: null });
  });
  it("next box is due only on/after the due date and after the previous one ships", () => {
    expect(isNextBoxDue(paidOnly, Date.UTC(2027, 5, 1))).toBe(false);
    expect(isNextBoxDue(shipped1, Date.UTC(2027, 1, 28))).toBe(false);
    expect(isNextBoxDue(shipped1, Date.UTC(2027, 2, 1))).toBe(true);
    const open2 = { ...shipped1, box_orders: [...shipped1.box_orders, { box_number: 2, shipped_at: null }] };
    expect(isNextBoxDue(open2, Date.UTC(2027, 8, 1))).toBe(false);
  });
  it("single season never schedules more", () => {
    const one = { seasons_total: 1, box_orders: [{ box_number: 1, shipped_at: SHIP1 }], first_box_shipped_at: SHIP1 };
    expect(isNextBoxDue(one, Date.UTC(2030, 0, 1))).toBe(false);
  });
});

describe("continue offer", () => {
  it("multi-season: once the final box order exists, before it ships", () => {
    const three = { seasons_total: 4, box_orders: [1, 2, 3].map((n) => ({ box_number: n, shipped_at: SHIP1 })) };
    expect(isContinueOfferDue(three)).toBe(false);
    const four = { seasons_total: 4, box_orders: [...three.box_orders, { box_number: 4, shipped_at: null }] };
    expect(isContinueOfferDue(four)).toBe(true);
    expect(isContinueOfferDue({ ...four, continue_offer_sent_at: 1 })).toBe(false);
    expect(isContinueOfferDue({ ...four, converted_at: 1 })).toBe(false);
  });
  it("single season: when it ships", () => {
    expect(isContinueOfferDue({ seasons_total: 1, box_orders: [{ box_number: 1, shipped_at: null }] })).toBe(false);
    expect(isContinueOfferDue({ seasons_total: 1, box_orders: [{ box_number: 1, shipped_at: SHIP1 }] })).toBe(true);
  });
});

describe("CRO card math (from variant prices)", () => {
  const single = GIFT_SEASON_OPTIONS.find((o) => o.seasons === 1)!.price;
  it("per-season price on every card: $299 / $275 / $250", () => {
    expect(GIFT_SEASON_OPTIONS.map((o) => formatUsd(perSeasonPrice(o.price, o.seasons)))).toEqual([
      "$299",
      "$275",
      "$250",
    ]);
  });
  it("savings vs 1-season price: none / $48 / $196", () => {
    expect(GIFT_SEASON_OPTIONS.map((o) => seasonSavings(o.price, o.seasons, single))).toEqual([0, 48, 196]);
  });
  it("follows live prices instead of hard-coded numbers", () => {
    const live = withLivePrices(GIFT_SEASON_OPTIONS, {
      [GIFT_SEASON_OPTIONS[0].variantId]: 300,
      [GIFT_SEASON_OPTIONS[2].variantId]: 1000,
    });
    expect(seasonSavings(live[2].price, 4, live[0].price)).toBe(200);
  });
});

describe("launch config placeholders", () => {
  it("timing line has a visible placeholder until the cutoff is set", () => {
    expect(giftSeasonTimingLine({ raw: "" })).toBe(
      "Order by [cutoff date TBD] for their first Reserve to arrive by Christmas."
    );
  });
  it("before the cutoff: order by the date for Christmas", () => {
    const at = Date.UTC(2026, 11, 15, 23, 0); // Dec 15, 6pm ET
    for (const selfDeliver of [false, true]) {
      expect(giftSeasonTimingLine({ now: at, raw: "2026-12-15", window: "1-2 business days", selfDeliver })).toBe(
        "Order by December 15 for their first Reserve to arrive by Christmas."
      );
    }
  });
  it("after the cutoff (ET midnight): the reveal still arrives on time", () => {
    const after = Date.UTC(2026, 11, 16, 5, 0); // Dec 16, 12:00am ET
    expect(isPastGiftSeasonCutoff(after - 1, "2026-12-15")).toBe(false);
    expect(isPastGiftSeasonCutoff(after, "2026-12-15")).toBe(true);
    expect(giftSeasonTimingLine({ now: after, raw: "2026-12-15", window: "1-2 business days" })).toBe(
      "Their gift reveal still arrives on time by email. Their first Reserve ships 1-2 business days after they confirm sizing."
    );
    expect(
      giftSeasonTimingLine({ now: after, raw: "2026-12-15", window: "1-2 business days", selfDeliver: true })
    ).toBe(
      "Your printable gift card still arrives on time by email. Their first Reserve ships 1-2 business days after they confirm sizing."
    );
  });
  it("cutoff parsing", () => {
    expect(formatGiftSeasonCutoff("2026-12-15")).toBe("December 15");
    expect(parseGiftSeasonCutoff("2026-02-30")).toBeNull();
    expect(isPastGiftSeasonCutoff(Date.UTC(2030, 0, 1), "December 15")).toBe(false);
  });
  it("free shipping / exchanges claim is off by default", () => {
    expect(GIFT_SEASON_SHOW_FREE_SHIPPING_EXCHANGES).toBe(false);
    expect(pendingGiftSeasonPlaceholders()).toHaveLength(3);
  });
});

describe("checkout", () => {
  const base: GiftSeasonCheckoutInput = {
    seasons: 4,
    recipientName: " Sam ",
    recipientEmail: " Sam@Example.com ",
    message: "Happy holidays",
    deliverOn: "2026-12-24",
    lpSource: "gift-season",
  };
  it("validates", () => {
    expect(validateGiftSeasonInput(base, "2026-11-11")).toBeNull();
    expect(validateGiftSeasonInput({ ...base, recipientName: " " }, "2026-11-11")).toMatch(/name/);
    expect(validateGiftSeasonInput({ ...base, recipientEmail: "nope" }, "2026-11-11")).toMatch(/email/);
    expect(validateGiftSeasonInput({ ...base, deliverOn: "2026-11-01" }, "2026-11-11")).toMatch(/today or later/);
    expect(validateGiftSeasonInput({ ...base, seasons: 3 as never }, "2026-11-11")).toMatch(/length/);
    expect(validateGiftSeasonInput({ ...base, message: "x".repeat(501) }, "2026-11-11")).toMatch(/500/);
  });
  it("builds a one-time cart with gift attributes and no selling plan", () => {
    const cart = buildGiftSeasonCart(base);
    expect(cart.merchandiseId).toBe("gid://shopify/ProductVariant/50765708886208");
    expect(cart).not.toHaveProperty("sellingPlanId");
    const attrs = Object.fromEntries(cart.attributes.map((a) => [a.key, a.value]));
    expect(attrs).toMatchObject({
      gift: "true",
      gift_kind: "season",
      gift_seasons: "4",
      gift_recipient_name: "Sam",
      gift_recipient_email: "sam@example.com",
      gift_deliver_on: "2026-12-24",
    });
    const sendNow = buildGiftSeasonCart({ ...base, deliverOn: "" });
    expect(sendNow.attributes.find((a) => a.key === "gift_deliver_on")).toBeUndefined();
    expect(attrs).not.toHaveProperty("gift_self_deliver");
  });
  it("self-give: recipient email optional, flagged on the cart", () => {
    const self = { ...base, recipientEmail: "", selfDeliver: true };
    expect(validateGiftSeasonInput(self, "2026-11-11")).toBeNull();
    expect(validateGiftSeasonInput({ ...self, recipientEmail: "nope" }, "2026-11-11")).toMatch(/email/);
    expect(validateGiftSeasonInput({ ...base, recipientEmail: "" }, "2026-11-11")).toMatch(/email/);
    const attrs = Object.fromEntries(buildGiftSeasonCart(self).attributes.map((a) => [a.key, a.value]));
    expect(attrs.gift_self_deliver).toBe("true");
    expect(attrs).not.toHaveProperty("gift_recipient_email");
  });
});

describe("customer copy rules", () => {
  const texts = [1, 2, 4].flatMap((n) => {
    const args = { recipientFirstName: "Sam", purchaserFirstName: "Alex", purchaserEmail: "a@x.com", giftMessage: "Enjoy", sizingUrl: "https://mymully.com/gift-sizing/t", seasonsTotal: n };
    const c = { recipientFirstName: "Sam", purchaserFirstName: "Alex", seasonsTotal: n, continueUrl: "https://mymully.com/gift-continue/t" };
    const sd = { purchaserFirstName: "Alex", recipientFirstName: "Sam", seasonsTotal: n, sizingUrl: "https://mymully.com/gift-sizing/t", giftCardUrl: "https://mymully.com/gift-card/t" };
    return [
      buildGiftRecipientSubject(args), buildGiftRecipientText(args),
      buildGiftContinueSubject(c), buildGiftContinueText(c),
      buildGiftSelfDeliverSubject(sd), buildGiftSelfDeliverText(sd),
    ];
  });
  it("has no em dashes, en dashes or double dashes", () => {
    for (const t of texts) expect(t).not.toMatch(/\u2014|\u2013|--/);
  });
  it("never says box or Mullybox", () => {
    for (const t of texts) expect(t).not.toMatch(/\bbox(es)?\b|mullybox/i);
  });
  it("says Mully and Reserve", () => {
    for (const t of texts.filter((_, i) => i % 2 === 1)) {
      expect(t).toMatch(/Mully/);
      expect(t).toMatch(/Reserve/);
    }
  });
  it("mentions the right count and that it never renews", () => {
    const four = buildGiftRecipientText({ recipientFirstName: "Sam", purchaserFirstName: "Alex", purchaserEmail: "a@x.com", giftMessage: null, sizingUrl: "u", seasonsTotal: 4 });
    expect(four).toMatch(/4 seasons/);
    expect(four).toMatch(/Nothing renews/);
  });
  it("makes no unverified value or free shipping claims", () => {
    for (const t of texts) {
      expect(t).not.toMatch(/\$300/);
      expect(t).not.toMatch(/free shipping|exchanges are free|Shipping and exchanges/i);
    }
  });
  it("legacy gift email: no $300+, em dashes, box or Mullybox", () => {
    const t = buildGiftRecipientText({ recipientFirstName: "Sam", purchaserFirstName: "Alex", purchaserEmail: "a@x.com", giftMessage: "Hi", sizingUrl: "u" });
    expect(t).not.toMatch(/\$300|\u2014|\u2013|--|\bbox(es)?\b|mullybox/i);
    expect(t).toMatch(/Reserve/);
  });
  it("self-give email goes with the card and sizing links", () => {
    const t = buildGiftSelfDeliverText({ purchaserFirstName: "Alex", recipientFirstName: "Sam", seasonsTotal: 2, sizingUrl: "S", giftCardUrl: "C" });
    expect(t).toMatch(/2 seasons/);
    expect(t).toContain("C");
    expect(t).toContain("S");
  });
});
