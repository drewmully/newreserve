"use client";

import { useMemo, useState } from "react";

/**
 * Mully Starter Kit - quarterly ROI calculator.
 *
 * Three sliders:
 *   1. Sell-through rate (60–100%, default 90%)
 *   2. Markup above retail (0–25%, default 10%)
 *   3. Member count (20–500, default 100; only affects Mullybox + storefront)
 *
 * Output cards (additive - clubs earn from three streams):
 *   - In-club boutique profit
 *   - Mullybox commissions
 *   - Online storefront commissions
 *   - Quarterly ROI %
 *   - Annual profit (quarterly total × 4)
 */

// Held constant (the spec)
const RETAIL_INVENTORY = 3000;          // $ in retail inventory shipped
const QUARTERLY_COST = 2000;            // $ kit cost
const MULLYBOX_ATTACH = 0.075;          // 7.5% of members buy a Mullybox per quarter
const MULLYBOX_COMMISSION = 50;         // flat $ per Mullybox
const ONLINE_ATTACH = 0.075;            // 7.5% of members purchase online per quarter
const ONLINE_AOV = 120;                 // average online order value
const ONLINE_COMMISSION_RATE = 0.25;    // 25% of online sales

function fmt(n: number): string {
  const rounded = Math.round(n);
  if (rounded < 0) return `-$${Math.abs(rounded).toLocaleString("en-US")}`;
  return `$${rounded.toLocaleString("en-US")}`;
}

function fmtPct(n: number): string {
  return `${Math.round(n)}%`;
}

