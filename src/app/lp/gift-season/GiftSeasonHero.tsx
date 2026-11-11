"use client";

/**
 * Gift a Season hero, two options for Drew to compare (?hero=a|b).
 *
 * A: real Shopify product photography from a typical Reserve (June 2026
 *    plan pieces), 2x2 collage on a neutral ground.
 * B: the real Mully course photograph already used on /shop
 *    (public/shop/hero-fall-2026.jpg, documented as a real photo in
 *    public/shop-redesign/asset-manifest.md). No generated imagery.
 *
 * Copy rules: no em dashes, "Reserve" never "box".
 */

import Image from "next/image";

export type GiftHeroVariant = "a" | "b";

const CDN = "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/";

/** Live product images on cdn.shopify.com (Shopify product media). */
const PRODUCT_TILES = [
  {
    src: `${CDN}VintagePoloFORESTDetail.jpg?v=1775579861`,
    alt: "Quiet Golf Vintage Polo in forest green, collar and placket detail",
    position: "50% 30%",
  },
  {
    src: `${CDN}rhone-layering-rhone-men-s-heritage-midweight-1-4-zip-1196079588.png?v=1775579880`,
    alt: "Rhone Heritage Midweight Quarter Zip in heather gray",
    position: "50% 20%",
  },
  {
    src: `${CDN}MG23A25_100_3_4860.webp?v=1781539301`,
    alt: "Greyson Gothic G Dad Hat, embroidered logo detail",
    position: "50% 50%",
  },
  {
    src: `${CDN}60397_BRAIDED_STRETCH_LEATHER_BELT_BROWN_03.jpg?v=1775486933`,
    alt: "Will Leather Goods braided leather stretch belt in brown",
    position: "40% 50%",
  },
];

const TRUST = ["Secure Shopify checkout", "Paid once, never renews", "Stylist-picked"];

interface Props {
  variant: GiftHeroVariant;
  fromPrice: string;
  onCta: () => void;
}

