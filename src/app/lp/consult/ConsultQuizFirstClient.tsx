"use client";

/**
 * /lp/consult — quiz-first A/B arm (mr_ab bucket 50..99).
 *
 * The quiz IS the hero. No CTA click required to start — Question 1 renders
 * inline above the fold and clicking a style card auto-advances to Q2 in
 * place. No modal, no Step-0 phone screen, no phone collection anywhere.
 *
 * Completion flow (identical to QuizModal today):
 *   - Step 0 answer creates the profile via /api/quiz/start
 *   - Each subsequent step saves via /api/quiz/step (fire-and-forget)
 *   - Step 5 (brands + play frequency) routes to /lp/reserve/reveal/{profileId}
 *     — the RevealBrick surface, unchanged.
 *
 * We render the existing <QuizModal /> without an onClose prop, which
 * suppresses its Close button. The QuizModal container is layout-friendly
 * (mx-auto max-w-2xl, no fixed positioning) so it drops into the hero shell
 * cleanly.
 *
 * Sections below the quiz — reviews, proof stats, "have a guy", the quarter,
 * how it works, brand logos, curator strip, editorial cross-sell — are copied
 * from ConsultLPClient so the below-fold experience is identical between the
 * two A/B arms. The bottom mobile sticky CTA is replaced with a "scroll to
 * quiz" nudge instead of a modal launcher, since the quiz lives on the page.
 */

import Image from "next/image";
import Link from "next/link";
import { useEffect } from "react";
import { trackEvent } from "@/lib/tracking";
import { captureAttributionFromUrl } from "@/lib/attribution";
import { GlassHeader } from "@/app/components/ClientComponents";
import { QuizModal } from "@/app/lp/_shared/QuizModal";
import { RECENT_BOX_PRODUCTS } from "../_shared/products";
import { ReviewsBlock } from "../_shared/LPSections";
import { CuratorStrip } from "../_shared/CuratorStrip";

const BRAND_LOGOS = [
  { src: "/brands/greyson.svg", alt: "Greyson" },
  { src: "/brands/rhone.svg", alt: "Rhone" },
  { src: "/brands/quiet-golf.svg", alt: "Quiet Golf" },
  { src: "/brands/field-day.svg", alt: "Field Day" },
  { src: "/brands/penfold.svg", alt: "Penfold" },
  { src: "/brands/tasc.svg", alt: "TASC" },
  { src: "/brands/anderson-ord.svg", alt: "Anderson Ord" },
  { src: "/brands/olydoe.svg", alt: "Olydoe" },
  { src: "/brands/will-leather.svg", alt: "Will Leather" },
];

const HOW_IT_WORKS = [
  {
    n: "01",
    title: "Answer six questions",
    body: "Style, sizing, brands you like. Sixty seconds.",
  },
  {
    n: "02",
    title: "See your edit",
    body: "Martine hand-picks four pieces. You review before you pay.",
  },
  {
    n: "03",
    title: "Fit-confirm and ship",
    body: "We double-check sizing after checkout. Free exchanges.",
  },
];

const PROOF_STATS = [
  { stat: "96%", label: "Renewal rate" },
  { stat: "4.9", label: "Member rating" },
  { stat: "20+", label: "Brands in rotation" },
  { stat: "1", label: "Stylist on your fit" },
];

