"use client";

import Link from "next/link";
import { useMembership } from "../context/MembershipContext";
import { ClubhouseNav, ClubhouseBottomNav } from "../components/ClubhouseNav";
import { SlideCart } from "../components/SlideCart";

/**
 * Community page navigation wrapper.
 * Shows ClubhouseNav for signed-in users, simple header for guests.
 * Also injects a <style> tag to set the correct top padding on main.
 */
export function CommunityNav() {
  const { isSignedIn, authLoading } = useMembership();

  // While auth is loading, show a minimal header to avoid layout shift
  if (authLoading) {
    return (
      <>
        <style>{`.community-main { padding-top: 7rem; }`}</style>
        <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20">
          <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16">
            <span className="flex items-center gap-2 text-forest">
              <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
              <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
            </span>
          </div>
        </header>
      </>
    );
  }

  if (isSignedIn) {
    return (
      <>
        <style>{`.community-main { padding-top: 12rem; }`}</style>
        <ClubhouseNav />
        <ClubhouseBottomNav />
        <SlideCart />
      </>
    );
  }

  // Guest header
  return (
    <>
      <style>{`.community-main { padding-top: 7rem; }`}</style>
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-between h-16">
          <Link href="/" className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
          </Link>
          <Link
            href="/onboarding"
            className="h-9 px-5 rounded-lg bg-forest text-bone text-xs font-medium tracking-wider uppercase hover:bg-forest-dark transition-colors duration-300 flex items-center btn-press"
          >
            Join Free
          </Link>
        </div>
      </header>
    </>
  );
}
