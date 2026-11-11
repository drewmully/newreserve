/**
 * Server-only: read live Gift a Season variant prices from the Storefront
 * API so page copy follows Shopify. Returns null when the variants are not
 * visible to the Storefront yet (draft product) or on any error, and the LP
 * falls back to GIFT_SEASON_PRICES.
 */
import { GIFT_SEASON_OPTIONS } from "./giftSeason";

export async function fetchGiftSeasonLivePrices(): Promise<Record<string, number> | null> {
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  const token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  if (!domain || !token) return null;
  try {
    const ids = GIFT_SEASON_OPTIONS.map((o) => `gid://shopify/ProductVariant/${o.variantId}`);
    const res = await fetch(`https://${domain}/api/2024-10/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": token,
      },
      body: JSON.stringify({
        query: `query GiftSeasonPrices($ids: [ID!]!) { nodes(ids: $ids) { ... on ProductVariant { id price { amount } } } }`,
        variables: { ids },
      }),
      next: { revalidate: 300 },
    } as RequestInit & { next?: { revalidate?: number } });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { nodes?: Array<{ id?: string; price?: { amount?: string } } | null> };
    };
    const out: Record<string, number> = {};
    for (const n of json.data?.nodes ?? []) {
      const id = n?.id?.split("/").pop();
      const amount = Number(n?.price?.amount);
      if (id && Number.isFinite(amount) && amount > 0) out[id] = amount;
    }
    return Object.keys(out).length ? out : null;
  } catch {
    return null;
  }
}
