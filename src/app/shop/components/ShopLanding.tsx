"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { ScrollToTop } from "./ScrollToTop";
import { ShopProductCard } from "./ShopProductCard";
import { ShopPasswordGate } from "./ShopPasswordGate";
import { SHOP_CATEGORIES, GIFT_TIERS } from "../shopCollections";
import type { SeasonalTheme } from "../seasonalTheme";
import type { ShopifyProduct } from "@/lib/shopify";

interface Props {
  products: ShopifyProduct[];
  productsByCategory: Record<string, ShopifyProduct[]>;
  theme: SeasonalTheme;
}

/**
 * /shop landing — commerce-first, seasonally themed, white-primary.
 *
 * Sections:
 *  1. Hero (dark image + white cutout eyebrow, seasonal accent on line 2)
 *  2. Category intent row (six tiles, white bg, cream borders)
 *  3. Fall Edit — 8 newest across the six collections
 *  4. The Layering Guide — 8 numbered outfits, palette swatches, homage
 *     to a third-party fall layering guide but reworked around Mully's
 *     product mix and the seasonal theme system
 *  5. Gift tier cards
 *  6. Trust strip
 */
export function ShopLanding({ products, productsByCategory, theme }: Props) {
  const fallEdit = useMemo(() => products.slice(0, 8), [products]);

  const giftProducts = useMemo(() => {
    const buckets: Record<string, ShopifyProduct[]> = {};
    for (const tier of GIFT_TIERS) {
      buckets[tier.key] = products.filter((p) =>
        p.tags?.some((t) => t.toLowerCase() === tier.tag)
      );
    }
    return buckets;
  }, [products]);

  return (
    <>
      <ScrollToTop />
      <ShopPasswordGate accent={theme.accent} />

      {/* ═══ HERO ═══ */}
      <section className="relative">
        <div
          className="relative h-[calc(100vh-4rem)] min-h-[560px] w-full overflow-hidden"
          style={{ backgroundColor: theme.heroOverlay }}
        >
          <Image
            src={theme.heroImage}
            alt="Dawn light on a fairway framed by mature trees and bunkers"
            fill
            priority
            sizes="100vw"
            className="object-cover object-center opacity-90"
          />
          <div
            className="absolute inset-0"
            style={{
              background: `linear-gradient(to right, ${theme.heroOverlay}CC 0%, ${theme.heroOverlay}55 45%, transparent 80%)`,
            }}
          />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/50 to-transparent" />

          <div className="relative z-10 mx-auto flex h-full max-w-7xl flex-col justify-end px-6 pb-16 md:px-12 md:pb-24">
            <div className="mb-5 inline-flex w-fit items-center gap-2 border border-white/25 bg-white/5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-white backdrop-blur">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: theme.accent }}
              />
              {theme.eyebrow}
            </div>
            <h1 className="max-w-4xl font-serif text-5xl leading-[0.98] tracking-tight text-white sm:text-6xl md:text-7xl lg:text-[5.5rem]">
              {theme.headline[0]}
              <br />
              <span style={{ color: theme.accent }}>{theme.headline[1]}</span>
            </h1>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="#fall-edit"
                className="inline-flex h-11 items-center gap-2 px-6 text-xs font-semibold uppercase tracking-[0.2em] text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: theme.accent }}
              >
                Shop the Edit
                <ArrowUpRight />
              </Link>
              <Link
                href="#layering-guide"
                className="inline-flex h-11 items-center gap-2 border bg-transparent px-6 text-xs font-semibold uppercase tracking-[0.2em] text-white transition-colors hover:bg-white/10"
                style={{ borderColor: "rgba(255,255,255,0.4)" }}
              >
                The Layering Guide
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ CATEGORY INTENT ROW ═══ */}
      <section className="border-b border-charcoal/10 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-y divide-charcoal/10 md:grid-cols-3 md:divide-y-0 lg:grid-cols-6">
          {SHOP_CATEGORIES.map((cat) => {
            const count = productsByCategory[cat.handle]?.length ?? 0;
            return (
              <Link
                key={cat.handle}
                href={`/shop/collection/${cat.handle}`}
                className="group flex flex-col justify-between gap-8 px-5 py-8 transition-colors hover:bg-cream sm:px-6 sm:py-10"
                data-testid={`shop-intent-${cat.key}`}
              >
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/50">
                  {cat.eyebrow}
                </div>
                <div>
                  <div className="flex items-end justify-between gap-2">
                    <span className="font-serif text-2xl tracking-tight text-charcoal sm:text-3xl">
                      {cat.label}
                    </span>
                    <ArrowUpRight
                      className="text-charcoal/40 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                      style={{ color: undefined }}
                    />
                  </div>
                  <p className="mt-3 hidden text-xs text-charcoal/60 lg:block">
                    {cat.detail}
                  </p>
                  {count > 0 && (
                    <p className="mt-2 text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/40">
                      {count} {count === 1 ? "piece" : "pieces"}
                    </p>
                  )}
                </div>
              </Link>
            );
          })}
        </div>
      </section>

      {/* ═══ FALL EDIT ═══ */}
      <section id="fall-edit" className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-24">
          <div className="mb-10 flex items-end justify-between gap-6">
            <div>
              <div
                className="text-[10px] font-mono uppercase tracking-[0.2em]"
                style={{ color: theme.accent }}
              >
                The {theme.season} Edit · {new Date().getFullYear()}
              </div>
              <h2 className="mt-2 font-serif text-3xl tracking-tight text-charcoal sm:text-5xl">
                Every piece, hand-picked.
              </h2>
              <p className="mt-4 max-w-xl text-sm text-charcoal/70">
                A season of layers built for the 6 a.m. tee time, the range
                session at lunch, and the seat at the bar after.
              </p>
            </div>
            <Link
              href="/shop/collection/shop-outerwear"
              className="hidden text-xs font-semibold uppercase tracking-[0.2em] text-charcoal/70 transition-colors hover:text-charcoal sm:inline-flex sm:items-center sm:gap-1"
            >
              View all <ArrowUpRight />
            </Link>
          </div>

          {fallEdit.length === 0 ? (
            <EmptyState message="Products land here as we add them in Shopify. Any product in Shop — Tops, Bottoms, Outerwear, Tech, Bags, or Accessories will appear." />
          ) : (
            <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 md:gap-x-8 lg:grid-cols-4">
              {fallEdit.map((p) => (
                <ShopProductCard key={p.slug} product={p} accent={theme.accent} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ═══ THE LAYERING GUIDE ═══ */}
      <section
        id="layering-guide"
        className="border-y border-charcoal/10 bg-cream"
      >
        <div className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-24">
          <div className="mb-12 flex flex-col gap-6 md:flex-row md:items-end md:justify-between">
            <div>
              <div
                className="text-[10px] font-mono uppercase tracking-[0.2em]"
                style={{ color: theme.accent }}
              >
                The Layering Guide · No. 01
              </div>
              <h2 className="mt-2 font-serif text-3xl tracking-tight text-charcoal sm:text-5xl">
                Eight ways to dress a fall round.
              </h2>
              <p className="mt-4 max-w-xl text-sm text-charcoal/70">
                Base, mid, outer. A palette per outfit, keyed to the light
                you'll actually play in. Rotate through as the season pulls
                colder.
              </p>
            </div>
            <div className="flex flex-wrap gap-3">
              {theme.layerPalette.map((c) => (
                <div
                  key={c.hex}
                  className="flex items-center gap-2 border border-charcoal/10 bg-white px-3 py-2"
                >
                  <span
                    className="inline-block h-4 w-4 rounded-full"
                    style={{ backgroundColor: c.hex }}
                  />
                  <span className="text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/70">
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {theme.outfits.map((o) => (
              <div
                key={o.number}
                className="group flex flex-col border border-charcoal/10 bg-white transition-colors hover:border-charcoal/30"
              >
                <div className="flex h-40 flex-col overflow-hidden">
                  {o.palette.map((hex, i) => (
                    <div
                      key={i}
                      className="flex-1"
                      style={{ backgroundColor: hex }}
                    />
                  ))}
                </div>
                <div className="flex flex-1 flex-col justify-between gap-6 px-5 py-5">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span
                        className="text-[10px] font-mono uppercase tracking-[0.25em]"
                        style={{ color: theme.accent }}
                      >
                        {o.number}
                      </span>
                      <span className="border border-charcoal/15 px-2 py-0.5 text-[9px] font-mono uppercase tracking-[0.2em] text-charcoal/50">
                        {o.context === "on-course"
                          ? "On course"
                          : o.context === "clubhouse"
                            ? "Clubhouse"
                            : "Either"}
                      </span>
                    </div>
                    <div className="mt-3 font-serif text-lg tracking-tight text-charcoal">
                      {o.title}
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-1 text-[9px] font-mono uppercase tracking-[0.2em] text-charcoal/50">
                    <span>Outer</span>
                    <span>Mid</span>
                    <span>Base</span>
                  </div>
                </div>
              </div>
            ))}
          </div>

          <p className="mt-10 text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/40">
            Inspired by classic menswear layering theory, remixed for the
            course.
          </p>
        </div>
      </section>

      {/* ═══ GIFT TIERS ═══ */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-24">
          <div className="mb-10">
            <div
              className="text-[10px] font-mono uppercase tracking-[0.2em]"
              style={{ color: theme.accent }}
            >
              Shop by gift
            </div>
            <h2 className="mt-2 font-serif text-3xl tracking-tight text-charcoal sm:text-4xl">
              Find the right one.
            </h2>
          </div>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {GIFT_TIERS.map((tier) => (
              <GiftTierCard
                key={tier.key}
                title={tier.title}
                subtitle={tier.subtitle}
                accent={tier.accent}
                themeAccent={theme.accent}
                products={giftProducts[tier.key] ?? []}
                href={`/shop/gifts/${tier.key}`}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ═══ TRUST STRIP ═══ */}
      <section className="border-t border-charcoal/10 bg-cream">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 py-12 sm:grid-cols-3 md:px-12">
          {[
            { k: "Free shipping", v: "On US orders over $75" },
            { k: "Members save 15%", v: "On every piece, every order" },
            { k: "Real returns", v: "30 days, no questions" },
          ].map((item) => (
            <div key={item.k} className="flex flex-col gap-1">
              <div
                className="text-sm font-semibold uppercase tracking-[0.2em]"
                style={{ color: theme.accent }}
              >
                {item.k}
              </div>
              <div className="text-sm text-charcoal/60">{item.v}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function ArrowUpRight({
  className = "h-4 w-4",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}

function EmptyState({ message }: { message: string }) {
  return (
    <div className="border border-dashed border-charcoal/20 bg-cream/60 px-8 py-16 text-center">
      <p className="mx-auto max-w-md text-sm text-charcoal/60">{message}</p>
    </div>
  );
}

function GiftTierCard({
  title,
  subtitle,
  accent,
  themeAccent,
  products,
  href,
}: {
  title: string;
  subtitle: string;
  accent: string;
  themeAccent: string;
  products: ShopifyProduct[];
  href: string;
}) {
  const preview = products.slice(0, 2);
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden border border-charcoal/10 bg-white transition-colors hover:border-charcoal/30"
    >
      <div className="flex items-start justify-between border-b border-charcoal/10 px-5 py-4">
        <div>
          <div
            className="text-[10px] font-mono uppercase tracking-[0.2em]"
            style={{ color: themeAccent }}
          >
            {accent}
          </div>
          <div className="mt-1 font-serif text-2xl tracking-tight text-charcoal">
            {title}
          </div>
          <div className="mt-1 text-xs text-charcoal/60">{subtitle}</div>
        </div>
        <ArrowUpRight className="mt-1 h-5 w-5 text-charcoal/40 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
      <div className="grid flex-1 grid-cols-2 divide-x divide-charcoal/10">
        {preview.length === 0
          ? [0, 1].map((i) => (
              <div
                key={i}
                className="flex aspect-square items-center justify-center bg-cream text-[10px] font-mono uppercase tracking-widest text-charcoal/30"
              >
                Coming soon
              </div>
            ))
          : preview.map((p) => (
              <div key={p.slug} className="flex flex-col">
                <div className="relative aspect-square w-full bg-white">
                  {p.images[0] && (
                    <Image
                      src={p.images[0]}
                      alt={p.name}
                      fill
                      sizes="(max-width: 768px) 50vw, 20vw"
                      className="object-contain p-3"
                    />
                  )}
                </div>
                <div className="border-t border-charcoal/10 px-3 py-2">
                  <div className="truncate text-[11px] font-semibold text-charcoal">
                    {p.name}
                  </div>
                  <div className="text-[11px] font-mono text-charcoal/50">
                    ${p.price.toFixed(0)}
                  </div>
                </div>
              </div>
            ))}
      </div>
    </Link>
  );
}
