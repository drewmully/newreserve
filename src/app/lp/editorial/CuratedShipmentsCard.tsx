"use client";

/**
 * CuratedShipmentsCard — the dominant, spanning editorial card that
 * sits after the first row of products in the /lp/editorial grid.
 *
 * Bigger than a normal grid cell: full-width on mobile, 2-col on md,
 * 3-col on lg (so it spans the entire row). Two-column layout at md+
 * (image left, editorial copy right) and stacked on mobile.
 *
 * Links to /lp/subscription — the Reserve subscription landing page.
 * Voice rules apply: no em dashes, no "Mullybox", Mully brand only.
 */

import Image from "next/image";
import Link from "next/link";
import { trackEvent } from "@/lib/tracking";

export function CuratedShipmentsCard() {
  const onClick = () =>
    void trackEvent("editorial_curated_shipments_click", {
      properties: { source: "editorial_grid_spanning" },
    });

  return (
    <li className="md:col-span-2 lg:col-span-3 md:!border-l-0 md:!pl-0">
      <Link
        href="/lp/subscription"
        onClick={onClick}
        className="group block bg-forest text-bone overflow-hidden"
      >
        <div className="grid grid-cols-1 md:grid-cols-2">
          {/* Image side */}
          <div className="relative aspect-[4/3] md:aspect-auto md:min-h-[420px] bg-forest overflow-hidden">
            <Image
              src="/reserve-flatlay-hero.webp"
              alt="A curated shipment of Mully goods, arranged flat"
              fill
              sizes="(max-width: 767px) 100vw, 50vw"
              className="object-cover transition-transform duration-[900ms] group-hover:scale-[1.03]"
            />
          </div>

          {/* Copy side */}
          <div className="flex flex-col justify-center px-8 md:px-12 lg:px-16 py-12 md:py-14">
            <div className="text-[10px] md:text-[11px] tracking-[0.32em] uppercase text-bone/60 mb-4">
              Featured / Subscription
            </div>

            <h3 className="font-serif font-bold uppercase text-bone leading-[1.1] text-[26px] md:text-[32px] lg:text-[38px] tracking-[0.02em] mb-5">
              The Curated Shipment
            </h3>

            <p className="font-serif text-bone/85 text-[15px] md:text-[16.5px] leading-[1.6] max-w-[46ch] mb-3">
              A box of things we like, four times a year. Chosen, not
              merchandised. Pieces we would keep on our own shelf, sent
              at a members-only price.
            </p>

            <p className="font-serif italic text-bone/60 text-[13.5px] md:text-[14.5px] leading-[1.55] max-w-[42ch] mb-8">
              Access from $250 a season, or a single quarter at retail.
            </p>

            <div className="flex items-baseline gap-3 text-[12.5px] md:text-[13.5px] tracking-[0.28em] uppercase">
              <span className="text-ember group-hover:text-bone transition-colors">
                See what is inside
              </span>
              <span
                aria-hidden
                className="text-ember/70 group-hover:text-bone transition-colors translate-y-[-1px]"
              >
                &rarr;
              </span>
            </div>
          </div>
        </div>
      </Link>
    </li>
  );
}
