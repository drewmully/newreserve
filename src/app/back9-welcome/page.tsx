"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useMembership } from "@/app/context/MembershipContext";

/* ═══════════════════════════════════════════
   BACK 9 WELCOME — Landing page for legacy members
   logging in to the new platform for the first time.
   ═══════════════════════════════════════════ */

export default function Back9WelcomePage() {
  const router = useRouter();
  const {
    isSignedIn,
    authLoading,
    isLegacy,
    username,
    back9UX,
    markBack9WelcomeSeen,
  } = useMembership();

  // Guard: only legacy members with "landing" UX should be here
  useEffect(() => {
    if (authLoading) return;
    if (!isSignedIn || !isLegacy || back9UX !== "landing") {
      router.replace("/dashboard");
    }
  }, [authLoading, isSignedIn, isLegacy, back9UX, router]);

  async function handleUpgrade() {
    await markBack9WelcomeSeen();
    router.push("/dashboard?upgrade=1");
  }

  async function handleContinue() {
    await markBack9WelcomeSeen();
    router.push("/dashboard");
  }

  if (authLoading || !isLegacy || back9UX !== "landing") {
    return (
      <div className="min-h-screen bg-bone flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-forest border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  const greeting = username
    ? `Good to have you back, ${username}.`
    : "Good to have you back.";

  return (
    <main className="min-h-screen bg-bone flex flex-col">
      {/* Hero */}
      <div className="bg-forest px-6 pt-16 pb-12 text-center">
        <p className="text-xs font-medium tracking-widest text-sage uppercase mb-3">
          Back 9 Member
        </p>
        <h1 className="font-serif text-4xl text-bone leading-tight mb-3">
          {greeting}
        </h1>
        <p className="text-bone/70 text-base max-w-sm mx-auto">
          You were with us before much of this existed. We wanted to welcome
          you properly.
        </p>
      </div>

      {/* Content */}
      <div className="flex-1 max-w-lg mx-auto w-full px-6 py-10 space-y-8">
        {/* What you have */}
        <div className="bg-cream rounded-xl p-6 space-y-3">
          <p className="text-xs font-medium tracking-widest text-taupe uppercase">
            Your Back 9 membership includes
          </p>
          <ul className="space-y-2 text-charcoal text-sm">
            {[
              "Pro Shop with member discount applied",
              "Private Club Registry access",
              "Benefits portal",
              "Community access",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="text-forest font-bold mt-0.5">+</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        {/* What Reserve adds */}
        <div className="rounded-xl border border-forest/20 p-6 space-y-3">
          <p className="text-xs font-medium tracking-widest text-taupe uppercase">
            Reserve Member adds ($250/quarter)
          </p>
          <ul className="space-y-2 text-charcoal text-sm">
            {[
              "Quarterly curated box, AI-personalized to your game",
              "Box value consistently exceeds membership cost",
              "Priority concierge for tee times, travel, and gear",
              "First access on every limited drop",
            ].map((item) => (
              <li key={item} className="flex items-start gap-3">
                <span className="text-ember font-bold mt-0.5">+</span>
                {item}
              </li>
            ))}
          </ul>
        </div>

        <p className="text-xs text-taupe text-center leading-relaxed">
          Your Back 9 rate ($150/quarter) is grandfathered. We are not
          changing that. This is just what is available above it.
        </p>

        {/* CTAs */}
        <div className="flex flex-col gap-3 pt-2">
          <button
            onClick={() => void handleUpgrade()}
            className="w-full bg-forest text-bone rounded-xl py-4 text-sm font-medium hover:bg-forest/90 transition-colors"
          >
            Upgrade to Reserve Member
          </button>
          <button
            onClick={() => void handleContinue()}
            className="w-full text-charcoal text-sm hover:text-obsidian transition-colors py-3 rounded-xl"
          >
            Continue to Dashboard
          </button>
        </div>
      </div>
    </main>
  );
}
