import type { Metadata } from "next";
import Link from "next/link";
import {
  getCollectionProducts,
  type ShopifyProduct,
} from "@/lib/shopify";
import { ShopSeasonalHeader } from "./components/ShopSeasonalHeader";
import { ShopLanding } from "./components/ShopLanding";
import { MullyWordmark } from "./components/MullyWordmark";
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
      <main className="shop-main pb-0">
        <ShopLanding
          products={merged}
          productsByCategory={productsByCategory}
          theme={theme}
        />
      </main>

      {/* Shop-branded footer, dissociated from the main site's forest green. */}
      <footer className="border-t border-charcoal/10 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-6 py-12 md:flex-row md:items-center md:justify-between md:px-12">
          <MullyWordmark accent={theme.accent} className="text-3xl" />
          <div className="flex flex-wrap items-center gap-8">
            <Link
              href="/policies/terms"
              className="text-xs font-mono uppercase tracking-[0.2em] text-charcoal/50 transition-colors hover:text-charcoal"
            >
              Terms
            </Link>
            <Link
              href="/policies/privacy"
              className="text-xs font-mono uppercase tracking-[0.2em] text-charcoal/50 transition-colors hover:text-charcoal"
            >
              Privacy
            </Link>
            <Link
              href="/faq"
              className="text-xs font-mono uppercase tracking-[0.2em] text-charcoal/50 transition-colors hover:text-charcoal"
            >
              FAQ
            </Link>
            <Link
              href="/"
              className="text-xs font-mono uppercase tracking-[0.2em] text-charcoal/50 transition-colors hover:text-charcoal"
            >
              mymully.com
            </Link>
          </div>
          <p className="text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/40">
            &copy; {new Date().getFullYear()} Mully Group, Inc.
          </p>
        </div>
      </footer>
    </div>
  );
}
