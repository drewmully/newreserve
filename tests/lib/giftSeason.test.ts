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
  parseShipMode,
  seasonCountFromLineItems,
  seasonProgress,
  addressEmailDue,
  addressFromShopify,
  formatGiftAddress,
  isValidGiftAddress,
  needsNextAddress,
  seasonNoticeDue,
  validateGiftAddress,
} from "@/lib/gifts/giftSeason";
import {
  buildGiftSeasonCart,
  createClientGiftToken,
  giftSeasonConfirmedPath,
  validateGiftSeasonInput,
  type GiftSeasonCheckoutInput,
} from "@/lib/giftSeasonCheckout";
import {
  buildGiftContinueSubject,
  buildGiftContinueText,
  buildGiftRecipientSubject,
  buildGiftRecipientText,
} from "@/lib/email/templates/giftRecipient";
import {
  buildAddressReminderSubject,
  buildAddressReminderText,
  buildAddressRequestPurchaserSubject,
  buildAddressRequestPurchaserText,
  buildAddressRequestRecipientSubject,
  buildAddressRequestRecipientText,
  buildGifterConfirmationSubject,
  buildGifterConfirmationText,
  buildSeasonNoticeSubject,
  buildSeasonNoticeText,
} from "@/lib/email/templates/giftSeasonEmails";
import {
  EMPTY_SIZING,
  formatSizingLine,
  isSizingComplete,
  sanitizeSizing,
  sizingFromAttributes,
  type GiftSizing,
} from "@/lib/gifts/giftSizing";
import { readGiftSeasonOrderData } from "@/lib/gifts/giftSeasonOrderData";
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

const SIZES: GiftSizing = {
  shirt: "L", waist: "34", inseam: '32"', shoe: "10.5", glove_size: "ML", glove_hand: "Left", notes: "Size up in polos",
};
const ADDR = {
  first_name: "Sam", last_name: "Lee", address1: "12 Elm St", address2: "", city: "Austin",
  province_code: "TX", zip: "78701", country_code: "US", phone: "",
};

