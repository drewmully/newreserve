"use client";

/**
 * CuratedShipmentBand — the flagship Reserve membership section on /shop.
 *
 * Modeled on <CuratedShipmentsCard/> from /lp/editorial but rebuilt as a
 * full-width standalone <section> instead of a grid <li>. Voice, price
 * framing, and CTA copy stay identical so the offer reads the same
 * across the two surfaces.
 *
 * Links to /lp/subscription. Voice rules apply (no em dashes, no
 * "Mullybox"). Uses Mully forest green + bone rather than the seasonal
 * accent, so the section always reads as the parent-brand offer.
 */

import Image from "next/image";
import Link from "next/link";
import { trackEvent } from "@/lib/tracking";

interface Props {
  accent: string;
}

export function CuratedShipmentBand({ accent }: Props) {
  const onClick = () =>
    void trackEvent("shop_curated_shipments_click", {
      properties: { source: "shop_home_band" },
    });

  return (
    <section className="bg-forest text-bone">
      <div className="mx-auto max-w-7xl">
        <Link
          href="/lp/subscription"
          onClick={onClick}
          className="group grid grid-cols-1 md:grid-cols-2"
        >
          {/* Image side */}
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-forest md:aspect-auto md:min-h-[520px]">
            <Image
              src="/reserve-flatlay-hero.webp"
              alt="A curated shipment of Mully goods, arranged flat"
              fill
              sizes="(max-width: 767px) 100vw, 50vw"
              className="object-cover transition-transform duration-[900ms] group-hover:scale-[1.03]"
            />
          </div>

          {/* Copy side */}
          <div className="flex flex-col justify-center px-6 py-14 md:px-12 md:py-20 lg:px-16">
            <div className="mb-5 flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.28em] text-bone/60 md:text-[11px]">
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: accent }}
              />
              Reserve · Membership
            </div>

            <h2 className="font-serif text-3xl leading-[1.05] tracking-tight text-bone sm:text-4xl md:text-5xl">
              The Curated Shipment.
            </h2>

            <p className="mt-5 max-w-[46ch] font-serif text-[15px] leading-[1.6] text-bone/85 md:text-[16.5px]">
              A box of things we like, four times a year. Chosen, not
              merchandised. Pieces we would keep on our own shelf, sent at a
              members-only price.
            </p>

            <p className="mt-3 max-w-[42ch] font-serif italic text-[13.5px] leading-[1.55] text-bone/60 md:text-[14.5px]">
              Access from $250 a season, or a single quarter at retail.
            </p>

            <div className="mt-8 flex items-baseline gap-3 text-[12.5px] uppercase tracking-[0.28em] md:text-[13.5px]">
              <span
                className="transition-colors group-hover:text-bone"
                style={{ color: accent }}
              >
                See what is inside
              </span>
              <span
                aria-hidden
                className="translate-y-[-1px] transition-colors group-hover:text-bone"
                style={{ color: accent }}
              >
                &rarr;
              </span>
            </div>
          </div>
        </Link>
      </div>
    </section>
  );
}