export default function ConsultQuizFirstClient() {
  useEffect(() => {
    captureAttributionFromUrl();
    // Same event as the phone-gated arm so top-of-funnel aggregates cleanly,
    // just stamped with the variant name so PostHog can split funnels.
    trackEvent("lp_consult_view", {
      properties: { variant: "inline_quiz", surface: "inline_quiz_lp" },
    });
  }, []);

  // Editorial grid — individual apparel photography.
  const gridShots = [
    RECENT_BOX_PRODUCTS[0], // Rhone Commuter — Top
    RECENT_BOX_PRODUCTS[1], // Adidas Ultimate 365 — Bottoms
    RECENT_BOX_PRODUCTS[2], // Peter Millar Sun Hoodie — Layer
    RECENT_BOX_PRODUCTS[3], // Will Leather Braided Belt — Accessory
  ].filter(Boolean);

  return (
    <div className="min-h-screen bg-white text-charcoal">
      <GlassHeader />

      {/* ============================== HERO ==============================
          The quiz is the hero. A short kicker + one-line headline sits above
          the quiz card; the quiz itself (rendered without a Close button)
          takes the primary visual weight. On mobile the entire hero is the
          quiz card so Question 1 is unambiguously the first thing seen. */}
      <section
        id="quiz"
        className="pt-24 sm:pt-28 lg:pt-32 pb-8 sm:pb-12 scroll-mt-20"
      >
        <div className="max-w-3xl mx-auto px-4 sm:px-6">
          <div className="text-center mb-8 sm:mb-10">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              Mully Reserve
            </div>
            <h1 className="font-serif text-3xl sm:text-4xl lg:text-[2.7rem] text-forest leading-[1.1]">
              Let&apos;s build your edit.
            </h1>
            <p className="text-sm sm:text-base text-charcoal/65 mt-3 max-w-md mx-auto leading-relaxed">
              Six questions, 60 seconds. See your quarterly picks before you
              commit — no phone number required.
            </p>
          </div>

          {/* Quiz card — the existing QuizModal, rendered chromeless (no
              onClose ⇒ no Close button) and framed as an inline hero card.
              The QuizModal already handles its own progress bar, step
              persistence, and reveal-brick handoff. */}
          <div className="rounded-md border border-forest/10 bg-white shadow-[0_1px_2px_rgba(0,0,0,0.03),0_8px_28px_-16px_rgba(20,40,30,0.18)] px-2 py-8 sm:px-4 sm:py-10">
            <QuizModal source="lp_consult_quiz_first" />
          </div>

          <div className="mt-5 text-center text-[11px] tracking-[0.2em] uppercase text-charcoal/45">
            $250 / quarter · cancel after your first · 96% renewal
          </div>
        </div>
      </section>

      {/* ========================= MEMBER REVIEWS ======================== */}
      <section className="bg-white py-16 md:py-20">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center mb-10 sm:mb-12">
            <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-4">
              Member reviews
            </div>
            <h2 className="font-serif text-3xl sm:text-4xl text-forest">
              What members are saying
            </h2>
          </div>
          <div
            className="junip-review-carousel"
            data-title=""
            data-reviews-type="store_reviews"
            data-show-summary="true"
          />
        </div>
      </section>

      {/* ====================== PROOF / STAT STRIP ======================= */}
      <section className="mt-4 sm:mt-8 border-y border-charcoal/[0.08] py-12">
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

      {/* =========================== FINAL CTA ============================
          On this arm the "final CTA" nudges the visitor back up to the quiz
          instead of opening a modal. If they scrolled all the way down
          without engaging, this is their prompt. */}
      <section className="bg-forest text-bone py-24 sm:py-28">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 text-center">
          <div className="text-[10px] tracking-[0.28em] uppercase text-bone/50 mb-5">
            $250 / quarter · billed every 3 months
          </div>
          <h2 className="font-serif text-3xl sm:text-5xl leading-[1.08]">
            See your edit before you commit.
          </h2>
          <p className="text-base sm:text-lg text-bone/70 mt-6 max-w-xl mx-auto leading-relaxed">
            Martine dials in your fit, then we show you the pieces we would send
            this quarter. Then it is your call.
          </p>
          <div className="mt-10 inline-block w-full max-w-sm">
            <a
              href="#quiz"
              className="block w-full rounded-md bg-ember py-4 text-base font-medium text-bone transition hover:bg-ember/90"
            >
              Start the quiz
            </a>
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
          Anchors down to the quiz section instead of opening a modal. The
          [data-consult-open] variant hide from the phone-gated arm is not
          needed here — there is no modal to conflict with — but we mirror
          the styling so users toggling between arms see a consistent bar. */}
      <div
        data-lp-sticky
        className="lg:hidden fixed bottom-0 inset-x-0 z-50 border-t border-charcoal/10 bg-white/95 backdrop-blur-md shadow-[0_-4px_16px_-8px_rgba(0,0,0,0.15)]"
        style={{ paddingBottom: "env(safe-area-inset-bottom, 0px)" }}
      >
        <div className="max-w-6xl mx-auto px-4 py-3">
          <a
            href="#quiz"
            className="block w-full rounded-md bg-ember py-4 text-center text-base font-medium text-bone transition hover:bg-ember/90"
          >
            Start the quiz · 60s
          </a>
        </div>
      </div>
    </div>
  );
}
