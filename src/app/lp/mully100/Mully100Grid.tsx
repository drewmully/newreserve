"use client";

/**
 * Client-side wrapper: category filter + grid. Category state is local
 * (no URL param yet — this page is browse-mostly, no deep-link need
 * demonstrated). If that changes, mirror the pattern in CategoryNav.tsx.
 */

import { useMemo, useState } from "react";
import type { Mully100Item } from "@/lib/mully100";
import {
  EDITORIAL_CATEGORIES,
  EDITORIAL_CATEGORY_LABELS,
  type EditorialCategory,
} from "@/lib/shopifyEditorial";
import { Mully100Card } from "./Mully100Card";
import { trackEvent } from "@/lib/tracking";

interface Mully100GridProps {
  items: Mully100Item[];
}

export function Mully100Grid({ items }: Mully100GridProps) {
  const [active, setActive] = useState<EditorialCategory | "all">("all");

  const counts = useMemo(() => {
    const base: Record<EditorialCategory | "all", number> = {
      all: items.length,
      tech: 0,
      style: 0,
      destinations: 0,
      course: 0,
    };
    for (const it of items) base[it.category] += 1;
    return base;
  }, [items]);

  const filtered = useMemo(() => {
    if (active === "all") return items;
    return items.filter((i) => i.category === active);
  }, [items, active]);

  const pills: Array<{ key: EditorialCategory | "all"; label: string }> = [
    { key: "all", label: "All" },
    ...EDITORIAL_CATEGORIES.map((c) => ({
      key: c,
      label: EDITORIAL_CATEGORY_LABELS[c],
    })),
  ];

  return (
    <>
      <nav
        aria-label="Filter Mully 100 by category"
        className="sticky top-14 md:top-16 z-30 bg-white/95 backdrop-blur border-b border-charcoal/[0.08]"
      >
        <div className="max-w-6xl mx-auto px-5 md:px-10">
          <ul className="flex items-center justify-center gap-2 md:gap-4 overflow-x-auto no-scrollbar py-4">
            {pills.map(({ key, label }) => {
              const isActive = active === key;
              const count = counts[key] ?? 0;
              return (
                <li key={key} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => {
                      setActive(key);
                      void trackEvent("mully100_category_filter", {
                        properties: { category: key },
                      });
                    }}
                    aria-pressed={isActive}
                    className={`inline-flex items-center gap-2 px-3.5 md:px-4 py-2 text-[10.5px] md:text-[11px] tracking-[0.28em] uppercase rounded-full border transition-all ${
                      isActive
                        ? "bg-forest text-bone border-forest"
                        : "bg-transparent text-charcoal/70 border-charcoal/15 hover:text-charcoal hover:border-charcoal/40"
                    }`}
                  >
                    <span>{label}</span>
                    {count > 0 && (
                      <span
                        className={`text-[9px] tracking-[0.2em] ${
                          isActive ? "text-bone/70" : "text-charcoal/40"
                        }`}
                      >
                        {count}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      </nav>

      <section className="px-5 md:px-10 pt-12 md:pt-16 pb-20 md:pb-28">
        <div className="max-w-6xl mx-auto">
          {filtered.length === 0 ? (
            <div className="text-center py-24 text-charcoal/60">
              <p className="font-serif text-2xl text-forest mb-3">
                Nothing in that category yet.
              </p>
              <p className="text-sm">More picks coming soon.</p>
            </div>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-y-14 md:gap-y-16 md:divide-x md:divide-charcoal/[0.06]">
              {filtered.map((item, i) => (
                <li key={item.id} className="relative md:px-6 lg:px-8">
                  <Mully100Card item={item} index={i} />
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>
    </>
  );
}
