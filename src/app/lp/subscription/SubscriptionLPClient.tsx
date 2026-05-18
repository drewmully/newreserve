"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { trackEvent } from "@/lib/tracking";
import { GlassHeader } from "@/app/components/ClientComponents";
import { LP_GALLERY } from "../_shared/products";
import {
  TrustBadgeStrip,
  RecentBoxesCarousel,
  ReviewsBlock,
  HowItWorks,
  LifestyleGallery,
  ProductDetails,
} from "../_shared/LPSections";

const BRAND_LOGOS = [
  { src: "/brands/greyson.png", alt: "Greyson" },
  { src: "/brands/rhone.png", alt: "Rhone" },
  { src: "/brands/quiet-golf.png", alt: "Quiet Golf" },
  { src: "/brands/topo.png", alt: "Topo" },
  { src: "/brands/feetures.png", alt: "Feetures" },
  { src: "/brands/arnies.png", alt: "Arnie's" },
  { src: "/brands/field-day.png", alt: "Field Day" },
  { src: "/brands/harlestons.png", alt: "Harlestons" },
  { src: "/brands/hyperice.png", alt: "Hyperice" },
];

const ABOUT_BULLETS = [
  "Hand-curated quarterly box for golfers with taste — 4 to 6 pieces, $300+ retail value, every quarter.",
  "Brands worth knowing: Rhone, Greyson, Quiet Golf, Will Leather Goods, Field Day, Penfold, Morning People and more.",
  "Sizing confirmed after purchase — quick 2-minute form covers shirt, pant, shoe, glove and fit preference. Nothing ships until you're set.",
  "Free shipping in the continental US, every quarter. Wrong fit? Exchange free, no questions, no shipping fee.",
  "$250 per quarter, billed every 3 months. Cancel anytime after your first box — no annual lock-in.",
];

