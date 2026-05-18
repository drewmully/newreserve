// Real product images pulled from mullybox-store.myshopify.com.
// Used on /lp/subscription and /lp/gift as examples of what
// members have received. Captioned as examples — the curation
// rotates quarterly, so future boxes will not be identical.

export type LPProduct = {
  title: string;
  vendor: string;
  category: string;
  image: string;
  retail?: string;
};

export const RECENT_BOX_PRODUCTS: LPProduct[] = [
  {
    title: "Founders Golf Quarter Zip",
    vendor: "Rhone",
    category: "Layer",
    image:
      "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/35386_TRUENAVY_cff30cfa-0914-47bb-92b2-4dc2850b9731.jpg?v=1775579878",
    retail: "$148",
  },
  {
    title: "Golforever Polo",
    vendor: "Morning People",
    category: "Polo",
    image:
      "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/Charcoal_Studio_Front.jpg?v=1778851177",
    retail: "$98",
  },
  {
    title: "Vintage Polo · Supima Cotton",
    vendor: "Quiet Golf",
    category: "Polo",
    image:
      "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/VintagePoloFOREST_1.jpg?v=1775579860",
    retail: "$95",
  },
  {
    title: "Braided Stretch Leather Belt",
    vendor: "Will Leather Goods",
    category: "Accessory",
    image:
      "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/60397_BRAIDED_STRETCH_LEATHER_BELT_BLACK_01.jpg?v=1775486933",
    retail: "$78",
  },
  {
    title: "Ricketts Repel Hoodie",
    vendor: "Field Day Sporting Co.",
    category: "Outerwear",
    image:
      "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/RickettsRepelHoodie-Navy-Front.jpg?v=1775579842",
    retail: "$128",
  },
  {
    title: "7\" Commuter Short",
    vendor: "Rhone",
    category: "Short",
    image:
      "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/1-7in-CommuterShort-iron_900x_b4f8cc3f-d847-4d85-a268-ca380e0b6082.webp?v=1775579866",
    retail: "$88",
  },
  {
    title: "Heritage Shoe Bag II",
    vendor: "Penfold",
    category: "Travel",
    image:
      "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/NewShoeBackGreen_1ca32feb-539b-46f9-be7f-1b9792af35f1.jpg?v=1775579855",
    retail: "$48",
  },
  {
    title: "Yardage Book",
    vendor: "Will Leather Goods",
    category: "Accessory",
    image:
      "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/45005_YARDAGE_BOOK_BLACK_001.jpg?v=1775579864",
    retail: "$45",
  },
];

// Hero / lifestyle imagery — used in the thumbnail rail alongside
// the box-opening hero shot.
export const LP_GALLERY = [
  {
    src: "/reserve-founders-hero.jpg",
    alt: "A Mully Reserve box, opened — neatly folded apparel, a Mully Reserve card, a braided belt, and a striped polo.",
  },
  ...RECENT_BOX_PRODUCTS.slice(0, 4).map((p) => ({
    src: p.image,
    alt: `${p.vendor} ${p.title} — example of an item from a past Mully Reserve box.`,
  })),
];

export const TRUST_BADGES = [
  { icon: "value", label: "$300+ Retail", sub: "Inside every box" },
  { icon: "ship", label: "Free Shipping", sub: "Continental US" },
  { icon: "cancel", label: "Cancel Anytime", sub: "After your first box" },
  { icon: "exchange", label: "Wrong Fit?", sub: "We swap, no questions" },
  { icon: "sizing", label: "Sizing Confirmed", sub: "After your purchase" },
] as const;
