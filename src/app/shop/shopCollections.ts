/**
 * Handles for the six /shop category collections created in Shopify Admin.
 * Each is a manual collection on mullybox-store.myshopify.com.
 *
 * Adding a product to any of these collections makes it appear at the top
 * of that category's tile products, the Fall Edit grid, and (if tagged)
 * the gift tiers — with a max of ~1h ISR delay.
 *
 * Gift merchandising uses product tags rather than more collections so a
 * single SKU can appear in multiple gift rows without duplicating catalog
 * entries.
 */

export const SHOP_CATEGORY_HANDLES = {
  tops: "shop-tops",
  bottoms: "shop-bottoms",
  outerwear: "shop-outerwear",
  gear: "shop-gear",
  bags: "shop-bags",
  accessories: "shop-accessories",
} as const;

export type ShopCategoryKey = keyof typeof SHOP_CATEGORY_HANDLES;

export const SHOP_CATEGORY_ORDER: ShopCategoryKey[] = [
  "tops",
  "bottoms",
  "outerwear",
  "gear",
  "bags",
  "accessories",
];

export interface ShopCategoryMeta {
  key: ShopCategoryKey;
  label: string;
  handle: string;
  eyebrow: string;
  detail: string;
}

export const SHOP_CATEGORIES: ShopCategoryMeta[] = [
  {
    key: "tops",
    label: "Tops",
    handle: SHOP_CATEGORY_HANDLES.tops,
    eyebrow: "Polos & quarter-zips",
    detail: "Polos and quarter-zips.",
  },
  {
    key: "bottoms",
    label: "Bottoms",
    handle: SHOP_CATEGORY_HANDLES.bottoms,
    eyebrow: "Trousers, shorts, joggers",
    detail: "Cut for a full swing. Sits right at the bar.",
  },
  {
    key: "outerwear",
    label: "Outerwear",
    handle: SHOP_CATEGORY_HANDLES.outerwear,
    eyebrow: "Vests, pullovers, shells",
    detail: "Stay warm during the frost delay.",
  },
  {
    key: "gear",
    label: "Gear",
    handle: SHOP_CATEGORY_HANDLES.gear,
    eyebrow: "Towels, belts & carry",
    detail: "The finishing pieces for your round and your weekend.",
  },
  {
    key: "bags",
    label: "Bags",
    handle: SHOP_CATEGORY_HANDLES.bags,
    eyebrow: "Stand, cart, duffel, tote",
    detail: "The one you'll still carry in five years.",
  },
  {
    key: "accessories",
    label: "Accessories",
    handle: SHOP_CATEGORY_HANDLES.accessories,
    eyebrow: "Headwear, belts, gloves",
    detail: "The stuff you notice in the pro shop.",
  },
];

/**
 * Gift guide tiers linked from the /shop landing ("Gifts for golfers") and the
 * sitemap. Slugs match /shop/gifts/[tier]. Picks, copy and price bands live in
 * src/lib/giftGuide.ts; old tag-based slugs (under100, hundredToThree,
 * threeHundredPlus) 308 to these in next.config.ts.
 */
export const GIFT_TIERS = [
  { key: "under-100", title: "Under $100", subtitle: "Stocking stuffers." },
  { key: "100-to-150", title: "$100 to $150", subtitle: "The chino, the layer, the long sleeve." },
  { key: "150-to-250", title: "$150 to $250", subtitle: "Vests and outerwear." },
] as const;
