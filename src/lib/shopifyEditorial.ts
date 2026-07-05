/**
 * Editorial feed data layer.
 *
 * `/lp/editorial` shows an endless, chronological "feed" of products across
 * both the Reserve Pro Shop and Private Releases collections, newest first.
 *
 * We reuse `getCollectionProducts` for the read (already cached, ISR-friendly),
 * merge by slug, then sort by `publishedAt` returned from Shopify. We piggy-
 * back on the existing Storefront query rather than adding a second network
 * call — but we need `publishedAt` on each product, so we ship a small
 * dedicated fetcher here that adds the field.
 *
 * Why not extend `getCollectionProducts`?
 * - `/shop` doesn't need publishedAt today; keeping the two callers separate
 *   avoids invalidating that cache entry when we iterate on this page.
 * - Editorial ordering (newest first, cross-collection) is a feed concern,
 *   not a catalog concern. Different mental model, different helper.
 */
import {
  PRO_SHOP_COLLECTION_HANDLE,
  PRIVATE_RELEASES_COLLECTION_HANDLE,
  DESTINATIONS_COLLECTION_HANDLE,
  type ShopifyProduct,
  type ShopifyProductImage,
  type ShopifyProductOption,
  type ShopifyProductVariant,
} from "@/lib/shopify";

const MEMBER_DISCOUNT_RATE = 0.15;

interface RawVariant {
  id: string;
  title: string;
  availableForSale: boolean;
  price: { amount: string; currencyCode: string };
  image?: { url: string; altText?: string | null } | null;
  selectedOptions: Array<{ name: string; value: string }>;
}

interface RawProduct {
  handle: string;
  title: string;
  vendor: string;
  productType: string;
  description: string;
  publishedAt: string | null;
  options: Array<{ name: string; values: string[] }>;
  variants: { nodes: RawVariant[] };
  images: { nodes: Array<{ url: string; altText?: string | null }> };
  materialMeta: { value: string } | null;
  aboutBrandMeta: { value: string } | null;
  whyWeLikeItMeta: { value: string } | null;
  sizingMeta: { value: string } | null;
  editorialHeadlineMeta: { value: string } | null;
  editorialBodyMeta: { value: string } | null;
  editorialCategoryMeta: { value: string } | null;
  destinationUrlMeta: { value: string } | null;
}

const PRODUCT_FIELDS = `
  handle
  title
  vendor
  productType
  description
  publishedAt
  options { name values }
  variants(first: 25) {
    nodes {
      id
      title
      availableForSale
      price { amount currencyCode }
      image { url altText }
      selectedOptions { name value }
    }
  }
  images(first: 30) {
    nodes { url altText }
  }
  materialMeta: metafield(namespace: "custom", key: "material") { value }
  aboutBrandMeta: metafield(namespace: "custom", key: "about_brand") { value }
  whyWeLikeItMeta: metafield(namespace: "custom", key: "why_we_like_it") { value }
  sizingMeta: metafield(namespace: "custom", key: "sizing") { value }
  editorialHeadlineMeta: metafield(namespace: "custom", key: "editorial_headline") { value }
  editorialBodyMeta: metafield(namespace: "custom", key: "editorial_body") { value }
  editorialCategoryMeta: metafield(namespace: "custom", key: "editorial_category") { value }
  destinationUrlMeta: metafield(namespace: "custom", key: "destination_url") { value }
`;

export interface EditorialProduct extends ShopifyProduct {
  /** ISO 8601 timestamp from Shopify. Never mutate — used for stable sort. */
  publishedAt: string | null;
  /** Which collection this appeared in (first match wins on merge). */
  sourceHandle: string;
  /**
   * Short editorial hook shown on the card (Uncrate-style: 1 sentence).
   * Sourced from Shopify metafield `custom.editorial_headline`.
   */
  editorialHeadline: string;
  /**
   * Longer editorial body for the PDP or future longform view. Multi-line.
   * Sourced from Shopify metafield `custom.editorial_body`.
   */
  editorialBody: string;
  /**
   * One of: 'tech' | 'style' | 'destinations' | 'course'.
   * Drives the category filter on /lp/editorial.
   */
  editorialCategory: EditorialCategory | "";
  /**
   * For editorial_category='destinations' only. Outbound resort URL.
   * The card renders "Visit Course" instead of Add to Cart when set.
   */
  destinationUrl: string;
}

export const EDITORIAL_CATEGORIES = [
  "tech",
  "style",
  "destinations",
  "course",
] as const;
export type EditorialCategory = (typeof EDITORIAL_CATEGORIES)[number];

export const EDITORIAL_CATEGORY_LABELS: Record<EditorialCategory, string> = {
  tech: "Tech",
  style: "Style",
  destinations: "Destinations",
  course: "Course",
};

function normalizeCategory(raw: string | null | undefined): EditorialCategory | "" {
  if (!raw) return "";
  const v = raw.trim().toLowerCase();
  return (EDITORIAL_CATEGORIES as readonly string[]).includes(v)
    ? (v as EditorialCategory)
    : "";
}

