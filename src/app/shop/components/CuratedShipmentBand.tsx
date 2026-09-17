"use client";

/**
 * CuratedShipmentBand — the Reserve membership editorial moment on /shop.
 *
 * Rebuilt to match the rest of the shop landing page: white/cream palette,
 * the same SectionHeader typography (mono eyebrow + charcoal serif headline
 * + short body), contained within the max-w-7xl frame, and a soft editorial
 * layout instead of a full-bleed forest slab. The offer intent is preserved:
 * a link to /lp/subscription, price framing, and a clear CTA.
 *
 * Voice rules apply (no em dashes, no "Mullybox", present tense).
 */

import Image from "next/image";
import Link from "next/link";
import { trackEvent } from "@/lib/tracking";

interface Props {
  accent: string;
}

const INSIDE_PILLARS: {
  eyebrow: string;
  headline: string;
  body: string;
}[] = [
  {
    eyebrow: "One layer",
    headline: "A mid you'll live in.",
    body: "A quarter-zip, a cashmere, an overshirt. The piece that shows up in every round.",
  },
  {
    eyebrow: "One accessory",
    headline: "The small thing.",
    body: "A belt, a knit hat, a leather headcover. Something that makes the bag look like yours.",
  },
  {
    eyebrow: "One find",
    headline: "The maker no one knows yet.",
    body: "A small brand we've been circling, chosen before they land in the shop.",
  },
];

export function CuratedShipmentBand({ accent }: Props) {
  const onClick = () =>
    void trackEvent("shop_curated_shipments_click", {
      properties: { source: "shop_home_band" },
    });

  return (
    <section className="border-t border-charcoal/10 bg-cream">
      <div className="mx-auto max-w-7xl px-6 py-16 md:px-12 md:py-24">
        {/* Section header — mirrors SectionHeader used elsewhere on /shop */}
        <div className="mb-10 flex items-end justify-between gap-6">
          <div>
            <div
              className="flex items-center gap-2 text-[10px] font-mono uppercase tracking-[0.2em]"
              style={{ color: accent }}
            >
              <span
                aria-hidden
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: accent }}
              />
              Reserve · Membership
            </div>
            <h2 className="mt-2 font-serif text-3xl tracking-tight text-charcoal sm:text-5xl">
              The Curated Shipment.
            </h2>
            <p className="mt-4 max-w-xl text-sm text-charcoal/70">
              Four times a year we send members a small box. One layer, one
              accessory, one find. Chosen the way we shop for ourselves.
            </p>
          </div>
          <Link
            href="/lp/subscription"
            onClick={onClick}
            className="hidden text-xs font-semibold uppercase tracking-[0.2em] text-charcoal/70 transition-colors hover:text-charcoal sm:inline-flex sm:items-center sm:gap-1"
          >
            How it works <ArrowUpRight />
          </Link>
        </div>

        {/* Editorial two-column */}
        <div className="grid grid-cols-1 gap-8 md:grid-cols-5 md:gap-12">
          {/* Image — 3 of 5 cols on desktop, framed like the brand tiles */}
          <Link
            href="/lp/subscription"
            onClick={onClick}
            className="group relative block overflow-hidden border border-charcoal/10 bg-white md:col-span-3"
          >
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-cream md:aspect-[5/4]">
              <Image
                src="/reserve-flatlay-hero.webp"
                alt="A curated shipment of Mully goods, arranged flat on grass"
                fill
                sizes="(max-width: 767px) 100vw, 60vw"
                className="object-cover transition-transform duration-[900ms] group-hover:scale-[1.03]"
              />
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-32 bg-gradient-to-t from-black/40 to-transparent" />
              <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-5 text-white md:p-6">
                <div>
                  <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-white/75">
                    Fall shipment
                  </div>
                  <div className="mt-1 font-serif text-xl leading-tight tracking-tight md:text-2xl">
                    A layer, a lighter, a book for the flight.
                  </div>
                </div>
                <ArrowUpRight className="mb-1 h-5 w-5 shrink-0 opacity-80 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5" />
              </div>
            </div>
          </Link>

          {/* What's inside — three quiet pillars */}
          <div className="flex flex-col justify-between gap-8 md:col-span-2">
            <div className="flex flex-col divide-y divide-charcoal/10 border-y border-charcoal/10">
              {INSIDE_PILLARS.map((p) => (
                <div key={p.eyebrow} className="flex flex-col gap-1.5 py-5">
                  <div className="text-[10px] font-mono uppercase tracking-[0.28em] text-charcoal/50">
                    {p.eyebrow}
                  </div>
                  <div className="font-serif text-lg leading-snug tracking-tight text-charcoal md:text-xl">
                    {p.headline}
                  </div>
                  <p className="text-xs leading-relaxed text-charcoal/65">
                    {p.body}
                  </p>
                </div>
              ))}
            </div>

            {/* Price + CTA */}
            <div className="flex flex-col gap-4">
              <div className="text-[11px] font-mono uppercase tracking-[0.28em] text-charcoal/50">
                Access from $250 a season. A single quarter at retail.
              </div>
              <Link
                href="/lp/subscription"
                onClick={onClick}
                className="group inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.2em] text-charcoal transition-colors hover:text-charcoal/70"
              >
                <span style={{ color: accent }}>See what is inside</span>
                <ArrowUpRight
                  className="h-4 w-4 transition-transform group-hover:-translate-y-0.5 group-hover:translate-x-0.5"
                  style={{ color: accent }}
                />
              </Link>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

function ArrowUpRight({
  className = "h-4 w-4",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <svg
      className={className}
      style={style}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <line x1="7" y1="17" x2="17" y2="7" />
      <polyline points="7 7 17 7 17 17" />
    </svg>
  );
}
