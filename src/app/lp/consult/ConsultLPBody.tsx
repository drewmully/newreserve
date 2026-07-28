"use client";

/**
 * Shared body for /lp/consult — everything below the hero, ABOVE the
 * mobile sticky CTA.
 *
 * Both arms of the /lp/consult A/B (modal_quiz and inline_quiz) render
 * this component immediately after their own hero section:
 *
 *   - ConsultLPClient (modal arm)   → editorial hero + <ConsultLPBody />
 *   - ConsultQuizFirstClient (inline arm) → inline quiz hero + <ConsultLPBody />
 *
 * Extracted 2026-07-28 to eliminate below-hero drift between the two arms.
 * Any change to reviews, proof strip, "Have a guy", "The Quarter", inline
 * mini-quiz, brand logos, curator strip, editorial cross-sell, or footer
 * MUST go here so both arms stay pixel-identical below the hero.
 *
 * The mobile sticky CTA is intentionally NOT part of this body. Each arm
 * renders its own sticky because they have different behaviours:
 *   - modal arm  → sticky opens the ConsultOnboardingLauncher modal
 *   - inline arm → sticky is a "Back to the quiz" scroll-anchor to #quiz
 */

import Image from "next/image";
import Link from "next/link";
import { RECENT_BOX_PRODUCTS } from "../_shared/products";
import { CuratorStrip } from "../_shared/CuratorStrip";
import { HeroMiniQuiz } from "../_shared/HeroMiniQuiz";
import { RoiSlider } from "../_shared/RoiSlider";

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

const PROOF_STATS = [
  { stat: "96%", label: "Renewal rate" },
  { stat: "4 to 6", label: "Pieces per quarter" },
  { stat: "20+", label: "Brands in rotation" },
  { stat: "1", label: "Stylist on your fit" },
];

export function ConsultLPBody() {
  // Editorial grid — individual apparel photography so the grid reads as
  // wardrobe pieces, not package contents.
  const gridShots = [
    RECENT_BOX_PRODUCTS[0], // Rhone Quarter Zip — Layer
    RECENT_BOX_PRODUCTS[2], // Quiet Golf Vintage Polo — Polo
    RECENT_BOX_PRODUCTS[4], // Field Day Repel Hoodie — Outerwear
    RECENT_BOX_PRODUCTS[3], // Will Leather Braided Belt — Accessory
  ].filter(Boolean);

  return (
    <>
      {/* ========================= MEMBER REVIEWS ========================
          Junip product-review widget (review wall) for the Reserve Member
          product. The Junip script is loaded globally in app/layout.tsx and
          hydrates the matching .junip-product-review node after mount. Framed
          by our own editorial label + h2. */}
      <section className="bg-white py-16 md:py-24">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10 sm:mb-12">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              Member reviews
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              What members are saying
            </h2>
          </div>
          <span className="junip-product-review" data-product-id="8501257044160" />
        </div>
      </section>

      {/* =========================== SEE THE VALUE =======================
          ROI slider in its own calm section. Faint off-white background sets
          it apart. Sits after reviews, ahead of the inline mini-quiz. */}
      <section className="bg-[#FAF9F6] py-16 md:py-24">
        <div className="max-w-2xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              See the value
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              How often do you shop for gear?
            </h2>
          </div>
          <RoiSlider className="max-w-2xl mx-auto" />
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
                Ships in 1 business day
              </div>
              <div className="text-sm text-bone/75 leading-relaxed">
                Your first edit typically ships within 1 business day. Sizing is
                confirmed after checkout with a 60-second form.
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

      {/* ===================== INLINE MINI STYLE QUIZ ==================== */}
      <HeroMiniQuiz source="lp_consult_hero" />

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

      {/* ========================== CURATOR STRIP ========================= */}
      <CuratorStrip />

      {/* ====================== EDITORIAL CROSS-SELL ===================== */}
      <section className="bg-bone py-20 sm:py-24">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center">
          <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-5">
            Prefer to pick your own?
          </div>
          <h2 className="font-serif text-3xl sm:text-4xl text-forest leading-tight">
            See our edits.
          </h2>
          <p className="text-base sm:text-lg text-charcoal/70 mt-6 leading-relaxed">
            The full Mully edit, browsable anytime. Curated pieces, resort
            profiles, and the Mully 100.
          </p>
          <div className="mt-8">
            <Link
              href="/lp/editorial"
              className="inline-block bg-ember hover:bg-ember/90 text-bone py-3.5 px-10 rounded-md text-sm font-medium tracking-wide transition cursor-pointer"
            >
              See the Editorial
            </Link>
          </div>
        </div>
      </section>

      <footer className="bg-forest-dark text-bone/55 text-xs pt-8 pb-24 lg:pb-8 text-center">
        © {new Date().getFullYear()} Mully Group, Inc. All rights reserved.
      </footer>
    </>
  );
}
