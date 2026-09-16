import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCollectionProducts } from "@/lib/shopify";
import { ShopHeader } from "../../../components/ShopHeader";
import { ShopProductCard } from "../../components/ShopProductCard";
import { ScrollToTop } from "../../components/ScrollToTop";
import { SHOP_CATEGORIES, SHOP_CATEGORY_HANDLES } from "../../shopCollections";

export const revalidate = 3600;

interface Props {
  params: Promise<{ handle: string }>;
}

const CATEGORY_HANDLE_SET = new Set<string>(Object.values(SHOP_CATEGORY_HANDLES));

export async function generateStaticParams() {
  return Object.values(SHOP_CATEGORY_HANDLES).map((handle) => ({ handle }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const cat = SHOP_CATEGORIES.find((c) => c.handle === handle);
  return {
    title: cat ? `${cat.label} | Mully Shop` : "Shop | Mully",
    description: cat?.detail ?? "Curated golf apparel and equipment from Mully.",
  };
}

export default async function ShopCollectionPage({ params }: Props) {
  const { handle } = await params;

  // Only accept known Mully shop category handles — otherwise 404.
  if (!CATEGORY_HANDLE_SET.has(handle)) notFound();

  const cat = SHOP_CATEGORIES.find((c) => c.handle === handle)!;

  let products = [] as Awaited<ReturnType<typeof getCollectionProducts>>;
  try {
    products = await getCollectionProducts(handle);
  } catch (err) {
    console.error(`[/shop/collection/${handle}] Shopify fetch failed:`, err);
  }

  return (
    <div className="min-h-screen bg-bone">
      <ShopHeader />
      <ScrollToTop />

      <main className="shop-main pb-24">
        {/* Header band */}
        <section className="border-b border-charcoal/10 bg-cream">
          <div className="mx-auto max-w-7xl px-6 py-12 md:px-12 md:py-16">
            <Link
              href="/shop"
              className="text-[11px] font-mono uppercase tracking-[0.2em] text-charcoal/50 transition-colors hover:text-forest"
            >
              ← Shop
            </Link>
            <div className="mt-4 text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/50">
              {cat.eyebrow}
            </div>
            <h1 className="mt-2 font-serif text-4xl tracking-tight text-forest sm:text-6xl">
              {cat.label}
            </h1>
            <p className="mt-4 max-w-xl text-sm text-charcoal/70">
              {cat.detail}
            </p>
          </div>
        </section>

        {/* Grid */}
        <section className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-20">
          {products.length === 0 ? (
            <div className="rounded-none border border-dashed border-charcoal/20 bg-cream/60 px-8 py-20 text-center">
              <p className="mx-auto max-w-md text-sm text-charcoal/60">
                Nothing in {cat.label.toLowerCase()} yet. New pieces drop into
                this collection from Shopify Admin — check back soon.
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 md:gap-x-8 lg:grid-cols-4">
              {products.map((p) => (
                <ShopProductCard key={p.slug} product={p} />
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}
