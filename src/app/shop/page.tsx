import type { Metadata } from "next";
import Link from "next/link";
import { products, BRANDS, COLLECTIONS } from "./products";
import { ShopGrid } from "./components/ShopClient";
import { ShopHeader } from "../components/ShopHeader";

export const metadata: Metadata = {
  title: "Shop | Mully Reserve",
  description:
    "Curated golf products from the best brands at Reserve pricing.",
};

export default function ShopPage() {
  return (
    <div className="min-h-screen bg-bone">
      {/* ─── HEADER ─── */}
      <ShopHeader />

      {/* ─── PAGE CONTENT ─── */}
      <main className="pt-24 pb-24 px-6 md:px-12">
        <div className="max-w-7xl mx-auto">
          {/* Grid */}
          <ShopGrid
            products={products}
            brands={BRANDS}
            collections={COLLECTIONS}
          />
        </div>
      </main>

      {/* ─── FOOTER ─── */}
      <footer className="py-10 px-6 md:px-12 bg-forest">
        <div className="max-w-6xl mx-auto flex flex-col md:flex-row md:items-center md:justify-between gap-4">
          <span className="flex items-center gap-2 text-bone">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-xl font-bold tracking-wide">mully.</span>
          </span>
          <div className="flex items-center gap-8">
            <Link href="/policies/terms" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300">Terms</Link>
            <Link href="/policies/privacy" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300">Privacy</Link>
            <Link href="/faq" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300">FAQ</Link>
            <Link href="/returns" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300">Returns</Link>
          </div>
          <p className="text-xs text-bone/30">&copy; {new Date().getFullYear()} Mully Group, Inc.</p>
        </div>
      </footer>
    </div>
  );
}
