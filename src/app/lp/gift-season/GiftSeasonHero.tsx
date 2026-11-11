"use client";

/**
 * Gift a Season hero media and shared hero copy. Two options for Drew to
 * compare on the preview (?hero=a|b). The page layout (split on desktop,
 * stacked on mobile) lives in GiftSeasonLPClient so the picker can sit in
 * the hero column.
 *
 * A: product flat lay built only from live Shopify product photography of
 *    pieces from a typical Reserve (Quiet Golf polo, Rhone quarter zip,
 *    Greyson hat, Will Leather belt), arranged on a bone ground. Nothing is
 *    generated; white packshot backgrounds drop out with multiply.
 * B: the real Mully course photograph already used on /shop
 *    (public/shop/hero-fall-2026.jpg, documented as a real photo in
 *    public/shop-redesign/asset-manifest.md). No generated imagery.
 *
 * Copy rules: no em dashes, "Reserve" never "box".
 */

export type GiftHeroVariant = "a" | "b";

const CDN = "https://cdn.shopify.com/s/files/1/0561/0530/4256/files/";

export const HERO_EYEBROW = "Gift a season";
export const HERO_HEADLINE = "The gift that shows up every season.";
export const HERO_LINE = "Stylist-picked golf apparel, in their sizes.";
export const HERO_TRUST = [
  "Paid once. Never renews.",
  "They pick their own sizes",
  "Secure Shopify checkout.",
];

/**
 * Live product media on cdn.shopify.com. Positions are percentages of the
 * hero frame so the same arrangement holds at every aspect ratio.
 */
const FLAT_LAY = [
  {
    // Rhone Rise 1/4 Zip, navy packshot (Shopify product media).
    src: `${CDN}mully-fall-2026-24.jpg?v=1790962847&width=1000`,
    alt: "Rhone Rise quarter zip in navy",
    style: { left: "2%", top: "0%", width: "54%", transform: "rotate(-6deg)" },
  },
  {
    // Quiet Golf Remy Polo, wine stripe packshot.
    src: `${CDN}mully-fall-2026-16.jpg?v=1790962847&width=900`,
    alt: "Quiet Golf Remy polo in wine stripe",
    style: { right: "2%", top: "4%", width: "48%", transform: "rotate(4deg)" },
  },
  {
    // Greyson Gothic G Dad Hat, transparent packshot (kept white, no multiply).
    src: `${CDN}MG23A25_100_1_4858.webp?v=1781539302&width=700`,
    alt: "Greyson Gothic G dad hat in white",
    style: { left: "10%", bottom: "0%", width: "38%", transform: "rotate(-9deg)", mixBlendMode: "normal" as const },
  },
  {
    // Will Leather Goods Saddle Belt, tan packshot.
    // Prepared white-canvas copy of the Shopify packshot
    // 60078_SADDLE_BELT_TAN_001 (see src/lib/shopProductPhotos.json).
    src: "/shop-redesign/products/white/will-leather-saddle-belt.webp",
    alt: "Will Leather Goods saddle belt in tan",
    style: { right: "2%", bottom: "6%", width: "50%", transform: "rotate(8deg)" },
  },
];

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
    <div
      className="absolute inset-0 overflow-hidden bg-[#ECE5D6]"
      style={{
        backgroundImage:
          "radial-gradient(120% 90% at 18% 12%, rgba(255,252,244,0.85) 0%, rgba(255,252,244,0) 55%), radial-gradient(90% 70% at 90% 100%, rgba(120,98,70,0.10) 0%, rgba(120,98,70,0) 60%)",
      }}
      data-testid="gift-hero-media-a"
      role="img"
      aria-label="Example pieces from a past Reserve: Rhone quarter zip, Quiet Golf polo, Greyson hat and Will Leather belt"
    >
      <div className="absolute inset-[2%]">
        {FLAT_LAY.map((p) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            key={p.src}
            src={p.src}
            alt=""
            aria-hidden="true"
            className="absolute h-auto mix-blend-multiply select-none"
            style={p.style}
            loading={priority ? "eager" : "lazy"}
            draggable={false}
          />
        ))}
      </div>
    </div>
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
