import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";

import { FEATURED_DROP } from "@/lib/dropConfig";
import { getProductByHandle } from "@/lib/shopify";
import { buildShopDisplayProducts } from "@/lib/shopDisplay";
import { ShopHeader } from "../../components/ShopHeader";

// Revalidate ISR every hour
export const revalidate = 3600;

interface Props {
  params: Promise<{ slug: string }>;
}

export async function generateStaticParams() {
  return [{ slug: FEATURED_DROP.slug }];
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { slug } = await params;
  if (slug !== FEATURED_DROP.slug) return {};
  return {
    title: `${FEATURED_DROP.number} · ${FEATURED_DROP.brand} | Mully Reserve`,
    description: FEATURED_DROP.subhead,
    openGraph: {
      title: `${FEATURED_DROP.number} · ${FEATURED_DROP.brand}`,
      description: FEATURED_DROP.subhead,
      images: [FEATURED_DROP.image],
    },
  };
}

export default async function DropLandingPage({ params }: Props) {
  const { slug } = await params;

  // Only Drop 001 is configured today. Future drops can be looked up here.
  if (slug !== FEATURED_DROP.slug) notFound();

  let product;
  try {
    product = await getProductByHandle(FEATURED_DROP.productHandle);
  } catch (err) {
    console.error("[DropLandingPage] Shopify fetch failed:", err);
    notFound();
  }
  if (!product) notFound();

  // Split the product into one display "card" per color.
  const colorCards = buildShopDisplayProducts([product]).filter(
    (card) => card.cardColor
  );

  const podcast = FEATURED_DROP.podcast;

  return (
    <div className="min-h-screen bg-bone">
      <ShopHeader />

      <main className="pb-24">
        {/* ─── HERO ──────────────────────────────────────────────── */}
        <section className="relative overflow-hidden topo-pattern-dark">
          <div className="absolute inset-0 hero-grain opacity-30 pointer-events-none" />
          <div className="relative z-10 max-w-6xl mx-auto px-6 md:px-12 pt-10 md:pt-16 pb-12 md:pb-16">
            <Link
              href="/shop"
              className="inline-flex items-center gap-2 text-xs tracking-[0.25em] uppercase text-bone/55 hover:text-bone transition-colors mb-8"
            >
              <svg
                className="w-3.5 h-3.5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18"
                />
              </svg>
              Back to Reserve
            </Link>

            <div className="grid md:grid-cols-2 gap-10 md:gap-14 items-center">
              <div>
                <span className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-bone/10 border border-bone/15 text-[10px] tracking-[0.35em] uppercase text-bone font-medium mb-5">
                  <span className="w-2 h-2 rounded-full bg-ember animate-pulse" />
                  {FEATURED_DROP.number} · Live Now
                </span>
                <p className="text-xs tracking-[0.25em] uppercase text-sage font-medium mb-3">
                  {FEATURED_DROP.brand}
                </p>
                <h1 className="font-serif text-3xl md:text-5xl text-bone leading-[1.05] mb-5">
                  {FEATURED_DROP.headline}
                </h1>
                <p className="text-base md:text-lg text-bone/65 leading-relaxed mb-7 max-w-md">
                  {FEATURED_DROP.subhead}
                </p>

                <div className="flex items-baseline gap-3 mb-7">
                  <span className="font-serif text-2xl md:text-3xl text-bone font-medium">
                    ${FEATURED_DROP.memberPrice}
                  </span>
                  <span className="text-sm text-bone/40 line-through">
                    ${FEATURED_DROP.retailPrice}
                  </span>
                  <span className="text-[10px] tracking-[0.25em] uppercase text-sage font-medium">
                    Member Price
                  </span>
                </div>

                <div className="flex flex-wrap gap-3">
                  <a
                    href="#colors"
                    className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-bone text-forest text-xs font-medium tracking-wide hover:bg-cream transition-colors btn-press"
                  >
                    Shop the Colorways
                    <svg
                      className="w-3.5 h-3.5"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        d="M19.5 13.5L12 21m0 0l-7.5-7.5M12 21V3"
                      />
                    </svg>
                  </a>
                  {podcast && (
                    <a
                      href="#podcast"
                      className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-bone/25 text-bone text-xs font-medium tracking-wide hover:bg-bone/10 transition-colors btn-press"
                    >
                      Listen to the Story
                    </a>
                  )}
                </div>
              </div>

              <div className="relative aspect-[4/5] md:aspect-square w-full rounded-2xl overflow-hidden bg-bone/5 shadow-2xl">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={FEATURED_DROP.image}
                  alt={FEATURED_DROP.productName}
                  className="w-full h-full object-cover"
                />
              </div>
            </div>
          </div>
        </section>

        {/* ─── COLOR GRID ────────────────────────────────────────── */}
        <section
          id="colors"
          className="max-w-6xl mx-auto px-6 md:px-12 py-14 md:py-20"
        >
          <div className="mb-10 md:mb-12 text-center">
            <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-3">
              <span className="w-6 h-px bg-sage/50" />
              Three Colorways
              <span className="w-6 h-px bg-sage/50" />
            </span>
            <h2 className="font-serif text-2xl md:text-4xl text-obsidian leading-tight">
              Pick your shade.
            </h2>
            <p className="mt-3 text-sm md:text-base text-charcoal/55 max-w-lg mx-auto">
              Same fabric. Same fit. Three distinct moods — each in a limited run.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-5 md:gap-7">
            {colorCards.map((card) => {
              const href = card.preferredVariantId
                ? `/shop/${FEATURED_DROP.productHandle}?variant=${encodeURIComponent(
                    card.preferredVariantId
                  )}&from=drops-001`
                : `/shop/${FEATURED_DROP.productHandle}?from=drops-001`;

              return (
                <Link
                  key={card.displayKey}
                  href={href}
                  className="group relative block rounded-2xl overflow-hidden bg-cream card-hover"
                >
                  <div className="relative aspect-[4/5] w-full overflow-hidden bg-bone">
                    {card.cardImage ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={card.cardImage}
                        alt={`${card.name} — ${card.cardColor}`}
                        className="w-full h-full object-cover transition-transform duration-700 group-hover:scale-[1.04]"
                      />
                    ) : (
                      <div className="w-full h-full bg-taupe/20" />
                    )}
                    <span className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-bone/95 text-forest text-[10px] font-bold tracking-[0.2em] uppercase">
                      {FEATURED_DROP.number}
                    </span>
                  </div>

                  <div className="px-5 py-5 flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[10px] tracking-[0.25em] uppercase text-sage font-medium mb-1">
                        {card.brand}
                      </p>
                      <p className="font-serif text-lg text-obsidian leading-snug truncate">
                        {card.cardColor}
                      </p>
                    </div>
                    <span className="inline-flex items-center gap-1.5 text-xs text-forest font-medium tracking-wide whitespace-nowrap group-hover:gap-2 transition-all">
                      Shop
                      <svg
                        className="w-3.5 h-3.5"
                        fill="none"
                        viewBox="0 0 24 24"
                        stroke="currentColor"
                        strokeWidth={2}
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          d="M13.5 4.5L21 12m0 0l-7.5 7.5M21 12H3"
                        />
                      </svg>
                    </span>
                  </div>
                </Link>
              );
            })}
          </div>
        </section>

        {/* ─── BRAND STORY ───────────────────────────────────────── */}
        {product.aboutBrand && (
          <section className="max-w-3xl mx-auto px-6 md:px-12 pb-14 md:pb-20">
            <div className="rounded-2xl bg-cream/60 border border-taupe/20 p-7 md:p-10">
              <p className="text-[10px] tracking-[0.35em] uppercase text-sage font-medium mb-3">
                About the Brand
              </p>
              <h3 className="font-serif text-2xl md:text-3xl text-obsidian leading-tight mb-4">
                The story behind {FEATURED_DROP.brand}
              </h3>
              <p className="text-sm md:text-base text-charcoal/70 leading-relaxed whitespace-pre-line">
                {product.aboutBrand}
              </p>
            </div>
          </section>
        )}

        {/* ─── PODCAST ───────────────────────────────────────────── */}
        {podcast && (
          <section
            id="podcast"
            className="relative overflow-hidden topo-pattern-dark"
          >
            <div className="absolute inset-0 hero-grain opacity-25 pointer-events-none" />
            <div className="relative z-10 max-w-5xl mx-auto px-6 md:px-12 py-14 md:py-20">
              <div className="text-center mb-8 md:mb-10">
                <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-3">
                  <span className="w-6 h-px bg-sage/40" />
                  Listen In
                  <span className="w-6 h-px bg-sage/40" />
                </span>
                <h3 className="font-serif text-2xl md:text-4xl text-bone leading-tight mb-3">
                  {podcast.title}
                </h3>
                {podcast.blurb && (
                  <p className="text-sm md:text-base text-bone/60 max-w-2xl mx-auto leading-relaxed">
                    {podcast.blurb}
                  </p>
                )}
              </div>

              <div className="relative w-full aspect-video rounded-2xl overflow-hidden bg-obsidian shadow-2xl ring-1 ring-bone/10">
                <iframe
                  src={`https://www.youtube-nocookie.com/embed/${podcast.youtubeId}?rel=0&modestbranding=1`}
                  title={podcast.title}
                  loading="lazy"
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                  allowFullScreen
                  className="absolute inset-0 w-full h-full"
                />
              </div>

              <div className="mt-8 text-center">
                <a
                  href="#colors"
                  className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full bg-bone text-forest text-xs font-medium tracking-wide hover:bg-cream transition-colors btn-press"
                >
                  Back to the Colorways
                </a>
              </div>
            </div>
          </section>
        )}

        {/* ─── FOOTER CTA ────────────────────────────────────────── */}
        <section className="max-w-3xl mx-auto px-6 md:px-12 pt-14 md:pt-20 text-center">
          <p className="text-[10px] tracking-[0.35em] uppercase text-sage font-medium mb-3">
            Limited Run
          </p>
          <h3 className="font-serif text-2xl md:text-3xl text-obsidian leading-tight mb-4">
            Once they&rsquo;re gone, they&rsquo;re gone.
          </h3>
          <p className="text-sm md:text-base text-charcoal/55 leading-relaxed mb-7 max-w-md mx-auto">
            Drop 001 is a small-batch release built for Reserve members. Shop a
            colorway above, or head back to the shop.
          </p>
          <Link
            href="/shop"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-full border border-forest/20 text-forest text-xs font-medium tracking-wide hover:bg-forest/5 transition-colors btn-press"
          >
            Browse Mully Reserve
          </Link>
        </section>
      </main>
    </div>
  );
}
