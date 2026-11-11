import { describe, expect, it } from "vitest";
import { getVariantById, type VariantBearingProduct } from "@/lib/productVariants";
import type { ShopifyProductVariant } from "@/lib/shopify";

const v = (id: string, size: string): ShopifyProductVariant => ({
  id: `gid://shopify/ProductVariant/${id}`,
  title: size,
  price: 138,
  reservePrice: 117.3,
  availableForSale: true,
  selectedOptions: [{ name: "Size", value: size }],
});
const product = { variants: [v("50621438066880", "S"), v("50621438099648", "M")] } as VariantBearingProduct;

describe("getVariantById", () => {
  it("matches the full gid", () => {
    expect(getVariantById(product, "gid://shopify/ProductVariant/50621438099648")?.title).toBe("M");
  });
  it("matches a bare numeric id from ?variant links", () => {
    expect(getVariantById(product, "50621438099648")?.title).toBe("M");
  });
  it("returns null for unknown or partial ids", () => {
    expect(getVariantById(product, "49030281625792")).toBeNull();
    expect(getVariantById(product, "99648")).toBeNull();
    expect(getVariantById(product, "")).toBeNull();
  });
});
