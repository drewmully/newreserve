import type { Metadata } from "next";
import Link from "next/link";
import {
  getCollectionProducts,
  mergeCollectionProductsBySlug,
  PRIVATE_RELEASES_COLLECTION_HANDLE,
  PRO_SHOP_COLLECTION_HANDLE,
} from "@/lib/shopify";
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
  // Fetch collections independently so one failure doesn't hide the other.
  const catalogCollections = [
    { label: "pro-shop", handle: PRO_SHOP_COLLECTION_HANDLE },
    { label: "private-releases", handle: PRIVATE_RELEASES_COLLECTION_HANDLE },
  ] as const;

  const settled = await Promise.allSettled(
    catalogCollections.map(({ handle }) => getCollectionProducts(handle))
  );

  const successfulCollections: Array<{
    handle: string;
    products: Awaited<ReturnType<typeof getCollectionProducts>>;
  }> = [];

  settled.forEach((result, index) => {
    const entry = catalogCollections[index];
    if (result.status === "fulfilled") {
      successfulCollections.push({
        handle: entry.handle,
        products: result.value,
      });
      return;
    }

    console.error(
      `[ShopPage] Shopify collection "${entry.label}" failed:`,
      result.reason
    );
  });

  const products = mergeCollectionProductsBySlug(successfulCollections);

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
            sourceContext="public-shop"
            privateReleasesHandle={PRIVATE_RELEASES_COLLECTION_HANDLE}
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
            <Link
              href="/returns"
              className="text-sm text-bone/50 hover:text-bone transition-colors duration-300"
            >
              Returns
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
