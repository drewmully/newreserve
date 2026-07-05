"use client";

/**
 * Header for /lp/editorial.
 *
 * Design goals:
 *   - Mobile first. Everything reachable one-thumb.
 *   - Editorial voice: understated wordmark, generous whitespace, no CTAs
 *     shouting at the visitor.
 *   - Hamburger holds *all* navigation. Inside: Curated Shipments (Mully's
 *     flagship subscription), then the brand/collection filters that used to
 *     live as tabs on /shop.
 *   - When a filter is selected the page scrolls to that section of the feed.
 *     Signaled to the feed via a hash change; the feed listens for it.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useMembership } from "../../context/MembershipContext";
import { SlideCart } from "../../components/SlideCart";

interface EditorialHeaderProps {
  brands: readonly string[];
  collections: readonly string[];
}

export function EditorialHeader({ brands, collections }: EditorialHeaderProps) {
  const { cartCount, setCartOpen } = useMembership();
  const [menuOpen, setMenuOpen] = useState(false);
  const [tab, setTab] = useState<"brand" | "collection">("brand");

  // Lock scroll while the menu is open. Also close on Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setMenuOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = prev;
      window.removeEventListener("keydown", onKey);
    };
  }, [menuOpen]);

  const jumpTo = useCallback((sectionId: string) => {
    setMenuOpen(false);
    // Wait one frame so the overlay unmount doesn't fight the scroll.
    requestAnimationFrame(() => {
      const el = document.getElementById(sectionId);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    });
  }, []);

  return (
    <>
      {/* SlideCart is normally rendered by ShopHeader; we bring it in here so
          the header's cart button has something to open on /lp/editorial. */}
      <SlideCart />

      {/* Sticky, thin, backdrop-blurred bar. Bone with a hairline underline. */}
      <header className="fixed top-0 inset-x-0 z-40 bg-white/90 backdrop-blur-md border-b border-charcoal/[0.08]">
        <div className="mx-auto max-w-6xl h-14 md:h-16 px-5 md:px-8 flex items-center justify-between">
          {/* Hamburger */}
          <button
            onClick={() => setMenuOpen(true)}
            aria-label="Open menu"
            className="w-10 h-10 -ml-2 flex items-center justify-center text-forest hover:text-forest-dark transition-colors cursor-pointer"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 20 20"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinecap="square"
            >
              <line x1="3" y1="6" x2="17" y2="6" />
              <line x1="3" y1="14" x2="17" y2="14" />
            </svg>
          </button>

          {/* Wordmark — dead center on mobile, still center on desktop */}
          <Link
            href="/lp/editorial"
            className="absolute left-1/2 -translate-x-1/2 flex items-center gap-1.5 text-forest"
          >
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
            <span className="font-serif text-xl md:text-2xl font-bold tracking-wide leading-none pt-0.5">
              mully.
            </span>
          </Link>

          {/* Cart */}
          <button
            onClick={() => setCartOpen(true)}
            className="relative w-10 h-10 -mr-2 flex items-center justify-center text-forest hover:text-forest-dark transition-colors cursor-pointer"
            aria-label="Cart"
          >
            <svg
              className="w-[18px] h-[18px]"
              fill="none"
              viewBox="0 0 24 24"
              stroke="currentColor"
              strokeWidth={1.5}
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z"
              />
            </svg>
            {cartCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-[16px] px-1 rounded-full bg-ember text-white text-[10px] font-medium flex items-center justify-center">
                {cartCount}
              </span>
            )}
          </button>
        </div>
      </header>

      {/* Slide-in menu — mobile-first, full width. On md+ it's a 420px panel. */}
      <div
        className={`fixed inset-0 z-50 transition-opacity duration-300 ${
          menuOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
      >
        {/* Backdrop */}
        <button
          aria-label="Close menu"
          onClick={() => setMenuOpen(false)}
          className="absolute inset-0 bg-charcoal/40 backdrop-blur-sm cursor-default"
        />

        {/* Panel */}
        <aside
          className={`absolute left-0 top-0 h-full w-full md:w-[420px] bg-white shadow-2xl transform transition-transform duration-300 ${
            menuOpen ? "translate-x-0" : "-translate-x-full"
          } flex flex-col`}
          role="dialog"
          aria-modal="true"
          aria-label="Site menu"
        >
          {/* Menu head */}
          <div className="flex items-center justify-between h-14 md:h-16 px-6 border-b border-charcoal/[0.06]">
            <span className="font-serif text-lg text-forest">Menu</span>
            <button
              onClick={() => setMenuOpen(false)}
              aria-label="Close"
              className="w-10 h-10 -mr-2 flex items-center justify-center text-forest hover:text-forest-dark cursor-pointer"
            >
              <svg
                width="18"
                height="18"
                viewBox="0 0 18 18"
                stroke="currentColor"
                strokeWidth="1.4"
              >
                <line x1="3" y1="3" x2="15" y2="15" />
                <line x1="15" y1="3" x2="3" y2="15" />
              </svg>
            </button>
          </div>

          <div className="flex-1 overflow-y-auto">
            {/* Curated Shipments — the flagship. Given top billing with a
                bordered card, not just a link. */}
            <Link
              href="/lp/subscription"
              onClick={() => setMenuOpen(false)}
              className="block mx-6 mt-6 mb-8 p-5 border border-forest/20 rounded-sm bg-[#faf9f6] hover:bg-[#f5f1e8] transition-colors group"
            >
              <div className="text-[10px] tracking-[0.2em] uppercase text-forest/60 mb-2">
                Flagship
              </div>
              <div className="font-serif text-2xl text-forest mb-1 leading-tight">
                Curated Shipments
              </div>
              <p className="text-sm text-charcoal/70 leading-relaxed">
                Four to six pieces, hand-picked, delivered quarterly.
              </p>
              <div className="mt-4 flex items-center gap-2 text-xs tracking-widest uppercase text-forest group-hover:gap-3 transition-all">
                <span>Explore</span>
                <span aria-hidden>&rarr;</span>
              </div>
            </Link>

            {/* Editorial browse — brands / collections dropdown. Mirrors the
                tabs that used to sit atop /shop. */}
            <div className="px-6 pb-8">
              <div className="text-[10px] tracking-[0.2em] uppercase text-charcoal/40 mb-3">
                Browse the Shop
              </div>

              <div className="inline-flex items-center gap-1 mb-4 p-1 rounded-full bg-taupe/20">
                {(["brand", "collection"] as const).map((mode) => (
                  <button
                    key={mode}
                    onClick={() => setTab(mode)}
                    className={`px-4 py-1.5 rounded-full text-[11px] tracking-widest uppercase transition-colors ${
                      tab === mode
                        ? "bg-forest text-bone"
                        : "text-charcoal/50 hover:text-forest"
                    }`}
                  >
                    {mode === "brand" ? "By Brand" : "By Category"}
                  </button>
                ))}
              </div>

              <ul className="space-y-0.5">
                <li>
                  <button
                    onClick={() => jumpTo("editorial-top")}
                    className="w-full text-left py-2.5 text-[15px] text-forest hover:text-forest-dark transition-colors border-b border-charcoal/[0.05]"
                  >
                    The Feed <span className="text-charcoal/40">— all recent</span>
                  </button>
                </li>
                {(tab === "brand" ? brands : collections).map((name) => (
                  <li key={name}>
                    <button
                      onClick={() =>
                        jumpTo(
                          `editorial-${tab}-${slugifyForId(name)}`
                        )
                      }
                      className="w-full text-left py-2.5 text-[15px] text-charcoal hover:text-forest transition-colors border-b border-charcoal/[0.05]"
                    >
                      {name}
                    </button>
                  </li>
                ))}
              </ul>
            </div>

            {/* Quiet secondary links */}
            <div className="px-6 pb-8 pt-2 mt-auto text-xs text-charcoal/50 space-y-2">
              <Link
                href="/account"
                onClick={() => setMenuOpen(false)}
                className="block hover:text-forest transition-colors"
              >
                Account
              </Link>
              <Link
                href="/faq"
                onClick={() => setMenuOpen(false)}
                className="block hover:text-forest transition-colors"
              >
                FAQ
              </Link>
            </div>
          </div>
        </aside>
      </div>
    </>
  );
}

// Kept in sync with the id-safe slug used in EditorialFeed.
export function slugifyForId(input: string): string {
  return input
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");
}
