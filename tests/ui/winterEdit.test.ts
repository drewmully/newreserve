import { describe, expect, it } from "vitest";
import { getShopPhase, getShopPresentation } from "@/app/shop/seasonalTheme";
import { productJsonLd, variantAvailability } from "@/lib/productJsonLd";
import { applyVariantSelection, getPdpInitialSelection, withoutSizeOptions } from "@/lib/productVariants";
import { isColdSeason, seasonAdjustment } from "@/lib/cartPicks";
import { selectShopEdit, SHOP_EDIT_LIMIT } from "@/lib/shopMerchandising";
import type { ShopifyProduct } from "@/lib/shopify";

// Noon Eastern on the given day, so UTC offsets never cross midnight.
const et = (y: number, m: number, d: number) => new Date(Date.UTC(y, m - 1, d, 17));

describe("getShopPhase", () => {
  it.each([
    [et(2026, 11, 25), "fall"],
    [et(2026, 11, 26), "holiday"],
    [et(2026, 12, 25), "holiday"],
    [et(2026, 12, 26), "winter"],
    [et(2027, 1, 15), "winter"],
    [et(2027, 2, 28), "winter"],
    [et(2027, 3, 1), "spring"],
    [et(2027, 7, 4), "summer"],
    [et(2026, 9, 1), "fall"],
  ])("%s is %s", (date, phase) => {
    expect(getShopPhase(date, "")).toBe(phase);
  });

  it("uses Eastern time at the Nov 26 boundary", () => {
    // 03:00 UTC Nov 26 is still Nov 25 in New York.
    expect(getShopPhase(new Date(Date.UTC(2026, 10, 26, 3)), "")).toBe("fall");
    expect(getShopPhase(new Date(Date.UTC(2026, 10, 26, 6)), "")).toBe("holiday");
  });

  it("honors a valid override and ignores a bad one", () => {
    expect(getShopPhase(et(2026, 7, 1), "Winter")).toBe("winter");
    expect(getShopPhase(et(2026, 7, 1), "nonsense")).toBe("summer");
  });

  it("holiday presentation uses the winter hero, evergreen bar and frost heading", () => {
    const p = getShopPresentation(et(2026, 12, 1), "");
    expect(p.editName).toBe("holiday");
    expect(p.hero.desktop).toContain("winter-frost-vest");
    expect(p.barColor).toBe("#1F3A2E");
    expect(p.outfitHeading).toBe("Built for the frost delay.");
    expect(p.hero.alt).not.toMatch(/[\u2014\u2013]/);
  });
});

const sizeColorProduct = {
  options: [
    { name: "Color", values: ["Black", "Navy"] },
    { name: "Size", values: ["S", "M", "L"] },
  ],
  variants: [
    { id: "gid://shopify/ProductVariant/1", availableForSale: true, selectedOptions: [{ name: "Color", value: "Black" }, { name: "Size", value: "S" }] },
    { id: "gid://shopify/ProductVariant/2", availableForSale: true, selectedOptions: [{ name: "Color", value: "Black" }, { name: "Size", value: "M" }] },
    { id: "gid://shopify/ProductVariant/3", availableForSale: true, selectedOptions: [{ name: "Color", value: "Navy" }, { name: "Size", value: "L" }] },
  ],
} as unknown as Parameters<typeof getPdpInitialSelection>[0];

describe("PDP initial selection", () => {
  it("preselects color but never size by default", () => {
    const sel = getPdpInitialSelection(sizeColorProduct);
    expect(sel.Color).toBeTruthy();
    expect(sel.Size).toBeUndefined();
  });

  it("keeps a size the link explicitly named", () => {
    const sel = getPdpInitialSelection(sizeColorProduct, { Color: "Navy", Size: "L" });
    expect(sel).toMatchObject({ Color: "Navy", Size: "L" });
  });

  it("clears a picked size instead of swapping it when a color lacks that size", () => {
    expect(applyVariantSelection(sizeColorProduct, { Color: "Black", Size: "M" }, "Color", "Navy")).toEqual({ Color: "Navy" });
    expect(applyVariantSelection(sizeColorProduct, { Color: "Black" }, "Color", "Navy")).toEqual({ Color: "Navy" });
    expect(applyVariantSelection(sizeColorProduct, { Color: "Black", Size: "S" }, "Size", "M")).toEqual({ Color: "Black", Size: "M" });
  });

  it("withoutSizeOptions strips size, waist and inseam keys only", () => {
    expect(withoutSizeOptions({ Color: "Stone", Waist: "32", Inseam: "30", Size: "M" })).toEqual({ Color: "Stone" });
  });
});

