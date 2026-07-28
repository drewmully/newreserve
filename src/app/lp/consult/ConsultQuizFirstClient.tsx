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
 * Below the hero this component renders the SAME shared body as the modal
 * arm (<ConsultLPBody />) so the two arms don't drift on reviews, proof,
 * "Have a guy", "The Quarter", inline mini-quiz, brand logos, curator
 * strip, editorial cross-sell, or footer. The bottom sticky is a
 * "Back to the quiz" scroll-anchor instead of a modal launcher, since the
 * quiz already lives on the page.
 */

import { useEffect } from "react";
import { trackEvent } from "@/lib/tracking";
import { captureAttributionFromUrl } from "@/lib/attribution";
import { GlassHeader } from "@/app/components/ClientComponents";
import { QuizModal } from "@/app/lp/_shared/QuizModal";
import {
  StickyRevealOnScroll,
  StickyRevealSentinel,
} from "@/app/lp/_shared/StickyRevealOnScroll";
import { ConsultLPBody } from "./ConsultLPBody";

export default function ConsultQuizFirstClient() {
  useEffect(() => {
    captureAttributionFromUrl();
    // Same event as the modal-quiz arm so top-of-funnel aggregates cleanly,
    // just stamped with the variant name so PostHog can split funnels.
    trackEvent("lp_consult_view", {
      properties: {
        variant: "inline_quiz",
        ab_variant: "inline_quiz",
        surface: "inline_quiz_lp",
      },
    });
  }, []);

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

      {/* Sticky-reveal sentinel is placed AFTER the quiz section (unlike the
          modal arm where it sits after the hero). On this arm the quiz IS
          the hero, so we only want the "Back to the quiz" nudge to appear
          if the user has scrolled past the quiz entirely. */}
      <StickyRevealSentinel />

      {/* Shared below-hero body — identical to the modal arm so the two
          A/B arms don't drift on reviews, proof, "Have a guy",
          "The Quarter", inline mini-quiz, brand logos, curator strip,
          editorial cross-sell, or footer. */}
      <ConsultLPBody />

      {/* ====================== MOBILE STICKY CTA =========================
          Sticky reveals only once the visitor has scrolled past the entire
          quiz section, at which point they've clearly bounced off the quiz
          and a scroll-back-up nudge is warranted. This is an <a href="#quiz">
          scroll-anchor, not a modal launcher, because the quiz already
          lives on the page. */}
      <StickyRevealOnScroll>
        <a
          href="#quiz"
          className="block w-full rounded-md bg-ember py-4 text-center text-base font-medium text-bone transition hover:bg-ember/90"
        >
          Back to the quiz · 60s
        </a>
      </StickyRevealOnScroll>
    </div>
  );
}
