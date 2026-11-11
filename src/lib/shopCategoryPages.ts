/**
 * Indexable shop category landing pages (/shop/vests, /shop/quarter-zips).
 *
 * Each page is a server-rendered slice of a live Shopify collection, filtered
 * by Shopify `productType`, with in-stock products first. Copy follows the
 * Mully editorial voice: no em dashes and no hard-coded prices (prices render
 * live on the product cards).
 *
 * Wording is drawn from 90 days of Search Console queries for
 * sc-domain:mymully.com (Aug 11 to Nov 9, 2026): "rhone vest", "duck head
 * vest", "rhone puffer vest", "quarter zip vs hoodie", "can you wear a
 * quarter zip to golf", "what quarter zips will keep me warm on the golf
 * course", "how many quarter zips should i own".
 */
import type { ShopifyProduct } from "@/lib/shopify";
import type { ShopColorCard } from "@/lib/shopColorCards";
import { SITE_URL } from "@/lib/seo";

export interface CategoryFaq {
  q: string;
  a: string;
}

export interface ShopCategoryPage {
  slug: string;
  path: string;
  /** Live Shopify collection the page reads from. */
  collection: string;
  /** Shopify productType values that belong on the page. */
  productTypes: string[];
  title: string;
  description: string;
  /** Short label used in nav, breadcrumbs and cross-links. */
  label: string;
  h1: string;
  intro: string;
  faqs: CategoryFaq[];
  /** Internal links shown under the grid. */
  related: { label: string; href: string }[];
}

export const SHOP_CATEGORY_PAGES: Record<"vests" | "quarter-zips", ShopCategoryPage> = {
  vests: {
    slug: "vests",
    path: "/shop/vests",
    collection: "shop-outerwear",
    productTypes: ["Vest"],
    title: "Golf Vests for Men: Rhone, Duck Head and Olydoe | Mully",
    description:
      "Golf vests for men from Rhone, Duck Head and Olydoe: 700+ fill down, quilted and Australian merino. In-stock sizes first, with 30-day returns.",
    label: "Vests",
    h1: "Golf Vests for Men",
    intro:
      "A vest keeps your core warm and leaves your shoulders alone, which is the whole point on a 45-degree first tee. The Rhone Voyage Down Vest packs 700+ fill down into a shell that layers clean and stows easily. The Duck Head Fremont is quilted with a full-zip front, in low-key fall colors. Olydoe's Merino Ponte Vest is two layers of Australian merino knitted together, so it wears like a sweater without the sleeves. Pieces with sizes in stock come first.",
    faqs: [
      {
        q: "What should I wear under a golf vest?",
        a: "A long sleeve polo on mild mornings and a quarter-zip when it gets colder. The vest covers your core, the layer underneath covers your arms, and nothing restricts your turn.",
      },
      {
        q: "Down vest or quilted vest for golf?",
        a: "Down, like the Rhone Voyage with 700+ fill, gives the most warmth for its weight and packs small in a golf bag. A quilted vest like the Duck Head Fremont is flatter and cleaner, and it looks just as right at dinner. Merino is the quiet option for the clubhouse.",
      },
      {
        q: "How should a golf vest fit?",
        a: "Close enough to sit flat over a polo, with room at the armholes for a quarter-zip underneath. If you are between sizes and plan to layer, size up. Every product page has a size chart.",
      },
      {
        q: "Can I return a vest if the size is wrong?",
        a: "Yes. Returns are accepted within 30 days. See the Mully return policy for the window and conditions, or start a return online.",
      },
    ],
    related: [
      { label: "Golf quarter-zips", href: "/shop/quarter-zips" },
      { label: "All outerwear", href: "/shop/collection/shop-outerwear" },
      { label: "The 12-piece golf capsule wardrobe", href: "/blog/golf-capsule-wardrobe-12-essential-pieces" },
    ],
  },
  "quarter-zips": {
    slug: "quarter-zips",
    path: "/shop/quarter-zips",
    collection: "shop-outerwear",
    productTypes: ["Quarter Zip", "Half Zip"],
    title: "Golf Quarter-Zips and Half-Zips for Men | Mully",
    description:
      "Golf quarter-zips and half-zips for men from Rhone, Olydoe and Technically Golf, in merino and stretch performance knits. In-stock sizes first.",
    label: "Quarter-zips",
    h1: "Golf Quarter-Zips for Men",
    intro:
      "The quarter-zip is the one layer you can swing in, wear to lunch and keep on for the drive home. The Rhone Rise has raglan sleeves and a low-profile chin guard, cut for a full turn. Olydoe's Merino Ponte is 100% Australian merino in a double knit with natural stretch. The Technically Golf Nio Half Zip is the lightweight pick for mornings that warm up by the turn. Zip it on the first tee and open it by the 9th. Pieces with sizes in stock come first.",
    faqs: [
      {
        q: "Can you wear a quarter-zip to play golf?",
        a: "Yes. A quarter-zip passes the dress code at nearly every club, including the ones that ban hoodies, and it layers over a collared polo so the collar still shows. If you are a guest, check the club's rules first.",
      },
      {
        q: "Quarter-zip or hoodie for cool morning rounds?",
        a: "A quarter-zip. It vents at the neck as the day warms up, there is no hood to bunch on your backswing, and it works at clubs where hoodies do not. Our quarter zip vs hoodie guide covers when a hoodie wins.",
      },
      {
        q: "Which quarter-zip keeps you warmest on the course?",
        a: "Merino. The Olydoe Merino Ponte is two layers of Australian merino knitted together, and it holds warmth without trapping sweat. For real cold, add a vest over any quarter-zip on this page.",
      },
      {
        q: "How many quarter-zips should a golfer own?",
        a: "Two covers most of the year: a lightweight half zip for cool mornings and a heavier merino layer for cold ones. Add a vest before you buy a third.",
      },
    ],
    related: [
      { label: "Golf vests", href: "/shop/vests" },
      { label: "Quarter zip vs hoodie", href: "/blog/golf-quarter-zip-vs-hoodie" },
      { label: "All outerwear", href: "/shop/collection/shop-outerwear" },
    ],
  },
};

