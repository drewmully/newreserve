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

// Hero / lifestyle imagery — used in the thumbnail rail. First two are
// our own brand photography (box-opening + staged box contents from the
// outings page). Last two are real product examples from our shop,
// flagged so users know they're examples of what has been inside.
export const LP_GALLERY: Array<{
  src: string;
  alt: string;
  isExample?: boolean;
  fit?: "cover" | "contain";
}> = [
  {
    src: "/reserve-founders-hero.jpg",
    alt: "A Mully Reserve box, opened — neatly folded apparel, a Mully Reserve card, a braided belt, and a striped polo.",
    fit: "cover",
  },
  {
    // Outings page hero — staged Mully box with quarter zip, leather pouch,
    // YETI tumbler, and braided belt.
    src: "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_11_2026_11_59_56_AM.png?v=1771257707",
    alt: "A Mully Reserve box staged open with a navy quarter zip, leather pouch, YETI tumbler, and braided belt inside.",
    fit: "cover",
  },
  {
    // Outings page unboxing — array of closed Mully boxes from above.
    src: "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/ChatGPT_Image_Feb_10_2026_04_48_19_PM.png?v=1771257707",
    alt: "A spread of forest-green Mully Reserve boxes shot from above on a neutral surface.",
    fit: "cover",
  },
  // Last two thumbs are real product photos — Rhone + Quiet Golf for
  // consistent vendor representation in the hero rail.
  ...[RECENT_BOX_PRODUCTS[0], RECENT_BOX_PRODUCTS[2]].map((p) => ({
    src: p.image,
    alt: `Example of a piece from a past Mully Reserve box: ${p.vendor} ${p.title}.`,
    isExample: true,
    fit: "cover" as const,
  })),
];

export const TRUST_BADGES = [
  { icon: "value", label: "$300+ Retail", sub: "Inside every box" },
  { icon: "ship", label: "Free Shipping", sub: "Continental US" },
  { icon: "cancel", label: "Cancel Anytime", sub: "After your first box" },
  { icon: "exchange", label: "Wrong Fit?", sub: "We swap, no questions" },
  { icon: "sizing", label: "Sizing Confirmed", sub: "After your purchase" },
] as const;
