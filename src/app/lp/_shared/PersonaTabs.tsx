"use client";

/**
 * Hero persona selector shared by /lp/subscription and /lp/consult.
 *
 * Controlled pill row. Selecting a tab swaps the hero subheader, the
 * single-line social-proof stat, and the primary CTA (see HeroCopyColumn).
 */

import { HERO_PERSONAS, type PersonaKey } from "./heroPersonas";

export interface PersonaTabsProps {
  value: PersonaKey;
  onChange: (key: PersonaKey) => void;
  className?: string;
}

export function PersonaTabs({ value, onChange, className }: PersonaTabsProps) {
  return (
    <div
      className={[
        "inline-flex items-center gap-1 rounded-full border border-charcoal/15 p-1",
        className,
      ]
        .filter(Boolean)
        .join(" ")}
      role="tablist"
      aria-label="Choose what fits you"
    >
      {HERO_PERSONAS.map((p) => {
        const active = p.key === value;
        return (
          <button
            key={p.key}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(p.key)}
            className={[
              "rounded-full px-3 sm:px-4 py-1.5 text-xs sm:text-sm tracking-wide transition cursor-pointer",
              active
                ? "bg-forest text-bone"
                : "text-charcoal/60 hover:text-charcoal",
            ].join(" ")}
          >
            {p.tab}
          </button>
        );
      })}
    </div>
  );
}
