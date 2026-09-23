"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { useMembership } from "../../context/MembershipContext";
import { ShopSlideCart } from "./ShopSlideCart";
import { MullyWordmark } from "./MullyWordmark";
import { ShopAnnouncementBar } from "./ShopAnnouncementBar";

/**
 * Shop-only header. 4 primary categories with a hover mega menu on the last
 * one to expose Bags/Accessories/Shop All without cluttering the top nav.
 *
 * Baymard 2024: 88% of top US ecommerce sites use hover mega menus. NNG:
 * mega menus cut nav time 37% for stores with >10 SKUs across categories.
 * We deliberately keep only 4 primary items to keep the header light.
 *
 * Two visual states, driven by route and scroll position (Huckberry pattern):
 *
 *  - **Transparent-on-hero**: on `/shop` while the user is inside the top
 *    ~90% of the viewport, the header sits directly on top of the seasonal
 *    hero image with white text and no background. This integrates the
 *    header into the hero photograph.
 *  - **Solid**: on every other shop route, and on `/shop` after the user has
 *    scrolled past the hero, the header renders on a solid white background
 *    with charcoal text and a soft bottom border.
 *
 * The dark announcement bar always renders above the header.
 */
export function ShopSeasonalHeader({ accent }: { accent: string }) {
  const { cartCount, setCartOpen } = useMembership();
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const pathname = usePathname();
  const [scrolledPastHero, setScrolledPastHero] = useState(false);

  // Only the /shop landing has a full-viewport dark hero the header can
  // sit on. Every other route starts with white/cream content.
  const hasHero = pathname === "/shop";

  useEffect(() => {
    if (!hasHero) return;
    // Flip to the solid state once the user has scrolled past ~85vh — a
    // touch before the hero fully leaves so the transition feels tight.
    const threshold = () => Math.round(window.innerHeight * 0.85);
    const onScroll = () => setScrolledPastHero(window.scrollY > threshold());
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, [hasHero]);

  const isTransparent = hasHero && !scrolledPastHero;
  const tone: "light" | "dark" = isTransparent ? "light" : "dark";

  // Colors switch together so the whole header reads coherently.
  const linkColor = isTransparent
    ? "text-white/85 hover:text-white"
    : "text-charcoal/70 hover:text-charcoal";
  const iconColor = isTransparent ? "text-white" : "text-charcoal";
  const headerBg = isTransparent
    ? "bg-transparent"
    : "bg-white/95 backdrop-blur-md border-b border-charcoal/10";

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
      {/*
        Global padding rule: on non-hero routes we push the main content down
        by (announcement 32px + header 64px) = 6rem. On the /shop landing,
        the hero is intentionally allowed to render under the header, so
        `shop-main` sits at 0 there and the hero occupies the full viewport
        below the announcement strip.
      */}
      <style>{`
        .shop-main { padding-top: 6rem; }
        .shop-main--hero { padding-top: 2rem; } /* just clears announcement bar; hero sits behind transparent header */
      `}</style>
      <ShopAnnouncementBar />
      <header
        className={`fixed left-0 right-0 top-8 z-40 transition-colors duration-300 ${headerBg}`}
      >
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6 md:px-12">
          <Link href="/shop" aria-label="Mully Shop home">
            <MullyWordmark accent={accent} tone={tone} className="text-2xl" />
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
                  className={`flex items-center gap-1 text-[11px] font-mono uppercase tracking-[0.2em] transition-colors ${linkColor}`}
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
            className={`relative flex items-center gap-2 transition-opacity duration-200 hover:opacity-70 ${iconColor}`}
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
