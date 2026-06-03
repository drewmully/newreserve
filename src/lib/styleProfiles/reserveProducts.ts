/**
 * Live Shopify product fetch for the personalized Reserve reveal page.
 *
 * Drew's instructions verbatim:
 *   "Poll live from shopify but collection tag won't work great — see what
 *    data you get and pick something that would work generally. Should be
 *    2 apparel items, 2 accessories, rangefinder gift."
 *
 * Strategy:
 *   1. Pull a healthy window of recently-updated products (status=active,
 *      published_status=published) so the catalog stays fresh without us
 *      having to maintain collection tags by hand.
 *   2. Classify each product as APPAREL, ACCESSORY, or RANGEFINDER using a
 *      cascade: productType > tags > title keywords. This works on Drew's
 *      catalog regardless of how he chooses to tag a new brand drop.
 *   3. Deterministically rank within each bucket by hashing
 *      `${profileId}:${styleBucket}:${product.id}` so the same visitor sees
 *      the same edit on refresh, but different visitors get variety.
 *   4. Return the first 2 apparel + 2 accessories + 1 rangefinder.
 *
 * Pure server-side — never import from a client component.
 */

import crypto from "crypto";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";
import type { StyleBucket } from "./types";

export type ProductBucket = "apparel" | "accessory" | "rangefinder";

export interface ReserveProductCard {
  id: string;           // numeric Shopify product id (e.g. "8123456789")
  handle: string;
  title: string;
  vendor: string | null;
  productType: string | null;
  /** Inferred bucket — apparel/accessory/rangefinder. */
  bucket: ProductBucket;
  /** Primary image (highest priority). null if the product has no images. */
  imageUrl: string | null;
  imageAlt: string | null;
  /** Display price (compareAt if present, otherwise the variant price). */
  priceDisplay: string;
  compareAtDisplay: string | null;
  /** Shopify storefront URL — used as fallback link if we want to deep-link. */
  url: string;
}

export interface RevealEdit {
  apparel: ReserveProductCard[];
  accessories: ReserveProductCard[];
  rangefinder: ReserveProductCard | null;
  /** Sum of retail/compareAt prices for the four edit pieces (rangefinder excluded — it's a gift). */
  totalRetailCents: number;
  /** $250 — the Reserve quarterly price. */
  reservePriceCents: number;
  /** Convenience: retail - reserve, in cents. */
  savingsCents: number;
}

// ─── Classification heuristics ───────────────────────────────────────────────

// Rangefinder keywords — kept narrow on purpose. "yardage" was previously
// included here and incorrectly matched the "Will Leather Goods Yardage Book"
// product, causing the yardage book to surface as the welcome gift. The
// classifier now requires a true rangefinder term, and explicitly excludes
// the yardage-book pattern.
const RANGEFINDER_KEYWORDS = [
  "rangefinder",
  "range finder",
  "range-finder",
  "laser rangefinder",
];
// Anti-pattern: titles matching any of these are NEVER classified as
// rangefinder, even if a rangefinder keyword would otherwise match.
const RANGEFINDER_ANTIPATTERNS = ["yardage book", "yardage-book"];

const APPAREL_KEYWORDS = [
  "polo", "shirt", "tee", "henley", "pullover", "quarter-zip", "quarter zip",
  "qzip", "sweater", "vest", "jacket", "hoodie", "crewneck", "outerwear",
  "pant", "short", "joggers", "trouser", "chino",
];
const ACCESSORY_KEYWORDS = [
  "hat", "cap", "bag", "headcover", "belt", "glove", "ball marker", "divot",
  "tee", "towel", "umbrella", "marker", "wallet", "keychain", "sock",
  "yardage book", "yardage-book", "notebook", "journal",
];

function lowerSet(values: Array<string | null | undefined>): string {
  return values.filter(Boolean).map((v) => v!.toLowerCase()).join(" | ");
}

function classify(args: {
  productType: string | null;
  tags: string[];
  title: string;
}): ProductBucket | null {
  const haystack = lowerSet([args.productType, args.title, ...args.tags]);

  // Rangefinder check FIRST — these are accessories too, so order matters.
  // BUT respect anti-patterns: e.g. a "Yardage Book" must never surface as
  // the rangefinder welcome gift, even if a future keyword loosely matches.
  const matchesRangefinder = RANGEFINDER_KEYWORDS.some((k) => haystack.includes(k));
  const matchesAntiPattern = RANGEFINDER_ANTIPATTERNS.some((k) => haystack.includes(k));
  if (matchesRangefinder && !matchesAntiPattern) {
    return "rangefinder";
  }
  if (APPAREL_KEYWORDS.some((k) => haystack.includes(k))) {
    return "apparel";
  }
  if (ACCESSORY_KEYWORDS.some((k) => haystack.includes(k))) {
    return "accessory";
  }
  return null;
}

// ─── Deterministic shuffle ───────────────────────────────────────────────────

function rankKey(profileId: string, styleBucket: StyleBucket, productId: string): number {
  // SHA-1 → first 8 hex chars → integer. Same input → same rank, so refreshes
  // are stable. Different visitors get different edits because profileId is
  // unique per quiz.
  const h = crypto
    .createHash("sha1")
    .update(`${profileId}:${styleBucket}:${productId}`)
    .digest("hex");
  return parseInt(h.slice(0, 8), 16);
}

// ─── GraphQL ─────────────────────────────────────────────────────────────────

interface RawShopifyImage {
  url: string;
  altText: string | null;
}

