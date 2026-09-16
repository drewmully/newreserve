"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { ScrollToTop } from "./ScrollToTop";
import { ShopProductCard } from "./ShopProductCard";
import { SHOP_CATEGORIES, GIFT_TIERS } from "../shopCollections";
import type { ShopifyProduct } from "@/lib/shopify";

interface Props {
  /** Every product across the six shop-* category collections, deduped. */
  products: ShopifyProduct[];
  /** Products keyed by category handle for the featured tiles. */
  productsByCategory: Record<string, ShopifyProduct[]>;
}

/**
 * /shop landing page — Mully's Fall 2026 styling edit.
 *
 * Layout ported from drewmully/v1sports-storefront (client/src/pages/home.tsx):
 * dark editorial hero, six-tile intent row, curated grid, gift tiers,
 * trust strip. Native to newreserve — reuses ShopHeader, SlideCart, and
 * MembershipContext for cart mutations.
 */
export function ShopLanding({ products, productsByCategory }: Props) {
  // Fall Edit grid — most recent 8 across every category collection.
  // Shopify sort order (CREATED_DESC on each collection) is preserved by
  // the deduped merge in the page.tsx server component.
  const fallEdit = useMemo(() => products.slice(0, 8), [products]);

  // Gift tier product previews (max 4 per tile — mini grid in the card).
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

      {/* ═══ HERO ═══ */}
      <section className="relative">
        <div className="relative h-[calc(100vh-4rem)] min-h-[560px] w-full overflow-hidden bg-forest-dark">
          <Image
            src="/shop/hero-fall-2026.jpg"
            alt="Dawn light on a fairway framed by mature trees and bunkers"
            fill
            priority
            sizes="100vw"
            className="object-cover object-center"
          />
          {/* Left-third darken for headline legibility; feather out by midway. */}
          <div className="absolute inset-0 bg-gradient-to-r from-forest-dark/80 via-forest-dark/30 to-transparent" />
          <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-forest-dark/70 to-transparent" />

          <div className="relative z-10 mx-auto flex h-full max-w-7xl flex-col justify-end px-6 pb-16 md:px-12 md:pb-24">
            <div className="mb-5 inline-flex w-fit items-center gap-2 border border-bone/25 bg-bone/5 px-3 py-1.5 text-[10px] font-mono uppercase tracking-[0.2em] text-bone backdrop-blur">
              <span className="inline-block h-1.5 w-1.5 rounded-full bg-ember" />
              Fall 2026 · The Styling Edit
            </div>
            <h1 className="max-w-4xl font-serif text-5xl leading-[0.98] tracking-tight text-bone sm:text-6xl md:text-7xl lg:text-[5.5rem]">
              Dress the round.
              <br />
              <span className="text-ember">Wear it home.</span>
            </h1>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <Link
                href="#fall-edit"
                className="inline-flex h-11 items-center gap-2 bg-ember px-6 text-xs font-semibold uppercase tracking-[0.2em] text-bone transition-colors hover:bg-ember/90"
              >
                Shop the Edit
                <ArrowUpRight />
              </Link>
              <Link
                href="/shop/collection/shop-outerwear"
                className="inline-flex h-11 items-center gap-2 border border-bone/40 bg-transparent px-6 text-xs font-semibold uppercase tracking-[0.2em] text-bone transition-colors hover:bg-bone/10"
              >
                Outerwear
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ SHOP BY CATEGORY (6-tile intent row) ═══ */}
      <section className="border-y border-charcoal/10 bg-cream">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-y divide-charcoal/10 md:grid-cols-3 md:divide-y-0 lg:grid-cols-6">
          {SHOP_CATEGORIES.map((cat) => {
            const count = productsByCategory[cat.handle]?.length ?? 0;
            return (
              <Link
                key={cat.handle}
                href={`/shop/collection/${cat.handle}`}
                className="group flex flex-col justify-between gap-8 px-5 py-8 transition-colors hover:bg-bone sm:px-6 sm:py-10"
                data-testid={`shop-intent-${cat.key}`}
              >
                <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/50">
                  {cat.eyebrow}
                </div>
                <div>
                  <div className="flex items-end justify-between gap-2">
                    <span className="font-serif text-2xl tracking-tight text-forest sm:text-3xl">
                      {cat.label}
                    </span>
                    <ArrowUpRight className="text-charcoal/40 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-forest" />
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

      {/* ═══ FALL EDIT — curated grid ═══ */}
      <section id="fall-edit" className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-24">
        <div className="mb-10 flex items-end justify-between gap-6">
          <div>
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/50">
              The Fall Edit · 2026
            </div>
            <h2 className="mt-2 font-serif text-3xl tracking-tight text-forest sm:text-5xl">
              Every piece, hand-picked.
            </h2>
            <p className="mt-4 max-w-xl text-sm text-charcoal/70">
              A season of layers built for the 6 a.m. tee time, the range
              session at lunch, and the seat at the bar after.
            </p>
          </div>
          <Link
            href="/shop/collection/shop-tops"
            className="hidden text-xs font-semibold uppercase tracking-[0.2em] text-forest/70 transition-colors hover:text-forest sm:inline-flex sm:items-center sm:gap-1"
          >
            View all <ArrowUpRight />
          </Link>
        </div>

        {fallEdit.length === 0 ? (
          <EmptyState message="Products land here as we add them in Shopify. Any product in Shop — Tops, Bottoms, Outerwear, Tech, Bags, or Accessories will appear." />
        ) : (
          <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-3 md:gap-x-8 lg:grid-cols-4">
            {fallEdit.map((p) => (
              <ShopProductCard key={p.slug} product={p} />
            ))}
          </div>
        )}
      </section>

      {/* ═══ GIFT TIERS ═══ */}
      <section className="border-t border-charcoal/10 bg-bone">
        <div className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-24">
          <div className="mb-10">
            <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/50">
              Shop by gift
            </div>
            <h2 className="mt-2 font-serif text-3xl tracking-tight text-forest sm:text-4xl">
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
              <div className="text-sm font-semibold uppercase tracking-[0.2em] text-forest">
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

function ArrowUpRight({ className = "h-4 w-4" }: { className?: string }) {
  return (
    <svg
      className={className}
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
    <div className="rounded-none border border-dashed border-charcoal/20 bg-bone/60 px-8 py-16 text-center">
      <p className="mx-auto max-w-md text-sm text-charcoal/60">{message}</p>
    </div>
  );
}

function GiftTierCard({
  title,
  subtitle,
  accent,
  products,
  href,
}: {
  title: string;
  subtitle: string;
  accent: string;
  products: ShopifyProduct[];
  href: string;
}) {
  const preview = products.slice(0, 2);

  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden border border-charcoal/10 bg-cream transition-colors hover:border-forest/40"
    >
      <div className="flex items-start justify-between border-b border-charcoal/10 px-5 py-4">
        <div>
          <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-ember">
            {accent}
          </div>
          <div className="mt-1 font-serif text-2xl tracking-tight text-forest">
            {title}
          </div>
          <div className="mt-1 text-xs text-charcoal/60">{subtitle}</div>
        </div>
        <ArrowUpRight className="mt-1 h-5 w-5 text-charcoal/40 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-forest" />
      </div>
      <div className="grid flex-1 grid-cols-2 divide-x divide-charcoal/10">
        {preview.length === 0
          ? [0, 1].map((i) => (
              <div
                key={i}
                className="flex aspect-square items-center justify-center bg-white text-[10px] font-mono uppercase tracking-widest text-charcoal/30"
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
                  <div className="truncate text-[11px] font-semibold text-forest">
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
