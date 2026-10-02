import type { ShopifyProduct, ShopifyProductVariant } from "./shopify";

export const OUTFIT_SLOTS = [
  {
    label: "Top",
    category: "shop-tops",
    slugs: ["quiet-golf-remy-polo-active-pique", "olydoe-og-supima-hollow-polo"],
  },
  {
    label: "Bottom",
    category: "shop-bottoms",
    slugs: ["duckhead-classic-fit-gold-school-chino-khaki", "duckhead-long-drive-performance-five-pocket"],
  },
  {
    label: "Layer",
    category: "shop-outerwear",
    slugs: [
      "duckhead-fremont-sport-performance-quilted-vest-brandy-brown",
      "olydoe-merino-ponte-quarter-zip",
    ],
  },
] as const;
export const OUTFIT_STORAGE_KEY = "mully_shop_outfit_v1";
export const RESERVE_OUTFIT_PRICE = 250;
export const money = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 2,
    minimumFractionDigits: Number.isInteger(n) ? 0 : 2,
  }).format(n);
export function outfitEstimate(prices: number[]) {
  const cents = prices.map((p) => Math.round(p * 100));
  const subtotal = cents.reduce((a, b) => a + b, 0);
  const savings = cents.length > 1 ? Math.round(Math.min(...cents) * 0.15) : 0;
  return {
    subtotal: subtotal / 100,
    savings: savings / 100,
    total: (subtotal - savings) / 100,
  };
}
export function outfitOptions(
  products: ShopifyProduct[],
  category: ShopifyProduct[],
  preferred: readonly string[],
) {
  const bySlug = new Map(products.map((p) => [p.slug, p]));
  const selected = preferred
    .map((s) => bySlug.get(s))
    .filter((p): p is ShopifyProduct => !!p);
  for (const p of category)
    if (selected.length < 2 && !selected.some((x) => x.slug === p.slug))
      selected.push(p);
  return selected;
}
export function variantLabel(v: ShopifyProductVariant) {
  return (
    v.selectedOptions
      .filter((o) => o.value !== "Default Title")
      .map((o) => o.value)
      .join(" / ") || v.title
  );
}
export function outfitProductName(product: ShopifyProduct) {
  const prefix = `${product.brand} `;
  return product.name.toLowerCase().startsWith(prefix.toLowerCase())
    ? product.name.slice(prefix.length)
    : product.name;
}
export type OutfitGuide = {
  createdAt: number;
  items: {
    slug: string;
    name: string;
    brand: string;
    variantId: string;
    size: string;
    image: string;
  }[];
};
export function readOutfitGuide(): OutfitGuide | null {
  try {
    const raw = JSON.parse(
      sessionStorage.getItem(OUTFIT_STORAGE_KEY) || "null",
    );
    if (
      !raw ||
      !Number.isFinite(raw.createdAt) ||
      Date.now() - raw.createdAt > 86400000 ||
      raw.createdAt > Date.now() + 60000 ||
      !Array.isArray(raw.items) ||
      raw.items.length !== 3
    )
      return null;
    if (
      !raw.items.every(
        (x: Record<string, unknown>) =>
          x &&
          ["slug", "name", "brand", "variantId", "size", "image"].every(
            (k) => typeof x[k] === "string" && (x[k] as string).length < 500,
          ) &&
          /^gid:\/\/shopify\/ProductVariant\/\d+$/.test(x.variantId as string),
      )
    )
      return null;
    return raw as OutfitGuide;
  } catch {
    return null;
  }
}
export function outfitLineAttributes(guide: OutfitGuide) {
  return guide.items.flatMap((item, i) => [
    {
      key: `Outfit ${OUTFIT_SLOTS[i].label}`,
      value: `${item.name} / ${item.size}`,
    },
    {
      key: `_outfit_${OUTFIT_SLOTS[i].label.toLowerCase()}_variant`,
      value: item.variantId,
    },
  ]);
}
