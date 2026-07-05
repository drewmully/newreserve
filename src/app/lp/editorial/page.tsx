import type { Metadata } from "next";
import Link from "next/link";
import { getEditorialFeed } from "@/lib/shopifyEditorial";
import { EditorialHeader } from "./EditorialHeader";
import { EditorialFeed } from "./EditorialFeed";

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

export default async function EditorialLandingPage() {
  const products = await getEditorialFeed();

  // Menu data — derived from what's actually in the feed.
  const brands = Array.from(new Set(products.map((p) => p.brand))).sort();
  const collections = Array.from(
    new Set(products.map((p) => p.collection))
  ).sort();

  return (
    <div className="min-h-screen bg-white text-charcoal">
      <EditorialHeader brands={brands} collections={collections} />

      {/* Push content below the fixed header (14/16 h). */}
      <main className="pt-14 md:pt-16">
        {/* ─── HERO ─────────────────────────────────────────────────────── */}
        <section className="px-6 md:px-8 pt-14 md:pt-20 pb-10 md:pb-16 max-w-3xl mx-auto text-center border-b border-charcoal/[0.08]">
          <div className="text-[10px] tracking-[0.3em] uppercase text-charcoal/45 mb-4">
            The Shelf &nbsp;·&nbsp; Curated by Mully
          </div>
          <h1 className="font-serif text-3xl md:text-5xl leading-[1.08] text-charcoal mb-5">
            Golf goods{" "}
            <span className="italic text-forest">most golfers</span>{" "}
            haven't found yet.
          </h1>
          <p className="text-[14.5px] md:text-[15px] leading-[1.7] text-charcoal/65 max-w-md mx-auto">
            Objects of desire &amp; tools of the trade, curated by Mully.
          </p>

          <div className="mt-7 flex items-center justify-center text-[10px] tracking-[0.28em] uppercase">
            <Link
              href="/lp/subscription"
              className="inline-flex items-center gap-2 text-charcoal/55 hover:text-forest border-b border-charcoal/25 hover:border-forest pb-1 transition-all"
            >
              <span>Or: Curated Shipments</span>
              <span aria-hidden>&rarr;</span>
            </Link>
          </div>
        </section>

        {/* ─── FEED ─────────────────────────────────────────────────────── */}
        <section className="px-5 md:px-10 pt-12 md:pt-16 pb-20 md:pb-28">
          <div className="max-w-6xl mx-auto">
            <EditorialFeed products={products} />
          </div>
        </section>
      </main>

      {/* ─── FOOTER ─────────────────────────────────────────────────────── */}
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
