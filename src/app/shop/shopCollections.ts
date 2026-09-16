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
  tech: "shop-tech",
  bags: "shop-bags",
  accessories: "shop-accessories",
} as const;

export type ShopCategoryKey = keyof typeof SHOP_CATEGORY_HANDLES;

export const SHOP_CATEGORY_ORDER: ShopCategoryKey[] = [
  "tops",
  "bottoms",
  "outerwear",
  "tech",
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
    detail: "What you're actually judged on.",
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
    detail: "The 6 a.m. tee time in October.",
  },
  {
    key: "tech",
    label: "Tech",
    handle: SHOP_CATEGORY_HANDLES.tech,
    eyebrow: "Rangefinders & wearables",
    detail: "The number, the swing speed, the round.",
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
 * Product tags used for gift-tier merchandising on the /shop landing page.
 * Assign on the product in Shopify Admin. A product can carry multiple.
 */
export const GIFT_TAGS = {
  under100: "gift-under-100",
  hundredToThree: "gift-100-300",
  threeHundredPlus: "gift-300-plus",
} as const;

export const GIFT_TIERS = [
  {
    key: "under100",
    tag: GIFT_TAGS.under100,
    title: "Under $100",
    subtitle: "The one they'll actually use.",
    accent: "Everyday",
  },
  {
    key: "hundredToThree",
    tag: GIFT_TAGS.hundredToThree,
    title: "$100 – $300",
    subtitle: "The one they'd never buy themselves.",
    accent: "Signature",
  },
  {
    key: "threeHundredPlus",
    tag: GIFT_TAGS.threeHundredPlus,
    title: "$300 & Up",
    subtitle: "The one they'll talk about.",
    accent: "Reserve",
  },
] as const;
