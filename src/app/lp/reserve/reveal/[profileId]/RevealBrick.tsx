"use client";

/**
 * Reveal Page — Tier Picker (2026-09-18 rewrite, 2026-09-18 image update).
 *
 * The reveal step is the last conversion moment. Three tiers:
 *
 *   Discovery ($50 first, then $250/quarter, 2 to 4 pieces, ~$60 retail)
 *   Signature ($125 first, then $250/quarter, 3 to 5 pieces, ~$160 retail)
 *   Reserve   ($250 first, then $250/quarter, 4 to 6 pieces, ~$310 retail)
 *
 * Each card renders a small square thumbnail of that tier's real Box-Preview
 * photograph (assets shared with the retired /lp/discover surface). Tapping
 * the thumbnail opens a lightbox with a large image and a clear close button
 * so a visitor can inspect the shipment before selecting a tier.
 *
 * The trust-chip row below the CTA reflects the currently selected tier. On
 * initial load, before the visitor has actively tapped a tier card, the chips
 * default to Reserve's numbers (4 to 6 pieces / $310 in retail) so the
 * aspirational spec is the baseline. A card tap syncs the chips to that tier
 * for the remainder of the session.
 *
 * Copy rules (must hold across the file):
 *   - No em or double dashes anywhere. Use commas, periods, parentheses.
 *   - Reserve renewal price is $250. Never $249.
 *   - Never use the word "box". Use "edit" / "quarter" / "curation".
 *   - "Mully", never "Mullybox".
 *   - Limit text. Chip icons + short lines. No AI filler.
 */

import Image from "next/image";
import { useCallback, useEffect, useState } from "react";
import type { StyleBucket } from "@/lib/styleProfiles/types";
import {
  ReserveCheckoutCTA,
  TIER_META,
  type QuizLineItemPropsInput,
  type ReserveTier,
} from "./ReserveCheckoutCTA";
import { RevealPageView } from "./RevealPageView";

interface RevealBrickProps {
  profileId: string;
  bucket: StyleBucket;
  quizLineItemProps: QuizLineItemPropsInput;
  alreadyConverted: boolean;
  /**
   * Optional first name from the quiz submission. Not currently rendered on
   * the tier picker surface (kept in the interface for callers).
   */
  firstName?: string;
  /**
   * Gift mode (Father's Day flow). Currently routes to the same tier picker
   * with a small copy tweak; the giftMode flag is retained for the wrapper
   * page but this surface treats it identically to the standard flow. The
   * dedicated gift flow lives at /lp/gift.
   */
  giftMode?: boolean;
}

const TIER_ORDER: ReserveTier[] = ["discovery", "signature", "reserve"];

// Short, punchy blurb per tier. One line max. No "box", no em dashes, no AI.
const TIER_BLURB: Record<ReserveTier, string> = {
  discovery: "A shorter first shipment. Try the format before you go all in.",
  signature: "Half the first quarter, curated the same way. Most-picked.",
  reserve: "The full quarterly edit from day one.",
};

// Piece counts + retail per tier. Retail = +25% of first-quarter price,
// rounded to the nearest $10. Discovery: $50 -> $60. Signature: $125 -> $160.
// Reserve: $250 -> $310.
const TIER_SPECS: Record<ReserveTier, { pieces: string; retail: string }> = {
  discovery: { pieces: "2 to 4 pieces", retail: "$60 in retail" },
  signature: { pieces: "3 to 5 pieces", retail: "$160 in retail" },
  reserve: { pieces: "4 to 6 pieces", retail: "$310 in retail" },
};

// Preview photography per tier. These are the same production photos we shot
// for /lp/discover; the reveal tier picker inherits them so every visitor
// coming through the quiz sees a real edit before committing.
const TIER_IMAGES: Record<
  ReserveTier,
  { thumb: string; full: string; alt: string }
> = {
  discovery: {
    thumb: "/lp/discover/Box-Preview-Discovery-5.jpg",
    full: "/lp/discover/Box-Preview-Discovery-5.jpg",
    alt: "A Discovery first shipment: two to four Mully pieces laid out on natural linen.",
  },
  signature: {
    thumb: "/lp/discover/Box-Preview-Signature-4.jpg",
    full: "/lp/discover/Box-Preview-Signature-4.jpg",
    alt: "A Signature Preview shipment: three to five Mully pieces laid out on natural linen.",
  },
  reserve: {
    thumb: "/lp/discover/Box-Preview-Reserve-6.jpg",
    full: "/lp/discover/Box-Preview-Reserve-6.jpg",
    alt: "A full Reserve Collection quarter: four to six Mully pieces laid out on natural linen.",
  },
};

