"use client";

/**
 * Compact ROI slider shared by /lp/subscription and /lp/consult.
 *
 * The visitor sets how many times a year they currently shop for golf gear
 * (5 to 24). Four outcome tiles recompute live, framing Mully Reserve against
 * self-directed retail shopping: time saved, pieces per year, annual spend,
 * and pieces others don't own.
 */

import { useMemo, useState } from "react";

function formatK(dollars: number): string {
  const k = dollars / 1000;
  const rounded = Math.round(k * 10) / 10;
  return Number.isInteger(rounded) ? `$${rounded}k` : `$${rounded.toFixed(1)}k`;
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
    const retailPieces = Math.floor(visits * 1.5);
    const retailSpend = visits * 200;
    return [
      { line1: `${hoursSaved} hours`, line2: "Saved every year" },
      { line1: `${retailPieces} vs 20`, line2: "Pieces per year" },
      { line1: `${formatK(retailSpend)} vs $1k`, line2: "Annual spend" },
      {
        line1: `${uniquePieces(visits)} vs 3 to 6`,
        line2: "Pieces others don't own",
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
