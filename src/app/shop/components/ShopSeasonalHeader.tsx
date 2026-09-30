"use client";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { useMembership } from "../../context/MembershipContext";
import { ShopSlideCart } from "./ShopSlideCart";
import { MullyWordmark } from "./MullyWordmark";
import { ShopAnnouncementBar } from "./ShopAnnouncementBar";
import { safeShopReturn } from "@/lib/shopLogin";

const apparel = [
  ["Tops", "/shop/collection/shop-tops"],
  ["Bottoms", "/shop/collection/shop-bottoms"],
  ["Outerwear", "/shop/collection/shop-outerwear"],
];
const gear = [
  ["Tech", "/shop/collection/shop-tech"],
  ["Bags", "/shop/collection/shop-bags"],
  ["Accessories", "/shop/collection/shop-accessories"],
];

export function ShopSeasonalHeader({ accent }: { accent: string }) {
  const { cartCount, setCartOpen, isSignedIn, authLoading } = useMembership();
  const pathname = usePathname();
  const menu = useRef<HTMLDialogElement>(null);
  const menuButton = useRef<HTMLButtonElement>(null);
  useEffect(() => { menu.current?.close(); }, [pathname]);
  const loginHref = `/login?returnTo=${encodeURIComponent(safeShopReturn(pathname) || "/shop")}`;
  function loginClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (isSignedIn || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    const destination = safeShopReturn(window.location.pathname + window.location.search + window.location.hash) || "/shop";
    window.location.assign(`/login?returnTo=${encodeURIComponent(destination)}`);
  }
  const utility = "inline-flex min-h-11 items-center gap-2 text-[11px] uppercase tracking-[.1em] text-charcoal";
  return (
    <>
      <style>{`
        .shop-main,.shop-main--hero{padding-top:6rem}
        .shop-nav-menu{position:fixed;inset:0 auto 0 0;margin:0;width:min(390px,100%);height:100dvh;max-height:100dvh;max-width:100%;border:0;padding:24px;background:#faf9f6;color:#2a2a2a}
        .shop-nav-menu::backdrop{background:rgba(30,23,18,.45)}
        .shop-nav-menu a{display:flex;min-height:44px;align-items:center}
        .shop-nav-summary{cursor:pointer;list-style:none;min-height:44px;display:flex;align-items:center;gap:8px}
        .shop-nav-summary::-webkit-details-marker{display:none}
        .shop-nav-summary::after{content:"+";font-size:13px}
        details[open]>.shop-nav-summary::after{content:"−"}
        .shop-nav a:focus-visible,.shop-nav button:focus-visible,.shop-nav summary:focus-visible{outline:2px solid ${accent};outline-offset:3px}
      `}</style>
      <ShopAnnouncementBar />
      <header className="shop-nav fixed left-0 right-0 top-8 z-40 border-b border-charcoal/10 bg-white/95 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-3 sm:px-6 lg:px-12">
          <div className="flex items-center gap-2">
            <button ref={menuButton} className="flex h-11 w-11 items-center justify-center lg:hidden" onClick={() => menu.current?.showModal()} aria-label="Open shop menu" aria-haspopup="dialog">
              <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true"><path d="M3 6h18M3 12h18M3 18h18" strokeWidth="1.5" /></svg>
            </button>
            <Link href="/shop" aria-label="Mully Shop home"><MullyWordmark accent={accent} tone="dark" className="text-2xl" /></Link>
          </div>
          <nav aria-label="Shop navigation" className="hidden items-center gap-6 text-[11px] uppercase tracking-[.12em] lg:flex">
            <Link href="/shop#edit" className="inline-flex min-h-11 items-center">The Edit</Link>
            {([["Apparel", apparel], ["Gear & Tech", gear]] as const).map(([label, links]) => (
              <details className="relative" key={label} onBlur={e => {
                if (!e.currentTarget.contains(e.relatedTarget as Node | null)) e.currentTarget.open = false;
              }} onKeyDown={e => { if (e.key === "Escape") { e.currentTarget.open = false; e.currentTarget.querySelector("summary")?.focus(); } }}>
                <summary className="shop-nav-summary">{label}</summary>
                <div className="absolute left-0 top-full min-w-48 border border-charcoal/10 bg-white p-3 shadow-sm">
                  {links.map(([name, href]) => <Link className="flex min-h-11 items-center px-3 hover:bg-cream" key={href} href={href} onClick={e => { const d = e.currentTarget.closest("details"); if (d) d.open = false; }}>{name}</Link>)}
                </div>
              </details>
            ))}
            <Link href="/shop#gift-tiers" className="inline-flex min-h-11 items-center">Gifts</Link>
            <Link href="/shop/collection/shop-all" className="inline-flex min-h-11 items-center">Shop all</Link>
          </nav>
          <div className="flex items-center gap-3 sm:gap-5">
            <Link href={!authLoading && isSignedIn ? "/account" : loginHref} onClick={loginClick} className={utility}>
              {!authLoading && isSignedIn ? "Account" : "Log in"}
            </Link>
            <button onClick={() => setCartOpen(true)} className={`${utility} relative min-w-11 justify-center`} aria-label={`Bag${cartCount ? `, ${cartCount} items` : ""}`}>
              <svg width="20" height="22" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M5 7h14l1 14H4L5 7Z M8 8V5a4 4 0 0 1 8 0v3" /></svg>
              <span className="hidden sm:inline">Bag</span>
              {cartCount > 0 && <span className="absolute -right-1 top-0 flex h-4 min-w-4 items-center justify-center rounded-full px-1 text-[10px] text-white" style={{ backgroundColor: accent }}>{cartCount}</span>}
            </button>
          </div>
        </div>
      </header>
      <dialog ref={menu} className="shop-nav-menu" aria-labelledby="shopMenuTitle" onClose={() => menuButton.current?.focus()}>
        <div className="flex items-center justify-between border-b border-charcoal/15 pb-4">
          <h2 id="shopMenuTitle" className="font-serif text-2xl">Shop Mully</h2>
          <button className="h-11 w-11 text-3xl" onClick={() => menu.current?.close()} aria-label="Close shop menu">×</button>
        </div>
        <nav aria-label="Mobile shop navigation" className="mt-4" onClick={e => { if ((e.target as HTMLElement).closest("a")) menu.current?.close(); }}>
          <Link href="/shop#edit" className="font-serif text-xl">The Mully Edit</Link>
          {[...apparel, ...gear, ["Gifts", "/shop#gift-tiers"], ["Shop all", "/shop/collection/shop-all"]].map(([name, href]) => <Link key={href} href={href} className="text-sm">{name}</Link>)}
          <div className="mt-4 border-t border-charcoal/15 pt-3 text-sm">
            <Link href="/blog">From the Journal</Link>
            <Link href="/lp/subscription">Explore Mully Reserve</Link>
            <Link href={isSignedIn ? "/account" : loginHref}>{isSignedIn ? "Account" : "Log in"}</Link>
          </div>
        </nav>
      </dialog>
      <ShopSlideCart accent={accent} />
    </>
  );
}