export const SHOP_CATEGORY_PAGE_PATHS = Object.values(SHOP_CATEGORY_PAGES).map((p) => p.path);

type StockVariant = { availableForSale: boolean; currentlyNotInStock?: boolean };

/** At least one variant can ship from stock now (not a restock preorder). */
export function variantsInStock(variants: StockVariant[]): boolean {
  return variants.some((v) => v.availableForSale && !v.currentlyNotInStock);
}

export function isProductInStock(p: Pick<ShopifyProduct, "variants">): boolean {
  return variantsInStock(p.variants ?? []);
}

/** Variants a color card represents (all variants when the card has no color). */
export function cardVariants(card: Pick<ShopColorCard, "variants" | "cardColor">) {
  const color = card.cardColor;
  if (!color) return card.variants ?? [];
  return (card.variants ?? []).filter((v) =>
    v.selectedOptions?.some((o) => /^colou?r$/i.test(o.name) && o.value === color),
  );
}

export function isCardInStock(card: Pick<ShopColorCard, "variants" | "cardColor">): boolean {
  return variantsInStock(cardVariants(card));
}

/** Products whose Shopify productType belongs on the page. */
export function filterCategoryProducts(page: ShopCategoryPage, products: ShopifyProduct[]): ShopifyProduct[] {
  const types = new Set(page.productTypes.map((t) => t.toLowerCase()));
  return products.filter((p) => types.has((p.collection || "").trim().toLowerCase()));
}

/** Stable sort: in-stock first, collection order kept within each group. */
export function inStockFirst<T>(items: T[], inStock: (item: T) => boolean): T[] {
  return [...items.filter(inStock), ...items.filter((i) => !inStock(i))];
}

export function breadcrumbJsonLd(page: ShopCategoryPage) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: `${SITE_URL}/` },
      { "@type": "ListItem", position: 2, name: "Shop", item: `${SITE_URL}/shop` },
      { "@type": "ListItem", position: 3, name: page.label, item: `${SITE_URL}${page.path}` },
    ],
  };
}

/** ItemList of in-stock product URLs. No prices: those stay live on cards and PDPs. */
export function categoryItemListJsonLd(page: ShopCategoryPage, products: ShopifyProduct[]) {
  const listed = products.filter(isProductInStock);
  return {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: page.h1,
    url: `${SITE_URL}${page.path}`,
    numberOfItems: listed.length,
    itemListElement: listed.map((p, i) => ({
      "@type": "ListItem",
      position: i + 1,
      url: `${SITE_URL}/shop/${p.slug}`,
      name: p.name.startsWith(p.brand) ? p.name : `${p.brand} ${p.name}`,
    })),
  };
}

export function categoryFaqJsonLd(page: ShopCategoryPage) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: page.faqs.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };
}

/** PDP breadcrumb target for a Shopify productType, when a category page exists. */
export function categoryPathForProductType(productType?: string): string | undefined {
  const t = (productType || "").trim().toLowerCase();
  return Object.values(SHOP_CATEGORY_PAGES).find((p) => p.productTypes.some((x) => x.toLowerCase() === t))?.path;
}
