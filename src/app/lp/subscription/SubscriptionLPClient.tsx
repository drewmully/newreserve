"use client";

/**
 * Mully Reserve — /lp/subscription landing page.
 *
 * Editorial restyle (2026-07-20): white background, Playfair headlines,
 * Inter body, generous whitespace, thin serif headings, 10px tracked
 * uppercase labels. Positioning is luxury/considered, not value/discount.
 *
 * Data wiring is untouched: the quiz -> reveal -> checkout flow is owned by
 * QuizLauncher/QuizModal. Analytics event names and launcher `source`
 * identifiers are preserved exactly.
 *
 * Strategic constraints (do NOT change without product sign-off):
 *   - Primary CTA everywhere is the style quiz (QuizLauncher).
 *   - Value anchor is the quarterly $250 price, presented as the cost of a
 *     considered edit, never a coupon or a percentage saved.
 *   - The mobile sticky CTA is a single full-width tap target so the whole
 *     visible bar routes into the same quiz/checkout flow as desktop.
 */

import Image from "next/image";
import { useEffect } from "react";
import { trackEvent } from "@/lib/tracking";
import { captureAttributionFromUrl } from "@/lib/attribution";
import { GlassHeader } from "@/app/components/ClientComponents";
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
    body: "60 seconds on style, fit, and sizes.",
  },
  {
    n: "02",
    title: "See your edit",
    body: "We show you the pieces we would send before you commit to anything.",
  },
  {
    n: "03",
    title: "Get your quarter",
    body: "Hand-picked apparel, delivered every three months.",
  },
];

const PROOF_STATS = [
  { stat: "96%", label: "Renewal rate" },
  { stat: "4 to 6", label: "Pieces per quarter" },
  { stat: "20+", label: "Brands in rotation" },
  { stat: "1", label: "Stylist on your fit" },
];

