"use client";

import { useMemo, useState } from "react";

/**
 * Mully Boutique — Range-based interactive economics calculator.
 *
 * Per LP brief: this is a range model (low/high), not a fixed projection.
 * Club-share split is deliberately not fixed — we show what the boutique
 * GENERATES, then surface the operator's share as a range so the actual
 * split can be negotiated tier-by-tier.
 *
 * All numbers are illustrative and clearly labeled as such.
 */

type TierKey = "starter" | "boutique" | "atelier";

type RangePair = { low: number; high: number };

const TIERS: Record<TierKey, { label: string; subscription: number; setup: number; captureLow: number; captureHigh: number; note: string; }> = {
  starter: {
    label: "Starter",
    subscription: 0,
    setup: 0,
    captureLow: 0.03,
    captureHigh: 0.08,
    note: "Free. Mully gift box at the front desk. Revenue share on sell-through.",
  },
  boutique: {
    label: "Boutique",
    subscription: 995,
    setup: 0,
    captureLow: 0.10,
    captureHigh: 0.20,
    note: "Full fixture, consigned inventory, embroidery — co-branded.",
  },
  atelier: {
    label: "Atelier",
    subscription: 2000,
    setup: 5000,
    captureLow: 0.18,
    captureHigh: 0.30,
    note: "Expanded footprint, kiosk option, white-label available.",
  },
};

// Conservative industry benchmarks. Held constant.
const ANNUAL_SPEND_PER_GOLFER = 1200;
const GROSS_MARGIN = 0.38;
const EMBROIDERY_ATTACH_LOW = 0.20;
const EMBROIDERY_ATTACH_HIGH = 0.35;
const EMBROIDERY_MARGIN_PER_UNIT = 15;
const AVG_ORDER_VALUE = 150;

// Operator share is shown as a RANGE — not a committed number.
const CLUB_SHARE_LOW = 0.55;
const CLUB_SHARE_HIGH = 0.70;

