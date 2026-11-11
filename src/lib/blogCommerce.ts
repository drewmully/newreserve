/**
 * Blog commerce v1: "Shop this story" product rows and intent-matched
 * end-of-post blocks for Journal posts (/blog/<slug>) and the restored
 * archive posts (/blogs/news/<handle>).
 *
 * Shown only to the `test` variant of the PostHog flag `blog-commerce-v1`
 * (see src/app/blog/commerce/BlogCommerceClient.tsx). Control sees the
 * template exactly as before.
 *
 * Rules:
 * - Product handles only. Price, image and availability always come live
 *   from the Shopify Storefront API at render time; sold-out products are
 *   skipped and a failed fetch renders nothing. Preorder sizes show the
 *   shared card's "Restocking · Ships <date>" note, same as /shop.
 * - Lists favor products with sizes that ship now (checked 2026-11-11);
 *   preorder-only picks are kept only where the post is about that item.
 * - Copy follows the Mully editorial voice: short, plain, no em dashes,
 *   no hard-coded prices, no offers.
 */
import type { BlogCategory, BlogSection } from "@/app/blog/posts";

export const BLOG_COMMERCE_FLAG = "blog-commerce-v1";
export type BlogCommerceVariant = "control" | "test";
export type BlogCommerceTemplate = "blog" | "archive";
export type BlogCommerceBlock = "product_row_top" | "product_row_bottom" | "end_block" | "reserve_mid";

/** Which end-of-post block a post gets. */
export type EndIntent = "shop" | "reserve-club" | "reserve-trip" | "reserve" | "gift";

export interface BlogCommerceEntry {
  /** Product handles to show, in order. Added after any /shop/<handle> links in the post. */
  products?: string[];
  /** Overrides the category default. */
  intent?: EndIntent;
  /** Mully Reserve block after the 2nd section (blog template only). */
  reserveMid?: boolean;
}

/** Journal posts (Supabase blog_posts), keyed by slug. */
export const BLOG_COMMERCE: Record<string, BlogCommerceEntry> = {
  // Subscription comparison: the sell is Reserve itself, so no product rows.
  "best-golf-subscription-boxes-2026-compared": { products: [], intent: "reserve", reserveMid: true },
  // Product handles come from the inline links in blogAddenda (s09).
  "greyson-vs-peter-millar-golf-comparison": {},
  "what-to-wear-private-golf-club-dress-code": {
    intent: "reserve-club",
    products: ["rhone-commuter-polo", "olydoe-merino-ponte-quarter-zip", "olydoe-pima-long-sleeve-polo", "duckhead-classic-fit-gold-school-chino-khaki"],
  },
  "private-golf-club-membership-cost-2026": {
    intent: "reserve-club",
    products: ["rhone-commuter-polo", "rhone-back-nine-knit-polo", "olydoe-oxford-pique-polo", "olydoe-merino-ponte-vest"],
  },
  "golf-quarter-zip-vs-hoodie": {
    products: ["rhone-rise-quarter-zip", "olydoe-merino-ponte-quarter-zip", "technically-golf-nio-half-zip", "sloat-organic-cotton-fleece-hoodie"],
  },
  "best-golf-polos-2026-quiet-golf-rhone": {
    products: ["quiet-golf-remy-polo-active-pique", "rhone-commuter-polo", "quiet-golf-randolph-polo", "rhone-commuter-flyweight-short-7"],
  },
  "golf-capsule-wardrobe-12-essential-pieces": {
    intent: "reserve",
    products: ["rhone-commuter-polo", "rhone-commuter-flyweight-short-7", "rhone-rise-quarter-zip", "olydoe-merino-ponte-vest"],
  },
  "best-golf-belt-2026-braided-leather-stretch": {
    products: ["duckhead-stretch-belt", "technically-golf-tiger-stripe-needlepoint-belt", "duckhead-classic-fit-gold-school-chino-khaki", "winston-golf-tour-towel"],
  },
  "best-golf-rain-gear-for-spring-2026": {
    products: ["rhone-long-game-jacket", "rhone-rise-quarter-zip", "technically-golf-nio-half-zip", "olydoe-merino-ponte-vest"],
  },
  "pinehurst-golf-trip-packing-list-spring-2026": {
    products: ["rhone-commuter-polo", "rhone-commuter-flyweight-short-7", "rhone-long-game-jacket", "jolly-golf-purist-organizer"],
  },
  "mully-pro-shop-may-2026-refresh": {
    products: ["rhone-commuter-polo", "quiet-golf-remy-polo-active-pique", "rhone-back-nine-knit-polo", "rhone-commuter-flyweight-short-7"],
  },
  "what-to-wear-golf-tournament-spectator-men": {
    intent: "shop",
    products: ["quiet-golf-remy-polo-active-pique", "rhone-commuter-flyweight-short-7", "rhone-rise-quarter-zip", "sloat-organic-cotton-six-panel-hat"],
  },
  "major-week-layering-system-golf-2026": {
    products: ["olydoe-pima-long-sleeve-polo", "rhone-rise-quarter-zip", "rhone-voyage-down-vest", "rhone-long-game-jacket"],
  },
  "golf-trip-carry-on-essentials-2026": {
    products: ["rhone-commuter-polo", "rhone-commuter-flyweight-short-7", "rhone-rise-quarter-zip", "jolly-golf-purist-organizer"],
  },
  "best-golf-shorts-2026": {
    products: ["rhone-commuter-flyweight-short-7", "rhone-commuter-flyweight-short-9", "quiet-golf-remy-polo-active-pique", "rhone-commuter-polo"],
  },
  "best-golf-pants-2026-rhone-commuter": {
    products: ["duckhead-long-drive-performance-five-pocket", "duckhead-classic-fit-gold-school-chino-khaki", "duckhead-stretch-belt", "rhone-commuter-polo"],
  },
  "best-golf-windbreaker-forresters-windblocker-2026": {
    products: ["rhone-long-game-jacket", "technically-golf-nio-half-zip", "rhone-rise-quarter-zip", "duckhead-fremont-sport-performance-quilted-vest-brandy-brown"],
  },
  "the-reserve-edit-golf-trip-packing-list-2026": {
    products: ["quiet-golf-remy-polo-active-pique", "rhone-commuter-flyweight-short-7", "rhone-rise-quarter-zip", "jolly-golf-purist-organizer"],
  },
  "best-golf-rain-jacket-forresters-rainshedder-guide": {
    products: ["rhone-long-game-jacket", "rhone-rise-quarter-zip", "rhone-commuter-polo", "olydoe-merino-ponte-vest"],
  },
};

