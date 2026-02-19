"use client";

import { useState, useRef, useEffect } from "react";
import Link from "next/link";
import { ShopGrid } from "../shop/components/ShopClient";
import { products, BRANDS, COLLECTIONS } from "../shop/products";
import { useMembership } from "../context/MembershipContext";
import { SlideCart } from "../components/SlideCart";
import { posts as SAMPLE_POSTS, FORUM_TAGS, type ForumPost, type ForumComment } from "../community/posts";

/* ═══════════════════════════════════════════
   DASHBOARD — Shop · Community · Club · Benefits
   ═══════════════════════════════════════════ */

type Tab = "shop" | "community" | "club" | "benefits";

export default function DashboardPage() {
  const [activeTab, setActiveTab] = useState<Tab>("shop");
  const { isSignedIn, tier, cartCount, setCartOpen } = useMembership();
  const isPaid = tier === "access" || tier === "member" || tier === "black";

  // Cart badge pop animation
  const [badgePop, setBadgePop] = useState(false);
  const prevCartCount = useRef(cartCount);
  useEffect(() => {
    if (cartCount > prevCartCount.current) {
      setBadgePop(true);
      const t = setTimeout(() => setBadgePop(false), 400);
      return () => clearTimeout(t);
    }
    prevCartCount.current = cartCount;
  }, [cartCount]);

  return (
    <div className="min-h-screen bg-bone">
      {/* ─── TOP BAR ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
          </Link>
          <div className="flex items-center gap-5">
            {/* Cart */}
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
            {/* Account */}
            <Link
              href="/account"
              className="text-forest hover:text-forest-dark transition-colors duration-300"
              aria-label="Account"
            >
              <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      {/* ─── TAB BAR ─── */}
      <nav className="fixed top-16 left-0 right-0 z-40 bg-bone/90 backdrop-blur-md border-b border-taupe/15">
        <div className="max-w-7xl mx-auto px-6 md:px-12">
          <div className="flex items-center gap-1 overflow-x-auto scrollbar-hide">
            {(
              [
                { key: "shop", label: "Shop" },
                { key: "community", label: "Community" },
                { key: "club", label: "Club" },
                { key: "benefits", label: "Benefits" },
              ] as const
            ).map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={`px-5 py-3.5 text-sm tracking-wider uppercase font-medium transition-all duration-300 border-b-2 whitespace-nowrap cursor-pointer ${
                  activeTab === key
                    ? "border-forest text-forest"
                    : "border-transparent text-charcoal/40 hover:text-charcoal/60"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      </nav>

      {/* ─── LAUNCH BANNER ─── */}
      <div className="fixed top-[7.25rem] left-0 right-0 z-30 bg-forest text-bone">
        <div className="max-w-7xl mx-auto px-6 md:px-12 py-2.5 flex items-center justify-center gap-2">
          <svg className="w-4 h-4 text-sage shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
          </svg>
          <p className="text-xs tracking-wide text-center">
            Tell your friends &mdash; we&rsquo;re having a launch party with <strong className="text-bone">free priority shipping</strong> for all.
          </p>
        </div>
      </div>

      {/* ─── TAB CONTENT ─── */}
      <main className="pt-42 pb-24">
        <div key={activeTab} className="animate-tab-in">
          {activeTab === "shop" && (isSignedIn ? <ShopTab /> : <GatedTab type="shop" />)}
          {activeTab === "community" && <CommunityTab />}
          {activeTab === "club" && (isPaid ? <ClubTab /> : <GatedTab type="club" />)}
          {activeTab === "benefits" && (isPaid ? <BenefitsTab /> : <GatedTab type="benefits" />)}
        </div>
      </main>

      {/* ─── SLIDE CART ─── */}
      <SlideCart />

      {/* ─── FOOTER ─── */}
      <footer className="py-16 px-6 md:px-12 bg-forest">
        <div className="max-w-6xl mx-auto">
          {/* Top — Logo + Nav columns */}
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-10 mb-14">
            {/* Logo */}
            <div className="col-span-2 md:col-span-4 lg:col-span-1 mb-4 lg:mb-0">
              <span className="flex items-center gap-2 text-bone mb-3">
                <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
                <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
              </span>
              <p className="text-sm text-bone/50 leading-relaxed max-w-xs">
                Members-only access to the best golf has to offer.
              </p>
            </div>

            {/* Company */}
            <div>
              <h4 className="text-xs tracking-[0.25em] uppercase text-bone/70 font-medium mb-4">
                Company
              </h4>
              <ul className="space-y-2.5">
                <li><a href="https://outings-self.vercel.app" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Outings &amp; Groups</a></li>
                <li><a href="/blog" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Blog</a></li>
                <li><a href="/faq" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">FAQ</a></li>
              </ul>
            </div>

            {/* Partners */}
            <div>
              <h4 className="text-xs tracking-[0.25em] uppercase text-bone/70 font-medium mb-4">
                Partners
              </h4>
              <ul className="space-y-2.5">
                <li><a href="/affiliates" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Affiliates</a></li>
                <li><a href="/influencers" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Influencers</a></li>
              </ul>
            </div>

            {/* Policies */}
            <div>
              <h4 className="text-xs tracking-[0.25em] uppercase text-bone/70 font-medium mb-4">
                Policies
              </h4>
              <ul className="space-y-2.5">
                <li><a href="/policies/refund" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Refund Policy</a></li>
                <li><a href="/policies/privacy" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Privacy Policy</a></li>
                <li><a href="/policies/shipping" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Shipping Policy</a></li>
                <li><a href="/policies/terms" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Terms of Service</a></li>
              </ul>
            </div>
          </div>

          {/* Contact + Socials */}
          <div className="border-t border-bone/15 pt-8 flex flex-col md:flex-row md:items-center md:justify-between gap-6">
            <div>
              <p className="text-sm text-bone/70 mb-1">
                Info@MyMully.com
              </p>
              <p className="text-xs text-bone/40">
                555 Friendly St., Pontiac, MI 48341
              </p>
            </div>

            {/* Social icons */}
            <div className="flex items-center gap-4">
              <a href="https://instagram.com/Mullybox" target="_blank" rel="noopener noreferrer" className="text-bone/50 hover:text-bone transition-colors duration-300" aria-label="Instagram">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0zm0 5.838a6.162 6.162 0 100 12.324 6.162 6.162 0 000-12.324zM12 16a4 4 0 110-8 4 4 0 010 8zm6.406-11.845a1.44 1.44 0 100 2.881 1.44 1.44 0 000-2.881z"/></svg>
              </a>
              <a href="https://tiktok.com/@Mullybox" target="_blank" rel="noopener noreferrer" className="text-bone/50 hover:text-bone transition-colors duration-300" aria-label="TikTok">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M19.59 6.69a4.83 4.83 0 01-3.77-4.25V2h-3.45v13.67a2.89 2.89 0 01-2.88 2.5 2.89 2.89 0 01-2.89-2.89 2.89 2.89 0 012.89-2.89c.28 0 .54.04.79.1v-3.5a6.37 6.37 0 00-.79-.05A6.34 6.34 0 003.15 15.2a6.34 6.34 0 0010.86 4.48V13a8.28 8.28 0 005.58 2.16V11.7a4.83 4.83 0 01-3.77-1.24V6.69h3.77z"/></svg>
              </a>
              <a href="https://facebook.com/Mullybox" target="_blank" rel="noopener noreferrer" className="text-bone/50 hover:text-bone transition-colors duration-300" aria-label="Facebook">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z"/></svg>
              </a>
              <a href="https://x.com/MyMully" target="_blank" rel="noopener noreferrer" className="text-bone/50 hover:text-bone transition-colors duration-300" aria-label="X">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
              </a>
              <a href="https://youtube.com/@Mullybox" target="_blank" rel="noopener noreferrer" className="text-bone/50 hover:text-bone transition-colors duration-300" aria-label="YouTube">
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24"><path d="M23.498 6.186a3.016 3.016 0 00-2.122-2.136C19.505 3.545 12 3.545 12 3.545s-7.505 0-9.377.505A3.017 3.017 0 00.502 6.186C0 8.07 0 12 0 12s0 3.93.502 5.814a3.016 3.016 0 002.122 2.136c1.871.505 9.376.505 9.376.505s7.505 0 9.377-.505a3.015 3.015 0 002.122-2.136C24 15.93 24 12 24 12s0-3.93-.502-5.814zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
              </a>
            </div>
          </div>

          {/* Copyright */}
          <div className="mt-8">
            <p className="text-xs text-bone/25">
              &copy; {new Date().getFullYear()} Mully Group, Inc. All rights
              reserved.
            </p>
          </div>
        </div>
      </footer>
    </div>
  );
}

/* ═══════════════════════════════════════════
   GATED TAB — Upgrade / Sign-in prompt
   ═══════════════════════════════════════════ */

const GATED_CONTENT = {
  shop: {
    icon: (
      <svg className="w-8 h-8 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" />
      </svg>
    ),
    title: "The Reserve Pro Shop",
    description: "Curated golf products from the best brands at Reserve pricing. Sign up for free to browse the shop, or upgrade to unlock members-only pricing.",
    cta: "Sign Up Free",
    href: "/onboarding",
    features: ["30+ products from top brands", "Reserve pricing for paid members", "Free 2-day shipping during launch"],
  },
  club: {
    icon: (
      <svg className="w-8 h-8 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" />
      </svg>
    ),
    title: "Private Club Registry",
    description: "Connect with fellow members who belong to private clubs. List your club, browse the registry, and coordinate guest play through our concierge.",
    cta: "Upgrade Membership",
    href: "/onboarding",
    features: ["Verified club member network", "Guest play coordination", "Concierge-facilitated introductions"],
  },
  benefits: {
    icon: (
      <svg className="w-8 h-8 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
      </svg>
    ),
    title: "Member Benefits",
    description: "Reserve pricing, free shipping, concierge support, and invite-only events. Upgrade your membership to unlock the full experience.",
    cta: "Upgrade Membership",
    href: "/onboarding",
    features: ["Reserve pricing on all products", "Free 2-day shipping", "Concierge support & events"],
  },
};

function GatedTab({ type }: { type: "shop" | "club" | "benefits" }) {
  const content = GATED_CONTENT[type];
  return (
    <div className="px-6 md:px-12">
      <div className="max-w-2xl mx-auto pt-8">
        <div className="text-center">
          {/* Icon */}
          <div className="w-16 h-16 rounded-2xl bg-forest/8 flex items-center justify-center mx-auto mb-6">
            {content.icon}
          </div>

          <h2 className="font-serif text-2xl md:text-3xl text-obsidian mb-3">
            {content.title}
          </h2>
          <p className="text-base text-charcoal/55 leading-relaxed mb-8 max-w-lg mx-auto">
            {content.description}
          </p>

          {/* Feature list */}
          <div className="inline-flex flex-col items-start gap-2.5 mb-8">
            {content.features.map((f) => (
              <div key={f} className="flex items-center gap-3">
                <svg className="w-4 h-4 text-forest shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span className="text-sm text-charcoal/65">{f}</span>
              </div>
            ))}
          </div>

          {/* CTA */}
          <div>
            <Link
              href={content.href}
              className="inline-flex items-center justify-center h-12 px-10 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 btn-press"
            >
              {content.cta}
            </Link>
          </div>

          {type === "shop" && (
            <p className="mt-4 text-xs text-charcoal/35">
              You can also browse the <Link href="/shop" className="underline underline-offset-2 hover:text-forest transition-colors duration-300">public shop</Link> without signing in.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SHOP TAB
   ═══════════════════════════════════════════ */

function ShopTab() {
  return (
    <div className="px-6 md:px-12">
      <div className="max-w-7xl mx-auto">
        <ShopGrid
          products={products}
          brands={BRANDS}
          collections={COLLECTIONS}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   BENEFITS TAB — SkyMiles-style perks
   ═══════════════════════════════════════════ */

function BenefitsTab() {
  const { tier, tierLabel } = useMembership();
  const isFree = tier === "free";
  const isPaid = tier === "access" || tier === "member" || tier === "black";
  const isMemberPlus = tier === "member" || tier === "black";

  const tierPricing: Record<string, string> = {
    free: "Complimentary",
    access: "$99/year",
    member: "$249/quarter",
    black: "By Invitation",
  };

  return (
    <div className="px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        {/* Status card */}
        <div className={`rounded-2xl p-8 md:p-10 mb-10 relative overflow-hidden ${isFree ? "bg-cream border border-taupe/20" : "bg-forest"}`}>
          <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{
            backgroundImage: `radial-gradient(circle at 1px 1px, ${isFree ? "#C8BFAF" : "#F5F1E8"} 0.5px, transparent 0)`,
            backgroundSize: "24px 24px",
          }} />
          <div className="relative">
            <p className={`text-xs tracking-[0.3em] uppercase font-medium mb-2 ${isFree ? "text-sage" : "text-sage"}`}>Your Tier</p>
            <h2 className={`font-serif text-3xl mb-2 ${isFree ? "text-obsidian" : "text-bone"}`}>{tierLabel}</h2>
            <p className={`text-sm ${isFree ? "text-charcoal/50" : "text-bone/50"}`}>
              Member since February 2026 &middot; {tierPricing[tier]}
            </p>
          </div>
          {isFree && (
            <div className="relative mt-5">
              <a
                href="/onboarding"
                className="inline-flex h-10 px-6 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 items-center"
              >
                Upgrade Membership
              </a>
            </div>
          )}
        </div>

        {/* Benefit categories */}
        <div className="mb-8">
          <h3 className="font-serif text-2xl text-obsidian mb-6">Your Benefits</h3>
        </div>

        <div className="grid md:grid-cols-2 gap-5">
          <BenefitTile
            icon={<PricingBenefitIcon />}
            title="Reserve Pricing"
            description={isPaid ? "Members-only pricing on all products. Save an average of $250+ per year across gear, apparel, and accessories." : "Browse Reserve pricing to see what members save. Upgrade to unlock members-only pricing."}
            status={isPaid ? "Active" : "Locked"}
          />
          <BenefitTile
            icon={<ShippingBenefitIcon />}
            title="Free 2-Day Shipping"
            description={isPaid ? "Complimentary 2-day shipping on all Pro Shop orders. No minimums." : "Free priority shipping during our launch party! Normally a paid member benefit."}
            status={isPaid ? "Active" : "Launch Promo"}
          />
          <BenefitTile
            icon={<DropBenefitIcon />}
            title="Priority Drop Access"
            description={isMemberPlus ? "48-hour early access to limited releases before they go live to Access members." : "Upgrade to Reserve Member for 48-hour early access to limited releases."}
            status={isMemberPlus ? "Active" : isPaid ? "Upgrade" : "Locked"}
          />
          <BenefitTile
            icon={<ConciergeBenefitIcon />}
            title="Concierge Support"
            description={isMemberPlus ? "Dedicated concierge for booking, styling advice, and product recommendations." : "Dedicated concierge support. Available with Reserve Member tier."}
            status={isMemberPlus ? "Active" : "Locked"}
          />
          <BenefitTile
            icon={<EventBenefitIcon />}
            title="Invite-Only Events"
            description={isMemberPlus ? "Access to member-only outings, demo days, and partner experiences." : "Exclusive events for Reserve Member and above."}
            status={isMemberPlus ? "Active" : "Locked"}
          />
          <BenefitTile
            icon={<HandicapBenefitIcon />}
            title="Official USGA Handicap"
            description="Track your handicap officially through Mully Reserve. Post scores from any course."
            status="Coming Soon"
          />
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   CLUB TAB — Registry + Guest Play Browser
   ═══════════════════════════════════════════ */

const US_STATES = [
  "Alabama", "Arizona", "California", "Colorado", "Connecticut", "Florida",
  "Georgia", "Hawaii", "Illinois", "Indiana", "Maryland", "Massachusetts",
  "Michigan", "Minnesota", "Nevada", "New Jersey", "New York",
  "North Carolina", "Ohio", "Oregon", "Pennsylvania", "South Carolina",
  "Tennessee", "Texas", "Virginia", "Washington",
];

const SAMPLE_CLUBS: ClubEntry[] = [
  { name: "Oakland Hills Country Club", city: "Bloomfield Hills", state: "Michigan", holes: 36, guestPolicy: "Member must accompany", addedBy: "J. Mitchell" },
  { name: "Barton Hills Country Club", city: "Ann Arbor", state: "Michigan", holes: 18, guestPolicy: "Member introduction required", addedBy: "D. Parker" },
  { name: "Detroit Golf Club", city: "Detroit", state: "Michigan", holes: 36, guestPolicy: "Guest pass available", addedBy: "R. Chen" },
  { name: "Country Club of Detroit", city: "Grosse Pointe Farms", state: "Michigan", holes: 18, guestPolicy: "Member must accompany", addedBy: "S. Williams" },
  { name: "Orchard Lake Country Club", city: "Orchard Lake", state: "Michigan", holes: 18, guestPolicy: "Limited guest days", addedBy: "T. Anderson" },
  { name: "Augusta National Golf Club", city: "Augusta", state: "Georgia", holes: 18, guestPolicy: "Member invitation only", addedBy: "M. Roberts" },
  { name: "Winged Foot Golf Club", city: "Mamaroneck", state: "New York", holes: 36, guestPolicy: "Member must accompany", addedBy: "K. Lewis" },
  { name: "Pebble Beach Golf Links", city: "Pebble Beach", state: "California", holes: 18, guestPolicy: "Public / resort guest", addedBy: "A. Kim" },
  { name: "Pinehurst Resort", city: "Pinehurst", state: "North Carolina", holes: 18, guestPolicy: "Resort guest access", addedBy: "B. Hall" },
  { name: "TPC Sawgrass", city: "Ponte Vedra Beach", state: "Florida", holes: 36, guestPolicy: "Resort guest access", addedBy: "C. Davis" },
];

interface ClubEntry {
  name: string;
  city: string;
  state: string;
  holes: number;
  guestPolicy: string;
  addedBy: string;
}

function ClubTab() {
  const { clubStatus, setClubStatus, interestedClubs, toggleClubInterest } = useMembership();
  const [selectedState, setSelectedState] = useState("Michigan");
  const [showForm, setShowForm] = useState(false);
  const [formData, setFormData] = useState({
    clubName: "",
    city: "",
    state: "",
    holes: "18",
    guestPolicy: "",
  });

  const filteredClubs = SAMPLE_CLUBS.filter((c) => c.state === selectedState);

  const handleSubmitApplication = () => {
    setClubStatus("pending");
    setShowForm(false);
  };

  // ── Not yet applied ──
  if (clubStatus === "none") {
    return (
      <div className="px-6 md:px-12">
        <div className="max-w-5xl mx-auto">
          {/* Intro */}
          <div className="mb-10">
            <h2 className="font-serif text-2xl md:text-3xl text-obsidian mb-3">Private Club Registry</h2>
            <p className="text-base text-charcoal/55 leading-relaxed max-w-2xl">
              The Club Registry connects Reserve members who belong to private clubs. List your club to unlock the full registry and connect with fellow members for guest play.
            </p>
          </div>

          {/* Gated explanation */}
          <div className="bg-forest rounded-2xl p-8 md:p-10 mb-10 relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.04] pointer-events-none" style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, #F5F1E8 0.5px, transparent 0)`,
              backgroundSize: "24px 24px",
            }} />
            <div className="relative">
              <div className="flex items-center gap-3 mb-4">
                <div className="w-10 h-10 rounded-xl bg-bone/10 flex items-center justify-center">
                  <svg className="w-5 h-5 text-sage" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                  </svg>
                </div>
                <h3 className="font-serif text-xl text-bone">How It Works</h3>
              </div>
              <div className="grid md:grid-cols-3 gap-6">
                <div>
                  <span className="text-xs tracking-[0.2em] uppercase text-sage/60 font-medium block mb-2">Step 1</span>
                  <p className="text-sm text-bone/60 leading-relaxed">List your private club membership below. Include your club name, location, and guest policy.</p>
                </div>
                <div>
                  <span className="text-xs tracking-[0.2em] uppercase text-sage/60 font-medium block mb-2">Step 2</span>
                  <p className="text-sm text-bone/60 leading-relaxed">Our team reviews your application to verify your membership. This typically takes 1&ndash;2 business days.</p>
                </div>
                <div>
                  <span className="text-xs tracking-[0.2em] uppercase text-sage/60 font-medium block mb-2">Step 3</span>
                  <p className="text-sm text-bone/60 leading-relaxed">Once approved, browse the full registry and indicate interest. Our concierge will facilitate introductions.</p>
                </div>
              </div>
            </div>
          </div>

          {/* Application form */}
          <div className="bg-cream rounded-2xl border border-taupe/15 p-6 md:p-8">
            {!showForm ? (
              <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                <div>
                  <h3 className="font-serif text-lg text-obsidian mb-1">List Your Club</h3>
                  <p className="text-sm text-charcoal/50">
                    Submit your club membership for review to unlock the full registry.
                  </p>
                </div>
                <button
                  onClick={() => setShowForm(true)}
                  className="h-11 px-8 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer whitespace-nowrap btn-press"
                >
                  Apply Now
                </button>
              </div>
            ) : (
              <div>
                <h3 className="font-serif text-lg text-obsidian mb-5">Register Your Club Membership</h3>
                <div className="grid md:grid-cols-2 gap-4 mb-6">
                  <div>
                    <label className="text-xs tracking-wide uppercase text-charcoal/50 font-medium mb-1.5 block">Club Name</label>
                    <input
                      type="text"
                      value={formData.clubName}
                      onChange={(e) => setFormData((p) => ({ ...p, clubName: e.target.value }))}
                      placeholder="e.g. Oakland Hills Country Club"
                      className="w-full h-11 px-4 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                    />
                  </div>
                  <div>
                    <label className="text-xs tracking-wide uppercase text-charcoal/50 font-medium mb-1.5 block">City</label>
                    <input
                      type="text"
                      value={formData.city}
                      onChange={(e) => setFormData((p) => ({ ...p, city: e.target.value }))}
                      placeholder="e.g. Bloomfield Hills"
                      className="w-full h-11 px-4 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                    />
                  </div>
                  <div>
                    <label className="text-xs tracking-wide uppercase text-charcoal/50 font-medium mb-1.5 block">State</label>
                    <select
                      value={formData.state}
                      onChange={(e) => setFormData((p) => ({ ...p, state: e.target.value }))}
                      className="w-full h-11 px-4 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                    >
                      <option value="">Select state</option>
                      {US_STATES.map((s) => (
                        <option key={s} value={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="text-xs tracking-wide uppercase text-charcoal/50 font-medium mb-1.5 block">Holes</label>
                    <select
                      value={formData.holes}
                      onChange={(e) => setFormData((p) => ({ ...p, holes: e.target.value }))}
                      className="w-full h-11 px-4 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                    >
                      <option value="9">9 holes</option>
                      <option value="18">18 holes</option>
                      <option value="27">27 holes</option>
                      <option value="36">36 holes</option>
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="text-xs tracking-wide uppercase text-charcoal/50 font-medium mb-1.5 block">Guest Policy</label>
                    <input
                      type="text"
                      value={formData.guestPolicy}
                      onChange={(e) => setFormData((p) => ({ ...p, guestPolicy: e.target.value }))}
                      placeholder="e.g. Member must accompany guest"
                      className="w-full h-11 px-4 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                    />
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  <button
                    onClick={handleSubmitApplication}
                    className="h-11 px-8 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer btn-press"
                  >
                    Submit for Review
                  </button>
                  <button
                    onClick={() => setShowForm(false)}
                    className="h-11 px-6 rounded-xl text-sm text-charcoal/50 hover:text-charcoal/70 transition-colors duration-300 cursor-pointer"
                  >
                    Cancel
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Blurred preview of registry */}
          <div className="mt-10 relative">
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <div className="bg-bone/90 backdrop-blur-sm rounded-xl px-6 py-4 text-center border border-taupe/20 shadow-sm">
                <svg className="w-6 h-6 text-forest mx-auto mb-2" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                <p className="text-sm font-medium text-obsidian">List your club to unlock the registry</p>
              </div>
            </div>
            <div className="filter blur-sm opacity-50 pointer-events-none">
              <h3 className="font-serif text-xl text-obsidian mb-5">Browse Clubs by State</h3>
              <div className="space-y-3">
                {SAMPLE_CLUBS.slice(0, 3).map((club) => (
                  <div key={club.name} className="bg-cream rounded-xl border border-taupe/15 p-5">
                    <h4 className="text-sm font-medium text-obsidian">{club.name}</h4>
                    <p className="text-xs text-charcoal/45 mt-0.5">{club.city}, {club.state}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Application pending review ──
  if (clubStatus === "pending") {
    return (
      <div className="px-6 md:px-12">
        <div className="max-w-5xl mx-auto">
          <div className="mb-10">
            <h2 className="font-serif text-2xl md:text-3xl text-obsidian mb-3">Private Club Registry</h2>
          </div>

          {/* Pending status card */}
          <div className="bg-cream rounded-2xl border border-taupe/15 p-8 md:p-10 text-center mb-10">
            <div className="w-14 h-14 rounded-2xl bg-sage/10 flex items-center justify-center mx-auto mb-5">
              <svg className="w-7 h-7 text-sage" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            </div>
            <h3 className="font-serif text-xl text-obsidian mb-2">Application Under Review</h3>
            <p className="text-sm text-charcoal/55 leading-relaxed max-w-md mx-auto mb-6">
              Your club listing has been submitted and is being reviewed by our team. This typically takes 1&ndash;2 business days. We&rsquo;ll notify you once you&rsquo;re approved.
            </p>
            <div className="inline-flex items-center gap-2 text-xs tracking-wider uppercase text-sage bg-sage/10 px-4 py-2 rounded-lg font-medium">
              <span className="w-2 h-2 rounded-full bg-sage animate-pulse" />
              Pending Review
            </div>

            {/* Demo: skip to approved */}
            <div className="mt-8 pt-6 border-t border-taupe/15">
              <p className="text-xs text-charcoal/30 mb-3">Demo: skip review process</p>
              <button
                onClick={() => setClubStatus("approved")}
                className="h-9 px-5 rounded-lg text-xs font-medium tracking-wider uppercase border border-taupe/25 text-charcoal/50 hover:border-forest/30 hover:text-forest transition-all duration-300 cursor-pointer"
              >
                Simulate Approval
              </button>
            </div>
          </div>

          {/* Still blurred */}
          <div className="relative">
            <div className="absolute inset-0 z-10 flex items-center justify-center">
              <div className="bg-bone/90 backdrop-blur-sm rounded-xl px-6 py-4 text-center border border-taupe/20 shadow-sm">
                <p className="text-sm font-medium text-obsidian">Registry unlocks after approval</p>
              </div>
            </div>
            <div className="filter blur-sm opacity-50 pointer-events-none">
              <h3 className="font-serif text-xl text-obsidian mb-5">Browse Clubs by State</h3>
              <div className="space-y-3">
                {SAMPLE_CLUBS.slice(0, 3).map((club) => (
                  <div key={club.name} className="bg-cream rounded-xl border border-taupe/15 p-5">
                    <h4 className="text-sm font-medium text-obsidian">{club.name}</h4>
                    <p className="text-xs text-charcoal/45 mt-0.5">{club.city}, {club.state}</p>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Approved — full registry access ──
  return (
    <div className="px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        {/* Intro */}
        <div className="mb-10">
          <h2 className="font-serif text-2xl md:text-3xl text-obsidian mb-3">Private Club Registry</h2>
          <p className="text-base text-charcoal/55 leading-relaxed max-w-2xl">
            You&rsquo;re approved! Browse clubs by state and indicate interest. Our concierge team will reach out to help coordinate guest play.
          </p>
        </div>

        {/* Approved status */}
        <div className="bg-forest/5 border border-forest/15 rounded-xl px-5 py-3 mb-8 flex items-center gap-3">
          <svg className="w-5 h-5 text-forest shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-forest">Your club membership has been verified. You have full registry access.</p>
        </div>

        {/* State browser */}
        <div>
          <h3 className="font-serif text-xl text-obsidian mb-5">Browse Clubs by State</h3>

          {/* State pills */}
          <div className="flex flex-wrap gap-2 mb-8">
            {US_STATES.map((state) => {
              const count = SAMPLE_CLUBS.filter((c) => c.state === state).length;
              return (
                <button
                  key={state}
                  onClick={() => setSelectedState(state)}
                  className={`px-3.5 py-2 rounded-lg text-xs tracking-wide transition-all duration-300 cursor-pointer border ${
                    selectedState === state
                      ? "bg-forest text-bone border-forest"
                      : "bg-cream border-taupe/20 text-charcoal/50 hover:border-forest/30"
                  }`}
                >
                  {state}{count > 0 && <span className="ml-1 opacity-60">({count})</span>}
                </button>
              );
            })}
          </div>

          {/* Club list */}
          {filteredClubs.length > 0 ? (
            <div className="space-y-3">
              {filteredClubs.map((club) => {
                const isInterested = interestedClubs.includes(club.name);
                return (
                  <div
                    key={club.name}
                    className="bg-cream rounded-xl border border-taupe/15 p-5 hover:border-taupe/25 tile-hover"
                  >
                    <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
                      <div>
                        <h4 className="text-sm font-medium text-obsidian">{club.name}</h4>
                        <p className="text-xs text-charcoal/45 mt-0.5">
                          {club.city}, {club.state} &middot; {club.holes} holes
                        </p>
                      </div>
                      <div className="flex items-center gap-3">
                        <span className="text-xs text-sage bg-sage/10 px-3 py-1.5 rounded-lg">
                          {club.guestPolicy}
                        </span>
                        <span className="text-xs text-charcoal/30">
                          Listed by {club.addedBy}
                        </span>
                      </div>
                    </div>

                    {/* Interest / Concierge */}
                    <div className="mt-4 pt-3 border-t border-taupe/10 flex items-center justify-between">
                      {isInterested ? (
                        <div className="flex items-center gap-2">
                          <svg className="w-4 h-4 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12.75L11.25 15 15 9.75M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                          </svg>
                          <span className="text-xs text-forest font-medium">Interest noted &mdash; our concierge will reach out</span>
                        </div>
                      ) : (
                        <button
                          onClick={() => toggleClubInterest(club.name)}
                          className="flex items-center gap-2 text-xs text-forest font-medium hover:text-forest-dark transition-colors duration-300 cursor-pointer"
                        >
                          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M21 8.25c0-2.485-2.099-4.5-4.688-4.5-1.935 0-3.597 1.126-4.312 2.733-.715-1.607-2.377-2.733-4.313-2.733C5.1 3.75 3 5.765 3 8.25c0 7.22 9 12 9 12s9-4.78 9-12z" />
                          </svg>
                          I&rsquo;m Interested
                        </button>
                      )}
                      {isInterested && (
                        <button
                          onClick={() => toggleClubInterest(club.name)}
                          className="text-xs text-charcoal/30 hover:text-charcoal/50 transition-colors duration-300 cursor-pointer"
                        >
                          Remove
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-16 bg-cream rounded-2xl border border-taupe/15">
              <p className="text-sm text-charcoal/40 mb-2">No clubs listed in {selectedState} yet.</p>
              <p className="text-xs text-charcoal/30">Be the first to register your club.</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   COMMUNITY TAB — Forum
   (Post data imported from ../community/posts)
   ═══════════════════════════════════════════ */

function CommunityTab() {
  const { isSignedIn } = useMembership();
  const [activeTag, setActiveTag] = useState("All");
  const [showCompose, setShowCompose] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);
  const [composeImages, setComposeImages] = useState<string[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newImages: string[] = [];
    Array.from(files).forEach((file) => {
      if (file.type.startsWith("image/")) {
        newImages.push(URL.createObjectURL(file));
      }
    });
    setComposeImages((prev) => [...prev, ...newImages].slice(0, 4));
    // Reset input so the same file can be re-selected
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeComposeImage = (index: number) => {
    setComposeImages((prev) => {
      const removed = prev[index];
      URL.revokeObjectURL(removed);
      return prev.filter((_, i) => i !== index);
    });
  };

  const filtered = activeTag === "All"
    ? SAMPLE_POSTS
    : SAMPLE_POSTS.filter((p) => p.tag === activeTag);

  return (
    <div className="px-6 md:px-12">
      <div className="max-w-3xl mx-auto">
        {/* Heading + compose */}
        <div className="flex items-start justify-between mb-8">
          <div>
            <h2 className="font-serif text-2xl md:text-3xl text-obsidian mb-2">Community</h2>
            <p className="text-sm text-charcoal/50">
              Connect with fellow Reserve members. Share gear reviews, organize guest play, and more.
            </p>
          </div>
          <button
            onClick={() => isSignedIn ? setShowCompose(!showCompose) : setShowSignUp(true)}
            className="h-10 px-5 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer whitespace-nowrap shrink-0 ml-4 btn-press"
          >
            + Post
          </button>
        </div>

        {/* Compose */}
        {showCompose && (
          <div className="bg-cream rounded-2xl border border-taupe/15 p-6 mb-6">
            <input
              type="text"
              placeholder="Post title"
              className="w-full h-11 px-4 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300 mb-3"
            />
            <textarea
              placeholder="Share something with the community..."
              rows={4}
              className="w-full px-4 py-3 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300 resize-none mb-3"
            />

            {/* Image previews */}
            {composeImages.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                {composeImages.map((src, i) => (
                  <div key={i} className="relative aspect-[3/2] rounded-lg overflow-hidden bg-bone border border-taupe/20 group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={src} alt={`Upload ${i + 1}`} className="w-full h-full object-cover" />
                    <button
                      onClick={() => removeComposeImage(i)}
                      className="absolute top-1.5 right-1.5 w-6 h-6 rounded-full bg-obsidian/70 text-bone flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer"
                      aria-label="Remove image"
                    >
                      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <select className="h-9 px-3 rounded-lg bg-bone border border-taupe/30 text-xs text-charcoal/60 focus:border-forest/40 transition-all duration-300">
                  <option>General</option>
                  <option>Gear Talk</option>
                  <option>Guest Play</option>
                  <option>Events</option>
                </select>

                {/* Photo upload */}
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={handleImageUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={composeImages.length >= 4}
                  className={`flex items-center gap-1.5 h-9 px-3 rounded-lg border text-xs transition-all duration-300 cursor-pointer ${
                    composeImages.length >= 4
                      ? "border-taupe/20 text-charcoal/25 cursor-not-allowed"
                      : "border-taupe/30 text-charcoal/50 hover:border-forest/30 hover:text-forest"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 15.75l5.159-5.159a2.25 2.25 0 013.182 0l5.159 5.159m-1.5-1.5l1.409-1.409a2.25 2.25 0 013.182 0l2.909 2.909M3.75 21h16.5a1.5 1.5 0 001.5-1.5V5.25a1.5 1.5 0 00-1.5-1.5H3.75a1.5 1.5 0 00-1.5 1.5v14.25a1.5 1.5 0 001.5 1.5zm14.47-11.47a.75.75 0 11-1.06-1.06.75.75 0 011.06 1.06z" />
                  </svg>
                  <span>Photo{composeImages.length > 0 ? ` (${composeImages.length}/4)` : ""}</span>
                </button>
              </div>
              <button className="h-10 px-6 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer btn-press">
                Publish
              </button>
            </div>
          </div>
        )}

        {/* Tags filter */}
        <div className="flex items-center gap-2 mb-6 overflow-x-auto pb-1">
          {FORUM_TAGS.map((tag) => (
            <button
              key={tag}
              onClick={() => setActiveTag(tag)}
              className={`px-4 py-2 rounded-lg text-xs tracking-wide transition-all duration-300 cursor-pointer border whitespace-nowrap ${
                activeTag === tag
                  ? "bg-forest text-bone border-forest"
                  : "bg-cream border-taupe/20 text-charcoal/50 hover:border-forest/30"
              }`}
            >
              {tag}
            </button>
          ))}
        </div>

        {/* Posts */}
        <div className="space-y-4">
          {filtered.map((post) => (
            <PostCard key={post.id} post={post} isSignedIn={isSignedIn} />
          ))}
        </div>

        {/* Sign-up modal (CommunityTab level — for + Post button) */}
        {showSignUp && <SignUpModal onClose={() => setShowSignUp(false)} />}
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SIGN-UP PROMPT MODAL
   ═══════════════════════════════════════════ */

function SignUpModal({ onClose }: { onClose: () => void }) {
  return (
    <>
      {/* Backdrop */}
      <div className="fixed inset-0 z-[60] bg-obsidian/40 backdrop-blur-sm animate-modal-backdrop" onClick={onClose} />

      {/* Modal */}
      <div className="fixed inset-0 z-[70] flex items-center justify-center p-6">
        <div className="bg-bone rounded-2xl border border-taupe/20 shadow-xl w-full max-w-sm overflow-hidden animate-modal-content">
          {/* Header */}
          <div className="bg-forest p-6 pb-5 relative overflow-hidden">
            <div className="absolute inset-0 opacity-[0.05] pointer-events-none" style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, #F5F1E8 0.5px, transparent 0)`,
              backgroundSize: "20px 20px",
            }} />
            <div className="relative flex items-center gap-2 mb-3">
              <svg viewBox="0 0 1002 540" fill="currentColor" className="h-4 w-auto text-bone" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
              <span className="font-serif text-lg font-bold tracking-wide text-bone">mully.</span>
            </div>
            <h3 className="font-serif text-xl text-bone leading-snug">
              Join the conversation.
            </h3>
            <p className="text-sm text-bone/55 mt-1.5 leading-relaxed">
              Sign up for free to like, comment, and post in the Reserve community.
            </p>
          </div>

          {/* Body */}
          <div className="p-6">
            <div className="space-y-2.5 mb-6">
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 text-forest shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span className="text-sm text-charcoal/65">Like and comment on posts</span>
              </div>
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 text-forest shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span className="text-sm text-charcoal/65">Share gear reviews and tips</span>
              </div>
              <div className="flex items-center gap-3">
                <svg className="w-4 h-4 text-forest shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                </svg>
                <span className="text-sm text-charcoal/65">Connect with fellow golfers</span>
              </div>
            </div>

            <Link
              href="/onboarding"
              className="flex items-center justify-center h-11 w-full rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 btn-press"
            >
              Sign Up Free
            </Link>

            <button
              onClick={onClose}
              className="w-full mt-3 text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer py-2"
            >
              Maybe later
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/* ═══════════════════════════════════════════
   POST CARD — Interactive likes & comments
   ═══════════════════════════════════════════ */

function PostCard({ post, isSignedIn }: { post: ForumPost; isSignedIn: boolean }) {
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likes);
  const [showComments, setShowComments] = useState(false);
  const [commentLikes, setCommentLikes] = useState<Record<string, boolean>>({});
  const [commentLikeCounts, setCommentLikeCounts] = useState<Record<string, number>>(
    () => Object.fromEntries(post.comments.map((c) => [c.id, c.likes]))
  );
  const [replyText, setReplyText] = useState("");
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);

  const requireAuth = (action: () => void) => {
    if (!isSignedIn) {
      setShowSignUp(true);
      return;
    }
    action();
  };

  const postUrl = typeof window !== "undefined"
    ? `${window.location.origin}/community/post/${post.id}`
    : `/community/post/${post.id}`;
  const shareText = `${post.title} — by ${post.author} on Mully Reserve`;

  const handleCopyLink = async () => {
    try {
      await navigator.clipboard.writeText(postUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      const textarea = document.createElement("textarea");
      textarea.value = postUrl;
      document.body.appendChild(textarea);
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const handleShare = async () => {
    // On mobile / browsers that support Web Share API, use it first
    if (typeof navigator !== "undefined" && navigator.share) {
      try {
        await navigator.share({ title: post.title, text: shareText, url: postUrl });
        return;
      } catch {
        // User cancelled or share failed — fall through to menu
      }
    }
    // Desktop fallback — show the manual share menu
    setShowShareMenu(!showShareMenu);
  };

  const handleShareSMS = () => {
    window.open(`sms:?&body=${encodeURIComponent(`${shareText}\n${postUrl}`)}`, "_self");
    setShowShareMenu(false);
  };

  const handleShareX = () => {
    window.open(`https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(postUrl)}`, "_blank", "noopener");
    setShowShareMenu(false);
  };

  const handleShareFacebook = () => {
    window.open(`https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(postUrl)}`, "_blank", "noopener");
    setShowShareMenu(false);
  };

  const toggleLike = () => {
    setLiked((prev) => !prev);
    setLikeCount((prev) => (liked ? prev - 1 : prev + 1));
  };

  const toggleCommentLike = (commentId: string) => {
    const wasLiked = commentLikes[commentId];
    setCommentLikes((prev) => ({ ...prev, [commentId]: !wasLiked }));
    setCommentLikeCounts((prev) => ({
      ...prev,
      [commentId]: wasLiked ? prev[commentId] - 1 : prev[commentId] + 1,
    }));
  };

  return (
    <article className="bg-cream rounded-xl border border-taupe/15 hover:border-taupe/30 transition-colors duration-300 overflow-hidden">
      <div className="p-6">
        <div className="flex items-start gap-4">
          {/* Avatar */}
          <div className="w-10 h-10 rounded-full bg-forest/10 flex items-center justify-center shrink-0">
            <span className="text-xs font-medium text-forest">{post.avatar}</span>
          </div>

          <div className="flex-1 min-w-0">
            {/* Meta */}
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-sm font-medium text-obsidian">{post.author}</span>
              <span className="text-xs text-charcoal/30">&middot;</span>
              <span className="text-xs text-charcoal/35">{post.timestamp}</span>
              <span className="text-xs text-sage bg-sage/10 px-2 py-0.5 rounded ml-auto">
                {post.tag}
              </span>
            </div>

            {/* Title */}
            <h3 className="text-base font-medium text-obsidian mb-2 leading-snug">
              {post.title}
            </h3>

            {/* Body */}
            <p className="text-sm text-charcoal/55 leading-relaxed mb-4">
              {post.body}
            </p>

            {/* Images */}
            {post.images && post.images.length > 0 && (
              <div className={`mb-4 grid gap-2 ${post.images.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                {post.images.map((src, i) => (
                  <div key={i} className="relative aspect-[3/2] rounded-lg overflow-hidden bg-cream border border-taupe/15">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={src}
                      alt={`${post.title} photo ${i + 1}`}
                      className="w-full h-full object-cover"
                    />
                  </div>
                ))}
              </div>
            )}

            {/* Actions */}
            <div className="flex items-center gap-5">
              {/* Like button */}
              <button
                onClick={() => requireAuth(toggleLike)}
                className={`flex items-center gap-1.5 text-xs transition-colors duration-300 cursor-pointer ${
                  liked ? "text-forest" : "text-charcoal/40 hover:text-forest"
                }`}
              >
                {liked ? (
                  <svg className="w-4 h-4" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M7.493 18.75c-.425 0-.82-.236-.975-.632A7.48 7.48 0 016 15.375c0-1.75.599-3.358 1.602-4.634.151-.192.373-.309.6-.397.473-.183.89-.514 1.212-.924a9.042 9.042 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3.18a2.055 2.055 0 01.357-1.093A2.78 2.78 0 0115.455 1c1.725 0 2.295 1.467 2.295 2.913V6.35c0 .532-.065 1.06-.218 1.551l-1.474 4.74a.75.75 0 00.213.855l.426.388a.75.75 0 01-.212 1.257l-.89.388a3.75 3.75 0 00-2.093 2.833l-.2 1.14a.75.75 0 01-.738.627H7.493z" />
                    <path d="M3.61 14.096c-.106 0-.21.016-.311.048a.75.75 0 00-.524.721v5.385a.75.75 0 00.75.75h1.225a.75.75 0 00.75-.75V14.846a.75.75 0 00-.75-.75H3.61z" />
                  </svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3.18a2.055 2.055 0 01.357-1.093A2.78 2.78 0 0115.455 1c1.725 0 2.295 1.467 2.295 2.913v2.437c0 .532-.065 1.06-.218 1.551l-1.474 4.74a3.375 3.375 0 00.851 3.421l.426.388M6.633 10.5H4.869a2.376 2.376 0 00-2.344 2.752l.88 5.749A2.376 2.376 0 005.749 21h1.102M6.633 10.5v10.5" />
                  </svg>
                )}
                <span className={liked ? "font-medium" : ""}>{likeCount}</span>
              </button>

              {/* Comment button */}
              <button
                onClick={() => requireAuth(() => setShowComments(!showComments))}
                className={`flex items-center gap-1.5 text-xs transition-colors duration-300 cursor-pointer ${
                  showComments ? "text-forest" : "text-charcoal/40 hover:text-forest"
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
                </svg>
                <span>{post.comments.length}</span>
              </button>

              {/* Share button */}
              <div className="relative ml-auto">
                <button
                  onClick={handleShare}
                  className={`flex items-center gap-1.5 text-xs transition-colors duration-300 cursor-pointer ${
                    showShareMenu ? "text-forest" : "text-charcoal/40 hover:text-forest"
                  }`}
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M7.217 10.907a2.25 2.25 0 100 2.186m0-2.186c.18.324.283.696.283 1.093s-.103.77-.283 1.093m0-2.186l9.566-5.314m-9.566 7.5l9.566 5.314m0 0a2.25 2.25 0 103.935 2.186 2.25 2.25 0 00-3.935-2.186zm0-12.814a2.25 2.25 0 103.933-2.185 2.25 2.25 0 00-3.933 2.185z" />
                  </svg>
                  <span>Share</span>
                </button>

                {/* Share menu popover */}
                {showShareMenu && (
                  <>
                    {/* Backdrop */}
                    <div className="fixed inset-0 z-40" onClick={() => setShowShareMenu(false)} />

                    <div className="absolute right-0 bottom-full mb-2 z-50 w-52 bg-bone rounded-xl border border-taupe/20 shadow-lg overflow-hidden">
                      <div className="px-3 py-2.5 border-b border-taupe/15">
                        <p className="text-[10px] tracking-[0.2em] uppercase text-charcoal/40 font-medium">Share this post</p>
                      </div>
                      <div className="py-1">
                        {/* Copy Link */}
                        <button
                          onClick={handleCopyLink}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-charcoal/70 hover:bg-cream transition-colors duration-200 cursor-pointer"
                        >
                          {copied ? (
                            <svg className="w-4 h-4 text-forest shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 12.75l6 6 9-13.5" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                            </svg>
                          )}
                          <span>{copied ? "Copied!" : "Copy Link"}</span>
                        </button>

                        {/* SMS / iMessage */}
                        <button
                          onClick={handleShareSMS}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-charcoal/70 hover:bg-cream transition-colors duration-200 cursor-pointer"
                        >
                          <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8.625 9.75a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H8.25m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0H12m4.125 0a.375.375 0 11-.75 0 .375.375 0 01.75 0zm0 0h-.375m-13.5 3.01c0 1.6 1.123 2.994 2.707 3.227 1.087.16 2.185.283 3.293.369V21l4.184-4.183a1.14 1.14 0 01.778-.332 48.294 48.294 0 005.83-.498c1.585-.233 2.708-1.626 2.708-3.228V6.741c0-1.602-1.123-2.995-2.707-3.228A48.394 48.394 0 0012 3c-2.392 0-4.744.175-7.043.513C3.373 3.746 2.25 5.14 2.25 6.741v6.018z" />
                          </svg>
                          <span>Text Message</span>
                          <span className="text-[10px] text-charcoal/30 ml-auto">Mobile</span>
                        </button>

                        {/* X / Twitter */}
                        <button
                          onClick={handleShareX}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-charcoal/70 hover:bg-cream transition-colors duration-200 cursor-pointer"
                        >
                          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                          </svg>
                          <span>X / Twitter</span>
                        </button>

                        {/* Facebook */}
                        <button
                          onClick={handleShareFacebook}
                          className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-charcoal/70 hover:bg-cream transition-colors duration-200 cursor-pointer"
                        >
                          <svg className="w-4 h-4 shrink-0" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M24 12.073c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.99 4.388 10.954 10.125 11.854v-8.385H7.078v-3.47h3.047V9.43c0-3.007 1.792-4.669 4.533-4.669 1.312 0 2.686.235 2.686.235v2.953H15.83c-1.491 0-1.956.925-1.956 1.874v2.25h3.328l-.532 3.47h-2.796v8.385C19.612 23.027 24 18.062 24 12.073z" />
                          </svg>
                          <span>Facebook</span>
                        </button>

                        {/* More — native share on supported browsers */}
                        {typeof navigator !== "undefined" && !!navigator.share && (
                          <button
                            onClick={async () => {
                              try { await navigator.share({ title: post.title, text: shareText, url: postUrl }); } catch {}
                              setShowShareMenu(false);
                            }}
                            className="w-full flex items-center gap-3 px-3 py-2.5 text-sm text-charcoal/70 hover:bg-cream transition-colors duration-200 cursor-pointer"
                          >
                            <svg className="w-4 h-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                              <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM12.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0zM18.75 12a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
                            </svg>
                            <span>More Options</span>
                          </button>
                        )}
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Comment thread */}
      {showComments && (
        <div className="border-t border-taupe/15 bg-bone/50 animate-comment-reveal">
          <div className="px-6 py-4 space-y-4">
            {post.comments.map((comment) => (
              <div key={comment.id} className="flex items-start gap-3">
                <div className="w-7 h-7 rounded-full bg-forest/8 flex items-center justify-center shrink-0 mt-0.5">
                  <span className="text-[10px] font-medium text-forest">{comment.avatar}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 mb-0.5">
                    <span className="text-xs font-medium text-obsidian">{comment.author}</span>
                    <span className="text-[10px] text-charcoal/30">{comment.timestamp}</span>
                  </div>
                  <p className="text-sm text-charcoal/60 leading-relaxed">{comment.body}</p>
                  <button
                    onClick={() => requireAuth(() => toggleCommentLike(comment.id))}
                    className={`flex items-center gap-1 mt-1.5 text-[11px] transition-colors duration-300 cursor-pointer ${
                      commentLikes[comment.id] ? "text-forest" : "text-charcoal/30 hover:text-forest"
                    }`}
                  >
                    {commentLikes[comment.id] ? (
                      <svg className="w-3 h-3" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M7.493 18.75c-.425 0-.82-.236-.975-.632A7.48 7.48 0 016 15.375c0-1.75.599-3.358 1.602-4.634.151-.192.373-.309.6-.397.473-.183.89-.514 1.212-.924a9.042 9.042 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3.18a2.055 2.055 0 01.357-1.093A2.78 2.78 0 0115.455 1c1.725 0 2.295 1.467 2.295 2.913V6.35c0 .532-.065 1.06-.218 1.551l-1.474 4.74a.75.75 0 00.213.855l.426.388a.75.75 0 01-.212 1.257l-.89.388a3.75 3.75 0 00-2.093 2.833l-.2 1.14a.75.75 0 01-.738.627H7.493z" />
                        <path d="M3.61 14.096c-.106 0-.21.016-.311.048a.75.75 0 00-.524.721v5.385a.75.75 0 00.75.75h1.225a.75.75 0 00.75-.75V14.846a.75.75 0 00-.75-.75H3.61z" />
                      </svg>
                    ) : (
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6.633 10.5c.806 0 1.533-.446 2.031-1.08a9.041 9.041 0 012.861-2.4c.723-.384 1.35-.956 1.653-1.715a4.498 4.498 0 00.322-1.672V3.18a2.055 2.055 0 01.357-1.093A2.78 2.78 0 0115.455 1c1.725 0 2.295 1.467 2.295 2.913v2.437c0 .532-.065 1.06-.218 1.551l-1.474 4.74a3.375 3.375 0 00.851 3.421l.426.388M6.633 10.5H4.869a2.376 2.376 0 00-2.344 2.752l.88 5.749A2.376 2.376 0 005.749 21h1.102M6.633 10.5v10.5" />
                      </svg>
                    )}
                    <span>{commentLikeCounts[comment.id]}</span>
                  </button>
                </div>
              </div>
            ))}
          </div>

          {/* Reply input */}
          <div className="px-6 pb-4">
            {isSignedIn ? (
              <div className="flex items-center gap-3">
                <div className="w-7 h-7 rounded-full bg-forest/10 flex items-center justify-center shrink-0">
                  <span className="text-[10px] font-medium text-forest">You</span>
                </div>
                <div className="flex-1 flex items-center gap-2">
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    placeholder="Write a reply..."
                    className="flex-1 h-9 px-3.5 rounded-lg bg-bone border border-taupe/25 text-sm text-obsidian placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                  />
                  <button
                    className={`h-9 px-4 rounded-lg text-xs font-medium tracking-wider uppercase transition-all duration-300 cursor-pointer ${
                      replyText.trim()
                        ? "bg-forest text-bone hover:bg-forest-dark"
                        : "bg-taupe/20 text-charcoal/30 cursor-not-allowed"
                    }`}
                    disabled={!replyText.trim()}
                  >
                    Reply
                  </button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setShowSignUp(true)}
                className="w-full flex items-center justify-center gap-2 h-9 rounded-lg bg-bone border border-taupe/25 text-sm text-charcoal/40 hover:text-forest hover:border-forest/30 transition-all duration-300 cursor-pointer"
              >
                <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
                </svg>
                Sign up to reply
              </button>
            )}
          </div>
        </div>
      )}
      {/* Sign-up modal */}
      {showSignUp && <SignUpModal onClose={() => setShowSignUp(false)} />}
    </article>
  );
}

/* ═══════════════════════════════════════════
   SHARED COMPONENTS
   ═══════════════════════════════════════════ */

function BenefitTile({
  icon,
  title,
  description,
  status,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
  status: string;
}) {
  const statusStyle =
    status === "Active"
      ? "bg-forest/10 text-forest"
      : status === "Launch Promo"
        ? "bg-forest/10 text-forest"
        : status === "Locked" || status === "Upgrade"
          ? "bg-taupe/20 text-charcoal/40"
          : "bg-taupe/20 text-charcoal/40";

  const isLocked = status === "Locked" || status === "Upgrade";

  return (
    <div className={`bg-cream rounded-xl border border-taupe/15 p-6 flex gap-4 ${isLocked ? "opacity-70" : "tile-hover"}`}>
      <div className={`w-10 h-10 rounded-xl flex items-center justify-center shrink-0 ${isLocked ? "bg-taupe/10" : "bg-forest/8"}`}>
        {icon}
      </div>
      <div className="flex-1">
        <div className="flex items-center gap-2 mb-1">
          <h4 className="text-sm font-medium text-obsidian">{title}</h4>
          <span className={`text-[10px] tracking-wider uppercase font-medium px-2 py-0.5 rounded-full ${statusStyle}`}>
            {status}
          </span>
        </div>
        <p className="text-xs text-charcoal/50 leading-relaxed">{description}</p>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   BENEFIT ICONS
   ═══════════════════════════════════════════ */

function PricingBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
      <path strokeLinecap="round" strokeLinejoin="round" d="M6 6h.008v.008H6V6z" />
    </svg>
  );
}

function ShippingBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 18.75a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h6m-9 0H3.375a1.125 1.125 0 01-1.125-1.125V14.25m17.25 4.5a1.5 1.5 0 01-3 0m3 0a1.5 1.5 0 00-3 0m3 0h1.125c.621 0 1.129-.504 1.09-1.124a17.902 17.902 0 00-3.213-9.193 2.056 2.056 0 00-1.58-.86H14.25M16.5 18.75h-2.25m0-11.177v-.958c0-.568-.422-1.048-.987-1.106a48.554 48.554 0 00-10.026 0 1.106 1.106 0 00-.987 1.106v7.635m12-6.677v6.677m0 4.5v-4.5m0 0h-12" />
    </svg>
  );
}

function DropBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" />
    </svg>
  );
}

function ConciergeBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
    </svg>
  );
}

function EventBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 012.25-2.25h13.5A2.25 2.25 0 0121 7.5v11.25m-18 0A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75m-18 0v-7.5A2.25 2.25 0 015.25 9h13.5A2.25 2.25 0 0121 11.25v7.5m-9-6h.008v.008H12v-.008zM12 15h.008v.008H12V15zm0 2.25h.008v.008H12v-.008zM9.75 15h.008v.008H9.75V15zm0 2.25h.008v.008H9.75v-.008zM7.5 15h.008v.008H7.5V15zm0 2.25h.008v.008H7.5v-.008zm6.75-4.5h.008v.008h-.008v-.008zm0 2.25h.008v.008h-.008V15zm0 2.25h.008v.008h-.008v-.008zm2.25-4.5h.008v.008H16.5v-.008zm0 2.25h.008v.008H16.5V15z" />
    </svg>
  );
}

function HandicapBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M3 13.125C3 12.504 3.504 12 4.125 12h2.25c.621 0 1.125.504 1.125 1.125v6.75C7.5 20.496 6.996 21 6.375 21h-2.25A1.125 1.125 0 013 19.875v-6.75zM9.75 8.625c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125v11.25c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V8.625zM16.5 4.125c0-.621.504-1.125 1.125-1.125h2.25C20.496 3 21 3.504 21 4.125v15.75c0 .621-.504 1.125-1.125 1.125h-2.25a1.125 1.125 0 01-1.125-1.125V4.125z" />
    </svg>
  );
}

