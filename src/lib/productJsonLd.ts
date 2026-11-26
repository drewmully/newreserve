import type { ShopifyProduct } from "./shopify";
import { SITE_URL } from "./seo";

const plain = (html = "") => html.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const numericId = (gid: string) => gid.split("/").pop() || gid;

/** schema.org availability for one Shopify variant. */
export function variantAvailability(v: { availableForSale: boolean; currentlyNotInStock?: boolean }): string {
  if (!v.availableForSale) return "https://schema.org/OutOfStock";
  return v.currentlyNotInStock ? "https://schema.org/PreOrder" : "https://schema.org/InStock";
}

/**
 * Product structured data for a PDP. Prices and stock come straight from the
 * Shopify product the page rendered, one Offer per variant. No ratings are
 * emitted because PDPs have no first-party review data.
 */
export function productJsonLd(product: ShopifyProduct) {
  const url = `${SITE_URL}/shop/${product.slug}`;
  const offers = product.variants.map((v) => ({
    "@type": "Offer",
    sku: numericId(v.id),
    name: v.selectedOptions.filter((o) => o.value !== "Default Title").map((o) => o.value).join(" / ") || product.name,
    price: (v.price ?? product.price).toFixed(2),
    priceCurrency: "USD",
    availability: variantAvailability(v),
    itemCondition: "https://schema.org/NewCondition",
    url: `${url}?variant=${numericId(v.id)}`,
  }));
  return {
    "@context": "https://schema.org",
    "@type": "Product",
    name: product.name,
    brand: { "@type": "Brand", name: product.brand },
    description: plain(product.description).slice(0, 5000) || undefined,
    image: (product.images ?? []).slice(0, 6),
    url,
    category: product.collection || undefined,
    offers,
  };
}
