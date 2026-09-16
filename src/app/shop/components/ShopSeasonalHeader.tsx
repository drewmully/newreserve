"use client";

import Link from "next/link";
import { useMembership } from "../../context/MembershipContext";
import { SlideCart } from "../../components/SlideCart";
import { ClubhouseNav, ClubhouseBottomNav } from "../../components/ClubhouseNav";
import { MullyWordmark } from "./MullyWordmark";

/**
 * Shop-only header. Deliberately different from the site-wide `ShopHeader`
 * (which uses the Mully green wordmark on a bone background). This one:
 *   - White background, subtle charcoal border
 *   - Wordmark with only the period tinted in the seasonal accent
 *   - Cart and account icons in charcoal, not forest
 *
 * This is the shop's answer to a Google seasonal doodle: same site,
 * different room. Signed-in members still get the full ClubhouseNav so
 * their subscription controls stay reachable — we only re-skin the
 * guest header.
 */
export function ShopSeasonalHeader({ accent }: { accent: string }) {
  const { cartCount, setCartOpen, isSignedIn, authLoading } = useMembership();

  // Members keep their existing top nav so the sub-management, streak, etc
  // stays in reach across the whole site.
  if (!authLoading && isSignedIn) {
    return (
      <>
        <style>{`.shop-main { padding-top: 12rem; }`}</style>
        <ClubhouseNav />
        <ClubhouseBottomNav />
        <SlideCart />
      </>
    );
  }

  return (
    <>
      <style>{`.shop-main { padding-top: 4rem; }`}</style>
      <header className="fixed left-0 right-0 top-0 z-40 border-b border-charcoal/10 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 md:px-12">
          <Link href="/shop" aria-label="Mully Shop home">
            <MullyWordmark accent={accent} className="text-2xl" />
          </Link>

          <nav className="hidden items-center gap-7 md:flex">
            {[
              { label: "Tops", href: "/shop/collection/shop-tops" },
              { label: "Bottoms", href: "/shop/collection/shop-bottoms" },
              { label: "Outerwear", href: "/shop/collection/shop-outerwear" },
              { label: "Tech", href: "/shop/collection/shop-tech" },
              { label: "Bags", href: "/shop/collection/shop-bags" },
              { label: "Accessories", href: "/shop/collection/shop-accessories" },
            ].map((link) => (
              <Link
                key={link.href}
                href={link.href}
                className="text-[11px] font-mono uppercase tracking-[0.2em] text-charcoal/60 transition-colors hover:text-charcoal"
              >
                {link.label}
              </Link>
            ))}
          </nav>

          <div className="flex items-center gap-5">
            <button
              onClick={() => setCartOpen(true)}
              className="relative text-charcoal transition-opacity duration-200 hover:opacity-70"
              aria-label="Cart"
            >
              <svg
                className="h-5 w-5"
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
                <span
                  className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full text-[10px] font-medium text-white"
                  style={{ backgroundColor: accent }}
                >
                  {cartCount}
                </span>
              )}
            </button>
            <Link
              href="/account"
              className="text-charcoal transition-opacity duration-200 hover:opacity-70"
              aria-label="Account"
            >
              <svg
                className="h-5 w-5"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={1.5}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z"
                />
              </svg>
            </Link>
          </div>
        </div>
      </header>
      <SlideCart />
    </>
  );
}
