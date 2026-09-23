"use client";

import Image from "next/image";
import Link from "next/link";
import { useMemo } from "react";
import { ScrollToTop } from "./ScrollToTop";
import { ShopProductCard } from "./ShopProductCard";
import { ShopPasswordGate } from "./ShopPasswordGate";
import { CuratedShipmentBand } from "./CuratedShipmentBand";
import { SHOP_CATEGORIES, GIFT_TIERS } from "../shopCollections";
import type { SeasonalTheme } from "../seasonalTheme";
import type { ShopifyProduct } from "@/lib/shopify";

interface Props {
  products: ShopifyProduct[];
  productsByCategory: Record<string, ShopifyProduct[]>;
  theme: SeasonalTheme;
}

/**
 * /shop landing — narrative sequence inspired by Huckberry's homepage.
 *
 * The old design dumped the whole catalog into one giant "Fall Edit" grid.
 * This version breaks the page into a sequence of theses, each with a
 * small (4-6 tile) grid and a real reason to exist. Curated Shipment
 * (Reserve) gets a dedicated forest-green editorial band at position 4.
 *
 * Order:
 *  1. Hero (theme-driven)
 *  2. Category intent tiles
 *  3. Just Landed (4 newest)
 *  4. The Curated Shipment (Reserve membership CTA band)
 *  5. This Season's Edit (curated 4)
 *  6. Shop by Moment (4 situation tiles)
 *  7. The Layering Rule (slim strip)
 *  8. The Team's Picks (6 with captions)
 *  9. The Brands We Back (3 brand spotlights)
 *  10. Gift Tiers
 *  11. From The Journal (3 editorial cross-sells)
 *  12. Trust strip
 */
