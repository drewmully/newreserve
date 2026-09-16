import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCollectionProducts, type ShopifyProduct } from "@/lib/shopify";
import { ShopHeader } from "../../../components/ShopHeader";
import { ShopProductCard } from "../../components/ShopProductCard";
import { ScrollToTop } from "../../components/ScrollToTop";
import { GIFT_TIERS, SHOP_CATEGORIES } from "../../shopCollections";

export const revalidate = 3600;

interface Props {
  params: Promise<{ tier: string }>;
}

type GiftTierKey = (typeof GIFT_TIERS)[number]["key"];
const TIER_KEYS = new Set<string>(GIFT_TIERS.map((t) => t.key));

export async function generateStaticParams() {
  return GIFT_TIERS.map((t) => ({ tier: t.key }));
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { tier } = await params;
  const t = GIFT_TIERS.find((x) => x.key === tier);
  return {
    title: t ? `Gifts ${t.title} | Mully Shop` : "Gifts | Mully Shop",
    description:
      t?.subtitle ?? "Golf gifts curated by Mully across every price point.",
  };
}

export default async function ShopGiftTierPage({ params }: Props) {
  const { tier: tierKey } = await params;
  if (!TIER_KEYS.has(tierKey)) notFound();

  const tier = GIFT_TIERS.find((t) => t.key === (tierKey as GiftTierKey))!;

  // Reuse the six category collection fetch — a gift tier is a tag filter
  // across the whole shop catalog, not its own Shopify collection. Product
  // dedupe is by slug so a piece in Tops and Outerwear only lists once.
  const settled = await Promise.allSettled(
    SHOP_CATEGORIES.map(({ handle }) => getCollectionProducts(handle))
  );
  const seen = new Set<string>();
  const merged: ShopifyProduct[] = [];
  for (const r of settled) {
    if (r.status !== "fulfilled") continue;
    for (const p of r.value) {
      if (seen.has(p.slug)) continue;
      seen.add(p.slug);
      merged.push(p);
    }
  }
  const products = merged.filter((p) =>
    p.tags?.some((t) => t.toLowerCase() === tier.tag)
  );

  return (
    <div className="min-h-screen bg-bone">
      <ShopHeader />
      <ScrollToTop />

      <main className="shop-main pb-24">
        <section className="border-b border-charcoal/10 bg-cream">
          <div className="mx-auto max-w-7xl px-6 py-12 md:px-12 md:py-16">
            <Link
              href="/shop"
              className="text-[11px] font-mono uppercase tracking-[0.2em] text-charcoal/50 transition-colors hover:text-forest"
            >
              ← Shop
            </Link>
            <div className="mt-4 text-[10px] font-mono uppercase tracking-[0.2em] text-ember">
              {tier.accent}
            </div>
            <h1 className="mt-2 font-serif text-4xl tracking-tight text-forest sm:text-6xl">
              Gifts {tier.title}
            </h1>
            <p className="mt-4 max-w-xl text-sm text-charcoal/70">
              {tier.subtitle}.
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-20">
          {products.length === 0 ? (
            <div className="rounded-none border border-dashed border-charcoal/20 bg-cream/60 px-8 py-20 text-center">
              <p className="mx-auto max-w-md text-sm text-charcoal/60">
                No products tagged{" "}
                <code className="font-mono text-xs">{tier.tag}</code> yet. Add
                the tag in Shopify Admin to include a product in this tier.
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
