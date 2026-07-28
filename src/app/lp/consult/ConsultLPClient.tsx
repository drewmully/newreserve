"use client";

/**
 * /lp/consult — Meta-optimized funnel landing page (MODAL-QUIZ arm).
 *
 * Editorial restyle (2026-07-20): mirrors /lp/subscription's editorial look
 * (white background, Playfair headlines, Inter body, generous whitespace,
 * 10px tracked uppercase labels). Positioning is luxury/considered.
 *
 * Funnel: ConsultOnboardingLauncher opens the shared style quiz -> reveal
 * -> checkout. (Phone gate removed 2026-07-09; `skipPhone` is passed on
 * every launcher.)
 *
 * Below-hero content is shared with the inline-quiz arm via
 * <ConsultLPBody />. Anything reviews/proof/have-a-guy/quarter/logos/
 * curator/cross-sell related MUST be edited there, not here, or the arms
 * will drift again.
 *
 * Strategic constraints (do NOT change without product sign-off):
 *   - Consult CTA (ConsultOnboardingLauncher) wins every CTA collision.
 *   - Value anchor is the quarterly $250 price, presented as the cost of a
 *     considered edit, never a coupon or a percentage saved.
 *   - The mobile sticky CTA is a single full-width tap target so the whole
 *     visible bar routes into the same onboarding/checkout flow as desktop.
 */

import Image from "next/image";
import { useEffect } from "react";
import { trackEvent } from "@/lib/tracking";
import { captureAttributionFromUrl } from "@/lib/attribution";
import { GlassHeader } from "@/app/components/ClientComponents";
import {
  StickyRevealOnScroll,
  StickyRevealSentinel,
} from "../_shared/StickyRevealOnScroll";
import { HeroCopyColumn } from "../_shared/HeroCopyColumn";
import { ConsultOnboardingLauncher } from "../_shared/ConsultOnboardingLauncher";
import { ConsultLPBody } from "./ConsultLPBody";

// This client renders the MODAL-QUIZ (control) arm of /lp/consult.
// The inline-quiz variant is ConsultQuizFirstClient, selected server-side
// in page.tsx based on the mr_ab cookie bucket.
//
// A/B is a pure modal-quiz vs inline-quiz test on top-of-funnel container:
// this arm keeps the standard editorial LP (HeroMiniQuiz mid-page via
// <ConsultLPBody />, sticky opens the ConsultOnboardingLauncher modal);
// the other arm makes the full quiz the hero. `variant` is stamped on
// lp_consult_view so funnel splits are clean.
export type ConsultVariant = "modal_quiz" | "inline_quiz";

export default function ConsultLPClient({
  variant = "modal_quiz",
}: {
  variant?: ConsultVariant;
} = {}) {
  useEffect(() => {
    captureAttributionFromUrl();
    // Fires both client-side fbq (Meta ViewContent) and server-side CAPI
    // via the analytics.ts META_EVENT_MAP mapping. `variant` stamps the A/B
    // arm on every LP view so top-of-funnel comparisons are clean.
    trackEvent("lp_consult_view", {
      properties: { variant, ab_variant: variant },
    });
  }, [variant]);

  return (
    <div className="min-h-screen bg-white text-charcoal">
      <GlassHeader />

      {/* ============================== HERO ============================== */}
      {/* Sticky-reveal sentinel is placed right after the hero closes; while
          it's in the viewport, the mobile sticky CTA stays hidden. As soon
          as the user scrolls past the hero, IntersectionObserver flips the
          sticky in. Keeps the fold clean and non-competitive with the hero
          CTA. */}
      <section className="pt-24 sm:pt-28 lg:pt-32 pb-16 md:pb-24">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-10 lg:gap-16 items-center md:items-center">
            {/* Copy column — persona tabs, price block, CTA, subtle gift link. */}
            <HeroCopyColumn funnel="consult" skipPhone />

            {/* Hero image — shared editorial shoot (local asset). */}
            <div className="order-1 md:order-none">
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

      {/* Sticky-reveal sentinel: while this 1px element is in the viewport,
          the mobile sticky CTA below is hidden. Placed right after the hero
          closes so the sticky only appears once the user has scrolled past
          the hero. */}
      <StickyRevealSentinel />

      {/* All content below the hero lives in the shared body so the two
          /lp/consult A/B arms don't drift. The mobile sticky below is
          arm-specific (modal arm opens the modal quiz; inline arm scrolls
          back to the inline quiz). */}
      <ConsultLPBody />

      {/* ====================== MOBILE STICKY CTA =========================
          Sticky reveals only after the user scrolls past the hero (via the
          StickyRevealSentinel above). data-lp-sticky is auto-added by
          StickyRevealOnScroll so the global rule in globals.css also hides
          the bar while [data-consult-open] is set (modal is open).
          skipPhone opens the modal directly on the quiz — no Step-0
          name+phone gate. */}
      <StickyRevealOnScroll>
        <ConsultOnboardingLauncher
          variant="primary-large"
          label="Get Started · $250/quarter"
          source="lp_consult_sticky"
          skipPhone
        />
      </StickyRevealOnScroll>
    </div>
  );
}
