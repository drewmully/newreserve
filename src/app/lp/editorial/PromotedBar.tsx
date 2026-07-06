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
      className="border-b border-charcoal/[0.08] bg-white"
    >
      <div className="max-w-6xl mx-auto px-5 md:px-10">
        <ul className="flex items-center justify-center overflow-x-auto no-scrollbar py-2 md:py-2.5">
          {PROMOTED.map(({ label, href, slug }, i) => (
            <li
              key={slug}
              className={`shrink-0 flex items-center ${
                i > 0 ? "pl-6 md:pl-10" : ""
              }`}
            >
              {i > 0 && (
                <span
                  aria-hidden
                  className="inline-block w-px h-3 bg-charcoal/25 mr-6 md:mr-10"
                />
              )}
              <Link
                href={href}
                onClick={() =>
                  void trackEvent("editorial_promoted_click", {
                    properties: { slug, href },
                  })
                }
                className="text-[10.5px] md:text-[11px] tracking-[0.28em] uppercase text-charcoal hover:text-forest transition-colors"
              >
                {label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
