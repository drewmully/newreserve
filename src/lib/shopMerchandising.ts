import type { ShopifyProduct } from "./shopify";

/** Preserve the merchant's Shop All collection order, including unavailable items. */
export function selectShopEdit(products: ShopifyProduct[], limit = 4): ShopifyProduct[] {
  return products.slice(0, limit);
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
