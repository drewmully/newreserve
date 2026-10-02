import { describe, expect, it } from "vitest";
import { buildColorCards } from "../../src/lib/shopColorCards";
import type { ShopifyProduct } from "../../src/lib/shopify";

const variant = (id: string, color: string, size = "M") => ({
  id, title: `${color} / ${size}`, price: 100, reservePrice: 80, availableForSale: true,
  selectedOptions: [{ name: "Color", value: color }, { name: "Size", value: size }],
});
const img = (url: string, altText: string) => ({ url, altText });
const product = (slug: string, colors: string[], images: { url: string; altText: string }[]) => ({
  slug, name: slug, brand: "B", price: 100, reservePrice: 80, collection: "", description: "", material: "",
  aboutBrand: "", whyWeLikeIt: "", sizing: "", variantId: `${slug}-v0`,
  images: images.map((i) => i.url), imageDetails: images,
  options: [{ name: "Color", values: colors }],
  variants: colors.map((c, i) => variant(`gid://shopify/ProductVariant/${slug}${i}`, c)),
}) as unknown as ShopifyProduct;

describe("buildColorCards", () => {
  const chino = product("chino", ["Khaki", "Navy"], [img("k.jpg", "Chino, Khaki"), img("n.jpg", "Chino, Navy")]);
  const towel = product("towel", ["Red Stripes", "Blue Stripes"], [img("t.jpg", "Golf towel")]);
  const belt = product("belt", ["Brown"], [img("b.jpg", "Belt")]);

  it("adds one card per photographed color, lead colors first", () => {
    const cards = buildColorCards([chino, towel, belt]);
    expect(cards.map((c) => c.displayKey)).toEqual(["chino:khaki", expect.stringMatching(/^towel/), "belt", "chino:navy"]);
    expect(cards[3].cardImage).toBe("n.jpg");
    expect(cards[3].cardColor).toBe("Navy");
    expect(cards[3].preferredVariantId).toBe("gid://shopify/ProductVariant/chino1");
  });
  it("folds colors without their own photo into one card", () => {
    const cards = buildColorCards([towel]);
    expect(cards).toHaveLength(1);
    expect(cards[0].cardColor).toBeUndefined();
  });
});

import { buildSwatchCards } from "../../src/lib/shopColorCards";
describe("buildSwatchCards", () => {
  const chino = product("chino", ["Khaki", "Navy"], [img("k.jpg", "Chino, Khaki"), img("n.jpg", "Chino, Navy")]);
  const belt = product("belt", ["Brown"], [img("b.jpg", "Belt")]);
  it("keeps one card per product with every photographed color as a swatch", () => {
    const cards = buildSwatchCards([chino, belt]);
    expect(cards.map((c) => c.displayKey)).toEqual(["chino", "belt"]);
    expect(cards[0].swatches?.map((s) => [s.color, s.image])).toEqual([["Khaki", "k.jpg"], ["Navy", "n.jpg"]]);
    expect(cards[0].swatches?.[1].variantId).toBe("gid://shopify/ProductVariant/chino1");
    expect(cards[1].swatches).toEqual([]);
  });
});

describe("white colorway card photos", () => {
  it("uses the on-model shot for Pima Snow White in cards and swatches", () => {
    const pima = product("olydoe-pima-long-sleeve-polo", ["Oceana", "Snow White"], [img("o.jpg", "Pima, Oceana"), img("w.jpg", "Pima, Snow White")]);
    const [, white] = buildColorCards([pima]);
    expect(white.cardImage).toContain("OLS-SW-1.jpg");
    expect(white.cardImageFit).toBe("cover");
    const [sw] = buildSwatchCards([pima]);
    expect(sw.swatches?.[1]).toMatchObject({ color: "Snow White", fit: "cover" });
    expect(sw.swatches?.[0].fit).toBeUndefined();
  });
});
