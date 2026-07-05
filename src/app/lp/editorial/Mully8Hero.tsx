"use client";

/**
 * Mully 8 — the rotating editorial hero.
 *
 * Modeled on Uncrate 20 (uncrate.com/20). Shows the 8 most-recently added
 * products from the editorial feed, one at a time, with a big image and
 * editorial copy. Auto-advances every ~6s, pauses on hover. Dots below.
 *
 * Numbering is FIXED 1..8. Newest = № 08, next = № 07, ... down to № 01.
 * This is different from the feed ordinal (which uses total-i and grows
 * unbounded over time). Mully 8 is a "top of shelf" magazine cover.
 *
 * Destinations render as an outbound "Visit Course" CTA. All other
 * products render as an "Add to Shelf" underline link that jumps to the
 * PDP, since the shelf card below has the actual cart flow.
 */

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EditorialProduct } from "@/lib/shopifyEditorial";
import { trackEvent } from "@/lib/tracking";

interface Mully8HeroProps {
  products: EditorialProduct[];
}

const AUTO_ADVANCE_MS = 6000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function Mully8Hero({ products }: Mully8HeroProps) {
  // Take the top 8 (feed is already newest-first).
  const top8 = useMemo(() => products.slice(0, 8), [products]);
  const [active, setActive] = useState(0);
  const [paused, setPaused] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const goTo = useCallback(
    (i: number) => {
      if (top8.length === 0) return;
      setActive(((i % top8.length) + top8.length) % top8.length);
    },
    [top8.length]
  );

  useEffect(() => {
    if (paused || top8.length <= 1) return;
    timerRef.current = setInterval(() => {
      setActive((a) => (a + 1) % top8.length);
    }, AUTO_ADVANCE_MS);
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [paused, top8.length]);

  if (top8.length === 0) return null;

  const product = top8[active];
  // Mully 8 number: newest (index 0) = 8, next = 7, ... oldest of 8 = 1.
  const mullyNum = top8.length - active;
  const isDestination = product.editorialCategory === "destinations";
  const image = product.images[0];

  return (
    <section
      className="relative bg-cream border-b border-charcoal/[0.08]"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      aria-roledescription="carousel"
      aria-label="The Mully 8"
    >
      <div className="max-w-6xl mx-auto px-5 md:px-10 pt-12 md:pt-16 pb-10 md:pb-16">
        {/* Eyebrow */}
        <div className="flex items-center justify-between mb-8 md:mb-10">
          <div className="flex items-center gap-3 text-[10px] tracking-[0.3em] uppercase text-charcoal/50">
            <span className="font-serif italic text-forest text-base normal-case tracking-normal">
              The
            </span>
            <span>Mully 8</span>
          </div>
          <Link
            href="/lp/mully100"
            className="text-[10px] tracking-[0.28em] uppercase text-charcoal/60 hover:text-forest border-b border-charcoal/25 hover:border-forest pb-1 transition-all"
            onClick={() =>
              void trackEvent("mully8_to_mully100_click", { properties: {} })
            }
          >
            The Mully 100 &rarr;
          </Link>
        </div>

        {/* Slide */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8 md:gap-14 items-center">
          {/* Image */}
          <div className="relative aspect-square bg-[#f7f6f2] border border-charcoal/[0.08] overflow-hidden">
            {image && (
              <Image
                key={product.slug}
                src={image}
                alt={product.name}
                fill
                sizes="(max-width: 767px) 100vw, 50vw"
                className={
                  isDestination
                    ? "object-cover transition-opacity duration-700"
                    : "object-contain p-6 md:p-10 transition-opacity duration-700"
                }
                priority
              />
            )}
            <div className="absolute top-4 left-4 text-[10px] tracking-[0.3em] uppercase text-charcoal/50 bg-bone/70 backdrop-blur px-2 py-1">
              № {pad(mullyNum)} / 08
            </div>
          </div>

          {/* Copy */}
          <div className="text-left">
            <div className="text-[10px] tracking-[0.3em] uppercase text-charcoal/45 mb-4">
              {product.brand}
              {product.editorialCategory ? (
                <>
                  <span className="mx-2 text-charcoal/25">·</span>
                  <span>{product.editorialCategory}</span>
                </>
              ) : null}
            </div>
            <h2 className="font-serif text-3xl md:text-4xl lg:text-5xl leading-[1.05] text-charcoal mb-5">
              {isDestination ? (
                <a
                  href={product.destinationUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="hover:text-forest transition-colors"
                >
                  {product.name}
                </a>
              ) : (
                <Link
                  href={`/shop/${product.slug}`}
                  className="hover:text-forest transition-colors"
                >
                  {product.name}
                </Link>
              )}
            </h2>
            {product.editorialHeadline && (
              <p className="text-[15px] md:text-[16px] leading-[1.65] text-charcoal/70 mb-8 max-w-[46ch]">
                {product.editorialHeadline}
              </p>
            )}

            <div className="flex items-center gap-6">
              {isDestination ? (
                <a
                  href={product.destinationUrl || "#"}
                  target="_blank"
                  rel="noopener noreferrer"
                  onClick={() =>
                    void trackEvent("mully8_cta_click", {
                      properties: {
                        product_slug: product.slug,
                        position: active,
                        category: "destinations",
                      },
                    })
                  }
                  className="inline-flex items-center gap-2 text-[11px] tracking-[0.28em] uppercase text-charcoal border-b border-charcoal hover:text-forest hover:border-forest pb-1 transition-all"
                >
                  <span>Visit Course</span>
                  <span aria-hidden>&rarr;</span>
                </a>
              ) : (
                <Link
                  href={`/shop/${product.slug}`}
                  onClick={() =>
                    void trackEvent("mully8_cta_click", {
                      properties: {
                        product_slug: product.slug,
                        position: active,
                      },
                    })
                  }
                  className="inline-flex items-center gap-2 text-[11px] tracking-[0.28em] uppercase text-charcoal border-b border-charcoal hover:text-forest hover:border-forest pb-1 transition-all"
                >
                  <span>View the Piece</span>
                  <span aria-hidden>&rarr;</span>
                </Link>
              )}
            </div>
          </div>
        </div>

        {/* Dots */}
        <div className="mt-10 md:mt-12 flex items-center justify-center gap-2">
          {top8.map((p, i) => (
            <button
              key={p.slug}
              type="button"
              onClick={() => {
                goTo(i);
                void trackEvent("mully8_dot_click", {
                  properties: { position: i },
                });
              }}
              aria-label={`Show item ${top8.length - i} of ${top8.length}`}
              aria-current={i === active}
              className={`h-1.5 rounded-full transition-all ${
                i === active
                  ? "w-8 bg-forest"
                  : "w-1.5 bg-charcoal/20 hover:bg-charcoal/40"
              }`}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
