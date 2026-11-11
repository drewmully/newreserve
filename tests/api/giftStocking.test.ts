import { describe, expect, it } from "vitest";
import { isStockingStuffer, inStockNow, type StockingCandidate } from "@/lib/giftStocking";

const base = (o: Partial<StockingCandidate>): StockingCandidate => ({
  slug: "x",
  brand: "Rhone",
  collection: "Accessories",
  tags: ["accessories", "socks"],
  price: 16,
  variants: [{ availableForSale: true, currentlyNotInStock: false }],
  ...o,
});

describe("isStockingStuffer", () => {
  it("keeps tagged accessories under the cap", () => {
    expect(isStockingStuffer(base({}))).toBe(true);
    expect(isStockingStuffer(base({ collection: "Golf Towel", tags: [] }))).toBe(true);
    expect(isStockingStuffer(base({ collection: "Golf Bag Organizer", tags: [], price: 72 }))).toBe(true);
    expect(isStockingStuffer(base({ collection: "Hat", tags: [] }))).toBe(true);
  });
  it("drops anything at or over the cap", () => {
    expect(isStockingStuffer(base({ price: 75 }))).toBe(false);
    expect(isStockingStuffer(base({ price: 98, collection: "Belt" }))).toBe(false);
  });
  it("drops apparel, memberships and Mully boxes", () => {
    expect(isStockingStuffer(base({ collection: "Polo", tags: ["shop"] }))).toBe(false);
    expect(isStockingStuffer(base({ slug: "swing-box-founding-100", brand: "Mullybox", tags: [] }))).toBe(false);
    expect(isStockingStuffer(base({ slug: "reserve-access" }))).toBe(false);
  });
  it("needs a tag when the type is only the Accessories fallback", () => {
    expect(isStockingStuffer(base({ tags: [] }))).toBe(false);
  });
  it("drops products with nothing purchasable", () => {
    expect(isStockingStuffer(base({ variants: [{ availableForSale: false }] }))).toBe(false);
  });
});

describe("inStockNow", () => {
  it("is false for Restocking-only products", () => {
    expect(inStockNow(base({ variants: [{ availableForSale: true, currentlyNotInStock: true }] }))).toBe(false);
    expect(inStockNow(base({}))).toBe(true);
  });
});
