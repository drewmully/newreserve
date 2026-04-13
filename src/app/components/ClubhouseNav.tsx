"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMembership } from "../context/MembershipContext";
import { useEffect, useRef, useState } from "react";

const QUICK_NAV_ITEMS = [
  { label: "Home", href: "/home", icon: "M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" },
  { label: "Shop", href: "/dashboard?tab=shop", icon: "M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" },
  { label: "Drops", href: "/dashboard?tab=drops", icon: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" },
  { label: "Community", href: "/dashboard?tab=community", icon: "M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" },
  { label: "Club", href: "/dashboard?tab=club", icon: "M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" },
  { label: "Benefits", href: "/dashboard?tab=benefits", icon: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" },
  { label: "Account", href: "/account", icon: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" },
] as const;

function isNavActive(itemHref: string, pathname: string, searchParams: URLSearchParams): boolean {
  const [itemPath, itemQuery] = itemHref.split("?");
  if (itemPath !== pathname) {
    // For /shop/* pages, highlight "Shop"
    if (pathname.startsWith("/shop") && itemPath === "/dashboard" && itemQuery === "tab=shop") return true;
    // For /community/* pages, highlight "Community"
    if (pathname.startsWith("/community") && itemPath === "/dashboard" && itemQuery === "tab=community") return true;
    return false;
  }
  if (!itemQuery) return true;
  const params = new URLSearchParams(itemQuery);
  for (const [key, value] of params.entries()) {
    if (searchParams.get(key) !== value) return false;
  }
  return true;
}

/**
 * Shared persistent navigation used across all authenticated pages.
 * Renders the top bar (logo + cart + account) and the quick-nav pill bar.
 * Includes the promo banner.
 */
export function ClubhouseNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { cartCount, setCartOpen } = useMembership();

  const [badgePop, setBadgePop] = useState(false);
  const prevCartCount = useRef(cartCount);
  useEffect(() => {
    const prev = prevCartCount.current;
    prevCartCount.current = cartCount;
    if (cartCount > prev) {
      const start = setTimeout(() => setBadgePop(true), 0);
      const end = setTimeout(() => setBadgePop(false), 400);
      return () => {
        clearTimeout(start);
        clearTimeout(end);
      };
    }
  }, [cartCount]);

  return (
    <>
      {/* ─── TOP BAR ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16">
          <Link href="/home" className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
          </Link>
          <div className="flex items-center gap-5">
            <button
              onClick={() => setCartOpen(true)}
              className="relative text-forest hover:text-forest-dark transition-colors duration-300 cursor-pointer"
              aria-label="Cart"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
              </svg>
              {cartCount > 0 && (
                <span className={`absolute -top-1.5 -right-1.5 w-4 h-4 rounded-full bg-ember text-white text-[10px] font-medium flex items-center justify-center ${badgePop ? "animate-badge-pop" : ""}`}>
                  {cartCount}
                </span>
              )}
            </button>
            <Link href="/account" className="text-forest hover:text-forest-dark transition-colors duration-300" aria-label="Account">
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      {/* ─── QUICK NAV BAR ─── */}
      <nav className="fixed top-16 left-0 right-0 z-40 bg-bone/90 backdrop-blur-md border-b border-taupe/15">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <div className="flex items-center gap-3 overflow-x-auto py-3 scrollbar-hide">
            {QUICK_NAV_ITEMS.map((item) => {
              const active = isNavActive(item.href, pathname, searchParams);
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`flex items-center gap-2 px-5 py-2.5 rounded-full border transition-all duration-300 btn-press whitespace-nowrap ${
                    active
                      ? "border-forest/40 bg-forest text-bone shadow-sm"
                      : "border-taupe/25 text-charcoal/70 hover:text-forest hover:border-forest/30 hover:bg-forest/5"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
                  </svg>
                  <span className="text-xs font-medium tracking-wide">{item.label}</span>
                </Link>
              );
            })}
          </div>
        </div>
      </nav>

      {/* ─── PROMO BANNER ─── */}
      <div className="fixed top-[8rem] left-0 right-0 z-30 bg-forest text-bone">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-2.5 flex items-center justify-center gap-2">
          <svg className="w-4 h-4 text-sage shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
          <p className="text-xs tracking-wide text-center">
            Tell your friends: we&rsquo;re having a launch party with <strong className="text-bone">free priority shipping</strong> for all.
          </p>
        </div>
      </div>
    </>
  );
}

/**
 * Mobile bottom nav bar — used on all authenticated pages.
 */
export function ClubhouseBottomNav() {
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const items = [
    { label: "Home", href: "/home", icon: "M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25" },
    { label: "Shop", href: "/dashboard?tab=shop", icon: "M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" },
    { label: "Drops", href: "/dashboard?tab=drops", icon: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" },
    { label: "Community", href: "/dashboard?tab=community", icon: "M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" },
    { label: "Account", href: "/account", icon: "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 z-40 bg-bone/95 backdrop-blur-md border-t border-taupe/20 md:hidden safe-area-bottom">
      <div className="flex items-center justify-around py-2 pb-[max(0.5rem,env(safe-area-inset-bottom))]">
        {items.map((item) => {
          const isActive = isNavActive(item.href, pathname, searchParams);
          return (
            <Link
              key={item.label}
              href={item.href}
              className={`flex flex-col items-center gap-0.5 px-3 py-1 ${isActive ? "text-forest" : "text-charcoal/40"}`}
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={item.icon} />
              </svg>
              <span className="text-[10px] font-medium">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
