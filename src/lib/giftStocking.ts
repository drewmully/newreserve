/**
 * Stocking stuffers (/shop/gifts/stocking-stuffers): the selection rule,
 * kept free of Shopify fetches so it can be unit tested.
 *
 * The page lists live accessories under GIFT_STOCKING_MAX: socks, towels,
 * gloves, balls, hats and small gear. Nothing is curated by handle, so new
 * accessories show up as soon as they are published and priced under the cap.
 * Prices and stock always come from Shopify at render time.
 */

export const GIFT_STOCKING_MAX = 75;

/** Product types (Shopify productType) that count as a stocking stuffer. */
const ACCESSORY_TYPE =
  /accessor|towel|organi[sz]er|sock|glove|ball|\btees?\b|marker|head ?cover|divot|brush|umbrella|\bhat\b|\bcap\b|beanie|visor|gear|tool|pouch|valuables/i;
/** Shopify tags that put a product in the accessories or small gear edit. */
const ACCESSORY_TAGS = new Set(["shop-accessories", "shop-gear", "accessories", "socks", "gloves", "golf-balls"]);
/** Never a stocking stuffer: memberships, boxes, gift cards, apparel. */
const EXCLUDE_HANDLE = /reserve|swing-box|mystery|gift-card|membership|subscription/i;
const EXCLUDE_BRAND = /^mully(box)?$/i;
const APPAREL_TYPE = /polo|shirt|pant|chino|short|jacket|vest|zip|sweater|hoodie|crew(neck)?$|pullover|fleece|belt|bag$|duffel|duffle|backpack/i;

export interface StockingCandidate {
  slug: string;
  brand: string;
  /** Shopify productType. The Storefront mapper falls back to "Accessories" when it is empty. */
  collection: string;
  tags?: string[];
  price: number;
  variants: { availableForSale: boolean; currentlyNotInStock?: boolean }[];
}

export function isStockingStuffer(p: StockingCandidate, max = GIFT_STOCKING_MAX): boolean {
  if (!(p.price > 0 && p.price < max)) return false;
  if (EXCLUDE_HANDLE.test(p.slug) || EXCLUDE_BRAND.test(p.brand.trim())) return false;
  if (!p.variants.some((v) => v.availableForSale)) return false;
  const type = p.collection;
  const tags = (p.tags ?? []).map((t) => t.toLowerCase());
  const tagged = tags.some((t) => ACCESSORY_TAGS.has(t));
  if (APPAREL_TYPE.test(type)) return false;
  // "Accessories" is also the mapper's fallback for an empty productType, so
  // on its own it needs an accessory tag to count.
  if (/^accessories$/i.test(type.trim())) return tagged;
  return ACCESSORY_TYPE.test(type) || tagged;
}

/** Units on hand right now (not a Restocking preorder). */
export function inStockNow(p: StockingCandidate): boolean {
  return p.variants.some((v) => v.availableForSale && !v.currentlyNotInStock);
}
