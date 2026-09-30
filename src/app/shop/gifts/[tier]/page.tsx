import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getCollectionProducts, type ShopifyProduct } from "@/lib/shopify";
import { ShopPageShell } from "../../components/ShopPageShell";
import { ShopProductCard } from "../../components/ShopProductCard";
import { ScrollToTop } from "../../components/ScrollToTop";
import { ShopPasswordGate } from "../../components/ShopPasswordGate";
import { GIFT_TIERS, SHOP_CATEGORIES } from "../../shopCollections";
import { getSeasonalTheme } from "../../seasonalTheme";

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
  const theme = getSeasonalTheme();

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
    <ShopPageShell>
      <ScrollToTop />
      <ShopPasswordGate accent={theme.accent} />

      <main className="shop-page-main">
        <header className="shop-page-heading">
            <Link
              href="/shop"
              className="shop-text-link shop-page-kicker"
            >
              ← Shop
            </Link>
            <h1>
              Gifts {tier.title}
            </h1>
            <p className="mt-4 max-w-xl text-sm text-charcoal/70">
              {tier.subtitle}.
            </p>
        </header>
        <nav className="shop-collection-nav" aria-label="Gift budgets">
          {GIFT_TIERS.map(t => <Link key={t.key} href={`/shop/gifts/${t.key}`} aria-current={tierKey === t.key ? "page" : undefined}>{t.title}</Link>)}
        </nav>

        <section aria-label="Gift selection">
          {products.length === 0 ? (
            <div className="rounded-none border border-dashed border-charcoal/20 bg-cream/60 px-8 py-20 text-center">
              <p className="mx-auto max-w-md text-sm text-charcoal/60">
                No gifts in this edit right now. Explore another budget or visit the full shop.
              </p>
            </div>
          ) : (
            <div className="shop-catalog-grid">
              {products.map((p) => (
                <ShopProductCard key={p.slug} product={p} accent={theme.accent} />
              ))}
            </div>
          )}
        </section>
      </main>
    </ShopPageShell>
  );
}
