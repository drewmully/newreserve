"use client";

/**
 * Mully Reserve — landing page.
 *
 * Magazine-style, visual-first, minimal copy. Brand palette:
 *   bone (page bg) / forest (primary) / ember (accents) / charcoal (body)
 *
 * Positioning: a CURATOR who handles your golf wardrobe. We are EXITING
 * the subscription-box category — the product is the CARE and the TASTE,
 * not the packaging. Buyer is 35+, affluent.
 *
 * Hero headline (current): "Premium golf gear. Zero guesswork."
 * The "have a guy who handles your golf wardrobe" line lives ONLY in the
 * pitch section as warmth — never as the H1.
 *
 * (Previous headline "Your golf style, handled." was rotated out 2026-06-03
 * to lean into premium/luxury search intent; the "style, handled" framing
 * is preserved in the AG2 paid-search RSA copy.)
 *
 * Primary CTA everywhere is the style quiz. No skip-to-checkout links —
 * those leak intent past email capture and into the hard $250 ask.
 *
 * Strategic constraints (do NOT change without product sign-off):
 *   - NEVER use the word "box" — it's "edit", "quarter", "curation", "Reserve".
 *   - Hero imagery must read "wardrobe," not "package." No closed/stacked boxes.
 *   - Gift is welcome gift, never a discount.
 *   - Quiz CTA wins every CTA collision; attention ratio stays near 1:1.
 */

import Image from "next/image";
import { useEffect, useState } from "react";
import { trackEvent } from "@/lib/tracking";
import { captureAttributionFromUrl } from "@/lib/attribution";
import { GlassHeader } from "@/app/components/ClientComponents";
import { ReserveHeroImage } from "@/app/components/ReserveHeroImage";
import { RECENT_BOX_PRODUCTS } from "../_shared/products";
import { ReviewsBlock } from "../_shared/LPSections";
import { CuratorStrip } from "../_shared/CuratorStrip";
import { QuizLauncher } from "../_shared/QuizLauncher";

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

const HOW_IT_WORKS = [
  {
    n: "01",
    title: "Take the quiz",
    body: "60 seconds. Style, fit, sizes.",
  },
  {
    n: "02",
    title: "See your edit",
    body: "We show you what we'd send before you commit.",
  },
  {
    n: "03",
    title: "Get your quarter",
    body: "$300+ retail, hand-curated, every 3 months.",
  },
];

const PROOF_STATS = [
  { stat: "96%", label: "Renewal rate" },
  { stat: "$300+", label: "Retail per quarter" },
  { stat: "4–6", label: "Pieces per shipment" },
  { stat: "Free", label: "Returns & exchanges" },
];

