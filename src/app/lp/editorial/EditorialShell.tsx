"use client";

/**
 * Client-side glue between CategoryNav (owns filter state via URL) and
 * EditorialFeed (renders filtered products). Kept small on purpose so the
 * server page can hand off cleanly.
 */

import { Suspense, useEffect, useMemo, useState } from "react";
import type {
  EditorialProduct,
  EditorialCategory,
} from "@/lib/shopifyEditorial";
import { EDITORIAL_CATEGORIES } from "@/lib/shopifyEditorial";
import { trackEvent } from "@/lib/tracking";
import { CategoryNav } from "./CategoryNav";
import { PromotedBar } from "./PromotedBar";
import { EditorialFeed } from "./EditorialFeed";

interface EditorialShellProps {
  products: EditorialProduct[];
  /** Optional label rendered vertically next to the hero card. */
  updatedAtLabel?: string;
}

export function EditorialShell({
  products,
  updatedAtLabel,
}: EditorialShellProps) {
  const [category, setCategory] = useState<EditorialCategory | "all">("all");

  // Fire lp_editorial_view once per mount. Matches the pattern used by
  // SubscriptionLPClient / GiftLPClient. The empty dep array plus a mount
  // guard means route changes back to /lp/editorial re-fire, but React
  // StrictMode double-mount won't (trackEvent itself dedupes bots).
  useEffect(() => {
    void trackEvent("lp_editorial_view", {
      product_count: products.length,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const counts = useMemo(() => {
    // Build the count map dynamically from EDITORIAL_CATEGORIES so new
    // categories don't require touching this file.
    const base = { all: products.length } as Record<EditorialCategory | "all", number>;
    for (const c of EDITORIAL_CATEGORIES) base[c] = 0;
    for (const p of products) {
      if (
        p.editorialCategory &&
        (EDITORIAL_CATEGORIES as readonly string[]).includes(p.editorialCategory)
      ) {
        base[p.editorialCategory as EditorialCategory] += 1;
      }
    }
    return base;
  }, [products]);

  return (
    <>
      {/* CategoryNav uses useSearchParams(), which requires a Suspense
          boundary during static prerender. */}
      <Suspense fallback={<div className="h-14" aria-hidden />}>
        <CategoryNav active={category} onChange={setCategory} counts={counts} />
      </Suspense>
      <PromotedBar />
      <section className="px-5 md:px-10 pt-12 md:pt-16 pb-20 md:pb-28">
        <div className="max-w-6xl mx-auto">
          <EditorialFeed
            products={products}
            categoryFilter={category}
            updatedAtLabel={updatedAtLabel}
          />
        </div>
      </section>
    </>
  );
}