export function ShopLanding({ products, productsByCategory, theme }: Props) {
  const justLanded = useMemo(() => products.slice(0, 4), [products]);

  // "Season's Edit" — one from each of the layering pillars if available,
  // otherwise fall back to the next 4 unique products.
  const seasonEdit = useMemo(() => {
    const picks: ShopifyProduct[] = [];
    const usedSlugs = new Set(justLanded.map((p) => p.slug));
    const preferred = [
      productsByCategory["shop-tops"]?.find((p) => !usedSlugs.has(p.slug)),
      productsByCategory["shop-outerwear"]?.find((p) => !usedSlugs.has(p.slug)),
      productsByCategory["shop-bottoms"]?.find((p) => !usedSlugs.has(p.slug)),
      productsByCategory["shop-accessories"]?.find((p) => !usedSlugs.has(p.slug)),
    ];
    for (const p of preferred) {
      if (p && !picks.some((x) => x.slug === p.slug)) {
        picks.push(p);
        usedSlugs.add(p.slug);
      }
    }
    // Fill remaining slots
    for (const p of products) {
      if (picks.length >= 4) break;
      if (!usedSlugs.has(p.slug)) {
        picks.push(p);
        usedSlugs.add(p.slug);
      }
    }
    return picks;
  }, [products, productsByCategory, justLanded]);

  // "Team's Picks" — 6 products with editorial captions. Deterministic
  // per session by name; captions rotate through the pool below so a
  // curator can hand-map SKU -> caption later.
  const teamPicks = useMemo(() => {
    const usedSlugs = new Set([
      ...justLanded.map((p) => p.slug),
      ...seasonEdit.map((p) => p.slug),
    ]);
    const pool = products.filter((p) => !usedSlugs.has(p.slug));
    return pool.slice(0, 6).map((p, i) => ({
      product: p,
      caption: TEAM_PICK_CAPTIONS[i % TEAM_PICK_CAPTIONS.length],
    }));
  }, [products, justLanded, seasonEdit]);

  const giftProducts = useMemo(() => {
    const buckets: Record<string, ShopifyProduct[]> = {
      under100: [],
      hundredToThree: [],
      threeHundredPlus: [],
    };
    for (const p of products) {
      const tags = (p.tags ?? []).map((t) => t.toLowerCase());
      let bucket: keyof typeof buckets | null = null;
      if (tags.includes("gift-under-100")) bucket = "under100";
      else if (tags.includes("gift-100-300")) bucket = "hundredToThree";
      else if (tags.includes("gift-300-plus")) bucket = "threeHundredPlus";
      else if (p.price < 100) bucket = "under100";
      else if (p.price < 300) bucket = "hundredToThree";
      else bucket = "threeHundredPlus";
      buckets[bucket].push(p);
    }
    return buckets;
  }, [products]);

  return (
    <>
      <ScrollToTop />
      <ShopPasswordGate accent={theme.accent} />

      {/* ═══ 1. HERO ═══ */}
      <section className="relative">
        <div
          className="relative h-screen min-h-[600px] w-full overflow-hidden"
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
                href="#just-landed"
                className="inline-flex h-11 items-center gap-2 px-6 text-xs font-semibold uppercase tracking-[0.2em] text-white transition-opacity hover:opacity-90"
                style={{ backgroundColor: theme.accent }}
              >
                Shop the Edit
                <ArrowUpRight />
              </Link>
              <Link
                href="#gift-tiers"
                className="inline-flex h-11 items-center gap-2 border bg-transparent px-6 text-xs font-semibold uppercase tracking-[0.2em] text-white transition-colors hover:bg-white/10"
                style={{ borderColor: "rgba(255,255,255,0.4)" }}
              >
                Shop Gifts
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ═══ 2. CATEGORY INTENT ROW ═══ */}
      <section className="border-b border-charcoal/10 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-2 divide-x divide-y divide-charcoal/10 md:grid-cols-3 md:divide-y-0 lg:grid-cols-6">
          {SHOP_CATEGORIES.map((cat) => {
            const count = productsByCategory[cat.handle]?.length ?? 0;
            return (
              <Link
                key={cat.handle}
                href={`/shop/collection/${cat.handle}`}
                className="group relative flex flex-col justify-between gap-8 px-5 py-8 transition-colors hover:bg-cream sm:px-6 sm:py-10"
                data-testid={`shop-intent-${cat.key}`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal/50">
                    {cat.eyebrow}
                  </div>
                  <ArrowUpRight className="h-4 w-4 shrink-0 text-charcoal/40 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
                </div>
                <div>
                  <span className="font-serif text-2xl tracking-tight text-charcoal sm:text-3xl">
                    {cat.label}
                  </span>
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

      {/* ═══ 3. JUST LANDED ═══ */}
      <section id="just-landed" className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-24">
          <SectionHeader
            eyebrow="New this week"
            eyebrowColor={theme.accent}
            headline="Latest at Mully."
            body="Fresh arrivals from the brands we curate."
            cta={{ label: "See all new", href: "/shop/collection/shop-all" }}
          />
          {justLanded.length === 0 ? (
            <EmptyState message="Nothing here yet. New pieces drop weekly." />
          ) : (
            <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-4 md:gap-x-8">
              {justLanded.map((p) => (
                <ShopProductCard key={p.slug} product={p} accent={theme.accent} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ═══ 4. THE CURATED SHIPMENT (Reserve membership) ═══ */}
      <CuratedShipmentBand accent={theme.accent} />

      {/* ═══ 5. THIS SEASON'S EDIT ═══ */}
      <section className="border-t border-charcoal/10 bg-white">
        <div className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-24">
          <SectionHeader
            eyebrow="The Fall Layering Edit"
            eyebrowColor={theme.accent}
            headline="The one you'll live in through November."
            body="A base, a mid, an outer, and something small. That's the season."
            cta={{ label: "See the full edit", href: "/shop/collection/shop-all" }}
          />
          {seasonEdit.length === 0 ? (
            <EmptyState message="The edit is coming together. Check back this week." />
          ) : (
            <div className="grid grid-cols-2 gap-x-5 gap-y-10 md:grid-cols-4 md:gap-x-8">
              {seasonEdit.map((p) => (
                <ShopProductCard key={p.slug} product={p} accent={theme.accent} />
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ═══ 6. SHOP BY MOMENT ═══ */}
      <section className="border-t border-charcoal/10 bg-cream">
        <div className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-24">
          <SectionHeader
            eyebrow="Shop by moment"
            eyebrowColor={theme.accent}
            headline="Match the round."
          />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-4">
            {SHOP_BY_MOMENT.map((m) => (
              <MomentTile
                key={m.label}
                label={m.label}
                caption={m.caption}
                image={m.image}
                href={m.href}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 7. THE LAYERING RULE (slim strip) ═══ */}
      <section
        id="layering-guide"
        className="border-y border-charcoal/10 bg-white"
      >
        <div className="mx-auto max-w-7xl px-6 py-6 md:px-12 md:py-8">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between md:gap-8">
            <div className="flex flex-col gap-1 md:flex-row md:items-baseline md:gap-4">
              <div
                className="text-[10px] font-mono uppercase tracking-[0.28em]"
                style={{ color: theme.accent }}
              >
                The Layering Rule
              </div>
              <p className="text-sm text-charcoal/70">
                A base you can sweat in. A mid you can zip up. An outer you
                throw off at the turn.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {theme.layerPalette.slice(0, 5).map((c) => (
                <div
                  key={c.hex}
                  className="flex items-center gap-1.5 border border-charcoal/10 bg-white px-2 py-1"
                  title={c.name}
                >
                  <span
                    className="inline-block h-3 w-3 rounded-full"
                    style={{ backgroundColor: c.hex }}
                  />
                  <span className="text-[9px] font-mono uppercase tracking-[0.2em] text-charcoal/60">
                    {c.name}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* ═══ 8. THE TEAM'S PICKS ═══ */}
      <section className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-24">
          <SectionHeader
            eyebrow="The team's picks"
            eyebrowColor={theme.accent}
            headline="What we're actually wearing."
            body="Six pieces from this season with a note on why."
          />
          {teamPicks.length === 0 ? (
            <EmptyState message="Picks land here as the season fills in." />
          ) : (
            <div className="grid grid-cols-2 gap-x-5 gap-y-12 md:grid-cols-3 md:gap-x-8">
              {teamPicks.map(({ product, caption }) => (
                <div key={product.slug} className="flex flex-col">
                  <ShopProductCard product={product} accent={theme.accent} />
                  <p className="mt-3 border-l-2 pl-3 text-xs italic text-charcoal/65" style={{ borderColor: theme.accent }}>
                    {caption}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* ═══ 9. THE BRANDS WE BACK ═══ */}
      <section className="border-y border-charcoal/10 bg-cream">
        <div className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-24">
          <SectionHeader
            eyebrow="The brands we back"
            eyebrowColor={theme.accent}
            headline="Curated, not carried."
            body="A short list of makers we keep coming back to."
          />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {BRAND_SPOTLIGHTS.map((b) => (
              <BrandTile
                key={b.slug}
                name={b.name}
                blurb={b.blurb}
                href={b.href}
                image={b.image}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 10. GIFT TIERS ═══ */}
      <section id="gift-tiers" className="bg-white">
        <div className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-24">
          <SectionHeader
            eyebrow="Shop by gift"
            eyebrowColor={theme.accent}
            headline="For the guy who has enough polos."
          />
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

      {/* ═══ 11. FROM THE JOURNAL ═══ */}
      <section className="border-t border-charcoal/10 bg-cream">
        <div className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-24">
          <SectionHeader
            eyebrow="The Journal"
            eyebrowColor={theme.accent}
            headline="Reading for the range."
            body="Stories, destinations, and the picks we're arguing about."
            cta={{ label: "See all", href: "/lp/editorial" }}
          />
          <div className="grid grid-cols-1 gap-5 md:grid-cols-3">
            {JOURNAL_TILES.map((j) => (
              <JournalTile
                key={j.href}
                eyebrow={j.eyebrow}
                headline={j.headline}
                body={j.body}
                image={j.image}
                href={j.href}
              />
            ))}
          </div>
        </div>
      </section>

      {/* ═══ 12. TRUST STRIP ═══ */}
      <section className="border-t border-charcoal/10 bg-white">
        <div className="mx-auto grid max-w-7xl grid-cols-1 gap-8 px-6 py-12 sm:grid-cols-3 md:px-12">
          {[
            { k: "Free shipping", v: "US orders over $75." },
            { k: "Members save 15%", v: "Every piece. Every order." },
            { k: "Returns that work", v: "30 days. No questions." },
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

/* ─── Content constants ──────────────────────────────────────────────────── */

const TEAM_PICK_CAPTIONS = [
  "The polo we'd wear to a wedding.",
  "The mid-layer that lives in the golf bag from now through March.",
  "The trousers that make you look like you meant to end up at dinner.",
  "The one thing every golfer we know keeps in the trunk.",
  "The piece we'd give to a friend who just got into the game.",
  "The one that makes the round photograph better.",
];

const SHOP_BY_MOMENT = [
  {
    label: "The 6 a.m. tee time",
    caption: "Vests, pullovers, packable shells.",
    image:
      "https://images.unsplash.com/photo-1600841867003-1c2d33fb0e42?auto=format&fit=crop&w=1200&q=70",
    href: "/shop/collection/shop-outerwear",
  },
  {
    label: "The Saturday round",
    caption: "Polos and trousers you can play in.",
    image:
      "https://images.unsplash.com/photo-1592919505780-303950717480?auto=format&fit=crop&w=1200&q=70",
    href: "/shop/collection/shop-tops",
  },
  {
    label: "The clubhouse dinner",
    caption: "Cashmere, belts, the good hat.",
    image:
      "https://images.unsplash.com/photo-1594736797933-d0501ba2fe65?auto=format&fit=crop&w=1200&q=70",
    href: "/shop/collection/shop-accessories",
  },
  {
    label: "The range session",
    caption: "Rangefinders, launch monitors, training tools.",
    image:
      "https://images.unsplash.com/photo-1591491634026-77cd8a30f3d1?auto=format&fit=crop&w=1200&q=70",
    href: "/shop/collection/shop-tech",
  },
];

const BRAND_SPOTLIGHTS = [
  {
    slug: "quiet-golf",
    name: "Quiet Golf",
    blurb: "Independent golf, cut and sewn like it matters.",
    href: "/shop/collection/shop-all?brand=quiet-golf",
    image:
      "https://images.unsplash.com/photo-1580657527061-84dcbc5920a3?auto=format&fit=crop&w=1200&q=70",
  },
  {
    slug: "rhone",
    name: "Rhone",
    blurb: "Technical menswear that actually holds up.",
    href: "/shop/collection/shop-all?brand=rhone",
    image:
      "https://images.unsplash.com/photo-1618354691373-d851c5c3a990?auto=format&fit=crop&w=1200&q=70",
  },
  {
    slug: "duckhead",
    name: "Duckhead",
    blurb: "Southern preppy, remixed for now.",
    href: "/shop/collection/shop-all?brand=duckhead",
    image:
      "https://images.unsplash.com/photo-1602810318383-e386cc2a3ccf?auto=format&fit=crop&w=1200&q=70",
  },
];

const JOURNAL_TILES = [
  {
    eyebrow: "Destinations",
    headline: "Pebble in the fall.",
    body: "Why October is the right month, and what to pack.",
    image:
      "https://images.unsplash.com/photo-1587174486073-ae5e5cff23aa?auto=format&fit=crop&w=1200&q=70",
    href: "/lp/editorial",
  },
  {
    eyebrow: "Style",
    headline: "The layering rule, illustrated.",
    body: "Three pieces, five colors, the whole season.",
    image:
      "https://images.unsplash.com/photo-1595341595379-cf1cd0fb7fb1?auto=format&fit=crop&w=1200&q=70",
    href: "/lp/editorial",
  },
  {
    eyebrow: "Mully 100",
    headline: "The gift list we actually use.",
    body: "One hundred picks under a hundred bucks.",
    image:
      "https://images.unsplash.com/photo-1606107557195-0e29a4b5b4aa?auto=format&fit=crop&w=1200&q=70",
    href: "/lp/mully100",
  },
];

/* ─── Sub-components ─────────────────────────────────────────────────────── */

function SectionHeader({
  eyebrow,
  eyebrowColor,
  headline,
  body,
  cta,
}: {
  eyebrow: string;
  eyebrowColor: string;
  headline: string;
  body?: string;
  cta?: { label: string; href: string };
}) {
  return (
    <div className="mb-10 flex items-end justify-between gap-6">
      <div>
        <div
          className="text-[10px] font-mono uppercase tracking-[0.2em]"
          style={{ color: eyebrowColor }}
        >
          {eyebrow}
        </div>
        <h2 className="mt-2 font-serif text-3xl tracking-tight text-charcoal sm:text-5xl">
          {headline}
        </h2>
        {body && (
          <p className="mt-4 max-w-xl text-sm text-charcoal/70">{body}</p>
        )}
      </div>
      {cta && (
        <Link
          href={cta.href}
          className="hidden text-xs font-semibold uppercase tracking-[0.2em] text-charcoal/70 transition-colors hover:text-charcoal sm:inline-flex sm:items-center sm:gap-1"
        >
          {cta.label} <ArrowUpRight />
        </Link>
      )}
    </div>
  );
}

function MomentTile({
  label,
  caption,
  image,
  href,
}: {
  label: string;
  caption: string;
  image: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group relative flex aspect-[4/5] items-end overflow-hidden bg-charcoal"
    >
      <Image
        src={image}
        alt={label}
        fill
        sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 25vw"
        className="object-cover opacity-85 transition-transform duration-700 group-hover:scale-[1.03] group-hover:opacity-95"
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-black/25 to-transparent" />
      <div className="relative z-10 flex w-full items-end justify-between gap-3 p-6 text-white">
        <div>
          <div className="font-serif text-2xl leading-tight tracking-tight">
            {label}
          </div>
          <div className="mt-1 text-[11px] uppercase tracking-[0.2em] text-white/75">
            {caption}
          </div>
        </div>
        <ArrowUpRight className="h-5 w-5 shrink-0 opacity-80 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function BrandTile({
  name,
  blurb,
  href,
  image,
}: {
  name: string;
  blurb: string;
  href: string;
  image: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden border border-charcoal/10 bg-white transition-colors hover:border-charcoal/30"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-cream">
        <Image
          src={image}
          alt={name}
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
        />
      </div>
      <div className="flex flex-1 items-start justify-between gap-3 px-5 py-5">
        <div>
          <div className="font-serif text-2xl tracking-tight text-charcoal">
            {name}
          </div>
          <div className="mt-1 text-xs text-charcoal/60">{blurb}</div>
        </div>
        <ArrowUpRight className="mt-1 h-5 w-5 text-charcoal/40 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
      </div>
    </Link>
  );
}

function JournalTile({
  eyebrow,
  headline,
  body,
  image,
  href,
}: {
  eyebrow: string;
  headline: string;
  body: string;
  image: string;
  href: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col overflow-hidden border border-charcoal/10 bg-white transition-colors hover:border-charcoal/30"
    >
      <div className="relative aspect-[4/3] w-full overflow-hidden bg-cream">
        <Image
          src={image}
          alt={headline}
          fill
          sizes="(max-width: 768px) 100vw, 33vw"
          className="object-cover transition-transform duration-700 group-hover:scale-[1.03]"
        />
      </div>
      <div className="flex flex-1 flex-col gap-2 px-5 py-5">
        <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-charcoal/50">
          {eyebrow}
        </div>
        <div className="font-serif text-xl leading-snug tracking-tight text-charcoal">
          {headline}
        </div>
        <div className="text-xs text-charcoal/60">{body}</div>
      </div>
    </Link>
  );
}

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