function fmt(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(n);
  return `${sign}$${abs.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function fmtRange(r: RangePair): string {
  return `${fmt(r.low)} – ${fmt(r.high)}`;
}

export default function BoutiqueCalculator() {
  const [members, setMembers] = useState<number>(300);
  const [tier, setTier] = useState<TierKey>("boutique");

  const result = useMemo(() => {
    const t = TIERS[tier];
    const gmvLow = members * ANNUAL_SPEND_PER_GOLFER * t.captureLow;
    const gmvHigh = members * ANNUAL_SPEND_PER_GOLFER * t.captureHigh;

    const grossMarginLow = gmvLow * GROSS_MARGIN;
    const grossMarginHigh = gmvHigh * GROSS_MARGIN;

    // Embroidery: attach rate × order count × per-unit margin.
    const ordersLow = gmvLow / AVG_ORDER_VALUE;
    const ordersHigh = gmvHigh / AVG_ORDER_VALUE;
    const embroideryLow = ordersLow * EMBROIDERY_ATTACH_LOW * EMBROIDERY_MARGIN_PER_UNIT;
    const embroideryHigh = ordersHigh * EMBROIDERY_ATTACH_HIGH * EMBROIDERY_MARGIN_PER_UNIT;

    // Club's share of margin (negotiable range — what we show as upside).
    const clubMarginLow = grossMarginLow * CLUB_SHARE_LOW;
    const clubMarginHigh = grossMarginHigh * CLUB_SHARE_HIGH;

    // Annual subscription cost the club commits to.
    const annualSubscription = t.subscription * 12;
    // Setup amortized over year one for the comparison.
    const annualFees = annualSubscription + t.setup;

    // Club's net annual benefit, year one.
    const clubNetLow = clubMarginLow + embroideryLow - annualFees;
    const clubNetHigh = clubMarginHigh + embroideryHigh - annualFees;

    return {
      gmv: { low: gmvLow, high: gmvHigh } as RangePair,
      grossMargin: { low: grossMarginLow, high: grossMarginHigh } as RangePair,
      embroidery: { low: embroideryLow, high: embroideryHigh } as RangePair,
      clubMargin: { low: clubMarginLow, high: clubMarginHigh } as RangePair,
      clubNet: { low: clubNetLow, high: clubNetHigh } as RangePair,
      annualFees,
      capture: { low: t.captureLow, high: t.captureHigh } as RangePair,
    };
  }, [members, tier]);

  return (
    <div className="rounded-2xl border border-taupe/15 bg-cream p-6 md:p-10 shadow-sm">
      {/* Inputs */}
      <div className="grid md:grid-cols-2 gap-6 mb-8">
        {/* Member count slider */}
        <div>
          <label htmlFor="members" className="block text-[11px] tracking-[0.28em] uppercase text-sage font-medium mb-3">
            Member Count
          </label>
          <div className="flex items-baseline gap-3 mb-3">
            <span className="font-serif text-4xl md:text-5xl text-forest tabular-nums">
              {members.toLocaleString()}
            </span>
            <span className="text-sm text-charcoal/55">members</span>
          </div>
          <input
            id="members"
            type="range"
            min={50}
            max={1500}
            step={25}
            value={members}
            onChange={(e) => setMembers(Number(e.target.value))}
            className="w-full accent-forest"
          />
          <div className="flex justify-between text-[11px] text-charcoal/40 mt-1.5 tabular-nums">
            <span>50</span>
            <span>1,500</span>
          </div>
        </div>

        {/* Tier selector */}
        <div>
          <p className="text-[11px] tracking-[0.28em] uppercase text-sage font-medium mb-3">Tier</p>
          <div className="grid grid-cols-3 gap-2">
            {(Object.keys(TIERS) as TierKey[]).map((key) => {
              const isActive = tier === key;
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setTier(key)}
                  className={`px-3 py-3 rounded-xl border text-xs sm:text-sm font-medium tracking-wider uppercase transition-all duration-300 ${
                    isActive
                      ? "bg-forest text-bone border-forest"
                      : "bg-bone border-taupe/25 text-charcoal/60 hover:border-forest/40 hover:text-forest"
                  }`}
                >
                  {TIERS[key].label}
                </button>
              );
            })}
          </div>
          <p className="text-[11px] text-charcoal/40 mt-3 leading-relaxed">
            {TIERS[tier].note}
          </p>
          <p className="text-[11px] text-charcoal/40 mt-1 leading-relaxed">
            Capture range:{" "}
            <span className="text-charcoal/65 tabular-nums">
              {(result.capture.low * 100).toFixed(0)}% – {(result.capture.high * 100).toFixed(0)}%
            </span>{" "}
            of member apparel spend
          </p>
        </div>
      </div>

      {/* Output grid */}
      <div className="border-t border-taupe/15 pt-8">
        <p className="text-[11px] tracking-[0.28em] uppercase text-sage font-medium mb-6">
          Annual Range — Illustrative
        </p>

        <div className="grid md:grid-cols-2 gap-5">
          {/* Boutique GMV */}
          <div className="rounded-xl bg-bone p-5 border border-taupe/12">
            <p className="text-[11px] tracking-[0.22em] uppercase text-charcoal/40 mb-2">
              Boutique GMV
            </p>
            <p className="font-serif text-2xl md:text-3xl text-obsidian tabular-nums">
              {fmtRange(result.gmv)}
            </p>
            <p className="text-xs text-charcoal/45 mt-2 leading-relaxed">
              What members buy through your boutique annually
            </p>
          </div>

          {/* Gross margin */}
          <div className="rounded-xl bg-bone p-5 border border-taupe/12">
            <p className="text-[11px] tracking-[0.22em] uppercase text-charcoal/40 mb-2">
              Gross Margin Generated
            </p>
            <p className="font-serif text-2xl md:text-3xl text-obsidian tabular-nums">
              {fmtRange(result.grossMargin)}
            </p>
            <p className="text-xs text-charcoal/45 mt-2 leading-relaxed">
              At a 38% blended apparel margin
            </p>
          </div>

          {/* Embroidery */}
          <div className="rounded-xl bg-bone p-5 border border-taupe/12">
            <p className="text-[11px] tracking-[0.22em] uppercase text-charcoal/40 mb-2">
              Embroidery Contribution
            </p>
            <p className="font-serif text-2xl md:text-3xl text-obsidian tabular-nums">
              {fmtRange(result.embroidery)}
            </p>
            <p className="text-xs text-charcoal/45 mt-2 leading-relaxed">
              20–35% attach on club-logo gear
            </p>
          </div>

          {/* Annual cost */}
          <div className="rounded-xl bg-bone p-5 border border-taupe/12">
            <p className="text-[11px] tracking-[0.22em] uppercase text-charcoal/40 mb-2">
              Your Annual Investment
            </p>
            <p className="font-serif text-2xl md:text-3xl text-obsidian tabular-nums">
              {fmt(result.annualFees)}
            </p>
            <p className="text-xs text-charcoal/45 mt-2 leading-relaxed">
              {tier === "starter"
                ? "No subscription. No setup. Zero inventory."
                : tier === "atelier"
                ? "Subscription + Year 1 setup, zero inventory"
                : "Subscription, zero inventory"}
            </p>
          </div>
        </div>

        {/* Headline net — the ember/gold callout */}
        <div className="mt-6 rounded-xl border border-ember/30 bg-forest p-6 md:p-7">
          <p className="text-[11px] tracking-[0.28em] uppercase text-ember font-medium mb-3">
            Operator&apos;s Annual Net Range
          </p>
          <p className="font-serif text-3xl md:text-5xl text-bone tabular-nums mb-3">
            {fmtRange(result.clubNet)}
          </p>
          <p className="text-sm text-bone/65 leading-relaxed max-w-2xl">
            Your share of margin plus embroidery, less subscription and setup. Final
            margin split is negotiated tier-by-tier. The model assumes a club share
            between 55% and 70% of gross margin — your founding partner agreement
            will set the actual number.
          </p>
        </div>

        <p className="text-[11px] text-charcoal/40 mt-5 leading-relaxed max-w-3xl">
          All projections use conservative industry benchmarks ($1,200 annual apparel
          spend per golfer, 38% gross margin, $150 average order value). Mully does not
          guarantee specific revenue outcomes. Actual results depend on member count,
          engagement, club positioning, and local market conditions.
        </p>
      </div>
    </div>
  );
}
