"use client";

/**
 * Shared hero copy column for /lp/subscription and /lp/consult.
 *
 * The two funnels differ only in which launcher the non-gift CTA opens:
 *   - subscription -> QuizLauncher (style quiz)
 *   - consult      -> ConsultOnboardingLauncher (phone capture, then quiz)
 *
 * Everything else (persona tabs, price card, 3-stat trust strip, per-piece
 * value line, gift card, ROI slider) is identical, so it lives here.
 *
 * Selecting the "Gift for a Golfer" persona swaps the primary CTA to open the
 * gift modal instead of the funnel launcher.
 *
 * Vertical order is deliberate: kicker, headline, persona tabs, one consolidated
 * subcopy paragraph, price block, primary CTA, subtle gift link. The ROI slider
 * and the hero IMAGE column are owned by the page, not this component.
 */

import { useState } from "react";
import { QuizLauncher } from "./QuizLauncher";
import { ConsultOnboardingLauncher } from "./ConsultOnboardingLauncher";
import { PersonaTabs } from "./PersonaTabs";
import { GiftModal } from "./GiftModal";
import { HERO_PERSONAS, type PersonaKey } from "./heroPersonas";

const PRIMARY_LARGE =
  "w-full bg-ember hover:bg-ember/90 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition cursor-pointer";

export function HeroCopyColumn({
  funnel,
}: {
  funnel: "subscription" | "consult";
}) {
  const [persona, setPersona] = useState<PersonaKey>("casual");
  const [giftOpen, setGiftOpen] = useState(false);

  const active = HERO_PERSONAS.find((p) => p.key === persona) ?? HERO_PERSONAS[0];
  const isGift = persona === "gift";
  const source = `lp_${funnel}_hero`;

  return (
    <div className="order-2 md:order-none">
      <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-6">
        Mully Reserve
      </div>
      <h1 className="font-serif text-4xl sm:text-5xl lg:text-[3.4rem] text-forest leading-[1.05]">
        Not a discount subscription box.
      </h1>

      <PersonaTabs value={persona} onChange={setPersona} className="mt-6 mb-6" />

      <p className="text-base text-charcoal/80 leading-relaxed max-w-md">
        {active.subheader}
      </p>

      {/* Price block — the $250 quarterly anchor and one consolidated billing
          line, the CTA immediately below (gift persona routes to the gift
          modal), and a subtle gift link. */}
      <div className="mt-8 max-w-sm">
        <div className="flex items-baseline gap-3">
          <span className="font-serif text-4xl sm:text-5xl text-forest leading-none">
            $250
          </span>
          <span className="text-sm tracking-[0.18em] uppercase text-charcoal/55">
            per quarter
          </span>
        </div>
        <div className="mt-2 text-sm text-charcoal/70">
          Billed every three months. $42 to $62 per piece from premium brands.
        </div>

        <div className="mt-5">
          {isGift ? (
            <button
              type="button"
              onClick={() => setGiftOpen(true)}
              className={PRIMARY_LARGE}
            >
              {active.ctaLabel}
            </button>
          ) : funnel === "subscription" ? (
            <QuizLauncher
              variant="primary-large"
              label={active.ctaLabel}
              source={source}
            />
          ) : (
            <ConsultOnboardingLauncher
              variant="primary-large"
              label={active.ctaLabel}
              source={source}
            />
          )}
        </div>

        {!isGift ? (
          <button
            type="button"
            onClick={() => setGiftOpen(true)}
            className="text-xs text-charcoal/60 hover:text-forest tracking-wide underline underline-offset-4 decoration-charcoal/20 mt-3"
          >
            Gifting? Send it as a gift &rarr;
          </button>
        ) : null}
      </div>

      <GiftModal
        open={giftOpen}
        onClose={() => setGiftOpen(false)}
        source={`lp_${funnel}_hero`}
      />
    </div>
  );
}