interface RawShopifyVariant {
  price: string;
  compareAtPrice: string | null;
}

interface RawShopifyProduct {
  id: string;
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  status: string;
  tags: string[];
  featuredImage: RawShopifyImage | null;
  variants: { nodes: RawShopifyVariant[] };
}

const PRODUCT_FIELDS = `
  id
  handle
  title
  vendor
  productType
  status
  tags
  featuredImage { url altText }
  variants(first: 1) { nodes { price compareAtPrice } }
`;

const QUERY_ACTIVE_PRODUCTS = `
  query ReserveActiveProducts($first: Int!, $after: String) {
    products(
      first: $first
      after: $after
      query: "status:active AND published_status:published"
      sortKey: UPDATED_AT
      reverse: true
    ) {
      pageInfo { hasNextPage endCursor }
      nodes { ${PRODUCT_FIELDS} }
    }
  }
`;

function numericIdFromGid(gid: string): string {
  // gid://shopify/Product/8123456789 → 8123456789
  return gid.split("/").pop() ?? gid;
}

function priceToCents(price: string | null): number {
  if (!price) return 0;
  const n = parseFloat(price);
  if (Number.isNaN(n)) return 0;
  return Math.round(n * 100);
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}

function toCard(raw: RawShopifyProduct, bucket: ProductBucket): ReserveProductCard {
  const variant = raw.variants.nodes[0];
  const price = variant?.price ?? "0";
  const compareAt = variant?.compareAtPrice ?? null;

  // Display logic: compareAt if it's higher (true retail), else variant price.
  let displayCents = priceToCents(price);
  let compareDisplay: string | null = null;
  const compareCents = priceToCents(compareAt);
  if (compareCents > displayCents) {
    compareDisplay = formatCents(compareCents);
    displayCents = compareCents;
  }

  const storeDomain = process.env.SHOPIFY_STORE_DOMAIN ?? "mullybox-store.myshopify.com";
  // Prefer the primary storefront domain over the .myshopify.com one for nicer links.
  const primaryHost = process.env.SHOPIFY_PRIMARY_DOMAIN ?? `https://${storeDomain}`;
  const url = `${primaryHost.replace(/\/+$/, "")}/products/${raw.handle}`;

  return {
    id: numericIdFromGid(raw.id),
    handle: raw.handle,
    title: raw.title,
    vendor: raw.vendor || null,
    productType: raw.productType || null,
    bucket,
    imageUrl: raw.featuredImage?.url ?? null,
    imageAlt: raw.featuredImage?.altText ?? raw.title,
    priceDisplay: formatCents(displayCents),
    compareAtDisplay: compareDisplay,
    url,
  };
}

/**
 * Build the personalized reveal edit for a given profile + style bucket.
 *
 * @param maxFetch  How many active products to consider. The catalog is small
 *                  enough that 100 covers the whole store; we cap for safety.
 */
export async function buildRevealEdit(args: {
  profileId: string;
  styleBucket: StyleBucket;
  maxFetch?: number;
}): Promise<RevealEdit> {
  const first = Math.min(args.maxFetch ?? 100, 250);

  const data = await shopifyGraphQL<{
    products: {
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
      nodes: RawShopifyProduct[];
    };
  }>(QUERY_ACTIVE_PRODUCTS, { first, after: null });

  const classified: ReserveProductCard[] = [];
  for (const raw of data.products.nodes) {
    if (raw.status !== "ACTIVE") continue;
    if (!raw.featuredImage?.url) continue; // visual-first reveal — skip imageless
    const bucket = classify({
      productType: raw.productType || null,
      tags: raw.tags ?? [],
      title: raw.title,
    });
    if (!bucket) continue;
    classified.push(toCard(raw, bucket));
  }

  const apparel = classified.filter((p) => p.bucket === "apparel");
  const accessory = classified.filter((p) => p.bucket === "accessory");
  const rangefinder = classified.filter((p) => p.bucket === "rangefinder");

  // Deterministic rank per bucket.
  const rankFn = (p: ReserveProductCard) =>
    rankKey(args.profileId, args.styleBucket, p.id);
  apparel.sort((a, b) => rankFn(a) - rankFn(b));
  accessory.sort((a, b) => rankFn(a) - rankFn(b));
  rangefinder.sort((a, b) => rankFn(a) - rankFn(b));

  const apparelPick = apparel.slice(0, 2);
  const accessoryPick = accessory.slice(0, 2);
  const rangefinderPick = rangefinder[0] ?? null;

  const retailParts: number[] = [];
  for (const p of [...apparelPick, ...accessoryPick]) {
    // Use the display number (already compareAt-aware) for the value math.
    const cents = parseInt(p.priceDisplay.replace(/[^0-9]/g, ""), 10) * 100;
    if (!Number.isNaN(cents)) retailParts.push(cents);
  }
  const totalRetailCents = retailParts.reduce((a, b) => a + b, 0);
  const reservePriceCents = 25000; // $250
  const savingsCents = Math.max(0, totalRetailCents - reservePriceCents);

  return {
    apparel: apparelPick,
    accessories: accessoryPick,
    rangefinder: rangefinderPick,
    totalRetailCents,
    reservePriceCents,
    savingsCents,
  };
}

/**
 * Tiny formatter used by the reveal UI. Kept here so the API + UI agree on
 * how cents are rendered (we never split this between client + server).
 */
export function formatCentsUSD(cents: number): string {
  return `$${(cents / 100).toFixed(0)}`;
}
