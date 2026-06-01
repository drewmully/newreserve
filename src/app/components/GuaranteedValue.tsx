/**
 * Guarantee block — "Guaranteed More Than You Pay".
 *
 * Used on the homepage, /choose-plan, /lp/subscription, and /lp/gift to
 * frame the Curated Box value above the fold and reduce decision risk.
 *
 * Copy is locked per the 2026-06 spec — do not edit the dollar amount,
 * brands, or guarantee terms without product sign-off.
 *
 * Pure-display component, server-rendered. No client hooks.
 */
import React from "react";

type Tone = "light" | "dark";

export function GuaranteedValue({
  className,
  tone = "light",
  compact = false,
}: {
  className?: string;
  /** "light" for cream/bone backgrounds, "dark" for forest/obsidian sections. */
  tone?: Tone;
  /** Tighter padding for in-card placements (e.g. landing-page buy-box rail). */
  compact?: boolean;
}) {
  const isDark = tone === "dark";
  const container = isDark
    ? "border-bone/15 bg-bone/[0.04]"
    : "border-forest/15 bg-forest/[0.04]";
  const heading = isDark ? "text-bone" : "text-forest";
  const body = isDark ? "text-bone/75" : "text-charcoal/70";
  const accent = isDark ? "text-sage" : "text-forest";
  const padding = compact ? "p-4 md:p-5" : "p-5 md:p-6";

  return (
    <div
      className={`rounded-2xl border ${container} ${padding} ${className ?? ""}`}
    >
      <div className="flex items-start gap-3">
        <svg
          className="w-5 h-5 mt-0.5 shrink-0 text-ember"
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
          strokeWidth={2}
          aria-hidden="true"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M9 12l2 2 4-4m5.618-4.016A11.955 11.955 0 0112 2.944a11.955 11.955 0 01-8.618 3.04A12.02 12.02 0 003 9c0 5.591 3.824 10.29 9 11.622 5.176-1.332 9-6.03 9-11.622 0-1.042-.133-2.052-.382-3.016z"
          />
        </svg>
        <div>
          <p className={`text-sm md:text-base font-medium leading-snug ${heading}`}>
            Guaranteed More Than You Pay
          </p>
          <p className={`text-sm leading-relaxed mt-1.5 ${body}`}>
            Each quarterly box contains{" "}
            <span className={`font-medium ${accent}`}>$300+ retail value</span>{" "}
            of premium gear from Rhone, Greyson, Quiet Golf &amp; more. If you
            don&apos;t absolutely love it, exchange or return anything &mdash;
            no questions asked.
          </p>
        </div>
      </div>
    </div>
  );
}

export default GuaranteedValue;
