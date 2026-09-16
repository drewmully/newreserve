import type { Metadata } from "next";
import Link from "next/link";
import Image from "next/image";
import { notFound } from "next/navigation";
import { getCollectionProducts } from "@/lib/shopify";
import { ShopSeasonalHeader } from "../../components/ShopSeasonalHeader";
import { ShopProductCard } from "../../components/ShopProductCard";
import { ScrollToTop } from "../../components/ScrollToTop";
import { ShopPasswordGate } from "../../components/ShopPasswordGate";
import { ShopFooter } from "../../components/ShopFooter";
import { SHOP_CATEGORIES, SHOP_CATEGORY_HANDLES } from "../../shopCollections";
import { getSeasonalTheme } from "../../seasonalTheme";

export const revalidate = 3600;

interface Props {
  params: Promise<{ handle: string }>;
}

const SHOP_ALL_HANDLE = "shop-all";
const CATEGORY_HANDLE_SET = new Set<string>([
  ...Object.values(SHOP_CATEGORY_HANDLES),
  SHOP_ALL_HANDLE,
]);

export async function generateStaticParams() {
  return [...Object.values(SHOP_CATEGORY_HANDLES), SHOP_ALL_HANDLE].map(
    (handle) => ({ handle })
  );
}

const SHOP_ALL_META = {
  key: "all" as const,
  label: "Shop All",
  handle: SHOP_ALL_HANDLE,
  eyebrow: "Every piece, one grid",
  detail: "The whole shop, sorted newest first.",
};

/**
 * Editorial interstitial cards inserted between product rows.
 * Rotates through a short library so different collections feel distinct.
 * All images are Unsplash CDN URLs already whitelisted in next.config.ts
 * remotePatterns (source.unsplash.com and images.unsplash.com).
 */
const INTERSTITIALS = [
  {
    eyebrow: "Style Tip",
    headline: "The layering rule",
    body: "One base you can sweat in, one mid you can zip up, one outer you can throw off at the turn. Everything else is season.",
    image:
      "https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?auto=format&fit=crop&w=1200&q=70",
    imageAlt: "Layered fall menswear",
  },
  {
    eyebrow: "The Case For",
    headline: "Fewer, better pieces",
    body: "The best-dressed guy in your foursome owns three quarter-zips. Not thirty. Rotate the same great fabrics until you feel guilty, then repeat.",
    image:
      "https://images.unsplash.com/photo-1622519407650-3df9883f76a5?auto=format&fit=crop&w=1200&q=70",
    imageAlt: "Neatly folded golf apparel",
  },
  {
    eyebrow: "From The Editors",
    headline: "The 6 a.m. tee time uniform",
    body: "Merino base, brushed mid-layer, packable shell. Coffee. A hat. That is the entire list for the coldest round you will play this year.",
    image:
      "https://images.unsplash.com/photo-1508098682722-e99c43a406b2?auto=format&fit=crop&w=1200&q=70",
    imageAlt: "Foggy dawn golf course",
  },
];

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { handle } = await params;
  const cat =
    handle === SHOP_ALL_HANDLE
      ? SHOP_ALL_META
      : SHOP_CATEGORIES.find((c) => c.handle === handle);
  return {
    title: cat ? `${cat.label} | Mully Shop` : "Shop | Mully",
    description: cat?.detail ?? "Curated golf apparel and equipment from Mully.",
  };
}

