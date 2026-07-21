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
 * Vertical order is deliberate (mobile budget): label, headline, persona tabs,
 * subheader, social-proof stat, price card, ROI slider. The hero IMAGE column
 * is owned by the page, not this component.
 */

import { useState } from "react";
import { QuizLauncher } from "./QuizLauncher";
import { ConsultOnboardingLauncher } from "./ConsultOnboardingLauncher";
import { PersonaTabs } from "./PersonaTabs";
import { RoiSlider } from "./RoiSlider";
import { GiftCard, GiftModal } from "./GiftModal";
import { HERO_PERSONAS, type PersonaKey } from "./heroPersonas";

const PRIMARY_LARGE =
  "w-full bg-ember hover:bg-ember/90 text-bone py-3.5 rounded-md text-sm font-medium tracking-wide transition cursor-pointer";

const TRUST_STATS = [
  { stat: "96%", label: "Renewal rate" },
  { stat: "4 to 6", label: "Pieces per quarter" },
  { stat: "20+", label: "Brands in rotation" },
] as const;

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
    <div className="lg:col-span-5 order-2 lg:order-none">
      <div className="text-[10px] tracking-[0.28em] uppercase text-forest/60 mb-6">
        Mully Reserve
      </div>
      <h1 className="font-serif text-4xl sm:text-5xl lg:text-[3.4rem] text-forest leading-[1.05]">
        Not a discount subscription box.
      </h1>

      <p className="text-base sm:text-lg text-charcoal/70 mt-6 leading-relaxed max-w-md">
        {active.subheader}
      </p>
      <div className="mt-3 text-[13px] tracking-wide text-forest/70">
        {active.stat}
      </div>

      <PersonaTabs
        value={persona}
        onChange={setPersona}
        className="mt-5"
      />

      {/* Price card — the $250 quarterly anchor, per-piece framing, the
          compact 3-stat trust strip, the CTA (gift persona routes to the gift
          modal), and the gift card entry point. */}
      <div className="mt-8 max-w-sm">
        <div className="flex items-baseline gap-3">
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
        <div className="mt-2 text-sm text-charcoal/70">
          That&rsquo;s $42 to $62 per piece from Rhone, Greyson, and more. Ditch
          retail.
        </div>

        <div className="grid grid-cols-3 gap-2 py-3 mt-4 border-y border-charcoal/[0.08]">
          {TRUST_STATS.map((s) => (
            <div key={s.label}>
              <div className="font-serif text-lg sm:text-xl text-forest leading-none">
                {s.stat}
              </div>
              <div className="mt-1 text-[9px] tracking-[0.24em] uppercase text-charcoal/50">
                {s.label}
              </div>
            </div>
          ))}
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

        <GiftCard className="mt-3" onOpen={() => setGiftOpen(true)} />
      </div>

      <RoiSlider className="mt-8 max-w-sm" />

      <GiftModal
        open={giftOpen}
        onClose={() => setGiftOpen(false)}
        source={`lp_${funnel}_hero`}
      />
    </div>
  );
}
