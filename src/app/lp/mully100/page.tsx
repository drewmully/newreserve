import type { Metadata } from "next";
import Link from "next/link";
import { MULLY_100 } from "@/lib/mully100";
import { EditorialHeader } from "../editorial/EditorialHeader";
import { Mully100Grid } from "./Mully100Grid";

/**
 * /lp/mully100
 *
 * The Mully 100 — Amazon-affiliate feed of golf-adjacent picks. Uses the
 * shared EditorialHeader for continuity with /lp/editorial. Data is
 * static in `src/lib/mully100.ts`; add rows via PR.
 *
 * Affiliate tag is centralized in `AMAZON_AFFILIATE_TAG` in the data file.
 */

export const metadata: Metadata = {
  title: "The Mully 100 | Mully",
  description:
    "One hundred golf-adjacent picks we'd buy on Amazon this week. Curated by Mully.",
  openGraph: {
    title: "The Mully 100 — Mully",
    description:
      "One hundred golf-adjacent picks we'd buy on Amazon this week. Curated by Mully.",
  },
};

// Static list, but keep ISR light in case we hot-swap items via git deploy.
export const revalidate = 3600;

export default function Mully100Page() {
  // Sort ascending by rank so rank=1 shows top-left.
  const items = [...MULLY_100].sort((a, b) => a.rank - b.rank);

  // Derive header menus from the items so it still looks like a real
  // shop nav, even though nothing here is Shopify-backed.
  const brands = Array.from(new Set(items.map((i) => i.brand))).sort();
  const collections: string[] = [];

  return (
    <div className="min-h-screen bg-white text-charcoal">
      <EditorialHeader brands={brands} collections={collections} />

      <main className="pt-14 md:pt-16">
        {/* ─── HERO ─────────────────────────────────────────────────────── */}
        <section className="px-6 md:px-8 pt-14 md:pt-20 pb-10 md:pb-14 max-w-3xl mx-auto text-center">
          <div className="text-[10px] tracking-[0.3em] uppercase text-charcoal/45 mb-4">
            The Mully 100 &nbsp;·&nbsp; Affiliate Feed
          </div>
          <h1 className="font-serif text-3xl md:text-5xl leading-[1.08] text-charcoal mb-5">
            One hundred picks{" "}
            <span className="italic text-forest">worth</span> the click.
          </h1>
          <p className="text-[14.5px] md:text-[15px] leading-[1.7] text-charcoal/65 max-w-md mx-auto">
            Golf-adjacent gear we'd actually put in the bag. Every link is an
            Amazon affiliate link, which helps keep Mully independent.
          </p>

          <div className="mt-7 flex items-center justify-center gap-6 text-[10px] tracking-[0.28em] uppercase">
            <Link
              href="/lp/editorial"
              className="inline-flex items-center gap-2 text-charcoal/55 hover:text-forest border-b border-charcoal/25 hover:border-forest pb-1 transition-all"
            >
              <span>&larr; The Shelf</span>
            </Link>
            <Link
              href="/lp/subscription"
              className="inline-flex items-center gap-2 text-charcoal/55 hover:text-forest border-b border-charcoal/25 hover:border-forest pb-1 transition-all"
            >
              <span>Curated Shipments</span>
              <span aria-hidden>&rarr;</span>
            </Link>
          </div>
        </section>

        {/* ─── FILTER + GRID (client-side) ────────────────────────────── */}
        <Mully100Grid items={items} />

        {/* ─── AFFILIATE DISCLOSURE ────────────────────────────────────── */}
        <section className="px-6 md:px-8 pb-24 max-w-2xl mx-auto text-center">
          <div className="mx-auto h-px w-8 bg-charcoal/25 mb-6" />
          <p className="text-[11px] leading-[1.7] text-charcoal/50">
            As an Amazon Associate, Mully earns a small commission on
            qualifying purchases at no extra cost to you. We only list picks
            we'd carry ourselves.
          </p>
        </section>
      </main>

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
              href="/lp/editorial"
              className="text-sm text-bone/70 hover:text-bone transition-colors duration-300"
            >
              The Shelf
            </Link>
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
          </div>
          <p className="text-xs text-bone/30">
            &copy; {new Date().getFullYear()} Mully Group, Inc.
          </p>
        </div>
      </footer>
    </div>
  );
}
