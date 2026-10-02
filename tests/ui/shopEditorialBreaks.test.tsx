import { describe, expect, it } from "vitest";
import { isValidElement } from "react";
import { withEditorialBreaks, SHOP_ALL_BREAKS } from "../../src/app/shop/components/ShopEditorialBreaks";
import type { ShopifyProduct } from "../../src/lib/shopify";

const p = (slug: string) => ({ slug, name: slug, brand: "B", price: 100, images: [] }) as unknown as ShopifyProduct;
const slugs = Array.from({ length: 20 }, (_, i) => `p${i}`);

describe("shop-all editorial breaks", () => {
  it("places a break only when every featured product is in the collection", () => {
    const featured = SHOP_ALL_BREAKS.flatMap((b) => (b.kind === "story" ? b.slugs : [b.slug]));
    const withAll = withEditorialBreaks([...featured, ...slugs].map(p), (x) => x.slug);
    expect(withAll.filter(isValidElement)).toHaveLength(2);
    const missing = withEditorialBreaks(slugs.map(p), (x) => x.slug);
    expect(missing.filter(isValidElement)).toHaveLength(0);
  });
  it("keeps every product card in order", () => {
    const featured = SHOP_ALL_BREAKS.flatMap((b) => (b.kind === "story" ? b.slugs : [b.slug]));
    const all = [...featured, ...slugs];
    const out = withEditorialBreaks(all.map(p), (x) => x.slug);
    expect(out.filter((x) => typeof x === "string")).toEqual(all);
  });
});
