"use client";

import { useContext } from "react";
import Link from "next/link";
import { MembershipContext } from "@/app/context/MembershipContext";
import { EmailCTA } from "./EmailCTA";

/**
 * Safely reads the MembershipContext. Returns null when rendered outside
 * MembershipProvider (e.g., the homepage, which is exempt from the provider).
 */
function useAuthState() {
  const ctx = useContext(MembershipContext);
  if (!ctx) return { isSignedIn: false, authLoading: false };
  return { isSignedIn: ctx.isSignedIn, authLoading: ctx.authLoading };
}

export function AuthAwareHero({ ctaText }: { ctaText?: string }) {
  const { isSignedIn, authLoading } = useAuthState();

  // No provider, loading, or not signed in — show default EmailCTA
  if (authLoading || !isSignedIn) {
    return <EmailCTA variant="hero" ctaText={ctaText} />;
  }

  // Logged-in user: show dashboard CTA
  return (
    <Link
      href="/home"
      className="inline-flex items-center justify-center h-12 px-10 rounded-lg text-white text-sm font-semibold tracking-wider uppercase shadow-lg hover:brightness-110 transition-all duration-300 btn-press"
      style={{ background: "#D4772C" }}
    >
      Go to Your Dashboard
    </Link>
  );
}

export function AuthAwareBottomCTA() {
  const { isSignedIn, authLoading } = useAuthState();

  if (authLoading || !isSignedIn) {
    return <EmailCTA variant="bottom" />;
  }

  return (
    <Link
      href="/home"
      className="block w-full text-center h-13 leading-[3.25rem] rounded-xl text-white text-sm font-semibold tracking-wider uppercase shadow-lg hover:brightness-110 transition-all duration-300 btn-press"
      style={{ background: "#D4772C" }}
    >
      Go to Your Dashboard
    </Link>
  );
}