describe("productJsonLd", () => {
  const product = {
    slug: "rhone-voyage-down-vest",
    name: "Voyage Down Vest",
    brand: "Rhone",
    price: 198,
    description: "<p>Warm <b>down</b> vest.</p>",
    images: ["https://cdn.shopify.com/a.jpg"],
    collection: "Outerwear",
    variants: [
      { id: "gid://shopify/ProductVariant/11", price: 198, availableForSale: true, currentlyNotInStock: false, selectedOptions: [{ name: "Size", value: "M" }] },
      { id: "gid://shopify/ProductVariant/12", price: 198, availableForSale: true, currentlyNotInStock: true, selectedOptions: [{ name: "Size", value: "S" }] },
      { id: "gid://shopify/ProductVariant/13", price: 198, availableForSale: false, selectedOptions: [{ name: "Size", value: "XS" }] },
    ],
  } as unknown as ShopifyProduct;

  it("emits one offer per variant with correct availability and no ratings", () => {
    const ld = productJsonLd(product);
    expect(ld["@type"]).toBe("Product");
    expect(ld.description).toBe("Warm down vest.");
    expect(ld.offers.map((o) => o.availability)).toEqual([
      "https://schema.org/InStock",
      "https://schema.org/PreOrder",
      "https://schema.org/OutOfStock",
    ]);
    expect(ld.offers[0]).toMatchObject({ sku: "11", price: "198.00", priceCurrency: "USD" });
    expect(JSON.stringify(ld)).not.toMatch(/aggregateRating|review/i);
  });

  it("variantAvailability maps sellable preorder to PreOrder", () => {
    expect(variantAvailability({ availableForSale: true, currentlyNotInStock: true })).toBe("https://schema.org/PreOrder");
  });
});

describe("winter cart picks", () => {
  it("cold season is Nov through Feb", () => {
    expect(isColdSeason(et(2026, 11, 26))).toBe(true);
    expect(isColdSeason(et(2027, 2, 10))).toBe(true);
    expect(isColdSeason(et(2027, 3, 10))).toBe(false);
  });

  it("sinks short sleeves and lifts outerwear only when cold", () => {
    expect(seasonAdjustment({ name: "Remy Polo", category: "tops" } as never, true)).toBe(-8);
    expect(seasonAdjustment({ name: "Pima Long Sleeve Polo", category: "tops" } as never, true)).toBe(0);
    expect(seasonAdjustment({ name: "Voyage Down Vest", category: "outerwear" } as never, true)).toBe(2);
    expect(seasonAdjustment({ name: "Remy Polo", category: "tops" } as never, false)).toBe(0);
  });
});

describe("shop edit rail", () => {
  it("is capped at 12", () => {
    expect(SHOP_EDIT_LIMIT).toBe(12);
  });

  it("leads with pieces that ship now and keeps merchant order within a band", () => {
    const mk = (slug: string, variants: { availableForSale: boolean; currentlyNotInStock?: boolean }[]) =>
      ({ slug, variants }) as unknown as ShopifyProduct;
    const list = [
      mk("sold-out", [{ availableForSale: false }]),
      mk("preorder", [{ availableForSale: true, currentlyNotInStock: true }]),
      mk("ships-a", [{ availableForSale: true, currentlyNotInStock: false }]),
      mk("ships-b", [{ availableForSale: true, currentlyNotInStock: true }, { availableForSale: true }]),
    ];
    expect(selectShopEdit(list, 12).map((p) => p.slug)).toEqual(["ships-a", "ships-b", "preorder", "sold-out"]);
    expect(selectShopEdit(list, 2)).toHaveLength(2);
  });
});
