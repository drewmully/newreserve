import type { ShopifyProduct } from "./shopify";

/** Homepage edit rail size; "Shop all" links to the full collection. */
export const SHOP_EDIT_LIMIT = 12;

/** 0 ships now, 1 restocking only, 2 unavailable. */
function stockRank(p: ShopifyProduct): number {
  const sellable = p.variants.filter(v => v.availableForSale);
  if (!sellable.length) return 2;
  return sellable.some(v => !v.currentlyNotInStock) ? 0 : 1;
}

/**
 * Keep the merchant's Shop All collection order within each stock band:
 * pieces that ship now lead, restocking pieces follow, unavailable last.
 */
export function selectShopEdit(products: ShopifyProduct[], limit = 4): ShopifyProduct[] {
  return products
    .map((p, i) => ({ p, i, r: stockRank(p) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, limit)
    .map(x => x.p);
}
/** Merchant-maintained editorial content only; never fabricate a selection claim. */
export function shopSelectionNote(p: ShopifyProduct): string {
  const value = p.whyWeLikeIt || p.editorialHeadline || p.material || p.description;
  const plain = (value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const first = plain.split(/(?<=[.!?])\s/)[0];
  return first.length <= 180 ? first : "";
}
const GIFTS = [
  "winston-golf-tour-towel", "duckhead-stretch-belt",
  "technically-golf-tiger-stripe-needlepoint-belt", "technically-golf-performance-polo",
  "leon-weekender-duffel",
];
export function shopGiftPicks(products: ShopifyProduct[], tag: string): ShopifyProduct[] {
  return products.filter(p => p.tags?.includes(tag)).sort((a,b) => {
    const score = (p: ShopifyProduct) => (p.variants.some(v => v.availableForSale) ? 0 : 1000) + (GIFTS.includes(p.slug) ? GIFTS.indexOf(p.slug) : 100);
    return score(a) - score(b);
  }).slice(0, 3);
}
