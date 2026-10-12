import { describe, expect, it } from "vitest";
import {
  BOGO15_CODE,
  bogoSavings,
  nextBogoCodes,
  resolveVariant,
  selectCartPicks,
  toCartPickProduct,
  type CartPickProduct,
} from "@/lib/cartPicks";

function src(slug: string, tags: string[], price = 100, options = [{ name: "Size", values: ["S", "M", "L"] }]) {
  const sizes = options.find((o) => o.name === "Size")?.values ?? ["One"];
  return {
    slug,
    name: slug,
    brand: "Brand",
    tags: ["shop", ...tags],
    options,
    variants: sizes.map((s) => ({
      id: `gid://v/${slug}-${s}`,
      title: s,
      price,
      availableForSale: s !== "L",
      selectedOptions: [{ name: "Size", value: s }],
    })),
  };
}

const catalog = [
  src("vest", ["shop-outerwear"], 198),
  src("polo-a", ["shop-tops"], 110),
  src("polo-b", ["shop-tops"], 114),
  src("polo-c", ["shop-tops"], 98),
  src("chino", ["shop-bottoms"], 118),
  src("short", ["shop-bottoms"], 108),
  src("belt", ["shop-accessories"], 98),
  src("towel", ["shop-gear"], 19.99),
  src("jacket", ["shop-outerwear"], 148),
].map((p) => toCartPickProduct(p)!) as CartPickProduct[];

describe("nextBogoCodes", () => {
  it("adds BOGO15 at two units", () => {
    expect(nextBogoCodes([], { units: 2, suppressed: false })).toEqual([BOGO15_CODE]);
  });
  it("leaves one unit alone and removes the code when the bag drops to one", () => {
    expect(nextBogoCodes([], { units: 1, suppressed: false })).toBeNull();
    expect(nextBogoCodes(["bogo15"], { units: 1, suppressed: false })).toEqual([]);
  });
  it("never adds alongside another code or for subscribers and reward holders", () => {
    expect(nextBogoCodes(["MULLYEDIT10"], { units: 3, suppressed: false })).toBeNull();
    expect(nextBogoCodes(["BOGO15", "MULLYTEXT15"], { units: 3, suppressed: false })).toEqual(["MULLYTEXT15"]);
    expect(nextBogoCodes([], { units: 3, suppressed: true })).toBeNull();
    expect(nextBogoCodes(["BOGO15"], { units: 3, suppressed: true })).toEqual([]);
  });
  it("is a no-op when already correct", () => {
    expect(nextBogoCodes(["BOGO15"], { units: 2, suppressed: false })).toBeNull();
  });
});

describe("toCartPickProduct", () => {
  it("drops non-shop, excluded and sold-out products", () => {
    expect(toCartPickProduct({ ...src("x", []), tags: ["shop-tops"] })).toBeNull();
    expect(toCartPickProduct(src("x", ["shop-tops", "cart-pick-exclude"]))).toBeNull();
    const soldOut = src("x", ["shop-tops"]);
    soldOut.variants.forEach((v) => (v.availableForSale = false));
    expect(toCartPickProduct(soldOut)).toBeNull();
  });
  it("sends two-dimension fits (waist + inseam) to the product page", () => {
    const p = toCartPickProduct(src("pant", ["shop-bottoms"], 118, [
      { name: "Color", values: ["Khaki", "Navy"] },
      { name: "Size", values: ["30", "32"] },
      { name: "Inseam", values: ["30", "32"] },
    ]))!;
    expect(p.quickAdd).toBe(false);
    expect(catalog[1].quickAdd).toBe(true);
  });
});

describe("selectCartPicks", () => {
  it("excludes cart items and favors complements of the bag", () => {
    const picks = selectCartPicks(catalog, ["vest"], { rotation: 0 });
    expect(picks).toHaveLength(3);
    expect(picks.map((p) => p.slug)).not.toContain("vest");
    expect(picks.every((p) => p.category === "tops" || p.category === "bottoms")).toBe(true);
  });
  it("caps any category at two per row", () => {
    for (let r = 0; r < 6; r++) {
      const picks = selectCartPicks(catalog, ["vest"], { rotation: r });
      const tops = picks.filter((p) => p.category === "tops").length;
      expect(tops).toBeLessThanOrEqual(2);
    }
  });
  it("cycles through different products across opens", () => {
    const seen = new Set<string>();
    for (let r = 0; r < 4; r++) selectCartPicks(catalog, ["vest"], { rotation: r }).forEach((p) => seen.add(p.slug));
    expect(seen.size).toBeGreaterThan(3);
  });
  it("keeps a pinned product in slot one", () => {
    const pinned = catalog.map((p) => (p.slug === "towel" ? { ...p, pinned: true } : p));
    for (let r = 0; r < 3; r++) expect(selectCartPicks(pinned, ["vest"], { rotation: r })[0].slug).toBe("towel");
  });
  it("sinks products that were shown repeatedly without a tap", () => {
    const base = selectCartPicks(catalog, ["vest"], { rotation: 0, window: 3 });
    const fatigue = Object.fromEntries(base.map((p) => [p.slug, { seen: 8, clicked: 0 }]));
    const next = selectCartPicks(catalog, ["vest"], { rotation: 0, window: 3, fatigue });
    expect(next.map((p) => p.slug)).not.toEqual(base.map((p) => p.slug));
  });
});

describe("helpers", () => {
  it("computes 15% of the cheaper piece", () => {
    expect(bogoSavings(198, 110)).toBe(16.5);
    expect(bogoSavings(98, 185)).toBe(14.7);
  });
  it("resolves the chosen variant and ignores sold-out sizes", () => {
    const polo = catalog[1];
    expect(resolveVariant(polo, { Size: "M" })?.id).toBe("gid://v/polo-a-M");
    expect(resolveVariant(polo, { Size: "L" })).toBeNull();
    expect(resolveVariant(polo, {})).toBeNull();
  });
});