function TrustRow({ tone = "dark" }: { tone?: "dark" | "light" }) {
  return (
    <ul
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] tracking-wide ${
        tone === "light" ? "text-bone/80" : "text-charcoal/60"
      }`}
      data-testid="gift-hero-trust"
    >
      {TRUST.map((t, i) => (
        <li key={t} className="flex items-center gap-3">
          {i > 0 ? <span aria-hidden="true" className={tone === "light" ? "text-bone/40" : "text-charcoal/30"}>·</span> : null}
          {t}
        </li>
      ))}
    </ul>
  );
}

function CtaBlock({ fromPrice, onCta, tone = "dark" }: { fromPrice: string; onCta: () => void; tone?: "dark" | "light" }) {
  return (
    <div className="flex items-center gap-4">
      <a
        href="#gift-picker"
        onClick={(e) => {
          e.preventDefault();
          onCta();
        }}
        data-testid="gift-hero-cta"
        className="inline-flex items-center justify-center bg-ember hover:bg-ember/90 text-bone px-6 py-3.5 rounded-md text-sm font-medium tracking-wide transition"
      >
        Choose their gift
      </a>
      <div className={tone === "light" ? "text-bone" : "text-charcoal"}>
        <div className={`text-[10px] uppercase tracking-[0.2em] ${tone === "light" ? "text-bone/70" : "text-charcoal/55"}`}>
          From
        </div>
        <div className={`font-serif text-2xl leading-none mt-0.5 ${tone === "light" ? "text-bone" : "text-forest"}`} data-testid="gift-hero-from">
          {fromPrice}
        </div>
      </div>
    </div>
  );
}

const HEADLINE = "The gift that shows up every season.";
const SUB = "Golf apparel hand-picked by a Mully stylist. They choose their sizes. You pay once.";

export default function GiftSeasonHero({ variant, fromPrice, onCta }: Props) {
  if (variant === "b") {
    return (
      <section className="relative" data-testid="gift-hero-b">
        {/* Mobile: stacked. Desktop: text overlaid on the photo. */}
        <div className="lg:hidden max-w-6xl mx-auto px-4 sm:px-6">
          <div className="text-[11px] tracking-[0.25em] uppercase text-ember/80">Gift a season</div>
          <h1 className="font-serif text-[2rem] sm:text-4xl text-forest leading-[1.08] mt-2">{HEADLINE}</h1>
          <p className="text-sm text-charcoal/75 mt-3 leading-relaxed">{SUB}</p>
          <div className="relative w-full aspect-[16/9] rounded-lg overflow-hidden mt-4 bg-forest-dark">
            <Image
              src="/shop/hero-fall-2026.jpg"
              alt="A tree-lined fairway and bunker in early morning light"
              fill
              priority
              sizes="100vw"
              className="object-cover"
            />
          </div>
          <div className="mt-4">
            <CtaBlock fromPrice={fromPrice} onCta={onCta} />
          </div>
          <div className="mt-3">
            <TrustRow />
          </div>
        </div>

        <div className="hidden lg:block max-w-6xl mx-auto px-6">
          <div className="relative w-full h-[560px] rounded-lg overflow-hidden bg-forest-dark">
            <Image
              src="/shop/hero-fall-2026.jpg"
              alt="A tree-lined fairway and bunker in early morning light"
              fill
              priority
              sizes="(min-width: 1152px) 1152px, 100vw"
              className="object-cover"
              style={{ objectPosition: "60% 60%" }}
            />
            <div className="absolute inset-0 bg-gradient-to-r from-forest-dark/90 via-forest-dark/60 to-transparent" />
            <div className="relative h-full flex flex-col justify-center max-w-[480px] pl-14">
              <div className="text-[11px] tracking-[0.25em] uppercase text-bone/75">Gift a season</div>
              <h1 className="font-serif text-5xl text-bone leading-[1.05] mt-3">{HEADLINE}</h1>
              <p className="text-[15px] text-bone/85 mt-4 leading-relaxed">{SUB}</p>
              <div className="mt-7">
                <CtaBlock fromPrice={fromPrice} onCta={onCta} tone="light" />
              </div>
              <div className="mt-6">
                <TrustRow tone="light" />
              </div>
            </div>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6" data-testid="gift-hero-a">
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 lg:gap-12 items-center">
        <div className="order-1 lg:col-span-5">
          <div className="text-[11px] tracking-[0.25em] uppercase text-ember/80">Gift a season</div>
          <h1 className="font-serif text-[2rem] sm:text-4xl lg:text-5xl text-forest leading-[1.08] mt-2 lg:mt-3">
            {HEADLINE}
          </h1>
          <p className="text-sm lg:text-[15px] text-charcoal/75 mt-3 lg:mt-4 leading-relaxed">{SUB}</p>
          <div className="hidden lg:block mt-7">
            <CtaBlock fromPrice={fromPrice} onCta={onCta} />
          </div>
          <div className="hidden lg:block mt-6">
            <TrustRow />
          </div>
        </div>

        <div className="order-2 lg:col-span-7">
          <div className="bg-bone-dark/50 rounded-lg p-2 sm:p-3">
            <div className="grid grid-cols-4 lg:grid-cols-2 gap-2 sm:gap-3">
              {PRODUCT_TILES.map((t, i) => (
                <div
                  key={t.src}
                  className={`relative aspect-square lg:aspect-[4/5] rounded-md overflow-hidden bg-white ${
                    i % 2 === 1 ? "lg:translate-y-6" : ""
                  }`}
                >
                  <Image
                    src={t.src}
                    alt={t.alt}
                    fill
                    priority={i < 2}
                    sizes="(min-width: 1024px) 320px, 25vw"
                    className="object-cover"
                    style={{ objectPosition: t.position }}
                  />
                </div>
              ))}
            </div>
            <div className="hidden lg:block h-6" aria-hidden="true" />
          </div>
          <p className="text-[10px] text-charcoal/50 mt-2">Real pieces from a past Reserve. Every Reserve is styled to the recipient.</p>
        </div>

        <div className="order-3 lg:hidden">
          <CtaBlock fromPrice={fromPrice} onCta={onCta} />
          <div className="mt-3">
            <TrustRow />
          </div>
        </div>
      </div>
    </section>
  );
}
