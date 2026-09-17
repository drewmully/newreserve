"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import type { ShopifyProduct } from "@/lib/shopify";

export interface OutfitSpec {
  name: string;
  handles: string[];
}

interface Props {
  currentProduct: ShopifyProduct;
  /** Related products passed from the server, used to resolve outfit handles. */
  catalog: ShopifyProduct[];
}

/**
 * Ways to Wear It — Huckberry-style outfit merchandising.
 *
 *  - Reads `product.outfitsJson` (JSON array of { name, handles }).
 *  - Falls back to nothing (section is hidden) when no outfits are set.
 *  - Renders 2 outfit cards per row on desktop; clicking a card opens the
 *    Way to Wear drawer with a 4-tile product grid. The current product is
 *    always slot 1, marked "This Item".
 *  - Every product tile inside the drawer opens in a NEW TAB so the shopper
 *    can multi-add across products without losing this PDP.
 *
 * The catalog prop is the merged list of shop products passed from the server
 * (already fetched for the "You may also like" rails). We look up outfit handles
 * against it. Missing handles are silently skipped.
 */
export function WaysToWear({ currentProduct, catalog }: Props) {
  const outfits = parseOutfits(currentProduct.outfitsJson).filter(
    (o) => o.handles.length > 0
  );

  const [drawerOutfit, setDrawerOutfit] = useState<OutfitSpec | null>(null);
  const [drawerIndex, setDrawerIndex] = useState(0);

  // Lock body scroll while drawer is open.
  useEffect(() => {
    if (!drawerOutfit) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [drawerOutfit]);

  if (outfits.length === 0) return null;

  const catalogMap = new Map(catalog.map((p) => [p.slug, p]));

  return (
    <section className="mt-20">
      <div className="mb-8 flex items-end justify-between">
        <h2 className="font-serif text-2xl tracking-tight text-charcoal md:text-3xl">
          Ways to wear it
        </h2>
      </div>
      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-3">
        {outfits.map((outfit, i) => {
          const resolved = outfit.handles
            .map((h) => catalogMap.get(h))
            .filter((p): p is ShopifyProduct => Boolean(p));

          // Show the current product as slot 1 in the preview.
          const preview = [currentProduct, ...resolved.filter((p) => p.slug !== currentProduct.slug)].slice(0, 4);

          return (
            <button
              key={`${outfit.name}-${i}`}
              type="button"
              onClick={() => {
                setDrawerOutfit(outfit);
                setDrawerIndex(i);
              }}
              className="group relative flex flex-col overflow-hidden rounded-sm border border-charcoal/10 bg-cream/40 text-left transition-colors hover:border-charcoal/25"
            >
              <span className="absolute left-3 top-3 z-10 rounded-sm border border-charcoal/10 bg-white/95 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal">
                Outfit {i + 1}
              </span>
              <div className="grid aspect-square grid-cols-2 grid-rows-2 gap-2 p-4">
                {preview.map((p, idx) => (
                  <div
                    key={`${p.slug}-${idx}`}
                    className="relative overflow-hidden bg-white"
                  >
                    {p.images?.[0] && (
                      <Image
                        src={p.images[0]}
                        alt={p.name}
                        fill
                        sizes="(max-width: 768px) 40vw, 20vw"
                        className="object-contain p-2"
                      />
                    )}
                  </div>
                ))}
                {/* Fill empty slots to keep the grid balanced. */}
                {Array.from({ length: Math.max(0, 4 - preview.length) }).map((_, i) => (
                  <div key={`empty-${i}`} className="bg-white/60" />
                ))}
              </div>
              <div className="border-t border-charcoal/10 px-4 py-3">
                <div className="text-[11px] font-mono uppercase tracking-[0.2em] text-charcoal/60">
                  {outfit.name}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {drawerOutfit && (
        <WayToWearDrawer
          outfit={drawerOutfit}
          outfitIndex={drawerIndex}
          totalOutfits={outfits.length}
          currentProduct={currentProduct}
          catalog={catalog}
          onClose={() => setDrawerOutfit(null)}
          onPrev={() => {
            const next = (drawerIndex - 1 + outfits.length) % outfits.length;
            setDrawerIndex(next);
            setDrawerOutfit(outfits[next]);
          }}
          onNext={() => {
            const next = (drawerIndex + 1) % outfits.length;
            setDrawerIndex(next);
            setDrawerOutfit(outfits[next]);
          }}
        />
      )}
    </section>
  );
}

function WayToWearDrawer({
  outfit,
  outfitIndex,
  totalOutfits,
  currentProduct,
  catalog,
  onClose,
  onPrev,
  onNext,
}: {
  outfit: OutfitSpec;
  outfitIndex: number;
  totalOutfits: number;
  currentProduct: ShopifyProduct;
  catalog: ShopifyProduct[];
  onClose: () => void;
  onPrev: () => void;
  onNext: () => void;
}) {
  const catalogMap = new Map(catalog.map((p) => [p.slug, p]));
  const items = [
    currentProduct,
    ...outfit.handles
      .filter((h) => h !== currentProduct.slug)
      .map((h) => catalogMap.get(h))
      .filter((p): p is ShopifyProduct => Boolean(p)),
  ];

  // Close on escape.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "ArrowLeft" && totalOutfits > 1) onPrev();
      if (e.key === "ArrowRight" && totalOutfits > 1) onNext();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, onPrev, onNext, totalOutfits]);

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/30"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Way to wear it"
    >
      <div
        className="flex h-full w-full max-w-2xl flex-col overflow-y-auto bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 z-10 flex items-center justify-between border-b border-charcoal/10 bg-white px-6 py-4">
          <h3 className="font-serif text-xl tracking-tight text-charcoal">
            Way to wear it
          </h3>
          <button
            onClick={onClose}
            className="text-2xl leading-none text-charcoal/60 hover:text-charcoal"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {totalOutfits > 1 && (
          <div className="flex items-center justify-center gap-4 border-b border-charcoal/10 px-6 py-3">
            <button
              onClick={onPrev}
              className="text-charcoal/50 hover:text-charcoal"
              aria-label="Previous outfit"
            >
              ‹
            </button>
            <span className="rounded-full bg-charcoal px-3 py-1 text-[11px] font-mono uppercase tracking-[0.2em] text-white">
              {outfitIndex + 1} / {totalOutfits}
            </span>
            <button
              onClick={onNext}
              className="text-charcoal/50 hover:text-charcoal"
              aria-label="Next outfit"
            >
              ›
            </button>
          </div>
        )}

        <div className="grid flex-1 grid-cols-2 gap-4 p-6">
          {items.map((p, i) => {
            const isCurrent = p.slug === currentProduct.slug;
            return (
              <a
                key={`${p.slug}-${i}`}
                href={`/shop/${p.slug}`}
                target={isCurrent ? undefined : "_blank"}
                rel={isCurrent ? undefined : "noopener noreferrer"}
                className="group flex flex-col"
                aria-current={isCurrent ? "page" : undefined}
              >
                <div className="relative aspect-square overflow-hidden bg-cream/60">
                  {isCurrent && (
                    <span className="absolute left-3 top-3 z-10 rounded-sm border border-charcoal/10 bg-white/95 px-2.5 py-1 text-[10px] font-mono uppercase tracking-[0.2em] text-charcoal">
                      This item
                    </span>
                  )}
                  {p.images?.[0] && (
                    <Image
                      src={p.images[0]}
                      alt={p.name}
                      fill
                      sizes="(max-width: 768px) 40vw, 25vw"
                      className="object-contain p-4 transition-transform duration-300 group-hover:scale-[1.03]"
                    />
                  )}
                </div>
                <div className="mt-3 flex items-baseline justify-between gap-3">
                  <div>
                    <div className="text-[11px] font-mono uppercase tracking-[0.18em] text-charcoal/50">
                      {p.brand}
                    </div>
                    <div className="mt-0.5 text-[13px] leading-snug text-charcoal">
                      {p.name}
                    </div>
                  </div>
                  <div className="text-[13px] text-charcoal">
                    ${p.price.toFixed(0)}
                  </div>
                </div>
              </a>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function parseOutfits(json: string | undefined): OutfitSpec[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (o): o is OutfitSpec =>
          Boolean(o) &&
          typeof o.name === "string" &&
          Array.isArray(o.handles) &&
          o.handles.every((h: unknown) => typeof h === "string")
      )
      .slice(0, 6);
  } catch {
    return [];
  }
}
