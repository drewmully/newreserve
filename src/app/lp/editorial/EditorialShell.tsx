"use client";

/**
 * Client-side glue between CategoryNav (owns filter state via URL) and
 * EditorialFeed (renders filtered products). Kept small on purpose so the
 * server page can hand off cleanly.
 */

import { Suspense, useMemo, useState } from "react";
import type {
  EditorialProduct,
  EditorialCategory,
} from "@/lib/shopifyEditorial";
import { EDITORIAL_CATEGORIES } from "@/lib/shopifyEditorial";
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