export default function StarterKitCalculator() {
  const [sellThroughPct, setSellThroughPct] = useState(90);  // 60–100
  const [markupPct, setMarkupPct] = useState(10);            // 0–25
  const [memberCount, setMemberCount] = useState(100);       // 20–500

  const numbers = useMemo(() => {
    const sellThrough = sellThroughPct / 100;
    const markup = 1 + markupPct / 100;

    // In-club boutique: sold inventory at markup, minus kit cost.
    const boutiqueRevenue = RETAIL_INVENTORY * sellThrough * markup;
    const boutiqueProfit = boutiqueRevenue - QUARTERLY_COST;

    // Mullybox commissions (passive, sits on the slatwall).
    const mullyboxUnits = memberCount * MULLYBOX_ATTACH;
    const mullyboxCommissions = mullyboxUnits * MULLYBOX_COMMISSION;

    // Online storefront commissions (managed by Mully).
    const onlineOrders = memberCount * ONLINE_ATTACH;
    const onlineRevenue = onlineOrders * ONLINE_AOV;
    const storefrontCommissions = onlineRevenue * ONLINE_COMMISSION_RATE;

    const quarterlyReturn = boutiqueProfit + mullyboxCommissions + storefrontCommissions;
    const quarterlyROI = (quarterlyReturn / QUARTERLY_COST) * 100;
    const annualProfit = quarterlyReturn * 4;

    return {
      boutiqueRevenue,
      boutiqueProfit,
      mullyboxCommissions,
      storefrontCommissions,
      quarterlyReturn,
      quarterlyROI,
      annualProfit,
    };
  }, [sellThroughPct, markupPct, memberCount]);

  return (
    <div className="rounded-2xl border border-taupe/20 bg-bone p-6 md:p-9">
      {/* Sliders */}
      <div className="grid md:grid-cols-3 gap-7 md:gap-10 mb-9">
        <SliderField
          label="Sell-through rate"
          value={sellThroughPct}
          min={60}
          max={100}
          step={1}
          onChange={setSellThroughPct}
          format={(v) => `${v}%`}
          note="Of the $3,000 in retail inventory"
        />
        <SliderField
          label="Markup above retail"
          value={markupPct}
          min={0}
          max={25}
          step={1}
          onChange={setMarkupPct}
          format={(v) => `${v}%`}
          note="Most clubs price at or slightly above retail"
        />
        <SliderField
          label="Member count"
          value={memberCount}
          min={20}
          max={500}
          step={10}
          onChange={setMemberCount}
          format={(v) => v.toLocaleString("en-US")}
          note="Affects Mullybox and online estimates"
        />
      </div>

      {/* Output cards */}
      <div className="border-t border-taupe/15 pt-7 md:pt-9">
        <p className="text-[11px] tracking-[0.28em] uppercase text-sage font-medium mb-5">
          Quarterly estimate
        </p>

        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-3 md:gap-4 mb-4">
          <OutputCard
            label="In-club boutique profit"
            value={fmt(numbers.boutiqueProfit)}
            sub={`After the $${QUARTERLY_COST.toLocaleString("en-US")} kit cost`}
            tone={numbers.boutiqueProfit >= 0 ? "positive" : "warning"}
          />
          <OutputCard
            label="Mullybox commissions"
            value={fmt(numbers.mullyboxCommissions)}
            sub="$50 flat per Mullybox sold, sits on the slatwall"
          />
          <OutputCard
            label="Online storefront commissions"
            value={fmt(numbers.storefrontCommissions)}
            sub="25% of online member purchases, managed by Mully"
          />
        </div>

        {/* Totals row - visually elevated */}
        <div className="grid sm:grid-cols-2 gap-3 md:gap-4">
          <OutputCard
            label="Quarterly ROI"
            value={fmtPct(numbers.quarterlyROI)}
            sub="Total return divided by kit cost"
            tone="featured"
          />
          <OutputCard
            label="Annual profit"
            value={fmt(numbers.annualProfit)}
            sub="Quarterly total × 4"
            tone="featured"
          />
        </div>

        <p className="text-[11px] text-charcoal/45 mt-6 leading-relaxed">
          All figures are illustrative estimates. Mullybox and online storefront assume a 7.5% quarterly attach rate.
          Online AOV assumed at $120. Actual results vary by club, member engagement, and market.
        </p>
      </div>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function SliderField({
  label,
  value,
  min,
  max,
  step,
  onChange,
  format,
  note,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
  format: (v: number) => string;
  note?: string;
}) {
  return (
    <div>
      <p className="text-[11px] tracking-[0.28em] uppercase text-sage font-medium mb-2">
        {label}
      </p>
      <p className="font-serif text-3xl md:text-4xl text-obsidian tabular-nums mb-3">
        {format(value)}
      </p>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-forest cursor-pointer"
        aria-label={label}
      />
      <div className="flex justify-between text-[11px] text-charcoal/45 mt-1 tabular-nums">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
      {note ? (
        <p className="text-[11px] text-charcoal/50 mt-2 leading-relaxed">{note}</p>
      ) : null}
    </div>
  );
}

function OutputCard({
  label,
  value,
  sub,
  tone = "neutral",
}: {
  label: string;
  value: string;
  sub: string;
  tone?: "neutral" | "positive" | "warning" | "featured";
}) {
  const toneClasses =
    tone === "featured"
      ? "bg-forest text-bone border-forest"
      : tone === "warning"
      ? "bg-cream border-taupe/30"
      : "bg-cream border-taupe/20";

  const labelColor =
    tone === "featured" ? "text-ember" : "text-sage";
  const valueColor =
    tone === "featured"
      ? "text-bone"
      : tone === "warning"
      ? "text-charcoal"
      : "text-obsidian";
  const subColor = tone === "featured" ? "text-bone/60" : "text-charcoal/50";

  return (
    <div className={`rounded-xl border p-5 ${toneClasses}`}>
      <p className={`text-[10px] tracking-[0.28em] uppercase font-medium mb-2 ${labelColor}`}>
        {label}
      </p>
      <p className={`font-serif text-2xl md:text-3xl tabular-nums ${valueColor}`}>
        {value}
      </p>
      <p className={`text-xs mt-2 leading-relaxed ${subColor}`}>{sub}</p>
    </div>
  );
}
