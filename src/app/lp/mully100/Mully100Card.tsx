"use client";

/**
 * One Mully 100 card — Uncrate-style tile with an outbound Amazon link.
 * No cart, no membership pricing, no PDP. This is a pure affiliate feed.
 *
 * Every image click and every "View on Amazon" click fires the same
 * tracking event so we can measure clickthrough in PostHog.
 */

import Image from "next/image";
import { useMemo, useState } from "react";
import { amazonUrl, type Mully100Item } from "@/lib/mully100";
import { EDITORIAL_CATEGORY_LABELS } from "@/lib/shopifyEditorial";
import { trackEvent } from "@/lib/tracking";

interface Mully100CardProps {
  item: Mully100Item;
  index: number;
}

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function Mully100Card({ item, index }: Mully100CardProps) {
  const [imgOk, setImgOk] = useState(true);
  const href = useMemo(() => amazonUrl(item), [item]);
  const isDataUrl = item.image.startsWith("data:");

  const fire = () =>
    void trackEvent("mully100_card_click", {
      properties: {
        item_id: item.id,
        rank: item.rank,
        category: item.category,
        brand: item.brand,
        index,
        has_asin: Boolean(item.asin),
      },
    });

  return (
    <article className="group flex flex-col">
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer sponsored"
        onClick={fire}
        className="block relative aspect-square bg-[#f7f6f2] border border-charcoal/[0.08] overflow-hidden"
      >
        {imgOk && item.image ? (
          isDataUrl ? (
            // Inline SVG placeholder — no next/image optimization needed
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={item.image}
              alt={`${item.brand} ${item.name}`}
              className="absolute inset-0 w-full h-full object-cover"
              loading="lazy"
            />
          ) : (
            <Image
              src={item.image}
              alt={`${item.brand} ${item.name}`}
              fill
              sizes="(max-width: 767px) 100vw, (max-width: 1023px) 50vw, 360px"
              className="object-contain p-5 md:p-6 transition-transform duration-500 group-hover:scale-[1.02]"
              loading="lazy"
              onError={() => setImgOk(false)}
            />
          )
        ) : (
          <div className="absolute inset-0 flex items-center justify-center text-charcoal/40 font-serif italic text-lg">
            {item.brand}
          </div>
        )}
      </a>

      <div className="pt-6 md:pt-7 text-center px-2">
        <div className="text-[10px] tracking-[0.28em] uppercase text-charcoal/40 mb-3">
          № {pad(item.rank)} &nbsp;·&nbsp; {item.brand}
          <span className="mx-2 text-charcoal/25">·</span>
          {EDITORIAL_CATEGORY_LABELS[item.category]}
        </div>

        <h2 className="font-sans text-[13px] md:text-[14px] font-semibold tracking-[0.08em] uppercase leading-[1.35] text-charcoal mb-3">
          <a
            href={href}
            target="_blank"
            rel="noopener noreferrer sponsored"
            onClick={fire}
            className="hover:text-forest transition-colors"
          >
            {item.name}
          </a>
        </h2>

        <p className="text-[13.5px] leading-[1.6] text-charcoal/70 max-w-[34ch] mx-auto mb-5">
          {item.headline}
        </p>

        <a
          href={href}
          target="_blank"
          rel="noopener noreferrer sponsored"
          onClick={fire}
          className="inline-flex items-center gap-2 text-[10px] tracking-[0.28em] uppercase text-charcoal/70 border-b border-charcoal/30 hover:border-charcoal hover:text-charcoal pb-1 transition-all"
        >
          <span>View on Amazon</span>
          <span aria-hidden>&rarr;</span>
        </a>
      </div>
    </article>
  );
}
