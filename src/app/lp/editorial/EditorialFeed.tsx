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
import { CuratedShipmentsCard } from "./CuratedShipmentsCard";
import { slugifyForId } from "./EditorialHeader";

interface EditorialFeedProps {
  products: EditorialProduct[];
  /** Filter to a single category. Omit or pass "all" to show everything. */
  categoryFilter?: EditorialCategory | "all";
  /** Optional label rendered vertically next to the hero card. */
  updatedAtLabel?: string;
}

export function EditorialFeed({
  products,
  categoryFilter = "all",
  updatedAtLabel,
}: EditorialFeedProps) {
  const { tier, isSignedIn, authLoading } = useMembership();
  const [upsellOpen, setUpsellOpen] = useState(false);

  // Ordinal in the feed is computed from the FULL feed (not filtered), so a
  // given product's № stays stable regardless of which filter is active.
  //
  // Destinations and off-Shopify affiliates are editorial breaks, not our
  // own shoppable inventory, so they don't get an ordinal. We number only
  // real Mully products: newest = highest №, oldest = № 01. Non-Mully
  // cards render without a number.
  const ordinalBySlug = useMemo(() => {
    const m = new Map<string, number>();
    const productsOnly = products.filter(
      (p) => p.editorialCategory !== "destinations" && !p.affiliateVendor
    );
    const totalProducts = productsOnly.length;
    productsOnly.forEach((p, i) => m.set(p.slug, totalProducts - i));
    return m;
  }, [products]);

  const filtered = useMemo(() => {
    if (categoryFilter === "all") return products;
    return products.filter((p) => p.editorialCategory === categoryFilter);
  }, [products, categoryFilter]);

  // Hero card: only when unfiltered. First item in the feed (newest, per
  // the sort in getEditorialFeed) becomes the hero variant. The rest of
  // the feed keeps its interleave rhythm below. When a category filter is
  // active we skip the hero — hero should only crown the full editorial
  // shelf, not a filtered view.
  const hero = categoryFilter === "all" ? filtered[0] : undefined;
  const gridItems = hero ? filtered.slice(1) : filtered;

  // First card index per brand / collection for menu jump anchors
  // (over the grid view, since that's where the anchors render).
  const brandAnchors = useMemo(
    () => firstIndexBy(gridItems, (p) => p.brand),
    [gridItems]
  );
  const collectionAnchors = useMemo(
    () => firstIndexBy(gridItems, (p) => p.collection),
    [gridItems]
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

      {/* Hero card: full-width, only on the unfiltered feed. */}
      {hero && (
        <div className="mb-16 md:mb-20 pb-16 md:pb-20 border-b border-charcoal/[0.08]">
          <EditorialCard
            product={hero}
            ordinal={ordinalBySlug.get(hero.slug)}
            index={0}
            variant="hero"
            updatedAtLabel={updatedAtLabel}
            onGuestAddedToCart={handleGuestAdded}
          />
        </div>
      )}

      {/* Grid: 1 / 2 / 3 columns, with dividers between cells */}
      <ul
        className="
          grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3
          gap-y-14 md:gap-y-16
          md:divide-x md:divide-charcoal/[0.06]
        "
      >
        {gridItems.flatMap((product, i) => {
          const ordinal = ordinalBySlug.get(product.slug);

          const brandAnchor =
            brandAnchors[product.brand] === i
              ? `editorial-brand-${slugifyForId(product.brand)}`
              : null;
          const collectionAnchor =
            collectionAnchors[product.collection] === i
              ? `editorial-collection-${slugifyForId(product.collection)}`
              : null;

          const cell = (
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

          // After the first row of 3 cells (i.e. before index 3),
          // slot in the spanning Curated Shipments card. Only inject
          // on the unfiltered feed and only when there are enough
          // items to warrant it — no point wedging a huge card into
          // a 4-item filtered view.
          if (
            i === 3 &&
            categoryFilter === "all" &&
            gridItems.length > 5
          ) {
            return [
              <CuratedShipmentsCard key="curated-shipments-spanning" />,
              cell,
            ];
          }

          return [cell];
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
