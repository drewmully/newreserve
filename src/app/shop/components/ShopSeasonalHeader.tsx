"use client";

import Link from "next/link";
import { useState } from "react";
import { useMembership } from "../../context/MembershipContext";
import { ShopSlideCart } from "./ShopSlideCart";
import { MullyWordmark } from "./MullyWordmark";

/**
 * Shop-only header. 4 primary categories with a hover mega menu on the last
 * one to expose Bags/Accessories/Shop All without cluttering the top nav.
 *
 * Baymard 2024: 88% of top US ecommerce sites use hover mega menus. NNG:
 * mega menus cut nav time 37% for stores with >10 SKUs across categories.
 * We deliberately keep only 4 primary items to keep the header light.
 */
export function ShopSeasonalHeader({ accent }: { accent: string }) {
  const { cartCount, setCartOpen } = useMembership();
  const [openMenu, setOpenMenu] = useState<string | null>(null);

  const primary = [
    {
      key: "apparel",
      label: "Apparel",
      href: "/shop/collection/shop-tops",
      submenu: [
        { label: "Tops", href: "/shop/collection/shop-tops" },
        { label: "Bottoms", href: "/shop/collection/shop-bottoms" },
        { label: "Outerwear", href: "/shop/collection/shop-outerwear" },
      ],
    },
    {
      key: "tech",
      label: "Tech",
      href: "/shop/collection/shop-tech",
    },
    {
      key: "gear",
      label: "Gear",
      href: "/shop/collection/shop-bags",
      submenu: [
        { label: "Bags", href: "/shop/collection/shop-bags" },
        { label: "Accessories", href: "/shop/collection/shop-accessories" },
      ],
    },
    {
      key: "all",
      label: "Shop All",
      href: "/shop/collection/shop-all",
    },
  ];

  return (
    <>
      <style>{`.shop-main { padding-top: 4rem; }`}</style>
      <header className="fixed left-0 right-0 top-0 z-40 border-b border-charcoal/10 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 md:px-12">
          <Link href="/shop" aria-label="Mully Shop home">
            <MullyWordmark accent={accent} className="text-2xl" />
          </Link>

          <nav
            className="hidden items-center gap-8 md:flex"
            onMouseLeave={() => setOpenMenu(null)}
          >
            {primary.map((item) => (
              <div
                key={item.key}
                className="relative"
                onMouseEnter={() =>
                  setOpenMenu(item.submenu ? item.key : null)
                }
              >
                <Link
                  href={item.href}
                  className="flex items-center gap-1 text-[11px] font-mono uppercase tracking-[0.2em] text-charcoal/70 transition-colors hover:text-charcoal"
                >
                  {item.label}
                  {item.submenu && (
                    <svg
                      className="h-2.5 w-2.5"
                      viewBox="0 0 12 12"
                      fill="none"
                      aria-hidden="true"
                    >
                      <path
                        d="M3 4.5l3 3 3-3"
                        stroke="currentColor"
                        strokeWidth={1.5}
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                </Link>
                {item.submenu && openMenu === item.key && (
                  <div className="absolute left-1/2 top-full -translate-x-1/2 pt-4">
                    <div className="min-w-[180px] border border-charcoal/10 bg-white py-2 shadow-lg">
                      {item.submenu.map((sub) => (
                        <Link
                          key={sub.href}
                          href={sub.href}
                          className="block px-5 py-2 text-[11px] font-mono uppercase tracking-[0.2em] text-charcoal/70 transition-colors hover:bg-cream hover:text-charcoal"
                        >
                          {sub.label}
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
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
