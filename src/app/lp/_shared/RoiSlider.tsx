"use client";

/**
 * Compact ROI slider shared by /lp/subscription and /lp/consult.
 *
 * The visitor sets how many times a year they currently shop for golf gear
 * (5 to 24). Four tiles recompute live and show only the delta (the Mully
 * improvement) as positive numbers: hours saved, extra pieces, dollars saved,
 * and extra unique pieces per edit.
 */

import { useMemo, useState } from "react";

function formatSaved(dollars: number): string {
  if (dollars < 1000) return `$${dollars}`;
  const k = Math.round((dollars / 1000) * 10) / 10;
  return Number.isInteger(k) ? `$${k}k` : `$${k.toFixed(1)}k`;
}

function uniquePieces(visits: number): number {
  if (visits < 10) return 0;
  if (visits <= 15) return 1;
  return 2;
}

interface Tile {
  line1: string;
  line2: string;
}

export function RoiSlider({ className }: { className?: string }) {
  const [visits, setVisits] = useState(12);

  const tiles = useMemo<Tile[]>(() => {
    const hoursSaved = Math.round((visits * (60 - 15)) / 60);
    const extraPieces = Math.max(0, 20 - Math.floor(visits * 1.5));
    const dollarsSaved = Math.max(0, visits * 200 - 1000);
    const theirUnique = uniquePieces(visits);
    return [
      { line1: `${hoursSaved} hours`, line2: "Hours saved / year" },
      { line1: `+${extraPieces}`, line2: "Extra pieces / year" },
      { line1: formatSaved(dollarsSaved), line2: "Saved / year" },
      {
        line1: `+${3 - theirUnique} to +${6 - theirUnique}`,
        line2: "Unique pieces / edit",
      },
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
    </div>
  );
}