/** Restored archive posts (/blogs/news/<handle>). Golf gloves are not carried. */
export const ARCHIVE_COMMERCE: Record<string, BlogCommerceEntry> = {
  "how-the-official-world-golf-rankings-determine-golfs-top-players-a-deep-dive-into-the-ranking-system": {
    intent: "reserve",
    products: ["rhone-commuter-polo", "olydoe-oxford-pique-polo", "rhone-rise-quarter-zip"],
  },
  "how-is-a-golf-handicap-calculated-the-complete-guide": {
    intent: "reserve",
    products: ["quiet-golf-remy-polo-active-pique", "olydoe-og-supima-hollow-polo", "technically-golf-nio-half-zip"],
  },
  "the-fix-heres-how-to-finally-stop-hitting-the-ball-off-the-hosel": {
    intent: "shop",
    products: ["rhone-approach-tech-polo", "winston-golf-tour-towel", "jolly-golf-purist-organizer", "rhone-commuter-flyweight-short-7"],
  },
  "best-formats-for-golf-trips-with-your-buddies": {
    intent: "shop",
    products: ["rhone-commuter-polo", "rhone-commuter-flyweight-short-7", "jolly-golf-purist-organizer", "stitch-roller-duffle"],
  },
  "golf-formats-explained-different-ways-to-play-the-game": {
    intent: "shop",
    products: ["quiet-golf-remy-polo-active-pique", "olydoe-og-supima-hollow-polo", "rhone-commuter-flyweight-short-7", "winston-golf-tour-towel"],
  },
  "top-5-golf-resorts-in-michigan": {
    intent: "reserve-trip",
    products: ["rhone-long-game-jacket", "rhone-rise-quarter-zip", "rhone-voyage-down-vest", "stitch-roller-duffle"],
  },
  "what-is-a-cadet-glove-size": {
    intent: "shop",
    products: ["winston-golf-tour-towel", "jolly-golf-purist-organizer", "rhone-approach-tech-polo", "sloat-organic-cotton-six-panel-hat"],
  },
  "choosing-the-perfect-golf-hat-tips-for-comfort-and-performance": {
    intent: "shop",
    products: ["sloat-organic-cotton-six-panel-hat", "winston-golf-tour-towel", "jolly-golf-purist-organizer", "rhone-approach-tech-polo"],
  },
  "5-essential-golf-wearables-every-player-should-know-about": {
    intent: "shop",
    products: ["rhone-approach-tech-polo", "technically-golf-nio-half-zip", "jolly-golf-purist-organizer"],
  },
  "golf-ball-rollback": {
    intent: "reserve",
    products: ["olydoe-oxford-pique-polo", "rhone-back-nine-knit-polo", "olydoe-merino-ponte-quarter-zip"],
  },
  "how-to-properly-transition-from-the-backswing-to-the-downswing": {
    intent: "shop",
    products: ["rhone-approach-tech-polo", "quiet-golf-remy-polo-active-pique", "rhone-commuter-flyweight-short-7", "winston-golf-tour-towel"],
  },
  "golf-outing-ideas-35-formats-themes-contests-and-extras-with-a-planning-checklist": {
    intent: "shop",
    products: ["winston-golf-tour-towel", "jolly-golf-purist-organizer", "rhone-commuter-polo", "sloat-organic-cotton-six-panel-hat"],
  },
};

