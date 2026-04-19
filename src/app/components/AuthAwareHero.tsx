"use client";

import Link from "next/link";
import { useMembership } from "@/app/context/MembershipContext";
import { EmailCTA } from "./EmailCTA";

export function AuthAwareHero({ ctaText }: { ctaText?: string }) {
  const { isSignedIn, authLoading } = useMembership();

  // While auth is loading, show the default EmailCTA to avoid layout flash
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
  const { isSignedIn, authLoading } = useMembership();

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
