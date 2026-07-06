"use client";

/**
 * PromotedBar — the secondary nav row that sits directly under the
 * CategoryNav on /lp/editorial. Modeled on Uncrate Supply's promoted
 * bar ("THE GIFTS WE LOVE ENOUGH TO SELL", "OUR FAVORITE HUNDRED
 * THINGS ON AMAZON", "EVERYDAY CARRY").
 *
 * Understated, uppercase, tracked. Not sticky — only the category
 * filter needs to pin. Two hand-picked destinations for now, easy to
 * extend by appending to the PROMOTED array.
 */

import Link from "next/link";
import { trackEvent } from "@/lib/tracking";

interface PromotedItem {
  label: string;
  href: string;
  slug: string;
}

const PROMOTED: PromotedItem[] = [
  {
    label: "Curated Shipments",
    href: "/lp/subscription",
    slug: "curated-shipments",
  },
  {
    label: "The Mully 100",
    href: "/lp/mully100",
    slug: "mully-100",
  },
];

export function PromotedBar() {
  return (
    <div
      aria-label="Featured collections"
      className="border-b border-charcoal/[0.08] bg-bone"
    >
      <div className="max-w-6xl mx-auto px-5 md:px-10">
        <ul className="flex items-center justify-center gap-6 md:gap-14 overflow-x-auto no-scrollbar py-3 md:py-3.5">
          {PROMOTED.map(({ label, href, slug }) => (
            <li key={slug} className="shrink-0">
              <Link
                href={href}
                onClick={() =>
                  void trackEvent("editorial_promoted_click", {
                    properties: { slug, href },
                  })
                }
                className="group inline-flex items-center gap-2 text-[10.5px] md:text-[11px] tracking-[0.28em] uppercase text-charcoal/70 hover:text-forest transition-colors"
              >
                <span
                  aria-hidden
                  className="inline-block h-[5px] w-[5px] rounded-full bg-ember/70 group-hover:bg-forest transition-colors"
                />
                <span>{label}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
