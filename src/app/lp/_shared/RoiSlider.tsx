"use client";

/**
 * Compact value slider shared by /lp/subscription and /lp/consult.
 *
 * The visitor sets how many times a year they currently shop for golf gear
 * (5 to 24). Only one tile is computed from the slider: an hours estimate
 * using a stated assumption (about 45 minutes per shopping trip). The second
 * tile is the plan fact (4 to 6 pieces a quarter, so 16 to 24 a year).
 *
 * 2026-11-11: removed the "$ saved / year", "extra pieces / year" and
 * "unique pieces / edit" tiles. They came from arbitrary formulas
 * (e.g. visits * 200 - 1000) with no supporting data.
 */

import { useMemo, useState } from "react";

const MINUTES_PER_TRIP = 45;

interface Tile {
  line1: string;
  line2: string;
}

export function RoiSlider({ className }: { className?: string }) {
  const [visits, setVisits] = useState(12);

  const tiles = useMemo<Tile[]>(() => {
    const hoursSaved = Math.round((visits * MINUTES_PER_TRIP) / 60);
    return [
      { line1: `About ${hoursSaved} hours`, line2: "Est. time back / year" },
      { line1: "16 to 24", line2: "Pieces / year" },
    ];
  }, [visits]);

  return (
    <div className={className}>
      <div className="text-[10px] tracking-[0.28em] uppercase text-charcoal/50">
        Gear shopping trips / year
      </div>
      <div className="mt-2 text-sm text-charcoal/70">
        You currently shop for gear about {visits} times a year.
      </div>
      <input
        type="range"
        min={5}
        max={24}
        step={1}
        value={visits}
        onChange={(e) => setVisits(Number(e.target.value))}
        aria-label="Times you shop for golf gear per year"
        className="mt-3 w-full accent-[#1F3D2B] cursor-pointer"
      />
      <div className="mt-4 grid grid-cols-2 gap-3">
        {tiles.map((t) => (
          <div
            key={t.line2}
            className="rounded-sm border border-charcoal/[0.08] px-3 py-3"
          >
            <div className="font-serif text-lg text-forest leading-none">
              {t.line1}
            </div>
            <div className="mt-1.5 text-[10px] tracking-[0.24em] uppercase text-charcoal/50">
              {t.line2}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-[11px] leading-relaxed text-charcoal/50">
        Estimate based on your slider, assuming about {MINUTES_PER_TRIP} minutes
        per shopping trip. Pieces reflect 4 to 6 per quarter.
      </p>
    </div>
  );
}