export default function SubscriptionLPClient() {
  const [error, setError] = useState<string | null>(null);

  // Hero: new editorial product-set shoot on a forest-green backdrop.
  // Art-directed per breakpoint inside the JSX via ReserveHeroImage's
  // <picture>-based mobileSrc/tabletSrc/src trio (see the hero block below).

  // Editorial grid — apparel detail only. We pull
  // individual product photography from RECENT_BOX_PRODUCTS so the grid reads
  // "wardrobe pieces," not "package contents."
  const gridShots = [
    RECENT_BOX_PRODUCTS[0], // Rhone Quarter Zip — Layer
    RECENT_BOX_PRODUCTS[2], // Quiet Golf Vintage Polo — Polo
    RECENT_BOX_PRODUCTS[4], // Field Day Repel Hoodie — Outerwear
    RECENT_BOX_PRODUCTS[3], // Will Leather Braided Belt — Accessory
  ].filter(Boolean);

  useEffect(() => {
    captureAttributionFromUrl();
    trackEvent("lp_subscription_view");
  }, []);

  // NOTE: the previous "Skip the quiz — start membership" links were removed
  // intentionally. They leaked visitors past email capture into the $250 ask
  // and tanked segmentation. The quiz IS the funnel. If a future bypass is
  // ever needed, it should be ONE low-contrast "already sold? start here"
  // link — not repeated buttons that compete with the quiz CTA.

  return (
    <div className="min-h-screen bg-bone text-charcoal">
      <GlassHeader />

      {/* ============================== HERO ============================== */}
      <section className="pt-20 sm:pt-24">
        <div className="max-w-6xl mx-auto px-4 sm:px-6">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 lg:gap-12 items-center">
            {/* Copy column */}
            <div className="lg:col-span-5 order-2 lg:order-none">
              <div className="text-[11px] tracking-[0.28em] uppercase text-ember/90 mb-4">
                Mully Reserve
              </div>
              <h1 className="font-serif text-4xl sm:text-5xl lg:text-6xl text-forest leading-[1.02]">
                Premium golf gear.
                <br />
                Zero guesswork.
              </h1>
              <p className="text-base sm:text-lg text-charcoal/75 mt-5 leading-relaxed max-w-md">
                Quarterly editorial curation for golfers with taste. Four to six
                pieces, $300+ retail, every three months.
              </p>

              {/* Primary CTA — quiz */}
              <div className="mt-7 max-w-sm">
                <QuizLauncher
                  variant="primary-large"
                  label="See what we'd send you · 60s"
                  source="lp_subscription_hero"
                />
                <div className="mt-3 text-[11px] tracking-[0.18em] uppercase text-charcoal/55 text-center">
                  No charge to see. Love it or exchange anything.
                </div>
              </div>

              {error ? (
                <div className="mt-3 text-xs text-red-700 bg-red-50 border border-red-200 rounded p-2 max-w-sm">
                  {error}
                </div>
              ) : null}
            </div>

            {/* Hero image — new editorial shoot on forest backdrop.
                Art-directed per breakpoint via <picture>:
                  mobile (4:5 container)  → hero-portrait-4x5.webp
                  tablet (5:4 container)  → hero-landscape-4x3.webp
                  desktop (4:5 container) → hero-portrait-4x5.webp (base)
                The dark green background on these shots IS the editorial
                backdrop — no flatlay vignette/caption overlay needed.
                Per Drew (2026-06-03): the prior 'no closed boxes in hero'
                rule has been retired in favor of this new product-set
                imagery. */}
            <div className="lg:col-span-7 order-1 lg:order-none">
              <div className="relative aspect-[4/5] sm:aspect-[5/4] lg:aspect-[4/5] rounded-sm overflow-hidden bg-[#1d3526]">
                <ReserveHeroImage
                  src="/lp/hero/hero-portrait-4x5.webp"
                  mobileSrc="/lp/hero/hero-portrait-4x5.webp"
                  tabletSrc="/lp/hero/hero-landscape-4x3.webp"
                  alt="A Mully Reserve quarter laid out on a forest-green editorial surface — Rhone navy quarter-zip, Field Day blue knit, Greyson tee, Will Leather plaid wallet, Penfold canvas bag, and a Will Leather golf shoe carrier."
                  treatment="default"
                  priority
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================== WEDGE / VALUE STRIP ====================== */}
      <section className="mt-16 sm:mt-24 border-y border-forest/10 bg-bone-dark/30 py-10">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 grid grid-cols-2 sm:grid-cols-4 gap-6">
          {PROOF_STATS.map((p) => (
            <div key={p.label} className="text-center">
              <div className="font-serif text-3xl sm:text-4xl text-forest">
                {p.stat}
              </div>
              <div className="text-[11px] sm:text-xs tracking-[0.18em] uppercase text-charcoal/60 mt-1.5">
                {p.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ========================= "HAVE A GUY" =========================== */}
      <section className="py-16 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <div className="text-[11px] tracking-[0.28em] uppercase text-ember/90 mb-4">
            The pitch
          </div>
          <h2 className="font-serif text-3xl sm:text-4xl text-forest leading-tight">
            You should have a guy who handles your golf wardrobe.
          </h2>
          <p className="text-base sm:text-lg text-charcoal/75 mt-6 leading-relaxed">
            Four times a year we send the pieces we'd put on ourselves. Brands
            worth knowing — Greyson, Rhone, Quiet Golf, Field Day, Penfold.
            Fit confirmed before anything ships.
          </p>
        </div>

        {/* Editorial grid — individual apparel product photography, no
            staged packages. Each tile is a piece you might receive. */}
        <div className="max-w-6xl mx-auto px-4 sm:px-6 mt-12">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            {gridShots.map((p) => (
              <figure
                key={p.image}
                className="relative"
              >
                <div className="relative aspect-[3/4] rounded-sm overflow-hidden bg-bone-dark/40">
                  <Image
                    src={p.image}
                    alt={`${p.vendor} ${p.title}`}
                    fill
                    sizes="(min-width: 1024px) 24vw, 50vw"
                    className="object-cover"
                    unoptimized
                  />
                </div>
                <figcaption className="mt-3 text-[10px] tracking-[0.2em] uppercase text-charcoal/55">
                  {p.vendor} · {p.category}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ GIFT ================================ */}
      <section className="py-16 sm:py-20 bg-forest text-bone">
        <div className="max-w-5xl mx-auto px-4 sm:px-6 grid grid-cols-1 lg:grid-cols-2 gap-10 lg:gap-16 items-center">
          <div className="relative aspect-[4/3] rounded-sm overflow-hidden bg-forest-dark">
            <Image
              src="/founding-100-rangefinder.webp"
              alt="Rangefinder welcome gift"
              fill
              sizes="(min-width: 1024px) 40vw, 100vw"
              className="object-contain p-6 sm:p-10"
              unoptimized
            />
          </div>
          <div>
            <div className="text-[11px] tracking-[0.28em] uppercase text-ember mb-4">
              Welcome gift
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl leading-tight">
              A rangefinder, on us.
            </h2>
            <p className="text-base sm:text-lg text-bone/80 mt-5 leading-relaxed">
              Every new Reserve member gets a precision rangefinder with their
              first quarter. Yours to keep — even if you cancel.
            </p>
            <div className="mt-7 inline-flex items-center gap-2 text-[11px] tracking-[0.22em] uppercase text-bone/65 border border-bone/25 rounded-sm px-3 py-2">
              <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M20 6L9 17l-5-5" />
              </svg>
              Yours to keep
            </div>
          </div>
        </div>
      </section>

      {/* ========================= HOW IT WORKS =========================== */}
      <section className="py-16 sm:py-24 bg-bone">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-12">
            <div className="text-[11px] tracking-[0.28em] uppercase text-ember/90 mb-3">
              How it works
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              Three steps. Sixty seconds.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-8 sm:gap-10">
            {HOW_IT_WORKS.map((s) => (
              <div key={s.n} className="text-center sm:text-left">
                <div className="font-serif text-5xl text-ember/80 mb-3 leading-none">
                  {s.n}
                </div>
                <div className="font-serif text-xl text-forest">{s.title}</div>
                <div className="text-sm text-charcoal/70 mt-2 leading-relaxed">
                  {s.body}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========================== BRAND LOGOS =========================== */}
      <section className="py-12 sm:py-16 border-y border-forest/10 bg-bone-dark/30">
        <div className="max-w-5xl mx-auto px-4 sm:px-6">
          <div className="text-center text-[11px] tracking-[0.28em] uppercase text-charcoal/55 mb-7">
            Brands you'll find inside
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-x-5 gap-y-6 items-center">
            {BRAND_LOGOS.map((b) => (
              <div key={b.alt} className="relative h-8 sm:h-9">
                <Image
                  src={b.src}
                  alt={b.alt}
                  fill
                  sizes="80px"
                  className="object-contain opacity-70"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ REVIEWS ============================= */}
      <ReviewsBlock />

      {/* ========================== CURATOR STRIP ========================= */}
      {/* Trust accent below the testimonials: who's actually behind Reserve. */}
      <CuratorStrip />

      {/* =========================== FINAL CTA ============================ */}
      <section className="bg-forest text-bone py-20 sm:py-24">
        <div className="max-w-3xl mx-auto px-4 sm:px-6 text-center">
          <div className="text-[11px] tracking-[0.28em] uppercase text-ember mb-4">
            $250 / quarter · billed every 3 months
          </div>
          <h2 className="font-serif text-3xl sm:text-5xl leading-[1.05]">
            See your edit before
            <br />
            you commit.
          </h2>
          <p className="text-base sm:text-lg text-bone/75 mt-6 max-w-xl mx-auto leading-relaxed">
            We'll show you the four pieces we'd send this quarter, plus the
            welcome-gift rangefinder. Then it's your call.
          </p>
          <div className="mt-9 inline-block w-full max-w-sm">
            <QuizLauncher
              variant="primary-large"
              label="Build my Reserve edit"
              source="lp_subscription_final"
            />
          </div>
          <div className="mt-4 text-[11px] tracking-[0.18em] uppercase text-bone/55">
            96% renewal · Free shipping · Cancel anytime after your first quarter
          </div>
        </div>
      </section>

      <footer className="bg-forest-dark text-bone/55 text-xs pt-8 pb-24 lg:pb-8 text-center">
        © {new Date().getFullYear()} Mullybox. All rights reserved.
      </footer>

      {/* ====================== MOBILE STICKY CTA ========================= */}
      <div
        className="lg:hidden fixed bottom-0 inset-x-0 z-40 border-t border-forest/15 bg-bone/95 backdrop-blur-md shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.15)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="max-w-6xl mx-auto px-4 py-3 flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-[10px] tracking-[0.2em] uppercase text-charcoal/55">
              Reserve · 60-second quiz
            </div>
            <div className="font-serif text-base text-forest leading-tight">
              See your edit
            </div>
          </div>
          <div className="flex-1 max-w-[60%]">
            <QuizLauncher
              variant="primary-large"
              label="Build my edit"
              source="lp_subscription_sticky"
            />
          </div>
        </div>
      </div>
    </div>
  );
}
