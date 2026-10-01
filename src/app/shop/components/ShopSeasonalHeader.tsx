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
  ["All gear", "/shop/collection/shop-gear"],
  ["Bags", "/shop/collection/shop-bags"],
  ["Accessories", "/shop/collection/shop-accessories"],
];
const allCategories = [
  ["Shop everything", "/shop/collection/shop-all"], ...apparel, ...gear,
  ["Gifts", "/shop#gift-tiers"],
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
  function outfitClick(e: React.MouseEvent<HTMLAnchorElement>) {
    if (pathname !== "/shop" || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    const target = document.getElementById("outfit");
    if (!target) return;
    e.preventDefault();
    window.history.replaceState(window.history.state, "", "/shop#outfit");
    requestAnimationFrame(() => {
      window.scrollTo({
        top: window.scrollY + target.getBoundingClientRect().top - 96,
        behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth",
      });
    });
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
        .shop-nav nav>a,.shop-nav-summary,.shop-nav-menu a{background-image:linear-gradient(currentColor,currentColor);background-size:0 1px;background-repeat:no-repeat;background-position:0 calc(100% - 8px);transition:background-size 180ms ease,color 180ms ease}
        .shop-nav nav>a:hover,.shop-nav-summary:hover,.shop-nav-menu a:hover,.shop-nav nav>a:focus-visible,.shop-nav-summary:focus-visible{background-size:100% 1px}
        .shop-nav .shop-build-link,.shop-nav-menu .shop-build-link{padding:0 12px;background-color:#e8ebd6;color:#333721;font-weight:600;white-space:nowrap;transition:background-color 180ms ease,background-size 180ms ease}
        .shop-nav .shop-build-link:hover,.shop-nav-menu .shop-build-link:hover{background-color:#dce2bf}
        .shop-all-menu{position:relative;display:flex;align-items:center}
        .shop-all-menu>a{display:flex;align-items:center;min-height:44px}
        .shop-all-menu>button{min-height:44px;min-width:28px;background:none;border:0;cursor:pointer}
        .shop-all-dropdown{position:absolute;top:100%;left:0;display:none;grid-template-columns:1fr 1fr;width:340px;background:#fff;border:1px solid #ddd9d0;padding:14px;box-shadow:0 12px 28px #30292312}
        .shop-all-menu.is-open .shop-all-dropdown{display:grid}
        .shop-all-dropdown a{display:flex;align-items:center;min-height:44px;padding:0 12px}
        .shop-all-dropdown a:hover{background:#f5f1e8}
        .shop-nav-menu .shop-build-link{margin:8px 0}
        @media(prefers-reduced-motion:reduce){.shop-nav *,.shop-nav-menu *{transition:none!important}}
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
          <nav aria-label="Shop navigation" className="hidden items-center gap-4 text-[11px] uppercase tracking-[.1em] lg:flex xl:gap-6">
            <ShopAllDropdown />
            <Link href="/shop/new-arrivals" className="inline-flex min-h-11 items-center">New Arrivals</Link>
            {([["Apparel", apparel], ["Gear", gear]] as const).map(([label, links]) => (
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
            <Link href="/shop#outfit" onClick={outfitClick} className="shop-build-link inline-flex min-h-11 items-center">Build an outfit</Link>
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
      <dialog ref={menu} className="shop-nav-menu" aria-labelledby="shopMenuTitle" onClose={() => menuButton.current?.focus({ preventScroll: true })}>
        <div className="flex items-center justify-between border-b border-charcoal/15 pb-4">
          <h2 id="shopMenuTitle" className="font-serif text-2xl">Shop Mully</h2>
          <button className="h-11 w-11 text-3xl" onClick={() => menu.current?.close()} aria-label="Close shop menu">×</button>
        </div>
        <nav aria-label="Mobile shop navigation" className="mt-4" onClick={e => { if ((e.target as HTMLElement).closest("a")) menu.current?.close(); }}>
          <Link href="/shop/collection/shop-all" className="font-serif text-xl">Shop All</Link>
          <Link href="/shop/new-arrivals" className="text-sm">New Arrivals</Link>
          <details><summary className="shop-nav-summary">Apparel</summary>{apparel.map(([name,href])=><Link key={href} href={href} className="pl-4 text-sm">{name}</Link>)}</details>
          <details><summary className="shop-nav-summary">Gear</summary>{gear.map(([name,href])=><Link key={href} href={href} className="pl-4 text-sm">{name}</Link>)}</details>
          <Link href="/shop#gift-tiers" className="text-sm">Gifts</Link>
          <Link href="/shop#outfit" onClick={outfitClick} className="shop-build-link text-sm">Build an Outfit</Link>
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

function ShopAllDropdown() {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  function setOpen(open: boolean) {
    root.current?.classList.toggle("is-open", open);
    trigger.current?.setAttribute("aria-expanded", String(open));
  }
  return <div ref={root} className="shop-all-menu"
    onMouseEnter={() => { if (matchMedia("(hover:hover)").matches) setOpen(true); }}
    onMouseLeave={() => { if (!root.current?.contains(document.activeElement)) setOpen(false); }}
    onFocus={e => { if ((e.target as HTMLElement) !== trigger.current) setOpen(true); }}
    onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setOpen(false); }}
    onKeyDown={e => { if (e.key === "Escape") { e.stopPropagation(); trigger.current?.focus(); setOpen(false); } }}>
    <Link href="/shop/collection/shop-all">Shop All</Link>
    <button ref={trigger} type="button" aria-label="Show all shop categories" aria-controls="shopAllCategories" aria-expanded="false"
      onClick={() => setOpen(!root.current?.classList.contains("is-open"))}>⌄</button>
    <div id="shopAllCategories" className="shop-all-dropdown">
      {allCategories.map(([label,href]) => <Link key={href} href={href} onClick={() => setOpen(false)}>{label}</Link>)}
    </div>
  </div>;
}
