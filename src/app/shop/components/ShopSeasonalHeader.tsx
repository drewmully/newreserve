"use client";

import Link from "next/link";
import { useMembership } from "../../context/MembershipContext";
import { ShopSlideCart } from "./ShopSlideCart";
import { MullyWordmark } from "./MullyWordmark";

/**
 * Shop-only header. Always renders the shop chrome regardless of auth state.
 * The shop is a self-contained retail surface (like V1 Sports storefront).
 * Account flows live on /account and are not surfaced from /shop routes.
 */
export function ShopSeasonalHeader({ accent }: { accent: string }) {
  const { cartCount, setCartOpen } = useMembership();

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

          <button
            onClick={() => setCartOpen(true)}
            className="relative flex items-center gap-2 text-charcoal transition-opacity duration-200 hover:opacity-70"
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
            <span className="text-[11px] font-mono uppercase tracking-[0.2em]">Cart</span>
            {cartCount > 0 && (
              <span
                className="absolute -right-2 -top-1.5 flex h-4 min-w-[16px] items-center justify-center rounded-full px-1 text-[10px] font-medium text-white"
                style={{ backgroundColor: accent }}
              >
                {cartCount}
              </span>
            )}
          </button>
        </div>
      </header>
      <ShopSlideCart accent={accent} />
    </>
  );
}
