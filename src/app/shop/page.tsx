import type { Metadata } from "next";
import Link from "next/link";
import {
  getCollectionProducts,
  type ShopifyProduct,
} from "@/lib/shopify";
import { ShopHeader } from "../components/ShopHeader";
import { ShopLanding } from "./components/ShopLanding";
import { SHOP_CATEGORIES } from "./shopCollections";

export const metadata: Metadata = {
  title: "Shop | Mully",
  description:
    "Fall 2026 Styling Edit. Layers for the 6 a.m. tee time, the range, and the seat at the bar after — curated by Mully.",
};

// Revalidate ISR every hour so new products / tag changes surface without a redeploy.
export const revalidate = 3600;

export default async function ShopPage() {
  // Fetch each of the six category collections independently so one 404 or
  // Shopify hiccup doesn't blank the entire landing page.
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
    // Merge for the Fall Edit grid, deduped by slug. Collection order in
    // SHOP_CATEGORIES governs tie-breaking — Tops first, Accessories last.
    for (const p of result.value) {
      if (!seen.has(p.slug)) {
        seen.add(p.slug);
        merged.push(p);
      }
    }
  });

  return (
    <div className="min-h-screen bg-bone">
      <ShopHeader />
      <main className="shop-main pb-0">
        <ShopLanding products={merged} productsByCategory={productsByCategory} />
      </main>

      {/* Footer — matches the pre-existing /shop chrome. */}
      <footer className="bg-forest px-6 py-10 md:px-12">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <span className="flex items-center gap-2 text-bone">
            <svg
              viewBox="0 0 1002 540"
              fill="currentColor"
              className="h-4 w-auto"
              aria-hidden="true"
            >
              <path
                d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z"
                fillRule="evenodd"
              />
            </svg>
            <span className="font-serif text-xl font-bold tracking-wide">
              mully.
            </span>
          </span>
          <div className="flex items-center gap-8">
            <Link
              href="/policies/terms"
              className="text-sm text-bone/50 transition-colors duration-300 hover:text-bone"
            >
              Terms
            </Link>
            <Link
              href="/policies/privacy"
              className="text-sm text-bone/50 transition-colors duration-300 hover:text-bone"
            >
              Privacy
            </Link>
            <Link
              href="/faq"
              className="text-sm text-bone/50 transition-colors duration-300 hover:text-bone"
            >
              FAQ
            </Link>
          </div>
          <p className="text-xs text-bone/30">
            &copy; {new Date().getFullYear()} Mully Group, Inc.
          </p>
        </div>
      </footer>
    </div>
  );
}
