/**
 * ChatGPT product feed (OpenAI Agentic Commerce, stable file-upload schema).
 * https://developers.openai.com/commerce/specs/file-upload/products
 *
 * One row per purchasable variant. The product set is exactly what /shop
 * renders: the "shop-all" collection plus the six category collections,
 * de-duplicated by handle. Reserve, Pro Shop and private-release inventory
 * never appears here because the storefront does not show it.
 *
 * Price is the storefront retail price (Shopify variant price). The member
 * price is a Reserve benefit, not a public offer, so it is not sent.
 */

import type { ShopifyProduct, ShopifyProductVariant } from "@/lib/shopify";

export const FEED_SITE_URL = "https://www.mymully.com";
export const FEED_SELLER_NAME = "Mully";
export const FEED_RETURN_DAYS = 30;

export const FEED_COLUMNS = [
  "item_id",
  "group_id",
  "listing_has_variations",
  "variant_dict",
  "title",
  "description",
  "url",
  "brand",
  "seller_name",
  "seller_url",
  "image_url",
  "additional_image_urls",
  "availability",
  "price",
  "condition",
  "product_category",
  "color",
  "size",
  "accepts_returns",
  "return_deadline_in_days",
  "return_policy",
  "review_count",
  "star_rating",
  "is_eligible_search",
  "is_ads_eligible",
  "target_countries",
  "store_country",
] as const;

export type FeedColumn = (typeof FEED_COLUMNS)[number];
export type FeedRow = Partial<Record<FeedColumn, string>>;

/** Category labels keyed by the /shop collection handle. */
const CATEGORY_LABELS: Record<string, string> = {
  "shop-tops": "Tops",
  "shop-bottoms": "Bottoms",
  "shop-outerwear": "Outerwear",
  "shop-gear": "Gear",
  "shop-bags": "Bags",
  "shop-accessories": "Accessories",
};

const FINAL_SALE_TAGS = new Set(["final-sale", "final sale", "finalsale"]);

const numericId = (gid: string) => gid.split("/").pop() ?? gid;

function plain(text: string | undefined, max: number): string {
  return (text ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const money = (amount: number) => `${amount.toFixed(2)} USD`;

function availability(v: ShopifyProductVariant): string {
  if (!v.availableForSale) return "out_of_stock";
  // Shopify allows checkout with no physical stock: the storefront sells it
  // with an estimated ship date, which is a backorder in feed terms.
  return v.currentlyNotInStock ? "backorder" : "in_stock";
}

function optionValue(v: ShopifyProductVariant, name: RegExp): string | undefined {
  return v.selectedOptions.find((o) => name.test(o.name))?.value;
}

function variantLabel(v: ShopifyProductVariant): string {
  return v.selectedOptions
    .filter((o) => o.value && o.value !== "Default Title")
    .map((o) => o.value)
    .join(", ");
}

export interface FeedProduct extends ShopifyProduct {
  /** /shop category handles the product appears in. */
  sourceCollections?: string[];
}

export function productToRows(product: FeedProduct): FeedRow[] {
  const variants = product.variants.filter((v) => v.price > 0);
  if (variants.length === 0 || product.images.length === 0) return [];

  const hasVariations =
    variants.length > 1 ||
    variants.some((v) => v.selectedOptions.some((o) => o.value !== "Default Title"));
  const groupId = `mully-${numericId(product.id ?? product.slug)}`;
  const category = (product.sourceCollections ?? [])
    .map((h) => CATEGORY_LABELS[h])
    .find(Boolean);
  const productCategory = ["Golf", category, product.collection]
    .filter(Boolean)
    .join(" > ");
  const finalSale = (product.tags ?? []).some((t) =>
    FINAL_SALE_TAGS.has(t.toLowerCase()),
  );
  // Product galleries mix every colorway, so extra views are only safe to
  // send when the listing has a single color.
  const colors = new Set(variants.map((v) => optionValue(v, /colou?r/i) ?? ""));
  const singleColor = colors.size <= 1;
  const description =
    plain(product.description, 5000) ||
    plain(product.editorialHeadline, 5000) ||
    product.name;

  return variants.map((v) => {
    const label = variantLabel(v);
    const image = v.image || product.images[0];
    const extra = singleColor
      ? product.images.filter((u) => u !== image).slice(0, 10)
      : [];
    const dict = Object.fromEntries(
      v.selectedOptions
        .filter((o) => o.value && o.value !== "Default Title")
        .map((o) => [o.name, o.value]),
    );

    const row: FeedRow = {
      item_id: `mully-${numericId(v.id)}`,
      group_id: groupId,
      title: plain(label ? `${product.name}, ${label}` : product.name, 150),
      description,
      url: `${FEED_SITE_URL}/shop/${product.slug}?variant=${numericId(v.id)}`,
      brand: product.brand,
      seller_name: FEED_SELLER_NAME,
      seller_url: `${FEED_SITE_URL}/shop`,
      image_url: image,
      additional_image_urls: extra.map((u) => u.replace(/,/g, "%2C")).join(","),
      availability: availability(v),
      price: money(v.price),
      condition: "new",
      product_category: productCategory,
      color: optionValue(v, /colou?r/i),
      size: optionValue(v, /^size$/i),
      accepts_returns: finalSale ? "false" : "true",
      return_deadline_in_days: finalSale ? undefined : String(FEED_RETURN_DAYS),
      return_policy: `${FEED_SITE_URL}/policies/refund`,
      is_eligible_search: "true",
      is_ads_eligible: "true",
      target_countries: JSON.stringify(["US"]),
      store_country: "US",
    };
    if (hasVariations && Object.keys(dict).length > 0) {
      row.listing_has_variations = "true";
      row.variant_dict = JSON.stringify(dict);
    }
    if (product.reviewCount && product.reviewCount > 0 && product.rating) {
      row.review_count = String(Math.round(product.reviewCount));
      row.star_rating = product.rating.toFixed(2);
    }
    return row;
  });
}

function csvCell(value: string | undefined): string {
  if (value === undefined || value === null) return "";
  return /[",\n\r]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

export function rowsToCsv(rows: FeedRow[]): string {
  const lines = [FEED_COLUMNS.join(",")];
  for (const row of rows) lines.push(FEED_COLUMNS.map((c) => csvCell(row[c])).join(","));
  return lines.join("\n") + "\n";
}

/** Merge collection results in /shop order, de-duplicated by handle. */
export function mergeShopProducts(
  groups: Array<{ handle: string; products: ShopifyProduct[] }>,
): FeedProduct[] {
  const bySlug = new Map<string, FeedProduct>();
  for (const { handle, products } of groups) {
    for (const p of products) {
      const existing = bySlug.get(p.slug);
      if (existing) {
        if (!existing.sourceCollections!.includes(handle)) existing.sourceCollections!.push(handle);
      } else {
        bySlug.set(p.slug, { ...p, sourceCollections: [handle] });
      }
    }
  }
  return [...bySlug.values()];
}
