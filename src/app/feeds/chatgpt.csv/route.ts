/**
 * GET /feeds/chatgpt.csv
 *
 * Hosted product feed for ChatGPT (OpenAI merchant portal / Ads Manager,
 * "Use a hosted URL"). One CSV row per variant, built from the same
 * collections /shop renders, so the feed lists only what the storefront
 * shows. Prices and availability come from the live Storefront API and
 * refresh hourly, matching the /shop ISR window.
 *
 * Contains only public catalog data.
 */

import { getCollectionProducts } from "@/lib/shopify";
import { SHOP_CATEGORIES } from "@/app/shop/shopCollections";
import { mergeShopProducts, productToRows, rowsToCsv } from "@/lib/chatgptFeed";

export const runtime = "nodejs";
export const revalidate = 3600;

export async function GET() {
  const handles = ["shop-all", ...SHOP_CATEGORIES.map((c) => c.handle)];
  const settled = await Promise.allSettled(handles.map((h) => getCollectionProducts(h)));

  // Shop All is the storefront's primary grid. Without it the feed would
  // silently drop most of the catalog, so fail loudly and let the
  // previous cached copy keep serving.
  if (settled[0].status === "rejected") {
    console.error("[chatgpt-feed] shop-all unavailable:", settled[0].reason);
    return new Response("catalog_unavailable\n", { status: 503 });
  }

  const groups = settled.flatMap((r, i) =>
    r.status === "fulfilled" ? [{ handle: handles[i], products: r.value }] : [],
  );
  const rows = mergeShopProducts(groups).flatMap(productToRows);

  return new Response(rowsToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": 'inline; filename="mully-chatgpt-products.csv"',
      "Cache-Control": "public, s-maxage=3600, stale-while-revalidate=86400",
    },
  });
}