export default async function ShopCollectionPage({ params }: Props) {
  const { handle } = await params;
  if (!CATEGORY_HANDLE_SET.has(handle)) notFound();

  const cat =
    handle === SHOP_ALL_HANDLE
      ? SHOP_ALL_META
      : SHOP_CATEGORIES.find((c) => c.handle === handle)!;
  const theme = getSeasonalTheme();

  let products = [] as Awaited<ReturnType<typeof getCollectionProducts>>;
  try {
    products = await getCollectionProducts(handle);
  } catch (err) {
    console.error(`[/shop/collection/${handle}] Shopify fetch failed:`, err);
  }

  // Build a flat list of items — products with editorial cards inserted every 4.
  type GridItem =
    | { kind: "product"; product: (typeof products)[number] }
    | {
        kind: "editorial";
        card: (typeof INTERSTITIALS)[number];
      };

  const gridItems: GridItem[] = [];
  products.forEach((p, i) => {
    gridItems.push({ kind: "product", product: p });
    // After every 4 products, insert an editorial card (but not at the very end).
    if ((i + 1) % 4 === 0 && i !== products.length - 1) {
      const card = INTERSTITIALS[Math.floor(i / 4) % INTERSTITIALS.length];
      gridItems.push({ kind: "editorial", card });
    }
  });

  return (
    <div className="min-h-screen bg-white">
      <ShopSeasonalHeader accent={theme.accent} />
      <ScrollToTop />
      <ShopPasswordGate accent={theme.accent} />

      <main className="shop-main pb-24">
        <section className="border-b border-charcoal/10">
          <div className="mx-auto max-w-7xl px-6 py-6 md:px-12">
            <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.2em] text-charcoal/50">
              <Link href="/shop" className="transition-colors hover:text-charcoal">
                Shop
              </Link>
              <span>/</span>
              <span className="text-charcoal/70">{cat.label}</span>
            </div>
          </div>
        </section>

        <section className="border-b border-charcoal/10">
          <div className="mx-auto max-w-7xl px-6 py-14 md:px-12 md:py-20">
            <div
              className="text-[10px] font-mono uppercase tracking-[0.28em]"
              style={{ color: theme.accent }}
            >
              {cat.eyebrow}
            </div>
            <h1 className="mt-3 font-serif text-4xl tracking-tight text-charcoal sm:text-6xl">
              {cat.label}
            </h1>
            <p className="mt-4 max-w-xl text-sm text-charcoal/70">{cat.detail}</p>
          </div>
        </section>

        {/* Category filter strip — quick lateral navigation */}
        <section className="border-b border-charcoal/10 bg-cream/40">
          <div className="mx-auto flex max-w-7xl flex-wrap gap-x-6 gap-y-2 overflow-x-auto px-6 py-4 md:px-12">
            <Link
              href="/shop/collection/shop-all"
              className={`text-[11px] font-mono uppercase tracking-[0.2em] transition-colors hover:text-charcoal ${
                handle === SHOP_ALL_HANDLE
                  ? "text-charcoal"
                  : "text-charcoal/50"
              }`}
            >
              All
            </Link>
            {SHOP_CATEGORIES.map((c) => (
              <Link
                key={c.handle}
                href={`/shop/collection/${c.handle}`}
                className={`text-[11px] font-mono uppercase tracking-[0.2em] transition-colors hover:text-charcoal ${
                  handle === c.handle ? "text-charcoal" : "text-charcoal/50"
                }`}
              >
                {c.label}
              </Link>
            ))}
          </div>
        </section>

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
              {gridItems.map((item, idx) =>
                item.kind === "product" ? (
                  <ShopProductCard
                    key={`p-${item.product.slug}`}
                    product={item.product}
                    accent={theme.accent}
                  />
                ) : (
                  <div
                    key={`e-${idx}`}
                    className="col-span-2 flex flex-col overflow-hidden border border-charcoal/10 bg-cream md:flex-row lg:col-span-4"
                  >
                    <div className="relative h-56 w-full md:h-auto md:w-1/2">
                      <Image
                        src={item.card.image}
                        alt={item.card.imageAlt}
                        fill
                        sizes="(max-width: 768px) 100vw, 50vw"
                        className="object-cover"
                      />
                    </div>
                    <div className="flex flex-1 flex-col justify-center gap-4 px-8 py-10 md:px-12">
                      <div
                        className="text-[10px] font-mono uppercase tracking-[0.28em]"
                        style={{ color: theme.accent }}
                      >
                        {item.card.eyebrow}
                      </div>
                      <h3 className="font-serif text-2xl leading-tight tracking-tight text-charcoal md:text-3xl">
                        {item.card.headline}
                      </h3>
                      <p className="max-w-md text-sm leading-relaxed text-charcoal/70">
                        {item.card.body}
                      </p>
                    </div>
                  </div>
                )
              )}
            </div>
          )}
        </section>
      </main>

      <ShopFooter accent={theme.accent} />
    </div>
  );
}
