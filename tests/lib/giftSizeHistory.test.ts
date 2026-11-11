import { describe, it, expect } from "vitest";
import { hasGiftSeasonTag, isGiftSeasonLine, isGiftSeasonSizingOrder, isGiftSeasonSku } from "@/lib/gifts/giftSizeHistory";

describe("gift season orders stay out of size history", () => {
  it("matches the paid parent by RES-GIFT SKU", () => {
    for (const sku of ["RES-GIFT-1S", "RES-GIFT-2S", "res-gift-4s", " RES-GIFT-4S "]) expect(isGiftSeasonSku(sku)).toBe(true);
    for (const sku of ["RES-MEM", "", null, undefined, "XRES-GIFT-1S"]) expect(isGiftSeasonSku(sku)).toBe(false);
    expect(
      isGiftSeasonSizingOrder({ tags: "", lines: [{ sku: "RES-GIFT-2S", properties: { Shirt: "L", Waist: "34", "Glove hand": "Left" } }] })
    ).toBe(true);
  });
  it("matches the $0 season orders by the _gift_season_box property", () => {
    expect(isGiftSeasonLine({ sku: "RES-MEM", properties: { Shirt: "L", Waist: "34", _gift_season_box: "2 of 4" } })).toBe(true);
  });
  it("matches gift season tags", () => {
    expect(hasGiftSeasonTag("gift-season, gift-season-4, gift-season-box-1-of-4")).toBe(true);
    expect(hasGiftSeasonTag("Subscription, gift-season-box")).toBe(true);
    expect(hasGiftSeasonTag("gift-season-2")).toBe(true);
    expect(hasGiftSeasonTag("gift, Subscription First Order")).toBe(false);
    expect(hasGiftSeasonTag(null)).toBe(false);
  });
  it("leaves regular Reserve orders alone, including the old recurring gift", () => {
    expect(isGiftSeasonSizingOrder({ tags: "Subscription First Order", lines: [{ sku: "RES-MEM", properties: { "Top size": "L", Waist: "34" } }] })).toBe(false);
    expect(isGiftSeasonSizingOrder({ tags: "gift", lines: [{ sku: "RES-MEM", properties: { "Shirt Size": "XL" } }] })).toBe(false);
  });
  it("one gift line marks the whole order", () => {
    expect(
      isGiftSeasonSizingOrder({ lines: [{ sku: "POLO-123", properties: null }, { sku: "RES-GIFT-1S", properties: null }] })
    ).toBe(true);
  });
});
