"use client";

import { useState, useRef, useEffect, useCallback, Suspense } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ShopGrid } from "../shop/components/ShopClient";
import {
  getCollectionProducts,
  mergeCollectionProductsBySlug,
  PRIVATE_RELEASES_COLLECTION_HANDLE,
  PRO_SHOP_COLLECTION_HANDLE,
  type ShopifyProduct,
} from "@/lib/shopify";
import { useMembership } from "../context/MembershipContext";
import { SlideCart } from "../components/SlideCart";
import { UpgradeModal } from "../components/UpgradeModal";
import { FORUM_TAGS, type ForumPost, type ForumComment } from "../community/posts";
import type { User as FirebaseUser } from "firebase/auth";
import { trackEvent } from "@/lib/tracking";
import { formatExclusiveDropLabel, getExclusiveDropDate } from "@/lib/dropConfig";
import {
  BENEFIT_CATALOG,
  type ActionableBenefitKey,
  type BenefitCatalogAction,
  type BenefitCatalogCategory,
  type BenefitKey,
} from "@/lib/benefits";

/* ═══════════════════════════════════════════
   DASHBOARD — Shop · Community · Club · Benefits
   ═══════════════════════════════════════════ */

type Tab = "shop" | "drops" | "community" | "club" | "benefits";

const VALID_TABS: Tab[] = ["shop", "drops", "community", "club", "benefits"];
const HOME_ICON = "M2.25 12l8.954-8.955c.44-.439 1.152-.439 1.591 0L21.75 12M4.5 9.75v10.125c0 .621.504 1.125 1.125 1.125H9.75v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21h4.125c.621 0 1.125-.504 1.125-1.125V9.75M8.25 21h8.25";
const ACCOUNT_ICON = "M15.75 6a3.75 3.75 0 11-7.5 0 3.75 3.75 0 017.5 0zM4.501 20.118a7.5 7.5 0 0114.998 0A17.933 17.933 0 0112 21.75c-2.676 0-5.216-.584-7.499-1.632z";
const DASHBOARD_TAB_PILLS: ReadonlyArray<{ key: Tab; label: string; icon: string }> = [
  { key: "shop", label: "Shop", icon: "M15.75 10.5V6a3.75 3.75 0 10-7.5 0v4.5m11.356-1.993l1.263 12c.07.665-.45 1.243-1.119 1.243H4.25a1.125 1.125 0 01-1.12-1.243l1.264-12A1.125 1.125 0 015.513 7.5h12.974c.576 0 1.059.435 1.119 1.007zM8.625 10.5a.375.375 0 11-.75 0 .375.375 0 01.75 0zm7.5 0a.375.375 0 11-.75 0 .375.375 0 01.75 0z" },
  { key: "drops", label: "Drops", icon: "M3.75 13.5l10.5-11.25L12 10.5h8.25L9.75 21.75 12 13.5H3.75z" },
  { key: "community", label: "Community", icon: "M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" },
  { key: "club", label: "Club", icon: "M12 21v-8.25M15.75 21v-8.25M8.25 21v-8.25M3 9l9-6 9 6m-1.5 12V10.332A48.36 48.36 0 0012 9.75c-2.551 0-5.056.2-7.5.582V21M3 21h18M12 6.75h.008v.008H12V6.75z" },
  { key: "benefits", label: "Benefits", icon: "M11.48 3.499a.562.562 0 011.04 0l2.125 5.111a.563.563 0 00.475.345l5.518.442c.499.04.701.663.321.988l-4.204 3.602a.563.563 0 00-.182.557l1.285 5.385a.562.562 0 01-.84.61l-4.725-2.885a.563.563 0 00-.586 0L6.982 20.54a.562.562 0 01-.84-.61l1.285-5.386a.562.562 0 00-.182-.557l-4.204-3.602a.563.563 0 01.321-.988l5.518-.442a.563.563 0 00.475-.345L11.48 3.5z" },
];

function DashboardContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const parsedTab = VALID_TABS.includes(tabParam as Tab)
    ? (tabParam as Tab)
    : "shop";
  const [activeTab, setActiveTab] = useState<Tab>(parsedTab);
  const {
    isSignedIn,
    authLoading,
    tier,
    setTier,
    cartCount,
    setCartOpen,
    refreshStoreCredit,
    refreshSubscriptionStatus,
  } = useMembership();
  const isPaid = tier === "access" || tier === "member" || tier === "black";
  const [upgradeOpen, setUpgradeOpen] = useState(false);

  useEffect(() => {
    if (parsedTab !== activeTab) {
      setActiveTab(parsedTab);
    }
  }, [activeTab, parsedTab]);

  const handleTabChange = useCallback(
    (nextTab: Tab) => {
      setActiveTab(nextTab);
      router.replace(`/dashboard?tab=${nextTab}`, { scroll: false });
    },
    [router]
  );

  // Auth guard
  useEffect(() => {
    if (!authLoading && !isSignedIn) {
      router.replace("/login");
    }
  }, [authLoading, isSignedIn, router]);

  // Load store credit and subscription status on mount
  useEffect(() => {
    if (isSignedIn) {
      void refreshStoreCredit();
      void refreshSubscriptionStatus();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isSignedIn]);

  // Cart badge pop animation
  const [badgePop, setBadgePop] = useState(false);
  const prevCartCount = useRef(cartCount);
  useEffect(() => {
    const previousCount = prevCartCount.current;
    prevCartCount.current = cartCount;
    if (cartCount > previousCount) {
      setBadgePop(true);
      const t = setTimeout(() => setBadgePop(false), 400);
      return () => clearTimeout(t);
    }
  }, [cartCount]);

  if (authLoading) {
    return (
      <div className="min-h-screen bg-bone flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-forest/30 border-t-forest rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bone">
      {/* ─── TOP BAR ─── */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16">
          <Link href="/home" className="flex items-center gap-2 text-forest">
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
          <div className="flex items-center gap-3 overflow-x-auto py-3 scrollbar-hide">
            <Link
              href="/home"
              className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-taupe/25 text-charcoal/70 hover:text-forest hover:border-forest/30 hover:bg-forest/5 transition-all duration-300 btn-press whitespace-nowrap"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={HOME_ICON} />
              </svg>
              <span className="text-xs font-medium tracking-wide">Home</span>
            </Link>
            {DASHBOARD_TAB_PILLS.map(({ key, label, icon }) => (
              <button
                key={key}
                onClick={() => handleTabChange(key)}
                className={`flex items-center gap-2 px-5 py-2.5 rounded-full border transition-all duration-300 btn-press whitespace-nowrap cursor-pointer ${
                  activeTab === key
                    ? "border-forest/40 bg-forest text-bone shadow-sm"
                    : "border-taupe/25 text-charcoal/70 hover:text-forest hover:border-forest/30 hover:bg-forest/5"
                }`}
              >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d={icon} />
                </svg>
                <span className="text-xs font-medium tracking-wide">{label}</span>
              </button>
            ))}
            <Link
              href="/account"
              className="flex items-center gap-2 px-5 py-2.5 rounded-full border border-taupe/25 text-charcoal/70 hover:text-forest hover:border-forest/30 hover:bg-forest/5 transition-all duration-300 btn-press whitespace-nowrap"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d={ACCOUNT_ICON} />
              </svg>
              <span className="text-xs font-medium tracking-wide">Account</span>
            </Link>
          </div>
        </div>
      </nav>

      {/* ─── LAUNCH BANNER ─── */}
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

      {/* ─── TAB CONTENT ─── */}
      <main className="pt-48 pb-24">
        <div key={activeTab} className="animate-tab-in">
          {activeTab === "shop" && (isSignedIn ? <ShopTab /> : <GatedTab type="shop" onUpgrade={() => setUpgradeOpen(true)} />)}
          {activeTab === "drops" && (isPaid ? <DropsTab /> : <GatedTab type="drops" onUpgrade={() => setUpgradeOpen(true)} />)}
          {activeTab === "community" && <CommunityTab />}
          {activeTab === "club" && (isPaid ? <ClubTab /> : <GatedTab type="club" onUpgrade={() => setUpgradeOpen(true)} />)}
          {activeTab === "benefits" && (isPaid ? <BenefitsTab onUpgrade={() => setUpgradeOpen(true)} /> : <GatedTab type="benefits" onUpgrade={() => setUpgradeOpen(true)} />)}
        </div>
      </main>

      {/* ─── SLIDE CART ─── */}
      <SlideCart />

      {/* ─── UPGRADE MODAL ─── */}
      <UpgradeModal
        open={upgradeOpen}
        onClose={() => setUpgradeOpen(false)}
        currentTier={tier}
        onSelectPlan={(t) => setTier(t)}
      />

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
                <li><Link href="/blog" className="text-sm text-bone/50 hover:text-bone transition-colors duration-300 link-hover-underline">Blog</Link></li>
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
  drops: {
    icon: (
      <svg className="w-8 h-8 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
    title: "Exclusive Drops",
    description: "Limited runs, member-only deals, and time-sensitive releases. Upgrade your membership to get access when drops go live.",
    cta: "Upgrade Membership",
    href: "/onboarding",
    features: ["Early access to limited releases", "Member-exclusive pricing", "First dibs on curated gear"],
  },
  benefits: {
    icon: (
      <svg className="w-8 h-8 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09zM18.259 8.715L18 9.75l-.259-1.035a3.375 3.375 0 00-2.455-2.456L14.25 6l1.036-.259a3.375 3.375 0 002.455-2.456L18 2.25l.259 1.035a3.375 3.375 0 002.455 2.456L21.75 6l-1.036.259a3.375 3.375 0 00-2.455 2.456z" />
      </svg>
    ),
    title: "Member Benefits",
    description: "V1+ coaching, travel credits, free shipping, concierge support, and priority drop access. Upgrade your membership to unlock the full experience.",
    cta: "Upgrade Membership",
    href: "/onboarding",
    features: ["V1+ virtual coaching", "Far & Sure travel credit", "Free 2-day shipping"],
  },
};

function GatedTab({ type, onUpgrade }: { type: "shop" | "drops" | "club" | "benefits"; onUpgrade: () => void }) {
  const content = GATED_CONTENT[type];
  // "shop" gated = not signed in → link to onboarding. Others = signed in but unpaid → open modal.
  const useModal = type !== "shop";

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
            {useModal ? (
              <button
                onClick={onUpgrade}
                className="inline-flex items-center justify-center h-12 px-10 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 btn-press cursor-pointer"
              >
                {content.cta}
              </button>
            ) : (
              <Link
                href={content.href}
                className="inline-flex items-center justify-center h-12 px-10 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 btn-press"
              >
                {content.cta}
              </Link>
            )}
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
  const [shopProducts, setShopProducts] = useState<ShopifyProduct[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [partialWarning, setPartialWarning] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(false);
    setPartialWarning(null);

    async function load() {
      const catalogCollections = [
        { label: "Pro Shop", handle: PRO_SHOP_COLLECTION_HANDLE },
        { label: "Private Releases", handle: PRIVATE_RELEASES_COLLECTION_HANDLE },
      ] as const;

      try {
        const settled = await Promise.allSettled(
          catalogCollections.map(({ handle }) => getCollectionProducts(handle))
        );

        if (cancelled) return;

        const successfulCollections: Array<{
          handle: string;
          products: ShopifyProduct[];
        }> = [];
        const failedLabels: string[] = [];

        settled.forEach((result, index) => {
          const entry = catalogCollections[index];
          if (result.status === "fulfilled") {
            successfulCollections.push({
              handle: entry.handle,
              products: result.value,
            });
          } else {
            failedLabels.push(entry.label);
            console.error(
              `[Dashboard ShopTab] failed to load "${entry.label}" (${entry.handle}):`,
              result.reason
            );
          }
        });

        const merged = mergeCollectionProductsBySlug(successfulCollections);
        setShopProducts(merged);

        if (failedLabels.length > 0 && merged.length > 0) {
          setPartialWarning(
            `Some catalog collections could not be loaded (${failedLabels.join(", ")}).`
          );
        }

        if (merged.length === 0) {
          setError(true);
        }
      } catch (err) {
        console.error("[Dashboard ShopTab] unexpected load error:", err);
        if (!cancelled) setError(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    void load();
    return () => { cancelled = true; };
  }, []);

  if (loading) {
    return (
      <div className="px-6 md:px-12">
        <div className="max-w-7xl mx-auto">
          <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3 md:gap-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="animate-pulse">
                <div className="aspect-[3/4] bg-taupe/20 rounded-lg mb-3" />
                <div className="h-3 bg-taupe/20 rounded w-2/3 mb-2" />
                <div className="h-4 bg-taupe/20 rounded mb-1.5" />
                <div className="h-3 bg-taupe/20 rounded w-1/3" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="px-6 md:px-12">
        <div className="max-w-7xl mx-auto flex flex-col items-center justify-center py-24 text-center gap-3">
          <p className="text-sm text-charcoal/50">
            Unable to load products. Check your connection and try again.
          </p>
        </div>
      </div>
    );
  }

  const brands = [...new Set(shopProducts.map((p) => p.brand))];
  const collections = [...new Set(shopProducts.map((p) => p.collection))];

  return (
    <div className="px-6 md:px-12">
      <div className="max-w-7xl mx-auto">
        {partialWarning && (
          <p className="mb-4 text-xs text-charcoal/45">{partialWarning}</p>
        )}
        <ShopGrid
          products={shopProducts}
          brands={brands}
          collections={collections}
          sourceContext="dashboard-shop"
          privateReleasesHandle={PRIVATE_RELEASES_COLLECTION_HANDLE}
        />
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   DROPS TAB — Limited / member-exclusive releases
   ═══════════════════════════════════════════ */

const DROP_DATE = getExclusiveDropDate();

function useCountdown(target: Date) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  const diff = Math.max(0, target.getTime() - now.getTime());
  const days = Math.floor(diff / 86_400_000);
  const hours = Math.floor((diff % 86_400_000) / 3_600_000);
  const minutes = Math.floor((diff % 3_600_000) / 60_000);
  const seconds = Math.floor((diff % 60_000) / 1000);
  return { days, hours, minutes, seconds, isLive: diff === 0 };
}

function DropsTab() {
  const { days, hours, minutes, seconds, isLive } = useCountdown(DROP_DATE);
  const dropDateLabel = formatExclusiveDropLabel(DROP_DATE);

  return (
    <div className="px-6 md:px-12">
      <div className="max-w-3xl mx-auto pt-4">
        {/* Header */}
        <div className="mb-10">
          <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-4">
            <span className="w-6 h-px bg-sage/50" />
            Drops
            <span className="w-6 h-px bg-sage/50" />
          </span>
          <h2 className="font-serif text-2xl md:text-4xl text-obsidian leading-tight mb-3">
            Limited runs. Member pricing.
          </h2>
          <p className="text-base text-charcoal/55 leading-relaxed max-w-xl">
            Time-sensitive releases and member-exclusive deals. Once they sell out, they&rsquo;re gone.
          </p>
        </div>

        {/* First Drop Card */}
        <div className="bg-forest rounded-2xl p-8 md:p-10 relative overflow-hidden">
          {/* Decorative glow */}
          <div className="absolute top-0 right-0 w-64 h-64 bg-sage/5 rounded-full blur-3xl pointer-events-none" />

          <div className="relative z-10">
            <div className="flex items-center gap-2 mb-6">
              <span className="w-2 h-2 rounded-full bg-sage animate-pulse" />
              <span className="text-xs tracking-[0.2em] uppercase text-sage font-medium">
                {isLive ? "Live Now" : "Upcoming Drop"}
              </span>
            </div>

            <h3 className="font-serif text-xl md:text-2xl text-bone mb-2">
              Drop 001
            </h3>
            <p className="text-sm text-bone/50 mb-8">
              Our first members-only release. Details revealed at drop time.
            </p>

            {/* Countdown */}
            {!isLive ? (
              <>
                <p className="text-[10px] tracking-[0.3em] uppercase text-bone/40 font-medium mb-3">
                  Goes live {dropDateLabel}
                </p>
                <div className="grid grid-cols-4 gap-3 max-w-sm">
                  {[
                    { value: days, label: "Days" },
                    { value: hours, label: "Hours" },
                    { value: minutes, label: "Min" },
                    { value: seconds, label: "Sec" },
                  ].map(({ value, label }) => (
                    <div key={label} className="bg-bone/8 rounded-xl py-4 text-center">
                      <span className="block font-serif text-2xl md:text-3xl text-bone tabular-nums">
                        {String(value).padStart(2, "0")}
                      </span>
                      <span className="text-[10px] tracking-[0.15em] uppercase text-bone/40 font-medium">
                        {label}
                      </span>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <div className="bg-bone/10 rounded-xl p-6 text-center">
                <p className="text-lg font-serif text-bone mb-2">The drop is live.</p>
                <p className="text-sm text-bone/50">Check back here for exclusive deals as they go live.</p>
              </div>
            )}
          </div>
        </div>

        {/* How drops work */}
        <div className="mt-10 grid md:grid-cols-3 gap-6">
          {[
            {
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M14.857 17.082a23.848 23.848 0 005.454-1.31A8.967 8.967 0 0118 9.75v-.7V9A6 6 0 006 9v.75a8.967 8.967 0 01-2.312 6.022c1.733.64 3.56 1.085 5.455 1.31m5.714 0a24.255 24.255 0 01-5.714 0m5.714 0a3 3 0 11-5.714 0" />
                </svg>
              ),
              title: "Get notified",
              desc: "We alert you before each drop so you never miss out.",
            },
            {
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v6h4.5m4.5 0a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              ),
              title: "Shop the window",
              desc: "Drops are time-limited. Once they sell out, they're gone.",
            },
            {
              icon: (
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                </svg>
              ),
              title: "Member pricing",
              desc: "Every drop features exclusive Reserve pricing for members.",
            },
          ].map(({ icon, title, desc }) => (
            <div key={title} className="text-center">
              <div className="w-10 h-10 rounded-xl bg-forest/8 flex items-center justify-center mx-auto mb-3 text-forest">
                {icon}
              </div>
              <h4 className="text-sm font-medium text-obsidian mb-1">{title}</h4>
              <p className="text-xs text-charcoal/50 leading-relaxed">{desc}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   BENEFITS TAB — SkyMiles-style perks
   ═══════════════════════════════════════════ */

type BenefitCategory = "All" | BenefitCatalogCategory;

interface BenefitEntry {
  key: BenefitKey;
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  description: string;
  category: BenefitCategory;
  status: "Active" | "Locked" | "In Review";
  action: {
    type: BenefitCatalogAction;
    label: string;
  };
}

const V1_REVIEW_MESSAGE =
  "Your V1+ Virtual Coaching request is being reviewed. You will receive an email within 1-3 days with next steps.";

const BENEFIT_ICONS: Record<BenefitKey, React.ReactNode> = {
  v1_virtual_coaching: <CoachingBenefitIcon />,
  concierge_support: <ConciergeBenefitIcon />,
  free_2_day_shipping: <ShippingBenefitIcon />,
  far_sure_golf_tours_credit: <TravelBenefitIcon />,
  priority_drop_access: <DropBenefitIcon />,
};

function BenefitsTab({ onUpgrade }: { onUpgrade: () => void }) {
  const { user, tier, tierLabel } = useMembership();
  const isFree = tier === "free";
  const isPaid = tier === "access" || tier === "member" || tier === "black";
  const [activeCategory, setActiveCategory] = useState<BenefitCategory>("All");
  const [enabledBenefits, setEnabledBenefits] = useState<Set<BenefitKey>>(new Set());
  const [conciergeOpen, setConciergeOpen] = useState(false);
  const [conciergeForm, setConciergeForm] = useState({ subject: "", message: "" });
  const [conciergeSent, setConciergeSent] = useState(false);
  const [conciergeSubmitting, setConciergeSubmitting] = useState(false);
  const [conciergeError, setConciergeError] = useState<string | null>(null);
  const [farSureOpen, setFarSureOpen] = useState(false);
  const [farSureForm, setFarSureForm] = useState({
    golfers: "2",
    budgetPerGolfer: "",
    dates: "",
    destination: "",
    notes: "",
  });
  const [farSureSent, setFarSureSent] = useState(false);
  const [farSureSubmitting, setFarSureSubmitting] = useState(false);
  const [farSureError, setFarSureError] = useState<string | null>(null);
  const [coachingSyncing, setCoachingSyncing] = useState(false);
  const [coachingError, setCoachingError] = useState<string | null>(null);
  const [benefitToast, setBenefitToast] = useState<string | null>(null);

  const categories: BenefitCategory[] = ["All", "Coaching", "Travel", "Other"];

  const tierPricing: Record<string, string> = {
    free: "Complimentary",
    access: "$99/year",
    member: "$249/quarter",
    black: "By Invitation",
  };

  const postBenefitInteraction = useCallback(
    async (payload: {
      benefit: ActionableBenefitKey;
      action: "toggle" | "request";
      enabled?: boolean;
      subject?: string;
      message?: string;
      golfers?: number;
      budgetPerGolfer?: string;
      dates?: string;
      destination?: string;
      notes?: string;
      source?: string;
    }) => {
      if (!user) {
        throw new Error("You must be signed in.");
      }
      const idToken = await user.getIdToken();
      const res = await fetch("/api/benefits/interaction", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        let errorMessage = `HTTP ${res.status}`;
        try {
          const data = (await res.json()) as { error?: string };
          if (data?.error) errorMessage = data.error;
        } catch {}
        throw new Error(errorMessage);
      }
    },
    [user]
  );

  const showBenefitToast = useCallback((message: string) => {
    setBenefitToast(message);
  }, []);

  useEffect(() => {
    if (!benefitToast) return;
    const timer = setTimeout(() => setBenefitToast(null), 5200);
    return () => clearTimeout(timer);
  }, [benefitToast]);

  const toggleBenefit = async (benefit: BenefitEntry) => {
    const wasEnabled = enabledBenefits.has(benefit.key);
    if (wasEnabled) return;

    setEnabledBenefits((prev) => {
      const next = new Set(prev);
      next.add(benefit.key);
      return next;
    });

    if (benefit.key !== "v1_virtual_coaching") return;

    setCoachingError(null);
    setCoachingSyncing(true);
    try {
      await postBenefitInteraction({
        benefit: "v1_virtual_coaching",
        action: "toggle",
        enabled: true,
        source: "dashboard_benefits",
      });
      showBenefitToast(V1_REVIEW_MESSAGE);
    } catch (err) {
      console.error("[Benefits] coaching toggle sync failed:", err);
      setEnabledBenefits((prev) => {
        const rollback = new Set(prev);
        rollback.delete(benefit.key);
        return rollback;
      });
      setCoachingError(
        err instanceof Error && err.message
          ? err.message
          : "Could not submit your V1+ coaching request. Please try again."
      );
    } finally {
      setCoachingSyncing(false);
    }
  };

  const handleConciergeSend = async () => {
    const subject = conciergeForm.subject.trim();
    const message = conciergeForm.message.trim();
    if (!subject || !message) return;

    setConciergeError(null);
    setConciergeSubmitting(true);
    try {
      await postBenefitInteraction({
        benefit: "concierge_support",
        action: "request",
        subject,
        message,
        source: "dashboard_benefits",
      });

      showBenefitToast("Concierge Support request submitted successfully.");
      setConciergeSent(true);
      setTimeout(() => {
        setConciergeOpen(false);
        setConciergeSent(false);
        setConciergeForm({ subject: "", message: "" });
      }, 2500);
    } catch (err) {
      console.error("[Benefits] concierge request failed:", err);
      setConciergeError(
        err instanceof Error && err.message
          ? err.message
          : "Could not send your request. Please try again."
      );
    } finally {
      setConciergeSubmitting(false);
    }
  };

  const handleFarSureSend = async () => {
    const golfers = Number(farSureForm.golfers);
    const budgetPerGolfer = farSureForm.budgetPerGolfer.trim();
    const dates = farSureForm.dates.trim();
    const destination = farSureForm.destination.trim();
    const notes = farSureForm.notes.trim();

    if (!Number.isInteger(golfers) || golfers < 1 || !budgetPerGolfer || !dates || !destination) return;

    setFarSureError(null);
    setFarSureSubmitting(true);
    try {
      await postBenefitInteraction({
        benefit: "far_sure_golf_tours_credit",
        action: "request",
        golfers,
        budgetPerGolfer,
        dates,
        destination,
        notes,
        source: "dashboard_benefits",
      });

      showBenefitToast("Far & Sure Golf Tours Credit request submitted successfully.");
      setFarSureSent(true);
      setTimeout(() => {
        setFarSureOpen(false);
        setFarSureSent(false);
        setFarSureForm({
          golfers: "2",
          budgetPerGolfer: "",
          dates: "",
          destination: "",
          notes: "",
        });
      }, 2500);
    } catch (err) {
      console.error("[Benefits] Far & Sure request failed:", err);
      setFarSureError(
        err instanceof Error && err.message
          ? err.message
          : "Could not send your travel credit request. Please try again."
      );
    } finally {
      setFarSureSubmitting(false);
    }
  };

  const benefits: BenefitEntry[] = BENEFIT_CATALOG.map((benefit) => ({
    ...benefit,
    icon: BENEFIT_ICONS[benefit.key],
    status:
      isPaid && benefit.key === "v1_virtual_coaching" && enabledBenefits.has(benefit.key)
        ? "In Review"
        : isPaid ? "Active" : "Locked",
    action: {
      type: benefit.action,
      label:
        benefit.key === "v1_virtual_coaching"
          ? isPaid && enabledBenefits.has(benefit.key) ? "Requested" : isPaid ? "Turn On" : "Upgrade to Access"
          : benefit.key === "concierge_support"
            ? isPaid ? "Send a Request" : "Upgrade to Access"
            : benefit.key === "far_sure_golf_tours_credit"
              ? isPaid ? "Request Credit" : "Upgrade to Access"
              : isPaid ? "Active" : "Upgrade to Access",
    },
  }));

  const filtered = activeCategory === "All" ? benefits : benefits.filter((b) => b.category === activeCategory);

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
            <p className={`text-xs tracking-[0.3em] uppercase font-medium mb-2 text-sage`}>Your Tier</p>
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

        {/* Category filter bar */}
        <div className="mb-8">
          <h3 className="font-serif text-2xl text-obsidian mb-5">Your Benefits</h3>
          <div className="flex flex-wrap gap-2">
            {categories.map((cat) => (
              <button
                key={cat}
                onClick={() => setActiveCategory(cat)}
                className={`px-4 py-2 rounded-full text-sm font-medium tracking-wide transition-all duration-200 ${
                  activeCategory === cat
                    ? "bg-forest text-bone shadow-sm"
                    : "bg-cream border border-taupe/20 text-charcoal/60 hover:border-forest/30 hover:text-forest"
                }`}
              >
                {cat}
              </button>
            ))}
          </div>
        </div>

        {/* Benefits table */}
        <div className="space-y-4">
          {filtered.map((benefit) => {
            const isEnabled = enabledBenefits.has(benefit.key);
            const isLocked = benefit.status === "Locked";

            return (
              <div
                key={benefit.key}
                className={`bg-cream rounded-xl border border-taupe/15 p-5 md:p-6 transition-all duration-200 ${
                  isLocked ? "opacity-60" : "tile-hover"
                }`}
              >
                <div className="flex items-start gap-4">
                  {/* Icon */}
                  <div className={`w-11 h-11 rounded-xl flex items-center justify-center shrink-0 ${isLocked ? "bg-taupe/10" : "bg-forest/8"}`}>
                    {benefit.icon}
                  </div>

                  {/* Content */}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-3 mb-1">
                      <h4 className="text-sm font-semibold text-obsidian">{benefit.title}</h4>
                      <span className={`text-[10px] tracking-wider uppercase font-medium px-2 py-0.5 rounded-full w-fit ${
                        benefit.status === "Active"
                          ? "bg-forest/10 text-forest"
                          : "bg-taupe/20 text-charcoal/40"
                      }`}>
                        {benefit.status}
                      </span>
                    </div>
                    <p className="text-xs font-medium text-forest/70 mb-1">{benefit.subtitle}</p>
                    <p className="text-xs text-charcoal/50 leading-relaxed">{benefit.description}</p>
                    {benefit.key === "v1_virtual_coaching" && isEnabled && (
                      <p className="text-[11px] text-forest mt-2">{V1_REVIEW_MESSAGE}</p>
                    )}
                    {benefit.key === "v1_virtual_coaching" && coachingError && (
                      <p className="text-[11px] text-ember mt-2">{coachingError}</p>
                    )}
                  </div>

                  {/* Action button */}
                  <div className="shrink-0 self-center">
                    {benefit.action.type === "toggle" && !isLocked ? (
                      <button
                        onClick={() => void toggleBenefit(benefit)}
                        disabled={benefit.key === "v1_virtual_coaching" && (coachingSyncing || isEnabled)}
                        aria-label={
                          benefit.key === "v1_virtual_coaching" && isEnabled
                            ? "V1+ Virtual Coaching request in review"
                            : "Turn on V1+ Virtual Coaching"
                        }
                        aria-checked={isEnabled}
                        role="switch"
                        className={`relative inline-flex h-7 w-12 items-center rounded-full transition-colors duration-200 ${
                          isEnabled ? "bg-forest" : "bg-taupe/30"
                        } ${benefit.key === "v1_virtual_coaching" && (coachingSyncing || isEnabled) ? "opacity-60 cursor-not-allowed" : ""}`}
                      >
                        <span className={`inline-block h-5 w-5 rounded-full bg-white shadow-sm transition-transform duration-200 ${
                          isEnabled ? "translate-x-6" : "translate-x-1"
                        }`} />
                      </button>
                    ) : benefit.action.type === "request" && !isLocked ? (
                      <button
                        onClick={() => {
                          if (benefit.key === "concierge_support") {
                            setConciergeOpen(true);
                          } else if (benefit.key === "far_sure_golf_tours_credit") {
                            setFarSureOpen(true);
                          }
                        }}
                        className="inline-flex h-9 px-4 rounded-lg bg-forest text-bone text-xs font-medium tracking-wide uppercase hover:bg-forest-dark transition-colors duration-200 items-center whitespace-nowrap"
                      >
                        {benefit.action.label}
                      </button>
                    ) : benefit.action.type === "auto" && !isLocked ? (
                      <span className="inline-flex h-9 px-4 rounded-lg bg-forest/8 text-forest text-xs font-medium tracking-wide items-center whitespace-nowrap">
                        {benefit.action.label}
                      </span>
                    ) : (
                      <button
                        onClick={onUpgrade}
                        className="inline-flex h-9 px-4 rounded-lg border border-forest/20 text-forest text-xs font-medium tracking-wide uppercase hover:bg-forest/5 transition-colors duration-200 items-center whitespace-nowrap"
                      >
                        {benefit.action.label}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Concierge Message Modal */}
        {conciergeOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-obsidian/50 backdrop-blur-sm" onClick={() => { setConciergeOpen(false); setConciergeSent(false); }} />
            <div className="relative bg-bone rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-8 animate-fade-up">
              <button
                type="button"
                onClick={() => { setConciergeOpen(false); setConciergeSent(false); }}
                className="absolute top-4 right-4 text-charcoal/30 hover:text-charcoal transition-colors"
                aria-label="Close concierge request"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {conciergeSent ? (
                <div className="text-center py-6">
                  <div className="w-14 h-14 rounded-full bg-forest/10 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="font-serif text-xl text-obsidian mb-2">Message Sent</h3>
                  <p className="text-sm text-charcoal/50">Our concierge team will get back to you within 24 hours.</p>
                </div>
              ) : (
                <>
                  <div className="mb-6">
                    <h3 className="font-serif text-xl text-obsidian mb-1">Concierge Request</h3>
                    <p className="text-sm text-charcoal/50">We&apos;ll help with anything — tee times, travel, gear sourcing, gifting, and more.</p>
                  </div>
                  <div className="space-y-4">
                    <div>
                      <label htmlFor="concierge-subject" className="block text-xs font-medium text-charcoal/60 uppercase tracking-wider mb-1.5">Subject</label>
                      <input
                        id="concierge-subject"
                        type="text"
                        value={conciergeForm.subject}
                        onChange={(e) => setConciergeForm((f) => ({ ...f, subject: e.target.value }))}
                        placeholder="e.g., Book a tee time at Pinehurst"
                        className="w-full h-10 px-4 rounded-lg border border-taupe/20 bg-cream text-sm text-obsidian placeholder:text-charcoal/30 focus:outline-none focus:border-forest/40 transition-colors"
                      />
                    </div>
                    <div>
                      <label htmlFor="concierge-message" className="block text-xs font-medium text-charcoal/60 uppercase tracking-wider mb-1.5">Message</label>
                      <textarea
                        id="concierge-message"
                        value={conciergeForm.message}
                        onChange={(e) => setConciergeForm((f) => ({ ...f, message: e.target.value }))}
                        placeholder="Tell us how we can help..."
                        rows={4}
                        className="w-full px-4 py-3 rounded-lg border border-taupe/20 bg-cream text-sm text-obsidian placeholder:text-charcoal/30 focus:outline-none focus:border-forest/40 transition-colors resize-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleConciergeSend()}
                      disabled={conciergeSubmitting}
                      className={`w-full h-11 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase transition-colors duration-300 ${
                        conciergeSubmitting ? "opacity-60 cursor-not-allowed" : "hover:bg-forest-dark"
                      }`}
                    >
                      {conciergeSubmitting ? "Sending..." : "Send Request"}
                    </button>
                    {conciergeError && (
                      <p className="text-[11px] text-ember">{conciergeError}</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {farSureOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center">
            <div className="absolute inset-0 bg-obsidian/50 backdrop-blur-sm" onClick={() => { setFarSureOpen(false); setFarSureSent(false); }} />
            <div className="relative bg-bone rounded-2xl shadow-2xl w-full max-w-lg mx-4 p-8 animate-fade-up">
              <button
                type="button"
                onClick={() => { setFarSureOpen(false); setFarSureSent(false); }}
                className="absolute top-4 right-4 text-charcoal/30 hover:text-charcoal transition-colors"
                aria-label="Close Far & Sure request"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>

              {farSureSent ? (
                <div className="text-center py-6">
                  <div className="w-14 h-14 rounded-full bg-forest/10 flex items-center justify-center mx-auto mb-4">
                    <svg className="w-7 h-7 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <h3 className="font-serif text-xl text-obsidian mb-2">Request Sent</h3>
                  <p className="text-sm text-charcoal/50">Our travel team will follow up with Far & Sure options.</p>
                </div>
              ) : (
                <>
                  <div className="mb-6">
                    <h3 className="font-serif text-xl text-obsidian mb-1">Far & Sure Golf Tours Credit</h3>
                    <p className="text-sm text-charcoal/50">Tell us where you want to play and we will help apply your $200 per golfer credit.</p>
                  </div>
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label htmlFor="far-sure-golfers" className="block text-xs font-medium text-charcoal/60 uppercase tracking-wider mb-1.5"># of golfers</label>
                        <input
                          id="far-sure-golfers"
                          type="number"
                          min="1"
                          max="100"
                          value={farSureForm.golfers}
                          onChange={(e) => setFarSureForm((f) => ({ ...f, golfers: e.target.value }))}
                          className="w-full h-10 px-4 rounded-lg border border-taupe/20 bg-cream text-sm text-obsidian placeholder:text-charcoal/30 focus:outline-none focus:border-forest/40 transition-colors"
                        />
                      </div>
                      <div>
                        <label htmlFor="far-sure-budget" className="block text-xs font-medium text-charcoal/60 uppercase tracking-wider mb-1.5">Budget per golfer</label>
                        <input
                          id="far-sure-budget"
                          type="text"
                          value={farSureForm.budgetPerGolfer}
                          onChange={(e) => setFarSureForm((f) => ({ ...f, budgetPerGolfer: e.target.value }))}
                          placeholder="$2,500"
                          className="w-full h-10 px-4 rounded-lg border border-taupe/20 bg-cream text-sm text-obsidian placeholder:text-charcoal/30 focus:outline-none focus:border-forest/40 transition-colors"
                        />
                      </div>
                    </div>
                    <div>
                      <label htmlFor="far-sure-dates" className="block text-xs font-medium text-charcoal/60 uppercase tracking-wider mb-1.5">Dates</label>
                      <input
                        id="far-sure-dates"
                        type="text"
                        value={farSureForm.dates}
                        onChange={(e) => setFarSureForm((f) => ({ ...f, dates: e.target.value }))}
                        placeholder="June 12-16 or flexible"
                        className="w-full h-10 px-4 rounded-lg border border-taupe/20 bg-cream text-sm text-obsidian placeholder:text-charcoal/30 focus:outline-none focus:border-forest/40 transition-colors"
                      />
                    </div>
                    <div>
                      <label htmlFor="far-sure-destination" className="block text-xs font-medium text-charcoal/60 uppercase tracking-wider mb-1.5">Destination</label>
                      <input
                        id="far-sure-destination"
                        type="text"
                        value={farSureForm.destination}
                        onChange={(e) => setFarSureForm((f) => ({ ...f, destination: e.target.value }))}
                        placeholder="Scotland, Pinehurst, Bandon..."
                        className="w-full h-10 px-4 rounded-lg border border-taupe/20 bg-cream text-sm text-obsidian placeholder:text-charcoal/30 focus:outline-none focus:border-forest/40 transition-colors"
                      />
                    </div>
                    <div>
                      <label htmlFor="far-sure-notes" className="block text-xs font-medium text-charcoal/60 uppercase tracking-wider mb-1.5">Notes</label>
                      <textarea
                        id="far-sure-notes"
                        value={farSureForm.notes}
                        onChange={(e) => setFarSureForm((f) => ({ ...f, notes: e.target.value }))}
                        placeholder="Course preferences, room count, flights, or anything else."
                        rows={4}
                        className="w-full px-4 py-3 rounded-lg border border-taupe/20 bg-cream text-sm text-obsidian placeholder:text-charcoal/30 focus:outline-none focus:border-forest/40 transition-colors resize-none"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => void handleFarSureSend()}
                      disabled={farSureSubmitting}
                      className={`w-full h-11 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase transition-colors duration-300 ${
                        farSureSubmitting ? "opacity-60 cursor-not-allowed" : "hover:bg-forest-dark"
                      }`}
                    >
                      {farSureSubmitting ? "Sending..." : "Send Request"}
                    </button>
                    {farSureError && (
                      <p className="text-[11px] text-ember">{farSureError}</p>
                    )}
                  </div>
                </>
              )}
            </div>
          </div>
        )}
        {benefitToast && (
          <div className="fixed inset-0 z-[70] pointer-events-none flex items-center justify-center px-6">
            <div className="relative w-full max-w-md rounded-2xl border border-sage/40 bg-gradient-to-br from-forest to-forest-dark text-bone shadow-[0_30px_80px_-24px_rgba(23,74,54,0.9)] animate-fade-up overflow-hidden">
              <div className="absolute -top-10 -left-10 w-28 h-28 rounded-full bg-sage/30 blur-2xl" aria-hidden="true" />
              <div className="absolute -bottom-12 -right-10 w-32 h-32 rounded-full bg-bone/15 blur-2xl" aria-hidden="true" />
              <div className="relative p-6 md:p-7 text-center">
                <div className="mx-auto mb-3 w-12 h-12 rounded-full bg-bone/15 border border-bone/30 flex items-center justify-center">
                  <svg className="w-6 h-6 text-bone" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                </div>
                <p className="text-[11px] uppercase tracking-[0.24em] text-bone/70 mb-1">Benefits Updated</p>
                <p className="text-base md:text-lg font-semibold leading-snug text-bone">{benefitToast}</p>
              </div>
            </div>
          </div>
        )}
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
  const { user, clubStatus, setClubStatus, interestedClubs, toggleClubInterest } = useMembership();
  const [selectedState, setSelectedState] = useState("Michigan");
  const [showForm, setShowForm] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [formData, setFormData] = useState({
    clubName: "",
    city: "",
    state: "",
    holes: "18",
    guestPolicy: "",
  });

  const filteredClubs = SAMPLE_CLUBS.filter((c) => c.state === selectedState);

  const handleSubmitApplication = async () => {
    if (!user) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const idToken = await user.getIdToken();
      const res = await fetch("/api/registry/apply", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({
          metadata: {
            club_name: formData.clubName,
            city: formData.city,
            state: formData.state,
            holes: Number(formData.holes),
            guest_policy: formData.guestPolicy,
            submitted_by_email: user.email ?? "",
          },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setClubStatus("pending");
      setShowForm(false);
      void trackEvent("registry_applied", {
        properties: {
          source: "dashboard_club_tab",
          club_state: formData.state,
        },
      });
    } catch (err) {
      console.error("[ClubTab] registry/apply failed:", err);
      setSubmitError("No se pudo enviar la solicitud. Intenta nuevamente.");
    } finally {
      setSubmitting(false);
    }
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
                  <p className="text-sm text-bone/60 leading-relaxed">Our team reviews your application to verify your membership. This typically takes 1 to 2 business days.</p>
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
                {submitError && (
                  <p className="mb-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
                    {submitError}
                  </p>
                )}
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
                    onClick={() => void handleSubmitApplication()}
                    disabled={submitting}
                    className="h-11 px-8 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 cursor-pointer btn-press disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {submitting ? "Submitting…" : "Submit for Review"}
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
              Your club listing has been submitted and is being reviewed by our team. This typically takes 1 to 2 business days. We&rsquo;ll notify you once you&rsquo;re approved.
            </p>
            <div className="inline-flex items-center gap-2 text-xs tracking-wider uppercase text-sage bg-sage/10 px-4 py-2 rounded-lg font-medium">
              <span className="w-2 h-2 rounded-full bg-sage animate-pulse" />
              Pending Review
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
                          <span className="text-xs text-forest font-medium">Interest noted. Our concierge will reach out</span>
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

export default function DashboardPage() {
  return (
    <Suspense>
      <DashboardContent />
    </Suspense>
  );
}

/* ═══════════════════════════════════════════
   COMMUNITY TAB — Forum
   (Post data imported from ../community/posts)
   ═══════════════════════════════════════════ */

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

function CommunityTab() {
  const { isSignedIn, user, username } = useMembership();
  const [activeTag, setActiveTag] = useState("All");
  const [showCompose, setShowCompose] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);
  const [composeImages, setComposeImages] = useState<{ url: string; file: File }[]>([]);
  const [composeTitle, setComposeTitle] = useState("");
  const [composeBody, setComposeBody] = useState("");
  const [composeTag, setComposeTag] = useState("General");
  const [publishing, setPublishing] = useState(false);
  const [posts, setPosts] = useState<ForumPost[]>([]);
  const [loading, setLoading] = useState(true);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setLoading(true);
    const url =
      activeTag === "All"
        ? "/api/community/posts"
        : `/api/community/posts?tag=${encodeURIComponent(activeTag)}`;
    fetch(url)
      .then((r) => r.json())
      .then((data) => setPosts(data.posts || []))
      .catch(() => setPosts([]))
      .finally(() => setLoading(false));
  }, [activeTag]);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files) return;
    const newImages: { url: string; file: File }[] = [];
    Array.from(files).forEach((file) => {
      if (file.type.startsWith("image/")) {
        newImages.push({ url: URL.createObjectURL(file), file });
      }
    });
    setComposeImages((prev) => [...prev, ...newImages].slice(0, 4));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeComposeImage = (index: number) => {
    setComposeImages((prev) => {
      URL.revokeObjectURL(prev[index].url);
      return prev.filter((_, i) => i !== index);
    });
  };

  const handlePublish = async () => {
    if (!user || !composeTitle.trim() || !composeBody.trim()) return;
    setPublishing(true);
    try {
      const token = await user.getIdToken();

      // Upload images server-side (avoids CORS issues with Firebase Storage)
      const uploadFile = async (file: File) => {
        const fd = new FormData();
        fd.append("file", file);
        const r = await fetch("/api/community/upload", {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
          body: fd,
        });
        if (!r.ok) return null;
        const { url } = await r.json();
        return (url as string) || null;
      };

      const imageUrls = await Promise.all(composeImages.map(({ file }) => uploadFile(file))).then(
        (urls) => urls.filter((u): u is string => !!u)
      );

      const avatar = getInitials(username || user.email || "?");
      const res = await fetch("/api/community/posts", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title: composeTitle,
          body: composeBody,
          tag: composeTag,
          author: username || user.email || "Member",
          avatar,
          images: imageUrls,
        }),
      });
      if (res.ok) {
        const { post } = await res.json();
        // Revoke blob URLs
        composeImages.forEach(({ url }) => URL.revokeObjectURL(url));
        setPosts((prev) => [post, ...prev]);
        setComposeTitle("");
        setComposeBody("");
        setComposeTag("General");
        setComposeImages([]);
        setShowCompose(false);
      }
    } catch {
      // silent
    } finally {
      setPublishing(false);
    }
  };

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
              value={composeTitle}
              onChange={(e) => setComposeTitle(e.target.value)}
              placeholder="Post title"
              className="w-full h-11 px-4 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300 mb-3"
            />
            <textarea
              value={composeBody}
              onChange={(e) => setComposeBody(e.target.value)}
              placeholder="Share something with the community..."
              rows={4}
              className="w-full px-4 py-3 rounded-xl bg-bone border border-taupe/30 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300 resize-none mb-3"
            />

            {/* Image previews */}
            {composeImages.length > 0 && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-2 mb-3">
                {composeImages.map(({ url }, i) => (
                  <div key={i} className="relative aspect-[3/2] rounded-lg overflow-hidden bg-bone border border-taupe/20 group">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={url} alt={`Upload ${i + 1}`} className="w-full h-full object-cover" />
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

            {/* Video previews */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <select
                  value={composeTag}
                  onChange={(e) => setComposeTag(e.target.value)}
                  className="h-9 px-3 rounded-lg bg-bone border border-taupe/30 text-xs text-charcoal/60 focus:border-forest/40 transition-all duration-300"
                >
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
              <button
                onClick={handlePublish}
                disabled={publishing || !composeTitle.trim() || !composeBody.trim()}
                className={`h-10 px-6 rounded-xl text-sm font-medium tracking-wider uppercase transition-colors duration-300 btn-press ${
                  publishing || !composeTitle.trim() || !composeBody.trim()
                    ? "bg-taupe/20 text-charcoal/30 cursor-not-allowed"
                    : "bg-forest text-bone hover:bg-forest-dark cursor-pointer"
                }`}
              >
                {publishing ? "Publishing…" : "Publish"}
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
        {loading ? (
          <div className="space-y-4">
            {[1, 2, 3].map((i) => (
              <div key={i} className="bg-cream rounded-xl border border-taupe/15 p-6 animate-pulse">
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-taupe/20" />
                  <div className="flex-1 space-y-2">
                    <div className="h-3 bg-taupe/20 rounded w-1/3" />
                    <div className="h-4 bg-taupe/20 rounded w-2/3" />
                    <div className="h-3 bg-taupe/15 rounded w-full" />
                    <div className="h-3 bg-taupe/15 rounded w-4/5" />
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : posts.length === 0 ? (
          <div className="text-center py-16 bg-cream rounded-2xl border border-taupe/15">
            <p className="text-sm text-charcoal/40 mb-2">No posts yet.</p>
            <p className="text-xs text-charcoal/30">Be the first to share something with the community.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {posts.map((post) => (
              <PostCard
                key={post.id}
                post={post}
                isSignedIn={isSignedIn}
                user={user}
                onDelete={(id) => setPosts((prev) => prev.filter((p) => p.id !== id))}
                onUpdate={(updated) => setPosts((prev) => prev.map((p) => p.id === updated.id ? updated : p))}
              />
            ))}
          </div>
        )}

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

function PostCard({
  post,
  isSignedIn,
  user,
  onDelete,
  onUpdate,
}: {
  post: ForumPost;
  isSignedIn: boolean;
  user: FirebaseUser | null;
  onDelete: (id: string) => void;
  onUpdate: (updated: ForumPost) => void;
}) {
  const router = useRouter();
  const isAuthor = !!user && user.uid === post.authorId;
  const initialCommentCount = post.commentCount ?? post.comments.length;

  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(post.likes);
  const [showComments, setShowComments] = useState(false);
  const [localComments, setLocalComments] = useState<ForumComment[]>(post.comments);
  const [commentCount, setCommentCount] = useState(initialCommentCount);
  const [commentsLoaded, setCommentsLoaded] = useState(
    post.comments.length > 0 || initialCommentCount === 0
  );
  const [commentsLoading, setCommentsLoading] = useState(false);
  const [commentLikes, setCommentLikes] = useState<Record<string, boolean>>({});
  const [commentLikeCounts, setCommentLikeCounts] = useState<Record<string, number>>(
    () => Object.fromEntries(post.comments.map((c) => [c.id, c.likes]))
  );
  const [replyText, setReplyText] = useState("");
  const [submittingReply, setSubmittingReply] = useState(false);
  const [showShareMenu, setShowShareMenu] = useState(false);
  const [copied, setCopied] = useState(false);
  const [showSignUp, setShowSignUp] = useState(false);
  const [showPostMenu, setShowPostMenu] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editTitle, setEditTitle] = useState(post.title);
  const [editBody, setEditBody] = useState(post.body);
  const [editTag, setEditTag] = useState(post.tag);
  const [savingEdit, setSavingEdit] = useState(false);
  const [deletingPost, setDeletingPost] = useState(false);
  const [deletingCommentId, setDeletingCommentId] = useState<string | null>(null);

  useEffect(() => {
    if (!showComments || commentsLoaded || commentsLoading || commentCount === 0) return;

    let cancelled = false;

    const loadComments = async () => {
      setCommentsLoading(true);
      try {
        const res = await fetch(`/api/community/posts/${post.id}/comments`);
        if (!res.ok) return;
        const data = (await res.json()) as { comments?: ForumComment[] };
        if (cancelled) return;
        const nextComments = Array.isArray(data.comments) ? data.comments : [];
        setLocalComments(nextComments);
        setCommentCount(nextComments.length);
        setCommentLikeCounts(
          Object.fromEntries(nextComments.map((comment) => [comment.id, comment.likes]))
        );
        setCommentsLoaded(true);
      } catch {
        // silent
      } finally {
        if (!cancelled) setCommentsLoading(false);
      }
    };

    void loadComments();

    return () => {
      cancelled = true;
    };
  }, [commentCount, commentsLoaded, commentsLoading, post.id, showComments]);

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
  const shareText = `${post.title} by ${post.author} on Mully Reserve`;

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

  const toggleLike = async () => {
    if (!user) return;
    const wasLiked = liked;
    const previousCount = likeCount;
    const optimisticLiked = !wasLiked;
    const optimisticCount = wasLiked ? previousCount - 1 : previousCount + 1;
    setLiked(optimisticLiked);
    setLikeCount(optimisticCount);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/community/posts/${post.id}/like`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to toggle like");
      const data = (await res.json()) as { liked?: boolean };
      if (typeof data.liked === "boolean" && data.liked !== optimisticLiked) {
        setLiked(data.liked);
        setLikeCount(data.liked ? previousCount + 1 : previousCount - 1);
      }
    } catch {
      setLiked(wasLiked);
      setLikeCount(previousCount);
    }
  };

  const toggleCommentLike = async (commentId: string) => {
    if (!user) return;
    const wasLiked = commentLikes[commentId] || false;
    const previousCount = commentLikeCounts[commentId] || 0;
    const optimisticLiked = !wasLiked;
    const optimisticCount = wasLiked ? previousCount - 1 : previousCount + 1;
    setCommentLikes((prev) => ({ ...prev, [commentId]: optimisticLiked }));
    setCommentLikeCounts((prev) => ({
      ...prev,
      [commentId]: optimisticCount,
    }));
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/community/posts/${post.id}/comments/${commentId}/like`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error("Failed to toggle comment like");
      const data = (await res.json()) as { liked?: boolean };
      if (typeof data.liked === "boolean" && data.liked !== optimisticLiked) {
        setCommentLikes((prev) => ({ ...prev, [commentId]: data.liked! }));
        setCommentLikeCounts((prev) => ({
          ...prev,
          [commentId]: data.liked ? previousCount + 1 : previousCount - 1,
        }));
      }
    } catch {
      setCommentLikes((prev) => ({ ...prev, [commentId]: wasLiked }));
      setCommentLikeCounts((prev) => ({
        ...prev,
        [commentId]: previousCount,
      }));
    }
  };

  const handleSaveEdit = async () => {
    if (!user || !editTitle.trim() || !editBody.trim()) return;
    setSavingEdit(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/community/posts/${post.id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ title: editTitle, body: editBody, tag: editTag }),
      });
      if (res.ok) {
        const { post: updated } = await res.json();
        onUpdate({
          ...updated,
          commentCount,
          comments: commentsLoaded ? localComments : [],
        });
        setIsEditing(false);
      }
    } catch {
      // silent
    } finally {
      setSavingEdit(false);
    }
  };

  const handleDelete = async () => {
    if (!user) return;
    setDeletingPost(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/community/posts/${post.id}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) onDelete(post.id);
    } catch {
      // silent
    } finally {
      setDeletingPost(false);
      setShowPostMenu(false);
    }
  };

  const handleReply = async () => {
    if (!user || !replyText.trim()) return;
    setSubmittingReply(true);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/community/posts/${post.id}/comments`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          body: replyText.trim(),
          author: user.displayName || user.email || "Member",
          avatar: getInitials(user.displayName || user.email || "?"),
        }),
      });
      if (res.ok) {
        const { comment } = await res.json();
        setLocalComments((prev) => [...prev, comment]);
        setCommentCount((prev) => prev + 1);
        setCommentsLoaded(true);
        setCommentLikeCounts((prev) => ({ ...prev, [comment.id]: 0 }));
        setReplyText("");
      }
    } catch {
      // silent
    } finally {
      setSubmittingReply(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (!user) return;
    setDeletingCommentId(commentId);
    try {
      const token = await user.getIdToken();
      const res = await fetch(`/api/community/posts/${post.id}/comments/${commentId}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${token}` },
      });
      if (res.ok) {
        setLocalComments((prev) => prev.filter((c) => c.id !== commentId));
        setCommentCount((prev) => Math.max(0, prev - 1));
      }
    } catch {
      // silent
    } finally {
      setDeletingCommentId(null);
    }
  };

  return (
    <article
      onClick={() => router.push(`/community/post/${post.id}`)}
      className="bg-cream rounded-xl border border-taupe/15 hover:border-forest/25 hover:shadow-md hover:-translate-y-0.5 transition-all duration-300 overflow-hidden cursor-pointer"
    >
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
              {/* Author kebab menu */}
              {isAuthor && (
                <div className="relative shrink-0">
                  <button
                    onClick={(e) => { e.stopPropagation(); setShowPostMenu(!showPostMenu); }}
                    className="w-6 h-6 flex items-center justify-center rounded text-charcoal/30 hover:text-charcoal/60 hover:bg-taupe/10 transition-colors duration-200 cursor-pointer"
                    aria-label="Post options"
                  >
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                      <path d="M12 6a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 7.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3zm0 7.5a1.5 1.5 0 110-3 1.5 1.5 0 010 3z" />
                    </svg>
                  </button>
                  {showPostMenu && (
                    <>
                      <div className="fixed inset-0 z-40" onClick={() => setShowPostMenu(false)} />
                      <div className="absolute right-0 top-full mt-1 z-50 w-36 bg-bone rounded-xl border border-taupe/20 shadow-lg overflow-hidden" onClick={(e) => e.stopPropagation()}>
                        <button
                          onClick={() => { setIsEditing(true); setShowPostMenu(false); }}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-charcoal/70 hover:bg-cream transition-colors duration-200 cursor-pointer"
                        >
                          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
                          </svg>
                          Edit post
                        </button>
                        <button
                          onClick={handleDelete}
                          disabled={deletingPost}
                          className="w-full flex items-center gap-2.5 px-3 py-2.5 text-sm text-red-500/80 hover:bg-red-50 transition-colors duration-200 cursor-pointer disabled:opacity-50"
                        >
                          <svg className="w-3.5 h-3.5 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                          </svg>
                          {deletingPost ? "Deleting…" : "Delete post"}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>

            {isEditing ? (
              /* ── Inline edit form ── */
              <div className="mb-3" onClick={(e) => e.stopPropagation()}>
                <input
                  type="text"
                  value={editTitle}
                  onChange={(e) => setEditTitle(e.target.value)}
                  className="w-full h-10 px-3 rounded-lg bg-bone border border-taupe/30 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300 mb-2"
                />
                <textarea
                  value={editBody}
                  onChange={(e) => setEditBody(e.target.value)}
                  rows={3}
                  className="w-full px-3 py-2 rounded-lg bg-bone border border-taupe/30 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300 resize-none mb-2"
                />
                <div className="flex items-center justify-between">
                  <select
                    value={editTag}
                    onChange={(e) => setEditTag(e.target.value)}
                    className="h-8 px-2 rounded-lg bg-bone border border-taupe/30 text-xs text-charcoal/60 focus:border-forest/40 transition-all duration-300"
                  >
                    <option>General</option>
                    <option>Gear Talk</option>
                    <option>Guest Play</option>
                    <option>Events</option>
                  </select>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => setIsEditing(false)}
                      className="h-8 px-3 rounded-lg text-xs text-charcoal/50 hover:text-charcoal/70 border border-taupe/20 hover:border-taupe/40 transition-all duration-200 cursor-pointer"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={handleSaveEdit}
                      disabled={savingEdit || !editTitle.trim() || !editBody.trim()}
                      className={`h-8 px-4 rounded-lg text-xs font-medium tracking-wider uppercase transition-all duration-200 ${
                        savingEdit || !editTitle.trim() || !editBody.trim()
                          ? "bg-taupe/20 text-charcoal/30 cursor-not-allowed"
                          : "bg-forest text-bone hover:bg-forest-dark cursor-pointer"
                      }`}
                    >
                      {savingEdit ? "Saving…" : "Save"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <>
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

                {/* Videos */}
                {post.videos && post.videos.length > 0 && (
                  <div className={`mb-4 grid gap-2 ${post.videos.length === 1 ? "grid-cols-1" : "grid-cols-2"}`}>
                    {post.videos.map((src, i) => (
                      <div key={i} className="rounded-lg overflow-hidden bg-cream border border-taupe/15">
                        <video
                          src={src}
                          controls
                          className="w-full max-h-64 object-contain"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}

            {/* Actions */}
            <div className="flex items-center gap-5" onClick={(e) => e.stopPropagation()}>
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
                <span>{commentCount}</span>
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
        <div className="border-t border-taupe/15 bg-bone/50 animate-comment-reveal" onClick={(e) => e.stopPropagation()}>
          <div className="px-6 py-4 space-y-4">
            {commentsLoading && (
              <p className="text-sm text-charcoal/40">Loading comments…</p>
            )}
            {localComments.map((comment) => (
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
                  <div className="flex items-center gap-3 mt-1.5">
                    <button
                      onClick={() => requireAuth(() => toggleCommentLike(comment.id))}
                      className={`flex items-center gap-1 text-[11px] transition-colors duration-300 cursor-pointer ${
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
                    {user && user.uid === comment.authorId && (
                      <button
                        onClick={() => handleDeleteComment(comment.id)}
                        disabled={deletingCommentId === comment.id}
                        className="flex items-center gap-1 text-[11px] text-charcoal/30 hover:text-red-500 transition-colors duration-300 cursor-pointer disabled:opacity-50"
                      >
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                        </svg>
                        {deletingCommentId === comment.id ? "..." : "Delete"}
                      </button>
                    )}
                  </div>
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
                    onClick={handleReply}
                    className={`h-9 px-4 rounded-lg text-xs font-medium tracking-wider uppercase transition-all duration-300 ${
                      replyText.trim() && !submittingReply
                        ? "bg-forest text-bone hover:bg-forest-dark cursor-pointer"
                        : "bg-taupe/20 text-charcoal/30 cursor-not-allowed"
                    }`}
                    disabled={!replyText.trim() || submittingReply}
                  >
                    {submittingReply ? "…" : "Reply"}
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

/* ═══════════════════════════════════════════
   BENEFIT ICONS
   ═══════════════════════════════════════════ */

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

function CoachingBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M4.26 10.147a60.438 60.438 0 00-.491 6.347A48.62 48.62 0 0112 20.904a48.62 48.62 0 018.232-4.41 60.46 60.46 0 00-.491-6.347m-15.482 0a50.636 50.636 0 00-2.658-.813A59.906 59.906 0 0112 3.493a59.903 59.903 0 0110.399 5.84c-.896.248-1.783.52-2.658.814m-15.482 0A50.717 50.717 0 0112 13.489a50.702 50.702 0 017.74-3.342M6.75 15a.75.75 0 100-1.5.75.75 0 000 1.5zm0 0v-3.675A55.378 55.378 0 0112 8.443m-7.007 11.55A5.981 5.981 0 006.75 15.75v-1.5" />
    </svg>
  );
}

function TravelBenefitIcon() {
  return (
    <svg className="w-5 h-5 text-forest" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 21a9.004 9.004 0 008.716-6.747M12 21a9.004 9.004 0 01-8.716-6.747M12 21c2.485 0 4.5-4.03 4.5-9S14.485 3 12 3m0 18c-2.485 0-4.5-4.03-4.5-9S9.515 3 12 3m0 0a8.997 8.997 0 017.843 4.582M12 3a8.997 8.997 0 00-7.843 4.582m15.686 0A11.953 11.953 0 0112 10.5c-2.998 0-5.74-1.1-7.843-2.918m15.686 0A8.959 8.959 0 0121 12c0 .778-.099 1.533-.284 2.253m0 0A17.919 17.919 0 0112 16.5c-3.162 0-6.133-.815-8.716-2.247m0 0A9.015 9.015 0 013 12c0-1.605.42-3.113 1.157-4.418" />
    </svg>
  );
}