describe("launch config", () => {
  it("timing line has a visible placeholder until the cutoff is set", () => {
    expect(giftSeasonTimingLine({ raw: "", window: "1-2 business days" })).toBe(
      "Order by [cutoff date TBD] for it to arrive by Christmas. Ships in 1-2 business days."
    );
  });
  it("before the cutoff: order by the date for Christmas, plus the ship window", () => {
    const at = Date.UTC(2026, 11, 15, 23, 0); // Dec 15, 6pm ET
    expect(giftSeasonTimingLine({ now: at, raw: "2026-12-15", window: "1-2 business days" })).toBe(
      "Order by December 15 for it to arrive by Christmas. Ships in 1-2 business days."
    );
  });
  it("after the cutoff (ET midnight): only the ship window", () => {
    const after = Date.UTC(2026, 11, 16, 5, 0); // Dec 16, 12:00am ET
    expect(isPastGiftSeasonCutoff(after - 1, "2026-12-15")).toBe(false);
    expect(isPastGiftSeasonCutoff(after, "2026-12-15")).toBe(true);
    expect(giftSeasonTimingLine({ now: after, raw: "2026-12-15", window: "1-2 business days" })).toBe(
      "Ships in 1-2 business days."
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
    sizing: SIZES,
    shipMode: "to_recipient",
    giftToken: "abcdefghijklmnopqrstuvwxyz012345",
    lpSource: "gift-season",
  };
  it("validates: name and sizes required, email optional", () => {
    expect(validateGiftSeasonInput(base)).toBeNull();
    expect(validateGiftSeasonInput({ ...base, recipientEmail: "" })).toBeNull();
    expect(validateGiftSeasonInput({ ...base, recipientName: " " })).toMatch(/name/);
    expect(validateGiftSeasonInput({ ...base, recipientEmail: "nope" })).toMatch(/email/);
    expect(validateGiftSeasonInput({ ...base, sizing: { ...SIZES, waist: "" } })).toBe("Pick their pant waist.");
    expect(validateGiftSeasonInput({ ...base, sizing: { ...SIZES, notes: "" } })).toBeNull();
    expect(validateGiftSeasonInput({ ...base, seasons: 3 as never })).toMatch(/length/);
    expect(validateGiftSeasonInput({ ...base, message: "x".repeat(501) })).toMatch(/500/);
    expect(validateGiftSeasonInput({ ...base, giftToken: "short" })).toMatch(/refresh/);
  });
  it("puts sizes, recipient and ship mode on the cart LINE (line item properties)", () => {
    const cart = buildGiftSeasonCart(base);
    expect(cart.merchandiseId).toBe("gid://shopify/ProductVariant/50765708886208");
    expect(cart).not.toHaveProperty("sellingPlanId");
    const line = Object.fromEntries(cart.lineAttributes.map((a) => [a.key, a.value]));
    expect(line).toEqual({
      Recipient: "Sam",
      Shirt: "L",
      Waist: "34",
      Inseam: '32"',
      Shoe: "10.5",
      Glove: "ML",
      "Glove hand": "Left",
      "Fit notes": "Size up in polos",
      "Ships to": "Recipient",
      _gift_token: base.giftToken,
      _gift_ship_mode: "to_recipient",
      _recipient_email: "sam@example.com",
    });
    const me = Object.fromEntries(
      buildGiftSeasonCart({ ...base, shipMode: "to_purchaser", recipientEmail: "" }).lineAttributes.map((a) => [a.key, a.value])
    );
    expect(me["Ships to"]).toBe("Purchaser (gift hand-off)");
    expect(me).not.toHaveProperty("_recipient_email");
  });
  it("mirrors everything as cart attributes (note_attributes), no reveal fields", () => {
    const attrs = Object.fromEntries(buildGiftSeasonCart(base).attributes.map((a) => [a.key, a.value]));
    expect(attrs).toMatchObject({
      gift: "true",
      gift_kind: "season",
      gift_seasons: "4",
      gift_ship_mode: "to_recipient",
      gift_token: base.giftToken,
      gift_recipient_name: "Sam",
      gift_recipient_email: "sam@example.com",
      gift_size_shirt: "L",
      gift_size_glove_hand: "Left",
    });
    expect(attrs).not.toHaveProperty("gift_deliver_on");
    expect(attrs).not.toHaveProperty("gift_self_deliver");
  });
  it("client token matches the server token shape; confirmation path carries mode", () => {
    const t = createClientGiftToken();
    expect(t).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(giftSeasonConfirmedPath({ giftToken: t, shipMode: "to_purchaser", seasons: 2 })).toBe(
      `/lp/gift-season/confirmed?t=${t}&mode=to_purchaser&seasons=2`
    );
  });
});

describe("sizing", () => {
  it("drops unknown values and keys", () => {
    expect(sanitizeSizing({ shirt: "XXXL", waist: "34", evil: "x" })).toEqual({ ...EMPTY_SIZING, waist: "34" });
    expect(isSizingComplete(SIZES)).toBe(true);
    expect(isSizingComplete({ ...SIZES, glove_hand: "" })).toBe(false);
    expect(formatSizingLine(SIZES)).toBe('Shirt L, Waist 34, Inseam 32", Shoe 10.5, Glove ML Left');
  });
  it("reads back from line properties or note attributes", () => {
    const props = buildGiftSeasonCart({
      seasons: 2, recipientName: "Sam", recipientEmail: "", message: "", sizing: SIZES,
      shipMode: "to_recipient", giftToken: "abcdefghijklmnopqrstuvwxyz012345", lpSource: "x",
    }).lineAttributes.map((a) => ({ name: a.key, value: a.value }));
    expect(sizingFromAttributes(props)).toEqual(SIZES);
    expect(sizingFromAttributes([{ name: "gift_size_shirt", value: "M" }]).shirt).toBe("M");
  });
});

describe("orders-paid gift data (no write_orders needed)", () => {
  const cart = buildGiftSeasonCart({
    seasons: 4, recipientName: "Sam", recipientEmail: "sam@example.com", message: "Enjoy", sizing: SIZES,
    shipMode: "to_purchaser", giftToken: "abcdefghijklmnopqrstuvwxyz012345", lpSource: "x",
  });
  const toProps = (a: Array<{ key: string; value: string }>) => a.map((x) => ({ name: x.key, value: x.value }));
  it("identifies the parent by SKU even without the gift attribute", () => {
    expect(seasonCountFromLineItems([{ sku: "RES-GIFT-4S", variant_id: 1 }])).toBe(4);
  });
  it("reads from note_attributes", () => {
    const d = readGiftSeasonOrderData({
      note_attributes: toProps(cart.attributes),
      line_items: [{ sku: "RES-GIFT-4S", variant_id: 1, properties: [] }],
    });
    expect(d).toMatchObject({ recipientName: "Sam", recipientEmail: "sam@example.com", shipMode: "to_purchaser", message: "Enjoy" });
    expect(d.sizing).toEqual(SIZES);
  });
  it("falls back to line item properties when note_attributes are missing", () => {
    const d = readGiftSeasonOrderData({
      note_attributes: [],
      line_items: [
        { sku: "OTHER", variant_id: 2, properties: [{ name: "Recipient", value: "Nope" }] },
        { sku: "RES-GIFT-4S", variant_id: 1, properties: toProps(cart.lineAttributes) },
      ],
    });
    expect(d).toMatchObject({ recipientName: "Sam", recipientEmail: "sam@example.com", shipMode: "to_purchaser", token: "abcdefghijklmnopqrstuvwxyz012345" });
    expect(d.sizing).toEqual(SIZES);
  });
  it("ship mode defaults to ship to them", () => {
    expect(parseShipMode(undefined)).toBe("to_recipient");
    expect(parseShipMode("to_purchaser")).toBe("to_purchaser");
    expect(parseShipMode("weird")).toBe("to_recipient");
  });
});

describe("next-season address", () => {
  it("validates US addresses", () => {
    expect(validateGiftAddress(ADDR)).toEqual({ ok: true, address: ADDR });
    expect(validateGiftAddress({ ...ADDR, zip: "7870" })).toMatchObject({ ok: false });
    expect(validateGiftAddress({ ...ADDR, province_code: "ZZ" })).toMatchObject({ ok: false, error: "Pick a state." });
    expect(validateGiftAddress({ ...ADDR, last_name: "" })).toMatchObject({ ok: false });
  });
  it("copies the Shopify shipping address", () => {
    const a = addressFromShopify({ first_name: "Sam", last_name: "Lee", address1: "12 Elm St", city: "Austin", province_code: "TX", zip: "78701", country_code: "US" });
    expect(isValidGiftAddress(a)).toBe(true);
    expect(formatGiftAddress(a)).toBe("Sam Lee, 12 Elm St, Austin, TX 78701");
    expect(addressFromShopify({ city: "Austin" })).toBeNull();
  });
  const boxes1Shipped = [{ box_number: 1, shipped_at: SHIP1 }];
  const meGift = {
    seasons_total: 4,
    box_orders: boxes1Shipped,
    first_box_shipped_at: SHIP1,
    ship_mode: "to_purchaser" as const,
    next_shipping_address: null,
    recipient_email: "sam@example.com",
    purchaser_email: "alex@example.com",
  };
  it("needs an address only while more seasons remain", () => {
    expect(needsNextAddress(meGift)).toBe(true);
    expect(needsNextAddress({ ...meGift, next_shipping_address: ADDR })).toBe(false);
    expect(needsNextAddress({ ...meGift, seasons_total: 1 })).toBe(false);
  });
  it("ship to me: asks the recipient 14 days after season 1 ships, never before", () => {
    expect(addressEmailDue(meGift, SHIP1 + 13 * DAY)).toBeNull();
    expect(addressEmailDue(meGift, SHIP1 + 14 * DAY)).toEqual({ kind: "request", target: "recipient" });
    expect(addressEmailDue({ ...meGift, recipient_email: "" }, SHIP1 + 14 * DAY)).toEqual({ kind: "request", target: "purchaser" });
    expect(addressEmailDue({ ...meGift, first_box_shipped_at: null, box_orders: [{ box_number: 1, shipped_at: null }] }, SHIP1 + 60 * DAY)).toBeNull();
  });
  it("falls back to the purchaser after 7 days without a response", () => {
    const asked = { ...meGift, address_request_sent_at: SHIP1 + 14 * DAY, address_request_target: "recipient" as const };
    expect(addressEmailDue(asked, SHIP1 + 20 * DAY)).toBeNull();
    expect(addressEmailDue(asked, SHIP1 + 21 * DAY)).toEqual({ kind: "fallback" });
    const fellBack = { ...asked, address_fallback_sent_at: SHIP1 + 21 * DAY };
    expect(addressEmailDue(fellBack, SHIP1 + 30 * DAY)).toBeNull();
  });
  it("reminds the purchaser 14 days before season 2 when still missing", () => {
    const fellBack = { ...meGift, address_request_sent_at: SHIP1, address_request_target: "recipient" as const, address_fallback_sent_at: SHIP1 };
    // season 2 due 2027-03-01
    expect(addressEmailDue(fellBack, Date.UTC(2027, 1, 14))).toBeNull();
    expect(addressEmailDue(fellBack, Date.UTC(2027, 1, 15))).toEqual({ kind: "reminder" });
    expect(addressEmailDue({ ...fellBack, address_reminder_sent_at: 1 }, Date.UTC(2027, 1, 20))).toBeNull();
    expect(addressEmailDue({ ...fellBack, next_shipping_address: ADDR }, Date.UTC(2027, 1, 20))).toBeNull();
  });
  it("ship to them never sends an address request", () => {
    const them = { ...meGift, ship_mode: "to_recipient" as const, next_shipping_address: ADDR };
    expect(addressEmailDue(them, SHIP1 + 30 * DAY)).toBeNull();
  });
  it("season notice goes out 10 days before each season once, only with an address", () => {
    const them = { ...meGift, ship_mode: "to_recipient" as const, next_shipping_address: ADDR };
    expect(seasonNoticeDue(them, Date.UTC(2027, 1, 18))).toBeNull();
    expect(seasonNoticeDue(them, Date.UTC(2027, 1, 19))).toBe(2);
    expect(seasonNoticeDue({ ...them, season_notices_sent: [2] }, Date.UTC(2027, 1, 19))).toBeNull();
    expect(seasonNoticeDue(meGift, Date.UTC(2027, 1, 19))).toBeNull();
  });
});

describe("customer copy rules", () => {
  const texts = [1, 2, 4].flatMap((n) => {
    const c = { recipientFirstName: "Sam", purchaserFirstName: "Alex", seasonsTotal: n, continueUrl: "https://mymully.com/gift-continue/t" };
    const out: string[] = [buildGiftContinueSubject(c), buildGiftContinueText(c)];
    for (const shipMode of ["to_recipient", "to_purchaser"] as const) {
      for (const hasRecipientEmail of [true, false]) {
        out.push(
          buildGifterConfirmationSubject(),
          buildGifterConfirmationText({
            purchaserFirstName: "Alex", recipientFirstName: "Sam", seasonsTotal: n, shipMode,
            shipToLine: "Sam Lee, 12 Elm St, Austin, TX 78701", hasRecipientEmail, purchasedAt: SHIP1,
            updateUrl: "https://mymully.com/gift-address/t", giftCardUrl: shipMode === "to_purchaser" ? "https://mymully.com/gift-card/t" : null,
          })
        );
      }
    }
    const a = { recipientFirstName: "Sam", purchaserFirstName: "Alex", seasonsTotal: n, nextDueOn: "2027-03-01", addressUrl: "https://mymully.com/gift-address/t" };
    out.push(
      buildAddressRequestRecipientSubject(), buildAddressRequestRecipientText(a),
      buildAddressRequestPurchaserSubject(a), buildAddressRequestPurchaserText({ ...a, fallback: true }),
      buildAddressReminderSubject(a), buildAddressReminderText(a),
      buildSeasonNoticeSubject({ seasonNumber: 2 }),
      buildSeasonNoticeText({ recipientFirstName: "Sam", seasonNumber: 2, seasonsTotal: n, dueOn: "2027-03-01", shipToLine: "Sam Lee, 12 Elm St", updateUrl: "u" })
    );
    return out;
  });
  it("has no em dashes, en dashes or double dashes", () => {
    for (const t of texts) expect(t).not.toMatch(/\u2014|\u2013|--/);
  });
  it("never says box or Mullybox", () => {
    for (const t of texts) expect(t).not.toMatch(/\bbox(es)?\b|mullybox/i);
  });
  it("makes no unverified value, free shipping or free exchange claims", () => {
    for (const t of texts) {
      expect(t).not.toMatch(/\$300/);
      expect(t).not.toMatch(/free shipping|exchanges are free|free exchange|Shipping and exchanges/i);
    }
  });
  it("gifter confirmation: on its way, ship-to address, schedule, mode-specific line", () => {
    const base = {
      purchaserFirstName: "Alex", recipientFirstName: "Sam", seasonsTotal: 4, shipToLine: "Sam Lee, 12 Elm St, Austin, TX 78701",
      hasRecipientEmail: true, purchasedAt: Date.UTC(2026, 11, 1), updateUrl: "U",
    };
    const them = buildGifterConfirmationText({ ...base, shipMode: "to_recipient" });
    expect(buildGifterConfirmationSubject()).toBe("Your gift is on its way");
    expect(them).toMatch(/Your gift is on its way\./);
    expect(them).toMatch(/Season 1 ships in .+ to:\nSam Lee, 12 Elm St, Austin, TX 78701/);
    expect(them).toMatch(/Season 1: ships now\nSeason 2: around March 2027\nSeason 3: around June 2027\nSeason 4: around September 2027/);
    expect(them).not.toMatch(/After they open it/);
    const me = buildGifterConfirmationText({ ...base, shipMode: "to_purchaser", giftCardUrl: "CARD" });
    expect(me).toMatch(/After they open it, we'll email them to collect their address for the next seasons\./);
    expect(me).toContain("CARD");
    const one = buildGifterConfirmationText({ ...base, seasonsTotal: 1, shipMode: "to_recipient" });
    expect(one).not.toMatch(/every 3 months|Season 2/);
  });
  it("legacy gift email: no $300+, em dashes, box or Mullybox", () => {
    const t = buildGiftRecipientText({ recipientFirstName: "Sam", purchaserFirstName: "Alex", purchaserEmail: "a@x.com", giftMessage: "Hi", sizingUrl: "u" });
    expect(t).not.toMatch(/\$300|\u2014|\u2013|--|\bbox(es)?\b|mullybox/i);
    expect(t).toMatch(/Reserve/);
    expect(buildGiftRecipientSubject({ purchaserFirstName: "Alex" })).toBe("Alex sent you a Mully Reserve gift");
  });
});
