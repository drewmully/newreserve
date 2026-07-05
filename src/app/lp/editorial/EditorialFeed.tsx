"use client";

/**
 * The endless editorial feed.
 *
 * Layout notes:
 *   - Mobile first, one card per row, generous vertical rhythm between them.
 *   - We render the full product list from the server (already 1h-ISR cached).
 *     "Endless" is a UX feel, not infinite scroll; when the list grows we'll
 *     switch to a windowed / paginated fetch, but until we have 100+ products
 *     it's cheaper (in code and CLS) to render everything.
 *   - Section anchors: we place invisible <div id="..."> markers before the
 *     first card of each brand and each collection so the header menu can
 *     `scrollIntoView` to that block. `slugifyForId` in EditorialHeader.tsx
 *     is the reciprocal transform.
 */

import { useMemo, useState } from "react";
import { useMembership } from "../../context/MembershipContext";
import type { EditorialProduct } from "@/lib/shopifyEditorial";
import { EditorialCard } from "./EditorialCard";
import { AccessUpsell } from "./AccessUpsell";
import { slugifyForId } from "./EditorialHeader";

interface EditorialFeedProps {
  products: EditorialProduct[];
}

export function EditorialFeed({ products }: EditorialFeedProps) {
  const { tier, isSignedIn, authLoading } = useMembership();
  const [upsellOpen, setUpsellOpen] = useState(false);

  // Compute the *first* card index for each brand and collection so we can
  // anchor a scroll target at that card. Done once per product list.
  const brandAnchors = useMemo(() => firstIndexBy(products, (p) => p.brand), [products]);
  const collectionAnchors = useMemo(
    () => firstIndexBy(products, (p) => p.collection),
    [products]
  );

  const handleGuestAdded = () => {
    if (isSignedIn) return;
    if (tier !== "free") return;
    setUpsellOpen(true);
  };

  if (products.length === 0) {
    return (
      <div className="max-w-md mx-auto text-center py-24">
        <p className="font-serif text-2xl text-forest mb-3">
          The shelf is being restocked.
        </p>
        <p className="text-sm text-charcoal/60">
          Check back shortly.
        </p>
      </div>
    );
  }

  return (
    <>
      <div id="editorial-top" aria-hidden />

      <ul className="space-y-24 md:space-y-32">
        {products.map((product, i) => {
          const brandAnchor = brandAnchors[product.brand] === i
            ? `editorial-brand-${slugifyForId(product.brand)}`
            : null;
          const collectionAnchor = collectionAnchors[product.collection] === i
            ? `editorial-collection-${slugifyForId(product.collection)}`
            : null;

          return (
            <li key={product.slug} className="relative">
              {/* Anchor targets sit above the card. Zero-height, keyboard-invisible. */}
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
                index={i}
                onGuestAddedToCart={handleGuestAdded}
              />

              {/* Divider — narrow, off-center. Removed after last card. */}
              {i < products.length - 1 && (
                <div className="mt-24 md:mt-32 flex justify-center">
                  <div className="h-px w-16 bg-charcoal/15" />
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {/* End-of-feed note. Editorial voice, no CTA. */}
      <div className="max-w-md mx-auto text-center pt-24 pb-12 md:pb-24">
        <div className="mx-auto h-px w-8 bg-charcoal/25 mb-6" />
        <p className="font-serif text-xl text-forest mb-2 leading-snug">
          That's the shelf for now.
        </p>
        <p className="text-sm text-charcoal/55">
          New pieces added quietly. Come back when you can.
        </p>
      </div>

      {/* Only render the upsell surface at all for guests — hidden for paid. */}
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
