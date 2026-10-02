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
import { getAllPublishedPosts } from "@/app/blog/posts";

export const metadata: Metadata = {
  title: "Shop | mully.",
  description:
    "Golf apparel and gear, selected by Mully. Shop individual pieces, build an outfit, and discover the stories behind our picks.",
};

// ISR one hour — collection contents, product tags, and seasonal
// theme swaps all refresh on the same cadence.
export const revalidate = 3600;

export default async function ShopPage() {
  const theme = getSeasonalTheme();

  // Fetch each category collection independently so one 404 doesn't blank
  // the whole landing.
  const [editResult, ...settled] = await Promise.allSettled([
    getCollectionProducts("shop-all"),
    ...SHOP_CATEGORIES.map(({ handle }) => getCollectionProducts(handle)),
  ]);
  // The Edit and Shop All share Shopify's collection-default order.
  // Keep category data separate for the outfit builder and other sections.
  const editProducts = editResult.status === "fulfilled" ? editResult.value : [];
  if (editResult.status === "rejected") {
    console.error('[ShopPage] Shopify collection "shop-all" failed:', editResult.reason);
  }

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
  const articleOrder = ["golf-quarter-zip-vs-hoodie", "best-golf-polos-2026-quiet-golf-rhone", "best-golf-belt-2026-braided-leather-stretch"];
  const journalPosts = (await getAllPublishedPosts().catch(() => []))
    .filter(p => ["Gear", "Travel", "Guides"].includes(p.category))
    .sort((a, b) => {
      const rank = (slug: string) => articleOrder.includes(slug) ? articleOrder.indexOf(slug) : 100;
      return rank(a.slug) - rank(b.slug);
    }).slice(0, 3)
    .map(({slug, title, excerpt, image, imageAlt}) => ({slug, title, excerpt, image, imageAlt}));

  return (
    <div className="min-h-screen bg-white">
      <ShopSeasonalHeader accent={theme.accent} />
      <main className="shop-main shop-main--hero pb-0">
        <ShopLanding
          products={merged}
          editProducts={editProducts}
          productsByCategory={productsByCategory}
          theme={theme}
          journalPosts={journalPosts}
        />
      </main>

      <ShopFooter accent={theme.accent} />
    </div>
  );
}
