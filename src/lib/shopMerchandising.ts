import type { ShopifyProduct } from "./shopify";

const EDIT = [
  "technically-golf-performance-polo", "duckhead-classic-fit-gold-school-chino-khaki",
  "voice-caddie-laser-fit", "olydoe-og-supima-hollow-polo",
  "blue-tees-player-gps-speaker", "winston-solid-tradition-leather-headcover",
];
export function selectShopEdit(products: ShopifyProduct[], limit = 6): ShopifyProduct[] {
  const rank = (p: ShopifyProduct) => {
    const i = EDIT.indexOf(p.slug);
    return (p.variants.some(v => v.availableForSale) ? 0 : 10000)
      + (p.tags?.includes("shop-featured") ? 0 : 100)
      + (i >= 0 ? i : 1000);
  };
  return [...products].sort((a, b) => rank(a) - rank(b)).slice(0, limit);
}
/** Merchant-maintained editorial content only; never fabricate a selection claim. */
export function shopSelectionNote(p: ShopifyProduct): string {
  const value = p.whyWeLikeIt || p.editorialHeadline || p.material || p.description;
  const plain = (value || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  const first = plain.split(/(?<=[.!?])\s/)[0];
  return first.length <= 180 ? first : "";
}
const GIFTS = [
  "winston-solid-tradition-leather-headcover", "bluegrass-fairways-handmade-leather-golf-yardage-book-cover-scorecard-holder-vintage-bourbon",
  "blue-tees-player-gps-speaker", "technically-golf-performance-polo",
  "voice-caddie-laser-fit", "garmin-approach-s70", "rapsodo-mlm2pro-mobile-launch-monitor",
];
export function shopGiftPicks(products: ShopifyProduct[], tag: string): ShopifyProduct[] {
  return products.filter(p => p.tags?.includes(tag)).sort((a,b) => {
    const score = (p: ShopifyProduct) => (p.variants.some(v => v.availableForSale) ? 0 : 1000) + (GIFTS.includes(p.slug) ? GIFTS.indexOf(p.slug) : 100);
    return score(a) - score(b);
  }).slice(0, 3);
}
