import type { Metadata } from "next";
import Link from "next/link";
import { products, BRANDS, COLLECTIONS } from "./products";
import { ShopGrid } from "./components/ShopClient";

export const metadata: Metadata = {
  title: "Shop | Mully Reserve",
  description:
    "Curated golf products from the best brands — at Reserve pricing.",
};

export default function ShopPage() {
  return (
    <div className="min-h-screen bg-bone">
      {/* ─── HEADER ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16">
          <Link
            href="/"
            className="font-serif text-2xl text-ember font-bold tracking-wide"
          >
            mully.
          </Link>
          <nav className="flex items-center gap-8">
            <Link
              href="/shop"
              className="hidden md:block text-sm tracking-wider uppercase text-forest font-medium transition-colors duration-300"
            >
              Shop
            </Link>
            <Link
              href="/#reserve"
              className="hidden md:block text-sm tracking-wider uppercase text-charcoal/60 hover:text-forest transition-colors duration-300"
            >
              Reserve
            </Link>
            <Link
              href="/login"
              className="text-sm tracking-wider uppercase text-forest font-medium hover:text-forest-dark transition-colors duration-300"
            >
              Sign In
            </Link>
          </nav>
        </div>
      </header>

      {/* ─── PAGE CONTENT ─── */}
      <main className="pt-32 pb-24 px-6 md:px-12">
        <div className="max-w-7xl mx-auto">
          {/* Title */}
          <div className="text-center mb-12 md:mb-16">
            <h1 className="font-serif text-3xl md:text-5xl text-obsidian leading-tight mb-4">
              The Shop
            </h1>
            <p className="text-base text-charcoal/50 max-w-lg mx-auto">
              Curated products from our partner brands. Reserve members
              get preferred pricing on everything.
            </p>
          </div>

          {/* Grid */}
          <ShopGrid
            products={products}
            brands={BRANDS}
            collections={COLLECTIONS}
          />
        </div>
      </main>

      {/* ─── FOOTER ─── */}
      <footer className="py-12 px-6 md:px-12 bg-obsidian">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-6">
          <span className="font-serif text-xl text-ember font-bold tracking-wide">
            mully.
          </span>
          <div className="flex items-center gap-8">
            <Link
              href="/terms"
              className="text-sm text-bone/40 hover:text-bone/70 transition-colors duration-300"
            >
              Terms
            </Link>
            <Link
              href="/privacy"
              className="text-sm text-bone/40 hover:text-bone/70 transition-colors duration-300"
            >
              Privacy
            </Link>
            <Link
              href="/contact"
              className="text-sm text-bone/40 hover:text-bone/70 transition-colors duration-300"
            >
              Contact
            </Link>
          </div>
        </div>
      </footer>
    </div>
  );
}