// Which tier gets the visual center weight + default selection.
// Signature is the anchor because Discovery-first cohorts historically
// churn harder and full-price Reserve is a harder ask cold.
const DEFAULT_TIER: ReserveTier = "signature";

// Small label on the visually-central tier.
const RECOMMENDED_TIER: ReserveTier = "signature";

// The chips row defaults to Reserve numbers on first paint (before any tier
// card is tapped), so the visitor sees the aspirational quarter spec first
// even though Signature is pre-selected in the picker.
const DEFAULT_CHIPS_TIER: ReserveTier = "reserve";

export function RevealBrick({
  profileId,
  bucket,
  quizLineItemProps,
  alreadyConverted,
}: RevealBrickProps) {
  const [selectedTier, setSelectedTier] = useState<ReserveTier>(DEFAULT_TIER);

  // Chips display a separate tier state so we can keep Reserve's numbers up
  // by default and switch to the visitor's own pick only after they tap.
  const [chipsTouched, setChipsTouched] = useState(false);
  const chipsTier: ReserveTier = chipsTouched ? selectedTier : DEFAULT_CHIPS_TIER;
  const chipsSpec = TIER_SPECS[chipsTier];

  const [lightboxTier, setLightboxTier] = useState<ReserveTier | null>(null);
  const closeLightbox = useCallback(() => setLightboxTier(null), []);

  // Escape closes the lightbox.
  useEffect(() => {
    if (!lightboxTier) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closeLightbox();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightboxTier, closeLightbox]);

  if (alreadyConverted) {
    return <BrickConvertedState />;
  }

  return (
    <main className="min-h-screen bg-bone text-charcoal">
      <RevealPageView profileId={profileId} bucket={bucket} variant="v3_tier_picker" />

      <section className="mx-auto flex min-h-screen max-w-xl flex-col px-5 py-8 sm:px-6 sm:py-12">
        {/* Kicker + one-line headline */}
        <div className="text-center">
          <p className="text-[10px] font-medium uppercase tracking-[0.24em] text-ember/90">
            Your quiz is in
          </p>
          <h1 className="mt-2 font-serif text-2xl leading-[1.15] text-forest sm:text-3xl">
            Pick your first quarter.
          </h1>
          <p className="mt-2 text-sm text-charcoal/70 sm:text-base">
            All three renew at $250 / quarter after the first. Cancel anytime.
          </p>
        </div>

        {/* Tier picker */}
        <fieldset className="mt-7 space-y-3">
          <legend className="sr-only">Pick your first quarter</legend>
          {TIER_ORDER.map((tier) => (
            <TierCard
              key={tier}
              tier={tier}
              selected={selectedTier === tier}
              onSelect={() => {
                setSelectedTier(tier);
                setChipsTouched(true);
              }}
              onOpenImage={() => setLightboxTier(tier)}
              recommended={tier === RECOMMENDED_TIER}
            />
          ))}
        </fieldset>

        {/* Single CTA */}
        <div className="mt-6">
          <ReserveCheckoutCTA
            profileId={profileId}
            styleBucket={bucket}
            tier={selectedTier}
            quizLineItemProps={quizLineItemProps}
          />
          <p className="mt-2 text-center text-xs text-charcoal/60">
            Cancel anytime after the first quarter. Free shipping.
          </p>
        </div>

        {/* Trust points. First two chips reflect the current tier (piece
            count + retail value); the last two are static across tiers. */}
        <ul className="mt-6 grid grid-cols-2 gap-2.5 sm:gap-3">
          <Chip icon={<IconBox />} text={chipsSpec.pieces} />
          <Chip icon={<IconGift />} text={chipsSpec.retail} />
          <Chip icon={<IconTruck />} text="Ships in 2 days" />
          <Chip icon={<IconStar />} text="96% renewal" />
        </ul>

        <p className="mt-6 text-center text-[10px] uppercase tracking-[0.22em] text-charcoal/45">
          Built by golfers in Detroit
        </p>
      </section>

      {lightboxTier && (
        <ImageLightbox
          tier={lightboxTier}
          onClose={closeLightbox}
        />
      )}
    </main>
  );
}

