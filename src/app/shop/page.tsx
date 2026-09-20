import type { Metadata } from "next";
import {
  getCollectionProducts,
  type ShopifyProduct,
} from "@/lib/shopify";
import { ShopSeasonalHeader } from "./components/ShopSeasonalHeader";
import { ShopLanding } from "./components/ShopLanding";
import { ShopFooter } from "./components/ShopFooter";
import { SHOP_CATEGORIES } from "./shopCollections";
import { getSeasonalTheme } from "./seasonalTheme";

export const metadata: Metadata = {
  title: "Shop | mully.",
  description:
    "Fall 2026 · The Layering Edit. Golf apparel and equipment curated by Mully.",
};

// ISR one hour — collection contents, product tags, and seasonal
// theme swaps all refresh on the same cadence.
export const revalidate = 3600;

export default async function ShopPage() {
  const theme = getSeasonalTheme();

  // Fetch each category collection independently so one 404 doesn't blank
  // the whole landing.
  const settled = await Promise.allSettled(
    SHOP_CATEGORIES.map(({ handle }) => getCollectionProducts(handle))
  );

  const productsByCategory: Record<string, ShopifyProduct[]> = {};
  const seen = new Set<string>();
  const merged: ShopifyProduct[] = [];

  settled.forEach((result, idx) => {
    const cat = SHOP_CATEGORIES[idx];
    if (result.status !== "fulfilled") {
      console.error(
        `[ShopPage] Shopify collection "${cat.handle}" failed:`,
        result.reason
      );
      productsByCategory[cat.handle] = [];
      return;
    }
    productsByCategory[cat.handle] = result.value;
    for (const p of result.value) {
      if (!seen.has(p.slug)) {
        seen.add(p.slug);
        merged.push(p);
      }
    }
  });

  return (
    <div className="min-h-screen bg-white">
      <ShopSeasonalHeader accent={theme.accent} />
      <main className="shop-main shop-main--hero pb-0">
        <ShopLanding
          products={merged}
          productsByCategory={productsByCategory}
          theme={theme}
        />
      </main>

      <ShopFooter accent={theme.accent} />
    </div>
  );
}