function mapVariant(raw: RawVariant): ShopifyProductVariant {
  const price = parseFloat(raw.price.amount);
  const reservePrice =
    Math.round(price * (1 - MEMBER_DISCOUNT_RATE) * 100) / 100;
  return {
    id: raw.id,
    title: raw.title,
    price,
    reservePrice,
    availableForSale: raw.availableForSale,
    image: raw.image?.url,
    imageAltText: raw.image?.altText ?? null,
    selectedOptions: raw.selectedOptions,
  };
}

function mapProduct(raw: RawProduct, sourceHandle: string): EditorialProduct {
  const variants = raw.variants.nodes.map(mapVariant);
  const defaultVariant =
    variants.find((v) => v.availableForSale) ?? variants[0];
  const images = raw.images.nodes.map((img) => img.url);
  const imageDetails: ShopifyProductImage[] = raw.images.nodes.map((img) => ({
    url: img.url,
    altText: img.altText ?? null,
  }));
  const options: ShopifyProductOption[] = raw.options.map((option) => ({
    name: option.name,
    values: option.values,
  }));

  return {
    slug: raw.handle,
    name: raw.title,
    brand: raw.vendor,
    collection: raw.productType || "Accessories",
    price: defaultVariant?.price ?? 0,
    reservePrice: defaultVariant?.reservePrice ?? 0,
    images,
    imageDetails,
    description: raw.description,
    material: raw.materialMeta?.value ?? "",
    aboutBrand: raw.aboutBrandMeta?.value ?? "",
    whyWeLikeIt: raw.whyWeLikeItMeta?.value ?? "",
    sizing: raw.sizingMeta?.value ?? "",
    editorialHeadline: raw.editorialHeadlineMeta?.value ?? "",
    editorialBody: raw.editorialBodyMeta?.value ?? "",
    editorialCategory: normalizeCategory(raw.editorialCategoryMeta?.value),
    destinationUrl: raw.destinationUrlMeta?.value ?? "",
    options,
    variants,
    variantId: defaultVariant?.id,
    sourceCollections: [sourceHandle],
    publishedAt: raw.publishedAt,
    sourceHandle,
  };
}

async function storefrontFetch<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  const token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  if (!domain || !token) {
    throw new Error("Shopify Storefront env vars missing");
  }

  const res = await fetch(`https://${domain}/api/2024-07/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token,
    },
    body: JSON.stringify({ query, variables }),
    // ISR — same 1h window as /shop.
    next: { revalidate: 3600 },
  });

  if (!res.ok) {
    throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  }

  const json = (await res.json()) as {
    data: T;
    errors?: Array<{ message: string }>;
  };
  if (json.errors?.length) {
    throw new Error(`Shopify GQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

/**
 * Fetch a single collection sorted by publish date, newest first.
 * Shopify natively supports `sortKey: CREATED, reverse: true` on the
 * collection.products connection.
 */
async function fetchCollection(handle: string): Promise<EditorialProduct[]> {
  const query = `
    query EditorialCollection($handle: String!) {
      collection(handle: $handle) {
        products(first: 50, sortKey: CREATED, reverse: true) {
          nodes { ${PRODUCT_FIELDS} }
        }
      }
    }
  `;
  const data = await storefrontFetch<{
    collection: { products: { nodes: RawProduct[] } } | null;
  }>(query, { handle });

  return (data.collection?.products.nodes ?? []).map((n) => mapProduct(n, handle));
}

/**
 * Return the full editorial feed: both collections, merged, sorted by
 * `publishedAt` DESC. Deduped by slug — if the same product appears in
 * both collections, the first (chronologically newest) instance wins and
 * both handles are recorded in `sourceCollections`.
 */
export async function getEditorialFeed(): Promise<EditorialProduct[]> {
  const handles = [
    PRO_SHOP_COLLECTION_HANDLE,
    PRIVATE_RELEASES_COLLECTION_HANDLE,
    DESTINATIONS_COLLECTION_HANDLE,
  ];
  const settled = await Promise.allSettled(handles.map(fetchCollection));

  const groups: EditorialProduct[][] = [];
  settled.forEach((result, i) => {
    if (result.status === "fulfilled") {
      groups.push(result.value);
    } else {
      console.error(`[EditorialFeed] "${handles[i]}" failed:`, result.reason);
    }
  });

  const bySlug = new Map<string, EditorialProduct>();
  for (const group of groups) {
    for (const product of group) {
      const existing = bySlug.get(product.slug);
      if (!existing) {
        bySlug.set(product.slug, product);
        continue;
      }
      // Merge source collections; keep the older-added entry's publishedAt
      // sort key (they should match — same product handle).
      bySlug.set(product.slug, {
        ...existing,
        sourceCollections: Array.from(
          new Set([
            ...(existing.sourceCollections ?? []),
            ...(product.sourceCollections ?? []),
          ])
        ),
      });
    }
  }

  const all = Array.from(bySlug.values());

  // Newest first. Products with no publishedAt sink to the bottom.
  all.sort((a, b) => {
    const ta = a.publishedAt ? Date.parse(a.publishedAt) : 0;
    const tb = b.publishedAt ? Date.parse(b.publishedAt) : 0;
    return tb - ta;
  });

  return all;
}
