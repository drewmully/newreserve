"use client";

/**
 * Gift a Season hero media and shared hero copy. Two options for Drew to
 * compare on the preview (?hero=a|b). The page layout (split on desktop,
 * stacked on mobile) lives in GiftSeasonLPClient so the picker can sit in
 * the hero column.
 *
 * A (default, CRO pick): product flat lay built only from live Shopify
 *    product photography of pieces from a typical Reserve (Quiet Golf polo,
 *    Rhone quarter zip, Greyson hat, Will Leather belt), cut out and arranged
 *    on a bone ground with one shared shadow. Nothing is generated.
 * B: the real Mully course photograph already used on /shop
 *    (public/shop/hero-fall-2026.jpg, documented as a real photo in
 *    public/shop-redesign/asset-manifest.md). No generated imagery.
 *
 * Copy rules: no em dashes, "Reserve" never "box".
 */

import { GIFT_SEASON_SHIP_WINDOW } from "@/lib/gifts/giftSeasonConfig";

export type GiftHeroVariant = "a" | "b";

export const HERO_EYEBROW = "Gift a season";
export const HERO_HEADLINE = "The gift that shows up every season.";
export const HERO_LINE = "A prepaid golf apparel gift for 1, 2 or 4 seasons. Stylist-picked, in their sizes.";
export const HERO_TRUST = [
  "Paid once. Never renews.",
  `Ships in ${GIFT_SEASON_SHIP_WINDOW}`,
  "Secure Shopify checkout.",
];

/**
 * Flat-lay cutouts of live Shopify product photography. Source packshots
 * (cdn.shopify.com) had their white backgrounds and baked-in shadows removed
 * so every piece carries the same drop shadow (one direction, one blur).
 * Sources are listed in public/lp/gift-season/flatlay/SOURCES.md.
 * Positions are percentages of the hero frame.
 */
const FLAT_LAY = [
  {
    src: "/lp/gift-season/flatlay/qz.webp",
    style: { left: "6%", top: "7%", width: "46%", transform: "rotate(-6deg)" },
  },
  {
    src: "/lp/gift-season/flatlay/polo.webp",
    style: { right: "7%", top: "8%", width: "38%", transform: "rotate(4deg)" },
  },
  {
    src: "/lp/gift-season/flatlay/hat.webp",
    style: { left: "11%", top: "57%", width: "33%", transform: "rotate(-8deg)" },
  },
  {
    src: "/lp/gift-season/flatlay/belt.webp",
    style: { right: "5%", top: "60%", width: "46%", transform: "rotate(6deg)" },
  },
];

/** One shared shadow for every piece: down and to the right, one blur. */
const FLAT_LAY_SHADOW = "drop-shadow(4px 8px 10px rgba(58,44,30,0.24))";

export const HERO_A_CAPTION = "Pieces from past Reserves. Every Reserve is styled to them.";

export function HeroMedia({ variant, priority = false }: { variant: GiftHeroVariant; priority?: boolean }) {
  if (variant === "b") {
    return (
      <div className="absolute inset-0 bg-[#5c6658]" data-testid="gift-hero-media-b">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/shop/hero-fall-2026.jpg"
          alt="Early morning on a tree-lined fairway"
          className="h-full w-full object-cover object-[50%_60%]"
          fetchPriority={priority ? "high" : "auto"}
          loading={priority ? "eager" : "lazy"}
        />
      </div>
    );
  }
  return (
    <figure
      className="absolute inset-0 m-0 overflow-hidden bg-[#ECE5D6]"
      style={{
        backgroundImage:
          "radial-gradient(120% 90% at 18% 12%, rgba(255,252,244,0.85) 0%, rgba(255,252,244,0) 55%), radial-gradient(90% 70% at 90% 100%, rgba(120,98,70,0.10) 0%, rgba(120,98,70,0) 60%)",
      }}
      data-testid="gift-hero-media-a"
    >
      <div
        className="absolute inset-0"
        role="img"
        aria-label="Rhone quarter zip, Quiet Golf polo, Greyson hat and Will Leather belt"
      >
        {FLAT_LAY.map((p) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={p.src}
            src={p.src}
            alt=""
            aria-hidden="true"
            className="absolute h-auto select-none"
            style={{ ...p.style, filter: FLAT_LAY_SHADOW }}
            loading={priority ? "eager" : "lazy"}
            draggable={false}
          />
        ))}
      </div>
      <figcaption
        className="absolute bottom-2.5 left-4 right-4 lg:bottom-5 lg:left-8 text-[11px] lg:text-[12px] text-[#625e55]"
        data-testid="gift-hero-caption"
      >
        {HERO_A_CAPTION}
      </figcaption>
    </figure>
  );
}

export function HeroTrustRow({ className = "" }: { className?: string }) {
  return (
    <ul
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] sm:text-[12px] text-[#625e55] ${className}`}
      data-testid="gift-hero-trust"
    >
      {HERO_TRUST.map((t) => (
        <li key={t} className="flex items-center gap-1.5 whitespace-nowrap">
          <svg aria-hidden="true" viewBox="0 0 12 12" className="h-3 w-3 text-[#5b613f]">
            <path d="M2.5 6.2l2.3 2.3 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          {t}
        </li>
      ))}
    </ul>
  );
}
