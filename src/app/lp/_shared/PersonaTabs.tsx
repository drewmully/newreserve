"use client";

/**
 * Hero persona selector shared by /lp/subscription and /lp/consult.
 *
 * A subtle "I'm shopping for" selector, not a primary nav: a tiny label above
 * a compact row of text buttons separated by thin dividers. Selecting a tab
 * swaps the hero subheader, the single-line social-proof stat, and the primary
 * CTA (see HeroCopyColumn).
 */

import { Fragment } from "react";
import { HERO_PERSONAS, type PersonaKey } from "./heroPersonas";

export interface PersonaTabsProps {
  value: PersonaKey;
  onChange: (key: PersonaKey) => void;
  className?: string;
}

export function PersonaTabs({ value, onChange, className }: PersonaTabsProps) {
  return (
    <div className={className}>
      <div className="text-[9px] tracking-[0.28em] uppercase text-charcoal/40 mb-1.5">
        I&rsquo;m shopping for
      </div>
      <div
        className="inline-flex items-center text-xs"
        role="tablist"
        aria-label="Choose what fits you"
      >
        {HERO_PERSONAS.map((p, i) => {
          const active = p.key === value;
          return (
            <Fragment key={p.key}>
              {i > 0 ? (
                <span className="mx-2 text-charcoal/25" aria-hidden="true">
                  |
                </span>
              ) : null}
              <button
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => onChange(p.key)}
                className={[
                  "tracking-wide transition cursor-pointer",
                  active
                    ? "text-forest font-medium underline underline-offset-4 decoration-forest/40"
                    : "text-charcoal/50 hover:text-charcoal",
                ].join(" ")}
              >
                {p.tab}
              </button>
            </Fragment>
          );
        })}
      </div>
    </div>
  );
}
