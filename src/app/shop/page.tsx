import type { Metadata } from "next";
import Link from "next/link";
import { getCollectionProducts } from "@/lib/shopify";
import { BRAND_INFO, COLLECTION_INFO } from "./products";
import { ShopGrid } from "./components/ShopClient";
import { ShopHeader } from "../components/ShopHeader";

export const metadata: Metadata = {
  title: "Shop | Mully Reserve",
  description:
    "Curated golf products from the best brands at Reserve pricing.",
};

// Revalidate ISR every hour
export const revalidate = 3600;

export default async function ShopPage() {
  // Fetch from both collections; merge + deduplicate by slug
  let products: Awaited<ReturnType<typeof getCollectionProducts>> = [];

  try {
    const [proShop, privateReleases] = await Promise.all([
      getCollectionProducts("reserve-pro-shop"),
      getCollectionProducts("private-releases"),
    ]);

    const seen = new Set<string>();
    for (const p of [...proShop, ...privateReleases]) {
      if (!seen.has(p.slug)) {
        seen.add(p.slug);
        products.push(p);
      }
    }
  } catch (err) {
    console.error("[ShopPage] Shopify fetch failed:", err);
    // Render empty grid rather than 500
  }

  // Derive filter lists from live products
  const brands = [...new Set(products.map((p) => p.brand))];
  const collections = [...new Set(products.map((p) => p.collection))];

  // Keep only brands/collections that have a curated info card
  const knownBrands = brands.filter((b) => b in BRAND_INFO);
  const knownCollections = collections.filter((c) => c in COLLECTION_INFO);

  return (
    <div className="min-h-screen bg-bone">
      {/* ─── HEADER ─── */}
      <ShopHeader />

      {/* ─── PAGE CONTENT ─── */}
      <main className="pt-24 pb-24 px-6 md:px-12">
        <div className="max-w-7xl mx-auto">
          <ShopGrid
            products={products}
            brands={knownBrands.length > 0 ? knownBrands : brands}
            collections={
              knownCollections.length > 0 ? knownCollections : collections
            }
          />
        </div>
      </main>

      {/* ─── FOOTER ─── */}
      <footer className="py-10 px-6 md:px-12 bg-forest">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
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
              className="text-sm text-bone/50 hover:text-bone transition-colors duration-300"
            >
              Terms
            </Link>
            <Link
              href="/policies/privacy"
              className="text-sm text-bone/50 hover:text-bone transition-colors duration-300"
            >
              Privacy
            </Link>
            <Link
              href="/faq"
              className="text-sm text-bone/50 hover:text-bone transition-colors duration-300"
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
