import { describe, it, expect } from "vitest";
import { recoverShopifyPath } from "@/lib/shopifyPathRecovery";

const r = (t: string | null) => {
  const out = recoverShopifyPath(t);
  return out ? { path: out.pathname, q: out.params.toString() } : null;
};

describe("recoverShopifyPath", () => {
  it("ignores plain dashboard tabs", () => {
    expect(r(null)).toBeNull();
    expect(r("shop")).toBeNull();
    expect(r("orders")).toBeNull();
  });
  it("maps product URLs and keeps the variant", () => {
    expect(r("shopproducts/olydoe-merino-ponte-vest")).toEqual({ path: "/shop/olydoe-merino-ponte-vest", q: "" });
    expect(r("shopproducts/nio-half-zip?variant=123")).toEqual({ path: "/shop/nio-half-zip", q: "variant=123" });
  });
  it("maps collection URLs", () => {
    expect(r("shopcollections/all")?.path).toBe("/shop");
    expect(r("shopcollections/shop-tops")?.path).toBe("/shop/collection/shop-tops");
    expect(r("shopcollections/shop-tops/products/rhone-fairway-polo")?.path).toBe("/shop/rhone-fairway-polo");
  });
  it("falls back to home for other Shopify pages", () => {
    expect(r("shoppages/about")?.path).toBe("/");
  });
});
