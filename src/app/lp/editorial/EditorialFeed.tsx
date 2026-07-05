"use client";

/**
 * The editorial grid — Uncrate Supply pattern.
 *
 * Layout:
 *   - Mobile: 1 column
 *   - md (≥768px): 2 columns
 *   - lg (≥1024px): 3 columns
 *
 * Ordinal numbering:
 *   - The oldest product is № 01. The newest product gets the highest
 *     number. This is stable — a product's issue number never changes,
 *     which is the editorial mental model ("this is issue 47 of the
 *     shelf").
 *   - The feed is still shown newest-first (products are sorted by
 *     publishedAt DESC in `getEditorialFeed`), so the highest-numbered
 *     card appears at the top.
 *
 * Section anchors:
 *   - We place invisible <div id="..."> markers before the first card of
 *     each brand and each collection so the header menu can smooth-scroll
 *     to that block. `slugifyForId` in EditorialHeader.tsx is the
 *     reciprocal transform.
 */

import { useMemo, useState } from "react";
import { useMembership } from "../../context/MembershipContext";
import type {
  EditorialProduct,
  EditorialCategory,
} from "@/lib/shopifyEditorial";
import { EditorialCard } from "./EditorialCard";
import { AccessUpsell } from "./AccessUpsell";
import { slugifyForId } from "./EditorialHeader";

interface EditorialFeedProps {
  products: EditorialProduct[];
  /** Filter to a single category. Omit or pass "all" to show everything. */
  categoryFilter?: EditorialCategory | "all";
}

export function EditorialFeed({
  products,
  categoryFilter = "all",
}: EditorialFeedProps) {
  const { tier, isSignedIn, authLoading } = useMembership();
  const [upsellOpen, setUpsellOpen] = useState(false);

  // Ordinal in the feed is computed from the FULL feed (not filtered), so a
  // given product's № stays stable regardless of which filter is active.
  const totalAll = products.length;
  const ordinalBySlug = useMemo(() => {
    const m = new Map<string, number>();
    products.forEach((p, i) => m.set(p.slug, totalAll - i));
    return m;
  }, [products, totalAll]);

  const filtered = useMemo(() => {
    if (categoryFilter === "all") return products;
    return products.filter((p) => p.editorialCategory === categoryFilter);
  }, [products, categoryFilter]);

  // First card index per brand / collection for menu jump anchors
  // (over the filtered view, since that's what's rendered).
  const brandAnchors = useMemo(
    () => firstIndexBy(filtered, (p) => p.brand),
    [filtered]
  );
  const collectionAnchors = useMemo(
    () => firstIndexBy(filtered, (p) => p.collection),
    [filtered]
  );

  const handleGuestAdded = () => {
    if (isSignedIn) return;
    if (tier !== "free") return;
    setUpsellOpen(true);
  };

  if (filtered.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-24">
        <p className="font-serif text-2xl text-forest mb-3">
          The shelf is being restocked.
        </p>
        <p className="text-sm text-charcoal/60">Check back shortly.</p>
      </div>
    );
  }

  return (
    <>
      <div id="editorial-top" aria-hidden />

      {/* Grid: 1 / 2 / 3 columns, with dividers between cells */}
      <ul
        className="
          grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3
          gap-y-14 md:gap-y-16
          md:divide-x md:divide-charcoal/[0.06]
        "
      >
        {filtered.map((product, i) => {
          const ordinal = ordinalBySlug.get(product.slug) ?? totalAll - i;

          const brandAnchor =
            brandAnchors[product.brand] === i
              ? `editorial-brand-${slugifyForId(product.brand)}`
              : null;
          const collectionAnchor =
            collectionAnchors[product.collection] === i
              ? `editorial-collection-${slugifyForId(product.collection)}`
              : null;

          return (
            <li
              key={product.slug}
              className="relative md:px-6 lg:px-8"
            >
              {brandAnchor && (
                <div
                  id={brandAnchor}
                  aria-hidden
                  className="absolute -top-24 left-0 h-0 w-0"
                />
              )}
              {collectionAnchor && (
                <div
                  id={collectionAnchor}
                  aria-hidden
                  className="absolute -top-24 left-0 h-0 w-0"
                />
              )}
              <EditorialCard
                product={product}
                ordinal={ordinal}
                index={i}
                onGuestAddedToCart={handleGuestAdded}
              />
            </li>
          );
        })}
      </ul>

      {/* End-of-feed note */}
      <div className="max-w-md mx-auto text-center pt-24 pb-12 md:pb-24">
        <div className="mx-auto h-px w-8 bg-charcoal/25 mb-6" />
        <p className="font-serif text-xl text-forest mb-2 leading-snug">
          That's the shelf for now.
        </p>
        <p className="text-sm text-charcoal/55">
          New pieces added quietly. Come back when you can.
        </p>
      </div>

      {!authLoading && !isSignedIn && tier === "free" && (
        <AccessUpsell
          visible={upsellOpen}
          onDismiss={() => setUpsellOpen(false)}
        />
      )}
    </>
  );
}

function firstIndexBy<T>(
  items: T[],
  key: (item: T) => string
): Record<string, number> {
  const out: Record<string, number> = {};
  items.forEach((item, i) => {
    const k = key(item);
    if (!(k in out)) out[k] = i;
  });
  return out;
}
