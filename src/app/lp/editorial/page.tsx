import type { Metadata } from "next";
import Link from "next/link";
import { getEditorialFeed } from "@/lib/shopifyEditorial";
import { EditorialHeader } from "./EditorialHeader";
import { EditorialShell } from "./EditorialShell";
import { Mully8Hero } from "./Mully8Hero";
import DropWatchBar from "./DropWatchBar";

/**
 * /lp/editorial
 *
 * Uncrate-flavored editorial shop for Mully. One product per row, newest
 * first. Content is 100% Shopify-backed — this page has no Supabase reads.
 *
 * Adding a product = adding it in Shopify. It shows up here on the next
 * ISR revalidation window (1h).
 *
 * Design pillars:
 *   - Mobile first.
 *   - Editorial voice, low volume.
 *   - Guest-friendly. Membership gates content nowhere; it only affects the
 *     price shown, and after adding to cart we surface a *dismissible*
 *     Access upsell.
 *   - Zero decisions on the visitor's part beyond "read → tap → check out".
 */

export const metadata: Metadata = {
  title: "The Shelf | Mully",
  description:
    "A quiet corner of curated golf goods. New pieces added often, chosen carefully.",
  openGraph: {
    title: "The Shelf — Mully",
    description:
      "A quiet corner of curated golf goods. New pieces added often, chosen carefully.",
  },
};

// ISR: refresh the shelf hourly. Adding a product in Shopify shows up within
// the next hour without a redeploy.
export const revalidate = 3600;

/**
 * Format "Updated on July 6, 2026 at 15:00" using US Eastern time. Uses
 * Intl.DateTimeFormat so DST is handled correctly. 24-hour clock to match
 * the Uncrate reference.
 */
function formatUpdatedAt(now: Date): string {
  const date = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(now);
  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(now);
  return `Updated on ${date} at ${time}`;
}

export default async function EditorialLandingPage() {
  const products = await getEditorialFeed();

  // Menu data — derived from what's actually in the feed.
  const brands = Array.from(new Set(products.map((p) => p.brand))).sort();
  const collections = Array.from(
    new Set(products.map((p) => p.collection))
  ).sort();

  // "Updated on ..." label pinned next to the hero (Uncrate pattern).
  // Rendered at ISR revalidation time, so it reflects the last cache
  // rebuild. Formatted in US Eastern time (Mully HQ, Detroit).
  const updatedAtLabel = formatUpdatedAt(new Date());

  return (
    <div className="min-h-screen bg-white text-charcoal">
      <EditorialHeader brands={brands} collections={collections} />

      {/* Push content below the fixed header (14/16 h). */}
      <main className="pt-14 md:pt-16">
        {/* ─── MULLY 8 HERO (rotating marquee, newest 8) ─────────────── */}
        <Mully8Hero />

        {/* ─── CATEGORY NAV + FEED (client shell owns filter state) ──── */}
        <EditorialShell
          products={products}
          updatedAtLabel={updatedAtLabel}
        />

        {/* ─── MULLY 100 CTA ─────────────────────────────────────────── */}
        <section className="px-6 md:px-8 pb-24 max-w-3xl mx-auto text-center">
          <div className="mx-auto h-px w-8 bg-charcoal/25 mb-6" />
          <p className="font-serif italic text-forest text-lg mb-3">
            Beyond the shelf.
          </p>
          <h2 className="font-serif text-2xl md:text-3xl text-charcoal mb-4">
            The Mully 100
          </h2>
          <p className="text-[14px] leading-[1.7] text-charcoal/65 max-w-md mx-auto mb-6">
            One hundred golf-adjacent picks we'd buy on Amazon this week. No
            fluff, no filler, no sponsored placements.
          </p>
          <Link
            href="/lp/mully100"
            className="inline-flex items-center gap-2 text-[11px] tracking-[0.28em] uppercase text-charcoal border-b border-charcoal hover:text-forest hover:border-forest pb-1 transition-all"
          >
            <span>Browse the Mully 100</span>
            <span aria-hidden>&rarr;</span>
          </Link>
        </section>
      </main>

      {/* Floating footer — subtle email capture ("Never miss a drop") */}
      <DropWatchBar />

      {/* ─── FOOTER ────────────────────────────────────────────────────── */}
      <footer className="py-10 px-6 md:px-12 bg-forest">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <span className="flex items-center gap-2 text-bone">
            <svg
              viewBox="0 0 1002 540"
              fill="currentColor"
              className="h-4 w-auto"
              aria-hidden
            >
              <path
                d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z"
                fillRule="evenodd"
              />
            </svg>
            <span className="font-serif text-xl font-bold tracking-wide">
              mully.
            </span>
          </span>
          <div className="flex items-center gap-8">
            <Link
              href="/lp/subscription"
              className="text-sm text-bone/70 hover:text-bone transition-colors duration-300"
            >
              Curated Shipments
            </Link>
            <Link
              href="/policies/terms"
              className="text-sm text-bone/50 hover:text-bone transition-colors duration-300"
            >
              Terms
            </Link>
            <Link
              href="/policies/privacy"
              className="text-sm text-bone/50 hover:text-bone transition-colors duration-300"
            >
              Privacy
            </Link>
            <Link
              href="/faq"
              className="text-sm text-bone/50 hover:text-bone transition-colors duration-300"
            >
              FAQ
            </Link>
          </div>
          <p className="text-xs text-bone/30">
            &copy; {new Date().getFullYear()} Mully Group, Inc.
          </p>
        </div>
      </footer>
    </div>
  );
}