const CATEGORY_INTENT: Record<BlogCategory, EndIntent> = {
  Gear: "shop",
  Partners: "shop",
  Guides: "shop",
  Travel: "reserve-trip",
  "The Craft": "reserve-club",
  "Inside the Reserve": "reserve",
};

/** End-of-post intent: explicit config, then gift keywords, then category. */
export function endIntentFor(slug: string, category: BlogCategory | null, entry?: BlogCommerceEntry): EndIntent {
  if (entry?.intent) return entry.intent;
  if (/(^|-)gifts?(-|$)/.test(slug)) return "gift";
  return (category && CATEGORY_INTENT[category]) || "shop";
}

const SHOP_LINK = /\]\(\/shop\/([a-z0-9][a-z0-9-]*)\)/g;

/** Product handles linked inline as [label](/shop/<handle>), in order. */
export function linkedProductHandles(sections: BlogSection[]): string[] {
  const out: string[] = [];
  for (const s of sections) for (const p of s.paragraphs) for (const m of p.matchAll(SHOP_LINK)) out.push(m[1]);
  return out;
}

/** Linked handles first, then configured ones, de-duplicated. */
export function productHandlesFor(sections: BlogSection[], entry?: BlogCommerceEntry): string[] {
  return [...new Set([...linkedProductHandles(sections), ...(entry?.products ?? [])])];
}

export const ROW_TOP_MAX = 4;
export const ROW_BOTTOM_MAX = 4;

/** Bottom row prefers products the top row did not show, then fills. */
export function splitRows<T extends { slug: string }>(products: T[]): { top: T[]; bottom: T[] } {
  const top = products.slice(0, ROW_TOP_MAX);
  const rest = products.slice(ROW_TOP_MAX);
  const bottom = rest.length >= 3 ? rest.slice(0, ROW_BOTTOM_MAX) : [...rest, ...top].slice(0, ROW_BOTTOM_MAX);
  return { top, bottom };
}

/* ─── Copy ──────────────────────────────────────────────────────────────── */

export const ROW_COPY = {
  top: "Shop this story",
  bottom: "Shop the pieces",
  shopLink: { label: "Shop the Mully Edit", href: "/shop" },
};

export interface CtaCopy { eyebrow: string; heading: string; body: string; cta: string; href: string }

const RESERVE_BODY = "Take a short style quiz on fit, sizing and the brands you already wear. A stylist picks every piece, and your fit is confirmed before anything ships.";

export const END_COPY: Record<Exclude<EndIntent, "shop">, CtaCopy> = {
  "reserve-club": {
    eyebrow: "Mully Reserve",
    heading: "A stylist-picked outfit for your club, matched to your fit.",
    body: RESERVE_BODY,
    cta: "See how Mully Reserve works",
    href: "/subscription",
  },
  "reserve-trip": {
    eyebrow: "Mully Reserve",
    heading: "A stylist-picked outfit for your next trip, matched to your fit.",
    body: RESERVE_BODY,
    cta: "See how Mully Reserve works",
    href: "/subscription",
  },
  reserve: {
    eyebrow: "Mully Reserve",
    heading: "A stylist-picked outfit, matched to your fit.",
    body: RESERVE_BODY,
    cta: "See how Mully Reserve works",
    href: "/subscription",
  },
  gift: {
    eyebrow: "Give Mully Reserve",
    heading: "A stylist-picked outfit for the golfer on your list.",
    body: "They confirm their own sizing before anything ships, so nothing is a guess.",
    cta: "Send Reserve as a gift",
    href: "/lp/gift",
  },
};

export const RESERVE_MID_COPY: CtaCopy = {
  eyebrow: "Mully Reserve",
  heading: "Picked by a stylist. Fit to you.",
  body: "Reserve starts with a short style quiz on fit and the brands you already wear. Your fit is confirmed before anything ships.",
  cta: "See plans and pricing",
  href: "/subscription",
};