export default function SubscriptionLPClient() {
  // Editorial grid — individual apparel photography so the grid reads as
  // wardrobe pieces, not package contents.
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

  return (
    <div className="min-h-screen bg-white text-charcoal">
      <GlassHeader />

      {/* ============================== HERO ============================== */}
      <section className="pt-24 sm:pt-28 lg:pt-32">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 lg:gap-16 items-center">
            {/* Copy column */}
            <div className="lg:col-span-5 order-2 lg:order-none">
              <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-6">
                Mully Reserve
              </div>
              <h1 className="font-serif text-4xl sm:text-5xl lg:text-[3.4rem] text-forest leading-[1.05]">
                Not a discount subscription box.
              </h1>
              <p className="text-base sm:text-lg text-charcoal/70 mt-6 leading-relaxed max-w-md">
                A quarterly edit of premium apparel, handpicked for your game.
                No two boxes are the same. Get started if you want to be the
                most dialed in player in your clubhouse.
              </p>

              {/* Price — prominent per Drew. The $250 quarterly figure is the
                  anchor, framed as the price of a considered edit. */}
              <div className="mt-8 flex items-baseline gap-3">
                <span className="font-serif text-4xl sm:text-5xl text-forest leading-none">
                  $250
                </span>
                <span className="text-sm tracking-[0.18em] uppercase text-charcoal/55">
                  per quarter
                </span>
              </div>
              <div className="mt-1 text-[13px] text-charcoal/50">
                Billed every three months. Cancel after your first quarter.
              </div>

              {/* Primary CTA — quiz */}
              <div className="mt-8 max-w-sm">
                <QuizLauncher
                  variant="primary-large"
                  label="Get Started · 60s"
                  source="lp_subscription_hero"
                />
                <div className="mt-3 text-[10px] tracking-[0.2em] uppercase text-charcoal/45 text-center">
                  See your edit before you commit.
                </div>
              </div>
            </div>

            {/* Hero image — new editorial shoot (local asset). */}
            <div className="lg:col-span-7 order-1 lg:order-none">
              <div className="md:max-w-[85%] md:ml-auto">
                <Image
                  src="/subscription-hero.jpg"
                  alt="A Mully Reserve quarterly edit of premium golf apparel, styled flat on an editorial surface."
                  width={1200}
                  height={1200}
                  sizes="(min-width: 768px) 42vw, 100vw"
                  className="w-full h-auto"
                  priority
                />
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ====================== PROOF / STAT STRIP ======================= */}
      <section className="mt-20 sm:mt-28 border-y border-charcoal/[0.08] py-12">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 grid grid-cols-2 sm:grid-cols-4 gap-8">
          {PROOF_STATS.map((p) => (
            <div key={p.label} className="text-center">
              <div className="font-serif text-3xl sm:text-4xl text-forest">
                {p.stat}
              </div>
              <div className="text-[10px] tracking-[0.22em] uppercase text-charcoal/50 mt-2">
                {p.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* ========================= "HAVE A GUY" =========================== */}
      <section className="py-20 sm:py-28">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center">
          <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-5">
            The idea
          </div>
          <h2 className="font-serif text-3xl sm:text-4xl text-forest leading-tight">
            You should have someone who handles your golf wardrobe.
          </h2>
          <p className="text-base sm:text-lg text-charcoal/70 mt-6 leading-relaxed">
            Four times a year we send the pieces we reach for ourselves. Brands
            worth knowing (Greyson, Rhone, Quiet Golf, Field Day, Penfold), fit
            confirmed before anything ships.
          </p>
        </div>

        {/* Editorial grid — individual apparel photography. */}
        <div className="max-w-6xl mx-auto px-5 sm:px-8 mt-14">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-6">
            {gridShots.map((p) => (
              <figure key={p.image} className="relative">
                <div className="relative aspect-[3/4] overflow-hidden rounded-sm border border-charcoal/[0.06] bg-bone-dark/20">
                  <Image
                    src={p.image}
                    alt={`${p.vendor} ${p.title}`}
                    fill
                    sizes="(min-width: 1024px) 24vw, 50vw"
                    className="object-cover"
                    unoptimized
                  />
                </div>
                <figcaption className="mt-3 text-[10px] tracking-[0.2em] uppercase text-charcoal/50">
                  {p.vendor} · {p.category}
                </figcaption>
              </figure>
            ))}
          </div>
        </div>
      </section>

      {/* ======================= THE QUARTER (forest panel) ============== */}
      <section className="py-20 sm:py-24 bg-forest text-bone">
        <div className="max-w-5xl mx-auto px-5 sm:px-8">
          <div className="text-center max-w-3xl mx-auto">
            <div className="text-[10px] tracking-[0.28em] uppercase text-bone/50 mb-5">
              The quarter
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl leading-tight">
              A considered edit, built around how you play.
            </h2>
            <p className="text-base sm:text-lg text-bone/75 mt-6 leading-relaxed">
              Four pieces tuned to your style and size, apparel and accessories
              that earn a place in your rotation. Nothing ships until your
              sizing is confirmed. If a piece misses, we exchange it.
            </p>
          </div>

          <div className="mt-14 grid grid-cols-1 sm:grid-cols-3 gap-6">
            <div className="rounded-sm border border-bone/15 p-6">
              <div className="text-[10px] tracking-[0.22em] uppercase text-bone/50 mb-3">
                Ships in 7 days
              </div>
              <div className="text-sm text-bone/75 leading-relaxed">
                Sizing is confirmed after checkout with a 60-second form. Your
                quarter ships within a week.
              </div>
            </div>
            <div className="rounded-sm border border-bone/15 p-6">
              <div className="text-[10px] tracking-[0.22em] uppercase text-bone/50 mb-3">
                Free size exchanges
              </div>
              <div className="text-sm text-bone/75 leading-relaxed">
                If a fit misses, we swap it. No restocking fees, no return
                shipping on your end.
              </div>
            </div>
            <div className="rounded-sm border border-bone/15 p-6">
              <div className="text-[10px] tracking-[0.22em] uppercase text-bone/50 mb-3">
                Cancel after Q1
              </div>
              <div className="text-sm text-bone/75 leading-relaxed">
                Take one full quarter. If Reserve is not for you, cancel before
                the next quarter bills. No calls, no forms.
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ========================= HOW IT WORKS =========================== */}
      <section className="py-20 sm:py-28">
        <div className="max-w-5xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-14">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              How it works
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              Three steps. Sixty seconds.
            </h2>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-10 sm:gap-12">
            {HOW_IT_WORKS.map((s) => (
              <div key={s.n} className="text-center sm:text-left">
                <div className="font-serif text-4xl text-forest/25 mb-4 leading-none">
                  {s.n}
                </div>
                <div className="font-serif text-xl text-forest">{s.title}</div>
                <div className="text-sm text-charcoal/65 mt-2 leading-relaxed">
                  {s.body}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ========================== BRAND LOGOS =========================== */}
      <section className="py-14 sm:py-16 border-y border-charcoal/[0.08]">
        <div className="max-w-5xl mx-auto px-5 sm:px-8">
          <div className="text-center text-[10px] tracking-[0.28em] uppercase text-charcoal/45 mb-8">
            Brands in the rotation
          </div>
          <div className="grid grid-cols-3 sm:grid-cols-5 lg:grid-cols-9 gap-x-6 gap-y-7 items-center">
            {BRAND_LOGOS.map((b) => (
              <div key={b.alt} className="relative h-8 sm:h-9">
                <Image
                  src={b.src}
                  alt={b.alt}
                  fill
                  sizes="80px"
                  className="object-contain opacity-60"
                />
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ============================ REVIEWS ============================= */}
      <ReviewsBlock />

      {/* ========================== CURATOR STRIP ========================= */}
      <CuratorStrip />

      {/* =========================== FINAL CTA ============================ */}
      <section className="bg-forest text-bone py-24 sm:py-28">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center">
          <div className="text-[10px] tracking-[0.28em] uppercase text-bone/50 mb-5">
            $250 / quarter · billed every 3 months
          </div>
          <h2 className="font-serif text-3xl sm:text-5xl leading-[1.08]">
            See your edit before you commit.
          </h2>
          <p className="text-base sm:text-lg text-bone/70 mt-6 max-w-xl mx-auto leading-relaxed">
            We will show you the pieces we would send this quarter. Then it is
            your call.
          </p>
          <div className="mt-10 inline-block w-full max-w-sm">
            <QuizLauncher
              variant="primary-large"
              label="Get Started"
              source="lp_subscription_final"
            />
          </div>
          <div className="mt-4 text-[10px] tracking-[0.2em] uppercase text-bone/45">
            96% renewal · Free shipping · Cancel anytime after your first quarter
          </div>
        </div>
      </section>

      <footer className="bg-forest-dark text-bone/55 text-xs pt-8 pb-24 lg:pb-8 text-center">
        © {new Date().getFullYear()} Mully Group, Inc. All rights reserved.
      </footer>

      {/* ====================== MOBILE STICKY CTA =========================
          Single full-width tap target. The previous bar rendered its label in
          a non-interactive <div> alongside a narrow button, so taps on the
          label region (most of the bar) did nothing. The whole visible bar is
          now the QuizLauncher button and routes into the same quiz/checkout
          flow as the desktop CTA. z-50 keeps it above page content. */}
      <div
        className="lg:hidden fixed bottom-0 inset-x-0 z-50 border-t border-charcoal/10 bg-white/95 backdrop-blur-md shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.15)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="max-w-6xl mx-auto px-4 py-3">
          <QuizLauncher
            variant="primary-large"
            label="Get Started · $250/quarter"
            source="lp_subscription_sticky"
          />
        </div>
      </div>
    </div>
  );
}
