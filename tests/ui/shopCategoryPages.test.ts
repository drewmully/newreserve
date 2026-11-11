import { describe, expect, it } from "vitest";
import {
  SHOP_CATEGORY_PAGES,
  SHOP_CATEGORY_PAGE_PATHS,
  breadcrumbJsonLd,
  categoryFaqJsonLd,
  categoryItemListJsonLd,
  categoryPathForProductType,
  filterCategoryProducts,
  inStockFirst,
  isCardInStock,
  isProductInStock,
} from "../../src/lib/shopCategoryPages";
import { applyAddenda } from "../../src/lib/blogAddenda";
import type { ShopifyProduct } from "../../src/lib/shopify";

const v = (color: string, inStock: boolean) => ({
  id: `${color}-${inStock}`, title: color, price: 100, reservePrice: 85,
  availableForSale: true, currentlyNotInStock: !inStock,
  selectedOptions: [{ name: "Color", value: color }, { name: "Size", value: "M" }],
});
const product = (slug: string, type: string, variants: ReturnType<typeof v>[]) => ({
  slug, name: `Brand ${slug}`, brand: "Brand", collection: type, price: 100, reservePrice: 85,
  images: [], description: "", material: "", aboutBrand: "", whyWeLikeIt: "", sizing: "",
  options: [], variants, variantId: variants[0]?.id,
}) as unknown as ShopifyProduct;

const vests = SHOP_CATEGORY_PAGES.vests;
const qz = SHOP_CATEGORY_PAGES["quarter-zips"];

describe("shop category pages copy", () => {
  for (const page of Object.values(SHOP_CATEGORY_PAGES)) {
    it(`${page.slug}: follows the copy rules`, () => {
      const copy = [page.title, page.description, page.h1, page.intro, ...page.faqs.flatMap((f) => [f.q, f.a])].join(" ");
      expect(copy).not.toMatch(/[\u2014\u2013]|--/);
      expect(copy).not.toMatch(/\$\s?\d/);
      expect(copy).not.toMatch(/mullybox|\bbox\b/i);
      const words = page.intro.split(/\s+/).length;
      expect(words).toBeGreaterThanOrEqual(60);
      expect(words).toBeLessThanOrEqual(100);
      expect(page.faqs.length).toBeGreaterThanOrEqual(3);
      expect(page.faqs.length).toBeLessThanOrEqual(4);
      expect(page.title.length).toBeLessThanOrEqual(60);
      expect(page.description.length).toBeLessThanOrEqual(160);
    });
  }
  it("has unique titles and is in the sitemap path list", () => {
    expect(new Set(Object.values(SHOP_CATEGORY_PAGES).map((p) => p.title)).size).toBe(2);
    expect(SHOP_CATEGORY_PAGE_PATHS).toEqual(["/shop/vests", "/shop/quarter-zips"]);
  });
});

describe("shop category product selection", () => {
  const soldOutVest = product("long-game-vest", "Vest", [v("Navy", false)]);
  const downVest = product("down-vest", "Vest", [v("Black", false), v("Brown", true)]);
  const qzip = product("rise", "Quarter Zip", [v("Navy", true)]);
  const half = product("nio", "Half Zip", [v("Slate", true)]);
  const polo = product("polo", "Polo", [v("White", true)]);

  it("filters by Shopify product type", () => {
    expect(filterCategoryProducts(vests, [soldOutVest, qzip, downVest, polo]).map((p) => p.slug)).toEqual(["long-game-vest", "down-vest"]);
    expect(filterCategoryProducts(qz, [soldOutVest, qzip, half, polo]).map((p) => p.slug)).toEqual(["rise", "nio"]);
  });

  it("sorts in-stock first and keeps order within groups", () => {
    const sorted = inStockFirst([soldOutVest, downVest, qzip], isProductInStock);
    expect(sorted.map((p) => p.slug)).toEqual(["down-vest", "rise", "long-game-vest"]);
  });

  it("treats a card as in stock only when its color has stock", () => {
    expect(isCardInStock({ ...downVest, cardColor: "Black" } as never)).toBe(false);
    expect(isCardInStock({ ...downVest, cardColor: "Brown" } as never)).toBe(true);
  });

  it("lists only in-stock products in ItemList JSON-LD", () => {
    const list = categoryItemListJsonLd(vests, [downVest, soldOutVest]);
    expect(list.numberOfItems).toBe(1);
    expect(list.itemListElement[0].url).toBe("https://www.mymully.com/shop/down-vest");
    expect(JSON.stringify(list)).not.toMatch(/price/i);
  });

  it("builds breadcrumb and FAQ JSON-LD", () => {
    const crumbs = breadcrumbJsonLd(qz);
    expect(crumbs.itemListElement.at(-1)).toMatchObject({ name: "Quarter-zips", item: "https://www.mymully.com/shop/quarter-zips" });
    expect(categoryFaqJsonLd(vests).mainEntity).toHaveLength(vests.faqs.length);
  });

  it("maps PDP product types to category pages", () => {
    expect(categoryPathForProductType("Vest")).toBe("/shop/vests");
    expect(categoryPathForProductType("Half Zip")).toBe("/shop/quarter-zips");
    expect(categoryPathForProductType("Polo")).toBeUndefined();
  });
});

describe("blog addenda link to category pages", () => {
  it("adds the quarter-zip link to the quarter zip vs hoodie post", () => {
    const out = applyAddenda("golf-quarter-zip-vs-hoodie", [{ heading: "When a quarter zip is the right answer", paragraphs: ["Body."] }] as never);
    expect(out[0].paragraphs.join(" ")).toContain("(/shop/quarter-zips)");
  });
  it("adds the vest link to the capsule wardrobe post", () => {
    const out = applyAddenda("golf-capsule-wardrobe-12-essential-pieces", [{ heading: "The Outer Layer: Quarter-Zip and Vest", paragraphs: ["Body."] }] as never);
    expect(out[0].paragraphs.join(" ")).toContain("(/shop/vests)");
  });
});
