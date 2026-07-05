"use client";

/**
 * Category nav bar for /lp/editorial. Four pills below the Mully 8 hero:
 * All / Tech / Style / Destinations / Course.
 *
 * Client-side filter — sets a `category` query param and communicates the
 * choice back up via `onChange`. The parent `EditorialFeed` reads its
 * `categoryFilter` prop and filters products accordingly.
 *
 * Design: understated, uppercase, tracked. Sticky under the fixed header
 * while the user scrolls the feed.
 */

import { useEffect, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import {
  EDITORIAL_CATEGORIES,
  EDITORIAL_CATEGORY_LABELS,
  type EditorialCategory,
} from "@/lib/shopifyEditorial";
import { trackEvent } from "@/lib/tracking";

interface CategoryNavProps {
  active: EditorialCategory | "all";
  onChange: (next: EditorialCategory | "all") => void;
  counts: Record<EditorialCategory | "all", number>;
}

const ALL: EditorialCategory | "all" = "all";

export function CategoryNav({ active, onChange, counts }: CategoryNavProps) {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const [sticky, setSticky] = useState(false);

  // Sync from URL on mount and back-forward navigation.
  useEffect(() => {
    const raw = (search.get("category") || "").toLowerCase();
    const next: EditorialCategory | "all" =
      raw && (EDITORIAL_CATEGORIES as readonly string[]).includes(raw)
        ? (raw as EditorialCategory)
        : "all";
    if (next !== active) onChange(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search]);

  // Track scroll so we can add a subtle shadow once the nav pins.
  useEffect(() => {
    const onScroll = () => setSticky(window.scrollY > 480);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const setCategory = (next: EditorialCategory | "all") => {
    onChange(next);
    const params = new URLSearchParams(search.toString());
    if (next === ALL) params.delete("category");
    else params.set("category", next);
    router.replace(
      `${pathname}${params.toString() ? `?${params.toString()}` : ""}#editorial-top`,
      { scroll: false }
    );
    void trackEvent("editorial_category_filter", {
      properties: { category: next },
    });
  };

  const items: Array<{ key: EditorialCategory | "all"; label: string }> = [
    { key: "all", label: "All" },
    ...EDITORIAL_CATEGORIES.map((c) => ({
      key: c,
      label: EDITORIAL_CATEGORY_LABELS[c],
    })),
  ];

  return (
    <nav
      aria-label="Filter by category"
      className={`sticky top-14 md:top-16 z-30 bg-white/95 backdrop-blur border-b border-charcoal/[0.08] transition-shadow ${
        sticky ? "shadow-[0_1px_0_0_rgba(0,0,0,0.02)]" : ""
      }`}
    >
      <div className="max-w-6xl mx-auto px-5 md:px-10">
        <ul className="flex items-center justify-center gap-2 md:gap-4 overflow-x-auto no-scrollbar py-4">
          {items.map(({ key, label }) => {
            const isActive = active === key;
            const count = counts[key] ?? 0;
            return (
              <li key={key} className="shrink-0">
                <button
                  type="button"
                  onClick={() => setCategory(key)}
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
  );
}