/* -------------------------------------------------------------------------- */
/*  Tier card                                                                 */
/* -------------------------------------------------------------------------- */

function TierCard({
  tier,
  selected,
  onSelect,
  onOpenImage,
  recommended,
}: {
  tier: ReserveTier;
  selected: boolean;
  onSelect: () => void;
  onOpenImage: () => void;
  recommended: boolean;
}) {
  const meta = TIER_META[tier];
  const blurb = TIER_BLURB[tier];
  const image = TIER_IMAGES[tier];

  return (
    <label
      className={[
        "relative block cursor-pointer rounded-md border px-4 py-4 transition sm:px-5 sm:py-5",
        selected
          ? "border-forest bg-forest/[0.04] shadow-[0_1px_0_rgba(0,0,0,0.03)]"
          : "border-forest/15 bg-white hover:border-forest/40",
      ].join(" ")}
    >
      <input
        type="radio"
        name="reserve-tier"
        value={tier}
        checked={selected}
        onChange={onSelect}
        className="sr-only"
      />

      {recommended && (
        <span className="absolute -top-2.5 right-3 rounded-full bg-ember px-2 py-0.5 text-[9px] font-medium uppercase tracking-[0.22em] text-bone">
          Most picked
        </span>
      )}

      <div className="flex items-start gap-3">
        {/* Radio dot */}
        <span
          aria-hidden="true"
          className={[
            "mt-1 h-4 w-4 flex-shrink-0 rounded-full border-2 transition",
            selected
              ? "border-forest bg-forest ring-4 ring-forest/15"
              : "border-forest/35 bg-white",
          ].join(" ")}
        />

        {/* Product thumbnail. Nested <button> is invalid inside <label>, so
            we use a keyboard-accessible span with role=button and stop the
            click so the surrounding label doesn't also toggle the radio. */}
        <span
          role="button"
          tabIndex={0}
          aria-label={`View a larger preview of the ${meta.label} shipment`}
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            onOpenImage();
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              e.stopPropagation();
              onOpenImage();
            }
          }}
          className="group relative block h-16 w-16 flex-shrink-0 overflow-hidden rounded-md border border-forest/15 bg-bone-dark/20 sm:h-20 sm:w-20"
        >
          <Image
            src={image.thumb}
            alt={image.alt}
            fill
            sizes="80px"
            className="object-cover transition group-hover:scale-[1.02]"
          />
          {/* Tiny expand cue on the corner. Not a label, just a visual hint. */}
          <span
            aria-hidden="true"
            className="pointer-events-none absolute bottom-1 right-1 flex h-4 w-4 items-center justify-center rounded-sm bg-charcoal/70 text-bone"
          >
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth={2.4}
              strokeLinecap="round"
              strokeLinejoin="round"
              width="10"
              height="10"
            >
              <path d="M5 5h5M5 5v5M19 19h-5M19 19v-5" />
            </svg>
          </span>
        </span>

        {/* Label + blurb */}
        <div className="min-w-0 flex-1">
          <div className="flex items-baseline justify-between gap-3">
            <p className="font-serif text-lg text-forest sm:text-xl">
              {meta.label}
            </p>
            <p className="whitespace-nowrap text-right text-base font-semibold text-forest sm:text-lg">
              {meta.firstBoxPrice}
              <span className="ml-1 text-[11px] font-normal text-charcoal/60">
                first
              </span>
            </p>
          </div>
          <p className="mt-1 text-[13px] leading-snug text-charcoal/75 sm:text-sm">
            {blurb}
          </p>
          <p className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-charcoal/45">
            {meta.renewalCopy}
          </p>
        </div>
      </div>
    </label>
  );
}

/* -------------------------------------------------------------------------- */
/*  Image lightbox                                                            */
/* -------------------------------------------------------------------------- */