export default function SubscriptionLPClient() {
  const [heroIndex, setHeroIndex] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    trackEvent("lp_subscription_view");
  }, []);

  async function handleStart() {
    setError(null);
    setLoading(true);
    trackEvent("lp_subscription_checkout_clicked", {
      properties: { tier: "member", method: "shopify_checkout" },
    });

    try {
      await createMembershipCheckout("member", {
        returnPath: "/auth/callback",
        attributes: [
          { key: "lp_source", value: "lp_subscription" },
          { key: "ad_group", value: "google_ads" },
        ],
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not start checkout. Please try again or use the form on our homepage."
      );
      setLoading(false);
    }
  }

  const hero = LP_GALLERY[heroIndex];

  return (
    <div className="min-h-screen bg-bone text-charcoal">
      <GlassHeader />

      {/* ------------------------------- HERO ------------------------------- */}
      <main className="pt-20 sm:pt-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 lg:gap-8">
            {/* Thumbnail rail */}
            <div className="hidden lg:flex lg:col-span-1 flex-col gap-2">
              {LP_GALLERY.map((g, i) => (
                <button
                  key={g.src}
                  type="button"
                  onMouseEnter={() => setHeroIndex(i)}
                  onClick={() => setHeroIndex(i)}
                  className={`relative w-full aspect-square rounded-md overflow-hidden border-2 transition ${
                    heroIndex === i
                      ? "border-forest"
                      : "border-forest/15 hover:border-forest/40"
                  }`}
                  aria-label={`Show image ${i + 1}`}
                >
                  <Image
                    src={g.src}
                    alt={g.alt}
                    fill
                    sizes="60px"
                    className="object-cover"
                    unoptimized
                  />
                </button>
              ))}
            </div>

            {/* Main hero image — smaller, square-ish */}
            <div className="lg:col-span-6">
              <div className="relative aspect-square bg-bone-dark/40 rounded-lg overflow-hidden border border-forest/10">
                <Image
                  src={hero.src}
                  alt={hero.alt}
                  fill
                  sizes="(min-width: 1024px) 50vw, 100vw"
                  className={
                    heroIndex === 0
                      ? "object-cover"
                      : "object-contain p-8"
                  }
                  priority
                  unoptimized
                />
              </div>
              {/* Mobile thumbnail strip */}
              <div className="lg:hidden mt-3 grid grid-cols-5 gap-2">
                {LP_GALLERY.map((g, i) => (
                  <button
                    key={g.src}
                    type="button"
                    onClick={() => setHeroIndex(i)}
                    className={`relative aspect-square rounded-md overflow-hidden border-2 ${
                      heroIndex === i ? "border-forest" : "border-forest/15"
                    }`}
                    aria-label={`Show image ${i + 1}`}
                  >
                    <Image
                      src={g.src}
                      alt={g.alt}
                      fill
                      sizes="60px"
                      className="object-cover"
                      unoptimized
                    />
                  </button>
                ))}
              </div>
            </div>

            {/* Buy box */}
            <div className="lg:col-span-5 flex flex-col">
              <div className="text-[11px] tracking-[0.25em] uppercase text-ember/80 mb-2">
                Mully Reserve · Quarterly Box
              </div>
              <h1 className="font-serif text-3xl sm:text-4xl text-forest leading-[1.1]">
                Quarterly box.<br />
                Built for golfers with taste.
              </h1>

              <div className="mt-3 flex items-center gap-2 text-sm">
                <div className="inline-flex items-center gap-0.5 text-ember">
                  {Array.from({ length: 5 }).map((_, i) => (
                    <svg
                      key={i}
                      className="h-4 w-4"
                      viewBox="0 0 24 24"
                      fill="currentColor"
                    >
                      <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" />
                    </svg>
                  ))}
                </div>
                <span className="text-charcoal/70 text-xs">
                  4.9 · 1,247 members
                </span>
              </div>

              <p className="text-sm text-charcoal/80 mt-4 leading-relaxed">
                Hand-curated quarterly boxes from the brands worth knowing.
                $300+ retail value per box. Free shipping. Cancel anytime
                after your first box.
              </p>

              {/* Price + CTA */}
              <div className="mt-5 bg-bone-dark/40 rounded-lg border border-forest/15 p-5">
                <div className="flex items-baseline justify-between">
                  <div>
                    <div className="text-[11px] uppercase tracking-[0.2em] text-charcoal/60">
                      Reserve Member
                    </div>
                    <div className="font-serif text-3xl text-forest mt-1">
                      $250
                      <span className="text-base text-charcoal/60 font-sans ml-1">
                        / quarter
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-xs text-ember font-medium">
                      MOST POPULAR
                    </div>
                    <div className="text-[11px] text-charcoal/60 mt-0.5">
                      Billed every 3 months
                    </div>
                  </div>
                </div>

                <button
                  type="button"
                  onClick={handleStart}
                  disabled={loading}
                  className="w-full mt-5 bg-ember hover:bg-ember/90 disabled:opacity-60 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition"
                >
                  {loading ? "Opening checkout…" : "Start membership"}
                </button>

                <div className="mt-3 flex items-center justify-center gap-1.5 text-[11px] text-charcoal/60">
                  <svg className="h-3 w-3" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <rect x="3" y="11" width="18" height="11" rx="2" />
                    <path d="M7 11V7a5 5 0 0110 0v4" />
                  </svg>
                  Secure checkout via Shopify
                </div>

                {error ? (
                  <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2">
                    {error}
                  </div>
                ) : null}
              </div>

              {/* In-box quick facts */}
              <ul className="mt-5 space-y-2.5">
                {ABOUT_BULLETS.slice(0, 3).map((b) => (
                  <li
                    key={b}
                    className="flex gap-2.5 text-sm text-charcoal/80 leading-snug"
                  >
                    <span className="text-ember mt-1 shrink-0">▸</span>
                    <span>{b}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>

        {/* ----------------------- TRUST BADGE STRIP ----------------------- */}
        <div className="mt-10">
          <TrustBadgeStrip />
        </div>

        {/* ----------------------- BRAND LOGOS ----------------------- */}
        <section className="py-8 bg-bone">
          <div className="max-w-5xl mx-auto px-4 sm:px-6">
            <div className="text-center text-[11px] tracking-[0.25em] uppercase text-charcoal/55 mb-5">
              Brands you'll find inside
            </div>
            <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-x-4 gap-y-5 items-center">
              {BRAND_LOGOS.map((b) => (
                <div key={b.alt} className="relative h-7 sm:h-8">
                  <Image
                    src={b.src}
                    alt={b.alt}
                    fill
                    sizes="80px"
                    className="object-contain opacity-65"
                  />
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* ----------------------- ABOUT THIS BOX ----------------------- */}
        <section className="py-12 bg-bone-dark/30 border-y border-forest/10">
          <div className="max-w-4xl mx-auto px-4 sm:px-6">
            <h2 className="font-serif text-xl text-forest mb-5">
              About this box
            </h2>
            <ul className="space-y-3">
              {ABOUT_BULLETS.map((b) => (
                <li
                  key={b}
                  className="flex gap-3 text-sm text-charcoal/85 leading-relaxed"
                >
                  <span className="text-ember mt-1.5 shrink-0 text-xs">●</span>
                  <span>{b}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ----------------------- HOW IT WORKS ----------------------- */}
        <HowItWorks />

        {/* ----------------------- RECENT BOXES CAROUSEL ----------------------- */}
        <RecentBoxesCarousel />

        {/* ----------------------- LIFESTYLE GALLERY ----------------------- */}
        <LifestyleGallery />

        {/* ----------------------- PRODUCT DETAILS ----------------------- */}
        <ProductDetails />

        {/* ----------------------- REVIEWS ----------------------- */}
        <ReviewsBlock />

        {/* ----------------------- FINAL CTA ----------------------- */}
        <section className="bg-forest text-bone py-16 sm:py-20">
          <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
            <h2 className="font-serif text-3xl sm:text-4xl">
              Built for golfers with taste.
            </h2>
            <p className="text-sm sm:text-base text-bone/80 mt-4 max-w-2xl mx-auto leading-relaxed">
              Quarterly curations. $300+ retail value inside. Sizing confirmed
              after purchase so nothing ships that doesn't fit. Cancel anytime
              after your first box.
            </p>
            <button
              type="button"
              onClick={handleStart}
              disabled={loading}
              className="mt-7 bg-ember hover:bg-ember/90 disabled:opacity-60 text-bone py-3.5 px-10 rounded-md text-sm font-medium tracking-wide transition"
            >
              {loading ? "Opening checkout…" : "Start membership · $250/qtr"}
            </button>
            <div className="mt-3 text-[11px] text-bone/55">
              Free shipping · Cancel anytime · Exchange without question
            </div>
          </div>
        </section>

        <footer className="bg-forest-dark text-bone/55 text-xs py-8 text-center">
          © {new Date().getFullYear()} Mullybox. All rights reserved.
        </footer>
      </main>
    </div>
  );
}