function ImageLightbox({
  tier,
  onClose,
}: {
  tier: ReserveTier;
  onClose: () => void;
}) {
  const image = TIER_IMAGES[tier];
  const meta = TIER_META[tier];

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={`${meta.label} shipment preview`}
      className="fixed inset-0 z-50 flex items-center justify-center bg-charcoal/85 px-4 py-6 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Close button. Sits on the backdrop so it works even when the image
          box is tapped through by a passthrough. */}
      <button
        type="button"
        onClick={onClose}
        aria-label="Close preview"
        className="absolute right-4 top-4 z-10 flex h-11 w-11 items-center justify-center rounded-full border border-bone/30 bg-charcoal/70 text-bone shadow-lg transition hover:bg-charcoal focus:outline-none focus:ring-2 focus:ring-bone/80 sm:right-6 sm:top-6"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={2.2}
          strokeLinecap="round"
          strokeLinejoin="round"
          width="22"
          height="22"
        >
          <path d="M6 6l12 12M18 6l-12 12" />
        </svg>
      </button>

      <div
        className="relative w-full max-w-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="relative aspect-[4/5] w-full overflow-hidden rounded-lg bg-charcoal sm:aspect-[3/2]">
          <Image
            src={image.full}
            alt={image.alt}
            fill
            sizes="(max-width: 768px) 100vw, 768px"
            className="object-contain"
            priority
          />
        </div>
        <p className="mt-3 text-center text-xs uppercase tracking-[0.22em] text-bone/80">
          {meta.label} · {TIER_SPECS[tier].pieces} · {TIER_SPECS[tier].retail}
        </p>
      </div>
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/*  Chip                                                                      */
/* -------------------------------------------------------------------------- */

function Chip({ icon, text }: { icon: React.ReactNode; text: string }) {
  return (
    <li className="flex items-center gap-2 rounded-md border border-forest/15 bg-bone-dark/30 px-3 py-2.5 text-[13px] text-forest sm:text-sm">
      <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center text-ember">
        {icon}
      </span>
      <span className="font-medium">{text}</span>
    </li>
  );
}

/* -------------------------------------------------------------------------- */
/*  Inline SVG icons                                                          */
/* -------------------------------------------------------------------------- */

function svgProps() {
  return {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.6,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    width: "100%",
    height: "100%",
  };
}

function IconBox() {
  return (
    <svg {...svgProps()}>
      <rect x="3" y="5" width="18" height="4" rx="0.5" />
      <rect x="3" y="11" width="18" height="4" rx="0.5" />
      <rect x="3" y="17" width="18" height="3" rx="0.5" />
    </svg>
  );
}

function IconTruck() {
  return (
    <svg {...svgProps()}>
      <rect x="2" y="7" width="11" height="9" rx="1" />
      <path d="M13 10h4l3 3v3h-7z" />
      <circle cx="7" cy="18" r="1.6" />
      <circle cx="17" cy="18" r="1.6" />
    </svg>
  );
}

function IconGift() {
  return (
    <svg {...svgProps()}>
      <rect x="3" y="9" width="18" height="12" rx="1" />
      <path d="M3 13h18M12 9v12" />
      <path d="M12 9c-1.5-3-5-3-5-1s2 2 5 1zM12 9c1.5-3 5-3 5-1s-2 2-5 1z" />
    </svg>
  );
}

function IconStar() {
  return (
    <svg {...svgProps()}>
      <path d="M12 3l2.5 6.2L21 10l-5 4.4L17.4 21 12 17.6 6.6 21 8 14.4 3 10l6.5-0.8L12 3z" />
    </svg>
  );
}

/* -------------------------------------------------------------------------- */
/*  Already-converted state                                                   */
/* -------------------------------------------------------------------------- */

function BrickConvertedState() {
  return (
    <main className="min-h-screen bg-bone text-charcoal">
      <section className="mx-auto max-w-xl px-5 py-16 sm:px-6">
        <div className="rounded-lg border border-forest/30 bg-forest/5 p-8 text-center">
          <div className="text-[11px] uppercase tracking-[0.22em] text-forest/80">
            You&apos;re in
          </div>
          <h2 className="mt-2 font-serif text-2xl text-forest">
            Looks like you&apos;ve already joined Reserve.
          </h2>
          <p className="mt-3 text-sm text-charcoal/75">
            Check your inbox for next steps. If nothing landed, reply to drew@mymully.com and I&apos;ll sort it out personally.
          </p>
        </div>
      </section>
    </main>
  );
}
