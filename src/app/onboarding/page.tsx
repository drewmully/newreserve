"use client";

import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";
import { useMembership } from "../context/MembershipContext";
import { sendOTPEmail } from "@/lib/firebase";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { PENDING_ONBOARDING_EMAIL_KEY } from "../components/EmailCTA";
import {
  FIT_SHIRT_SIZES, FIT_GLOVE_HANDS, FIT_GLOVE_SIZES,
  FIT_WAIST_SIZES, FIT_SHOE_SIZES, FIT_PANTS_INSEAMS, FIT_SHORTS_INSEAMS,
  FitDots, FitNav, PillButton,
} from "../components/UpgradeModal";

const PENDING_ONBOARDING_DATA_KEY = "pending_onboarding_data";

/* ─── A/B bucket reader (mirrors mr_ab cookie from middleware) ─── */
function getABBucket(): number {
  if (typeof document === "undefined") return 0;
  const match = document.cookie.match(/(?:^|; )mr_ab=(\d+)/);
  return match ? parseInt(match[1], 10) : 0;
}

/* Onboarding variant maps — keyed by bucket ranges */
const OB_VARIANTS = {
  planHeadline: {
    control: "Choose your membership.",
    variantA: "Your membership is ready.",
  },
  planSubtext: {
    control: "Start free or unlock the full Reserve experience. Upgrade anytime.",
    variantA: "Every tier includes Reserve pricing. Pick the level that fits your game.",
  },
} as const;

function getOnboardingVariant(key: keyof typeof OB_VARIANTS, bucket: number): string {
  const v = OB_VARIANTS[key];
  return bucket < 50 ? v.control : v.variantA;
}

/* ═══════════════════════════════════════════
   ONBOARDING — Preferences → Plan Selection
   ═══════════════════════════════════════════ */

const HANDICAP_OPTIONS = [
  "Scratch or better",
  "1 to 5",
  "6 to 10",
  "11 to 15",
  "16 to 20",
  "21 to 30",
  "30+",
  "I don't keep one",
];

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const VIBE_OPTIONS = [
  {
    id: "polite",
    label: "Ask them to stop",
    subtitle: "Respect the game.",
    icon: HandIcon,
  },
  {
    id: "turn-up",
    label: "Turn it up",
    subtitle: "Golf is supposed to be fun.",
    icon: MusicIcon,
  },
  {
    id: "move",
    label: "Switch holes",
    subtitle: "Not my problem to solve.",
    icon: WalkIcon,
  },
  {
    id: "depends",
    label: "Depends on the song",
    subtitle: "Taste matters.",
    icon: HeadphonesIcon,
  },
];

function suggestUsernames(email: string): string[] {
  const local = email.split("@")[0]?.toLowerCase().replace(/[^a-z0-9._-]/g, "") || "";
  if (!local) return [];
  const parts = local.split(/[._\-+]+/).filter(Boolean);
  const suggestions: string[] = [];
  if (parts.length >= 2) {
    const [first, last] = [parts[0], parts[parts.length - 1]];
    suggestions.push(`${first}_${last[0]}`);
    suggestions.push(`${first}${last}`);
    suggestions.push(`${first[0]}_${last}`);
    suggestions.push(`${first}${last[0]}`);
  } else if (local.length > 0) {
    const base = parts[0].replace(/\d+$/, "");
    if (base) suggestions.push(base);
    suggestions.push(local);
    if (base && base.length > 3) suggestions.push(`${base}_golf`);
  }
  return [...new Set(suggestions)].filter((s) => s.length >= 2).slice(0, 4);
}

function daysInMonth(month: number, year: number): number {
  if (!month || !year) return 31;
  return new Date(year, month, 0).getDate();
}

export default function OnboardingPage() {
  const router = useRouter();
  const {
    email: contextEmail,
    setEmail,
    username,
    setUsername,
    setTier,
    completeOnboarding,
    authLoading,
    isSignedIn,
    onboardingCompleted,
  } = useMembership();

  // Pre-auth mode: user came from home page without being logged in
  const [preAuthEmail, setPreAuthEmail] = useState<string>(() => {
    if (typeof window === "undefined") return "";
    try { return sessionStorage.getItem(PENDING_ONBOARDING_EMAIL_KEY) ?? ""; } catch { return ""; }
  });
  const isPreAuth = !isSignedIn && !!preAuthEmail;
  const email = isPreAuth ? preAuthEmail : contextEmail;

  // "Check your email" screen after magic link sent in pre-auth mode
  const [magicLinkSent, setMagicLinkSent] = useState(false);
  const [sendingLink, setSendingLink] = useState(false);
  const [sendLinkError, setSendLinkError] = useState<string | null>(null);

  // Sync pre-auth email to context so login page picks it up
  useEffect(() => {
    if (isPreAuth && preAuthEmail) setEmail(preAuthEmail);
  }, [isPreAuth, preAuthEmail, setEmail]);

  // Post-auth guard: if not signed in AND not pre-auth mode, redirect to login
  useEffect(() => {
    if (!authLoading && !isSignedIn && !isPreAuth) {
      router.replace("/login");
    }
  }, [authLoading, isSignedIn, isPreAuth, router]);

  // If signed in, clear leftover pre-auth keys and redirect if onboarding is done
  useEffect(() => {
    if (!authLoading && isSignedIn) {
      // Clear any leftover pre-auth keys
      try {
        sessionStorage.removeItem(PENDING_ONBOARDING_EMAIL_KEY);
      } catch {}
      // Redirect away if the user already completed onboarding
      if (onboardingCompleted) {
        router.replace("/home");
      }
    }
  }, [authLoading, isSignedIn, onboardingCompleted, router]);

  async function handleComplete(newTier: "free" | "access" | "member") {
    const nextFitProfile = {
      shirtSize,
      gloveHand,
      gloveSize,
      waistSize,
      pantsInseam,
      shortsInseam,
      shoeSize,
    };

    const onboardingData = {
      username,
      onboardingProfile: {
        birthMonth,
        birthDay,
        birthYear,
        handicap,
        privateClub,
        clubName: privateClub === true ? clubName : "",
        vibeCheck,
        selectedTier: newTier,
      },
      fitProfile: newTier === "member" ? nextFitProfile : undefined,
    };

    if (isPreAuth) {
      // Save data to localStorage (persists across tabs — needed when magic link opens in new tab)
      try {
        localStorage.setItem(
          PENDING_ONBOARDING_DATA_KEY,
          JSON.stringify({ ...onboardingData, selectedTier: newTier })
        );
      } catch {}

      setSendingLink(true);
      setSendLinkError(null);

      if (newTier === "access" || newTier === "member") {
        // Paid flow: go directly to Shopify checkout — magic link sent after payment via webhook
        // Pre-set emailForSignIn so the login page can auto-confirm when the magic link is clicked
        try { localStorage.setItem("emailForSignIn", preAuthEmail); } catch {}
        try {
          await createMembershipCheckout(newTier);
        } catch (err) {
          setSendLinkError("Couldn't start checkout. Please try again.");
          console.error("[Onboarding] createMembershipCheckout failed:", err);
          setSendingLink(false);
        }
        return;
      }

      // Free flow: send magic link now
      try {
        await sendOTPEmail(preAuthEmail);
        setMagicLinkSent(true);
      } catch (err) {
        setSendLinkError("Couldn't send the link. Please try again.");
        console.error("[Onboarding] sendOTPEmail failed:", err);
      } finally {
        setSendingLink(false);
      }
      return;
    }

    // Post-auth mode: save directly
    await completeOnboarding(onboardingData);
    if (newTier === "access" || newTier === "member") {
      // Paid tier — redirect to Shopify checkout; the orders-paid webhook
      // sets the tier in Firestore after payment is confirmed.
      await createMembershipCheckout(newTier);
    } else {
      // Free tier — go straight to dashboard
      setTier(newTier);
      router.push("/home");
    }
  }
  const [step, setStep] = useState(1);
  const abBucket = typeof window !== "undefined" ? getABBucket() : 0;

  // Register onboarding A/B variants with PostHog for conversion analysis
  const obVariants = useMemo(() => ({
    "ob-plan-headline": abBucket < 50 ? "control" : "variant-a",
    "ob-plan-subtext": abBucket < 50 ? "control" : "variant-a",
  }), [abBucket]);

  useEffect(() => {
    try {
      const ph = require("posthog-js").default;
      if (ph?.__loaded) ph.register(obVariants);
    } catch {}
  }, [obVariants]);

  // Sub-step within step 1 (1 = basics, 2 = your game, 3 = vibe check)
  const [substep, setSubstep] = useState(1);
  const [direction, setDirection] = useState<"forward" | "back">("forward");

  // Step 1a state
  const [editingEmail, setEditingEmail] = useState(false);
  const usernameSuggestions = suggestUsernames(email);
  const [birthMonth, setBirthMonth] = useState("");
  const [birthDay, setBirthDay] = useState("");
  const [birthYear, setBirthYear] = useState("");

  // Step 1b state
  const [handicap, setHandicap] = useState("");
  const [privateClub, setPrivateClub] = useState<boolean | null>(null);
  const [clubName, setClubName] = useState("");

  // Step 1c state
  const [vibeCheck, setVibeCheck] = useState("");

  // Step 3: Fit profile (only if Reserve Member)
  const [fitStep, setFitStep] = useState(1); // 1 = tops, 2 = bottoms
  const [shirtSize, setShirtSize] = useState("");
  const [gloveHand, setGloveHand] = useState("");
  const [gloveSize, setGloveSize] = useState("");
  const [waistSize, setWaistSize] = useState("");
  const [shoeSize, setShoeSize] = useState("");
  const [pantsInseam, setPantsInseam] = useState("");
  const [shortsInseam, setShortsInseam] = useState("");

  const canAdvance1a = email && username && birthMonth && birthDay && birthYear;

  const maxDays = daysInMonth(Number(birthMonth), Number(birthYear));
  const currentYear = new Date().getFullYear();

  function goForward() {
    if (substep < 3) {
      setDirection("forward");
      setSubstep((s) => s + 1);
    } else {
      setStep(2);
    }
  }

  function goBack() {
    if (substep > 1) {
      setDirection("back");
      setSubstep((s) => s - 1);
    }
  }

  const animClass = direction === "forward" ? "animate-substep-in" : "animate-substep-back-in";

  // ── Magic link sent screen ──────────────────────────────────────────────────
  if (magicLinkSent) {
    return (
      <div className="min-h-screen bg-bone flex flex-col items-center justify-center px-6">
        <div className="w-full max-w-sm text-center">
          <div className="w-12 h-12 rounded-2xl bg-forest/8 flex items-center justify-center mx-auto mb-6">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto text-forest" aria-hidden="true">
              <path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" />
            </svg>
          </div>
          <h1 className="font-serif text-2xl text-obsidian mb-2">Check your email</h1>
          <p className="text-sm text-charcoal/50 leading-relaxed mb-6">
            We sent a sign-in link to{" "}
            <strong className="text-obsidian font-medium">{preAuthEmail}</strong>.
            Click it to confirm your account and complete your membership.
          </p>
          <div className="rounded-xl bg-cream border border-taupe/15 px-5 py-4 text-sm text-charcoal/55 leading-relaxed mb-6">
            The link expires after 1 hour. Check your spam folder if you don&apos;t see it.
          </div>
          <button
            onClick={() => {
              setSendingLink(true);
              setSendLinkError(null);
              sendOTPEmail(preAuthEmail)
                .then(() => setSendLinkError(null))
                .catch(() => setSendLinkError("Couldn't resend. Please try again."))
                .finally(() => setSendingLink(false));
            }}
            disabled={sendingLink}
            className="text-sm text-forest hover:underline disabled:opacity-50"
          >
            {sendingLink ? "Sending…" : "Resend link"}
          </button>
          {sendLinkError && (
            <p className="text-xs text-ember mt-3">{sendLinkError}</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-bone">
      {/* Header */}
      <header className="fixed top-0 left-0 right-0 z-50 bg-bone/90 backdrop-blur-md border-b border-taupe/20">
        <div className="max-w-7xl mx-auto px-6 md:px-12 flex items-center justify-center h-16">
          <span className="flex items-center gap-2 text-forest">
            <svg viewBox="0 0 1002 540" fill="currentColor" className="h-5 w-auto" aria-hidden="true"><path d="M0,0 H1002 V540 H0 Z M50,1 L998,269 L50,538 Z" fillRule="evenodd" /></svg>
            <span className="font-serif text-2xl font-bold tracking-wide">mully.</span>
          </span>
        </div>
      </header>

      <main className="pt-28 pb-24 px-6 md:px-12">
        <div className="max-w-2xl mx-auto">
          {/* Top progress */}
          <div className="flex items-center gap-3 mb-10">
            <div className={`h-1 flex-1 rounded-full transition-colors duration-500 ${step >= 1 ? "bg-forest" : "bg-taupe/25"}`} />
            <div className={`h-1 flex-1 rounded-full transition-colors duration-500 ${step >= 2 ? "bg-forest" : "bg-taupe/25"}`} />
            {step >= 3 && (
              <div className="h-1 flex-1 rounded-full transition-colors duration-500 bg-forest" />
            )}
          </div>

          {/* ════════════════════════════════════════
             STEP 1: THE FITTING (3 sub-steps)
             ════════════════════════════════════════ */}
          {step === 1 && (
            <>
              {/* Sub-step dots */}
              <div className="flex items-center justify-center gap-0 mb-10">
                {[1, 2, 3].map((dot) => (
                  <div key={dot} className="flex items-center">
                    <div
                      className={`w-2.5 h-2.5 rounded-full transition-all duration-500 ${
                        substep >= dot ? "bg-forest scale-100" : "bg-taupe/30 scale-90"
                      }`}
                    />
                    {dot < 3 && (
                      <div className="w-10 h-px mx-1">
                        <div
                          className={`h-full rounded-full transition-all duration-500 ${
                            substep > dot ? "bg-forest" : "bg-taupe/20"
                          }`}
                        />
                      </div>
                    )}
                  </div>
                ))}
              </div>

              {/* ── Sub-step 1a: The Basics ── */}
              {substep === 1 && (
                <div key="substep-1" className={animClass}>
                  <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-4">
                    <span className="w-6 h-px bg-sage/50" />
                    The Basics
                    <span className="w-6 h-px bg-sage/50" />
                  </span>
                  <h1 className="font-serif text-3xl md:text-4xl text-obsidian leading-tight mb-3">
                    Let&rsquo;s get started.
                  </h1>
                  <p className="text-base text-charcoal/55 leading-relaxed mb-10">
                    The essentials, so we know who we&rsquo;re talking to.
                  </p>

                  {/* Email */}
                  <div className="mb-8">
                    <h3 className="text-sm font-medium text-obsidian tracking-wide mb-4">
                      Your email
                    </h3>
                    {email && !editingEmail ? (
                      <div className="flex items-center gap-3 max-w-sm">
                        <div className="flex-1 h-11 px-4 rounded-xl bg-taupe/10 border border-taupe/15 flex items-center">
                          <span className="text-sm text-charcoal/50">{email}</span>
                        </div>
                        {isPreAuth && (
                          <button
                            onClick={() => setEditingEmail(true)}
                            className="text-xs text-charcoal/40 hover:text-forest transition-colors duration-300 cursor-pointer whitespace-nowrap"
                          >
                            Edit
                          </button>
                        )}
                      </div>
                    ) : (
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        onBlur={() => email && setEditingEmail(false)}
                        placeholder="you@example.com"
                        autoFocus={editingEmail}
                        className="w-full max-w-sm h-11 px-4 rounded-xl bg-cream border border-taupe/25 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                      />
                    )}
                  </div>

                  {/* Username */}
                  <div className="mb-10">
                    <h3 className="text-sm font-medium text-obsidian tracking-wide mb-2">
                      Choose a username
                    </h3>
                    <p className="text-xs text-charcoal/40 mb-4">This is how you&rsquo;ll appear in the community.</p>
                    <input
                      type="text"
                      value={username}
                      onChange={(e) => setUsername(e.target.value)}
                      placeholder="e.g. jack_m"
                      className="w-full max-w-sm h-11 px-4 rounded-xl bg-cream border border-taupe/25 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                    />
                    {usernameSuggestions.length > 0 && (
                      <div className="flex flex-wrap gap-2 mt-3">
                        {usernameSuggestions.map((s) => (
                          <button
                            key={s}
                            type="button"
                            onClick={() => setUsername(s)}
                            className={`px-3 py-1.5 rounded-lg text-xs transition-all duration-200 cursor-pointer ${
                              username === s
                                ? "bg-forest text-bone"
                                : "bg-taupe/10 text-charcoal/55 hover:bg-taupe/20 border border-taupe/15"
                            }`}
                          >
                            {s}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>

                  {/* Birthdate */}
                  <div className="mb-12">
                    <h3 className="text-sm font-medium text-obsidian tracking-wide mb-4">
                      Date of birth
                    </h3>
                    <div className="flex gap-3 max-w-sm">
                      <div className="flex-[2]">
                        <select
                          value={birthMonth}
                          onChange={(e) => setBirthMonth(e.target.value)}
                          className={`w-full h-11 px-3 rounded-xl bg-cream border border-taupe/25 text-sm transition-all duration-300 cursor-pointer focus:border-forest/40 focus:ring-2 focus:ring-forest/10 appearance-none ${
                            birthMonth ? "text-obsidian" : "text-charcoal/30"
                          }`}
                          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}
                        >
                          <option value="" disabled>Month</option>
                          {MONTHS.map((m, i) => (
                            <option key={m} value={String(i + 1)}>{m}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex-[1]">
                        <select
                          value={birthDay}
                          onChange={(e) => setBirthDay(e.target.value)}
                          className={`w-full h-11 px-3 rounded-xl bg-cream border border-taupe/25 text-sm transition-all duration-300 cursor-pointer focus:border-forest/40 focus:ring-2 focus:ring-forest/10 appearance-none ${
                            birthDay ? "text-obsidian" : "text-charcoal/30"
                          }`}
                          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}
                        >
                          <option value="" disabled>Day</option>
                          {Array.from({ length: maxDays }, (_, i) => i + 1).map((d) => (
                            <option key={d} value={String(d)}>{d}</option>
                          ))}
                        </select>
                      </div>
                      <div className="flex-[1.2]">
                        <select
                          value={birthYear}
                          onChange={(e) => setBirthYear(e.target.value)}
                          className={`w-full h-11 px-3 rounded-xl bg-cream border border-taupe/25 text-sm transition-all duration-300 cursor-pointer focus:border-forest/40 focus:ring-2 focus:ring-forest/10 appearance-none ${
                            birthYear ? "text-obsidian" : "text-charcoal/30"
                          }`}
                          style={{ backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='12' height='12' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`, backgroundRepeat: "no-repeat", backgroundPosition: "right 12px center" }}
                        >
                          <option value="" disabled>Year</option>
                          {Array.from({ length: 80 }, (_, i) => currentYear - 13 - i).map((y) => (
                            <option key={y} value={String(y)}>{y}</option>
                          ))}
                        </select>
                      </div>
                    </div>
                  </div>

                  {/* Continue */}
                  <div className="flex items-center justify-end">
                    <button
                      onClick={goForward}
                      disabled={!canAdvance1a}
                      className={`h-12 px-10 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 cursor-pointer btn-press ${
                        canAdvance1a
                          ? "bg-forest text-bone hover:bg-forest-dark"
                          : "bg-taupe/25 text-charcoal/30 cursor-not-allowed"
                      }`}
                    >
                      Continue
                    </button>
                  </div>
                </div>
              )}

              {/* ── Sub-step 1b: Your Game ── */}
              {substep === 2 && (
                <div key="substep-2" className={animClass}>
                  <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-4">
                    <span className="w-6 h-px bg-sage/50" />
                    Your Game
                    <span className="w-6 h-px bg-sage/50" />
                  </span>
                  <h1 className="font-serif text-3xl md:text-4xl text-obsidian leading-tight mb-3">
                    Tell us about your game.
                  </h1>
                  <p className="text-base text-charcoal/55 leading-relaxed mb-10">
                    Optional, but it helps us curate better.
                  </p>

                  {/* Handicap */}
                  <div className="mb-10">
                    <h3 className="text-sm font-medium text-obsidian tracking-wide mb-4">
                      What&rsquo;s your handicap?
                    </h3>
                    <div className="flex flex-wrap gap-2">
                      {HANDICAP_OPTIONS.map((opt) => (
                        <button
                          key={opt}
                          onClick={() => setHandicap(handicap === opt ? "" : opt)}
                          className={`px-4 py-2.5 rounded-xl text-sm transition-all duration-300 cursor-pointer border ${
                            handicap === opt
                              ? "bg-forest text-bone border-forest"
                              : "bg-cream border-taupe/25 text-charcoal/70 hover:border-forest/40"
                          }`}
                        >
                          {opt}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Private Club */}
                  <div className="mb-12">
                    <h3 className="text-sm font-medium text-obsidian tracking-wide mb-4">
                      Are you a member at a private club?
                    </h3>
                    <div className="flex gap-3">
                      <button
                        onClick={() => setPrivateClub(privateClub === true ? null : true)}
                        className={`px-6 py-2.5 rounded-xl text-sm transition-all duration-300 cursor-pointer border ${
                          privateClub === true
                            ? "bg-forest text-bone border-forest"
                            : "bg-cream border-taupe/25 text-charcoal/70 hover:border-forest/40"
                        }`}
                      >
                        Yes
                      </button>
                      <button
                        onClick={() => { setPrivateClub(privateClub === false ? null : false); setClubName(""); }}
                        className={`px-6 py-2.5 rounded-xl text-sm transition-all duration-300 cursor-pointer border ${
                          privateClub === false
                            ? "bg-forest text-bone border-forest"
                            : "bg-cream border-taupe/25 text-charcoal/70 hover:border-forest/40"
                        }`}
                      >
                        No
                      </button>
                    </div>
                    <div className="club-reveal mt-4" data-open={privateClub === true ? "true" : "false"}>
                      <input
                        type="text"
                        value={clubName}
                        onChange={(e) => setClubName(e.target.value)}
                        placeholder="Club name"
                        className="w-full max-w-sm h-11 px-4 rounded-xl bg-cream border border-taupe/25 text-obsidian text-sm placeholder:text-charcoal/30 focus:border-forest/40 focus:ring-2 focus:ring-forest/10 transition-all duration-300"
                      />
                    </div>
                  </div>

                  {/* Navigation */}
                  <div className="flex items-center justify-between">
                    <button
                      onClick={goBack}
                      className="text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer flex items-center gap-1.5"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                      </svg>
                      Back
                    </button>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={goForward}
                        className="text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer"
                      >
                        Skip
                      </button>
                      <button
                        onClick={goForward}
                        className="h-12 px-10 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 cursor-pointer btn-press bg-forest text-bone hover:bg-forest-dark"
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* ── Sub-step 1c: The Vibe Check ── */}
              {substep === 3 && (
                <div key="substep-3" className={animClass}>
                  <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-4">
                    <span className="w-6 h-px bg-sage/50" />
                    Vibe Check
                    <span className="w-6 h-px bg-sage/50" />
                  </span>
                  <h1 className="font-serif text-3xl md:text-4xl text-obsidian leading-tight mb-3">
                    One more thing.
                  </h1>
                  <p className="text-base text-charcoal/55 leading-relaxed mb-10">
                    A quick vibe check. Just for fun.
                  </p>

                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-obsidian tracking-wide mb-6 leading-relaxed">
                      Someone in the cart next to you starts playing music on the first tee. What&rsquo;s your move?
                    </h3>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 vibe-card-stagger">
                      {VIBE_OPTIONS.map(({ id, label, subtitle, icon: Icon }) => {
                        const active = vibeCheck === id;
                        return (
                          <button
                            key={id}
                            onClick={() => setVibeCheck(vibeCheck === id ? "" : id)}
                            className={`animate-fade-up opacity-0 flex flex-col items-start p-5 rounded-2xl text-left transition-all duration-300 cursor-pointer border group/card ${
                              active
                                ? "bg-forest text-bone border-forest shadow-lg shadow-forest/15"
                                : "bg-cream border-taupe/25 text-charcoal/70 hover:border-forest/30 hover:shadow-md hover:shadow-forest/5 hover:-translate-y-0.5"
                            }`}
                          >
                            <div className={`mb-3 transition-colors duration-300 ${active ? "text-sage/70" : "text-sage"}`}>
                              <Icon />
                            </div>
                            <span className={`font-medium text-sm mb-1 ${active ? "text-bone" : "text-obsidian"}`}>
                              {label}
                            </span>
                            <span className={`text-xs leading-relaxed ${active ? "text-bone/55" : "text-charcoal/45"}`}>
                              {subtitle}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Navigation */}
                  <div className="flex items-center justify-between mt-10">
                    <button
                      onClick={goBack}
                      className="text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer flex items-center gap-1.5"
                    >
                      <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                      </svg>
                      Back
                    </button>
                    <div className="flex items-center gap-4">
                      <button
                        onClick={goForward}
                        className="text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer"
                      >
                        Skip
                      </button>
                      <button
                        onClick={goForward}
                        className="h-12 px-10 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 cursor-pointer btn-press bg-forest text-bone hover:bg-forest-dark"
                      >
                        Continue
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}

          {/* ════════════════════════════════════════
             STEP 2: Plan Selection (unchanged)
             ════════════════════════════════════════ */}
          {step === 2 && (
            <div className="animate-fade-up">
              <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-4">
                <span className="w-6 h-px bg-sage/50" />
                Step 2 of 2
                <span className="w-6 h-px bg-sage/50" />
              </span>
              <h1 className="font-serif text-3xl md:text-4xl text-obsidian leading-tight mb-3">
                {getOnboardingVariant("planHeadline", abBucket)}
              </h1>
              <p className="text-base text-charcoal/55 leading-relaxed mb-10">
                {getOnboardingVariant("planSubtext", abBucket)}
              </p>

              <div className="space-y-5">
                {/* Reserve Access */}
                <div className="bg-cream rounded-2xl p-7 md:p-8 border border-taupe/20">
                  <span className="text-[11px] tracking-[0.25em] uppercase text-forest font-medium">
                    Reserve Access
                  </span>
                  <div className="mt-2 mb-5">
                    <span className="font-serif text-3xl text-obsidian">$99</span>
                    <span className="text-charcoal/40 text-sm ml-1">/year</span>
                  </div>
                  <div className="border-t border-taupe/12 pt-5">
                    <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5 mb-6">
                      <FeatureItem text="Reserve pricing unlocked" />
                      <FeatureItem text="Early access to drops" />
                      <FeatureItem text="USGA Handicap (coming soon)" />
                      <FeatureItem text="Partner benefit access" />
                      <FeatureItem text="Free 2-day shipping" />
                    </ul>
                    <button
                      onClick={() => handleComplete("access")}
                      className="h-12 px-10 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-all duration-300 cursor-pointer btn-press"
                    >
                      Join Reserve Access
                    </button>
                  </div>
                </div>

                {/* Reserve Member (Featured) */}
                <div className="relative">
                  <div className="absolute -top-3 left-7 z-20">
                    <span className="inline-block bg-sage text-bone text-[10px] tracking-[0.2em] uppercase font-semibold px-4 py-1.5 rounded-full shadow-sm">
                      Most Popular
                    </span>
                  </div>
                  <div className="bg-forest rounded-2xl overflow-hidden relative shadow-xl shadow-forest/20 ring-1 ring-sage/20">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src="https://cdn.shopify.com/s/files/1/0561/0530/4256/files/Untitled_design_17.png?v=1771516197"
                      alt=""
                      aria-hidden="true"
                      draggable={false}
                      className="absolute -top-4 -left-4 w-44 h-44 object-cover object-right-bottom opacity-[0.18] -rotate-6 pointer-events-none select-none"
                    />
                    <div className="relative z-10 p-7 md:p-8">
                      <span className="text-[11px] tracking-[0.25em] uppercase text-sage font-medium">
                        Reserve Member
                      </span>
                      <div className="mt-2 mb-5">
                        <span className="font-serif text-3xl text-bone">$249</span>
                        <span className="text-bone/45 text-sm ml-1">/quarter</span>
                      </div>
                      <div className="border-t border-bone/10 pt-5">
                        <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5 mb-6">
                          <FeatureItem text="Everything in Access" light />
                          <FeatureItem text="Guaranteed access windows" light />
                          <FeatureItem text="Priority release access" light />
                          <FeatureItem text="Concierge booking support" light />
                          <FeatureItem text="Invite-only events" light />
                        </ul>
                        <button
                          onClick={() => { setFitStep(1); setStep(3); }}
                          className="h-12 px-10 rounded-xl bg-bone text-forest text-sm font-medium tracking-wider uppercase hover:bg-bone-dark transition-all duration-300 cursor-pointer btn-press"
                        >
                          Join Reserve Member
                        </button>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Reserve Black */}
                <div className="bg-cream rounded-2xl p-7 md:p-8 border border-taupe/20 relative overflow-hidden">
                  <div className="absolute top-0 left-0 right-0 h-1 bg-obsidian" />
                  <span className="text-[11px] tracking-[0.25em] uppercase text-charcoal/50 font-medium">
                    Reserve Black
                  </span>
                  <div className="mt-2 mb-5">
                    <span className="font-serif text-3xl text-obsidian">Invite Only</span>
                  </div>
                  <div className="border-t border-taupe/12 pt-5">
                    <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5 mb-6">
                      <FeatureItem text="Everything in Member" />
                      <FeatureItem text="$1,000 quarterly credit" />
                      <FeatureItem text="Personal stylist" />
                      <FeatureItem text="Concierge phone line" />
                      <FeatureItem text="Invite-only experiences" />
                    </ul>
                    <div className="inline-block h-12 px-10 leading-[3rem] rounded-xl border border-charcoal/15 text-charcoal/40 text-sm font-medium tracking-wider uppercase cursor-default">
                      By Invitation
                    </div>
                  </div>
                </div>
              </div>

              {/* Reassurance */}
              <p className="text-center text-sm text-charcoal/40 mt-8">
                Start free. Upgrade or cancel anytime. No commitments.
              </p>

              {/* Start Free */}
              <div className="mt-4 text-center">
                <button
                  onClick={() => handleComplete("free")}
                  className="text-sm text-charcoal/40 hover:text-charcoal/60 underline underline-offset-4 decoration-charcoal/20 hover:decoration-charcoal/40 transition-all duration-300 cursor-pointer"
                >
                  Or start free
                </button>
              </div>

              {/* Back */}
              <div className="mt-8">
                <button
                  onClick={() => setStep(1)}
                  className="text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer flex items-center gap-1.5"
                >
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
                  </svg>
                  Back to preferences
                </button>
              </div>
            </div>
          )}

          {/* ════════════════════════════════════════
             STEP 3: FIT PROFILE (Reserve Member only)
             ════════════════════════════════════════ */}
          {step === 3 && (
            <>
              {/* Fit 1/2: Tops & Glove */}
              {fitStep === 1 && (
                <div className="animate-substep-in">
                  <FitDots current={1} />

                  <h1 className="font-serif text-3xl md:text-4xl text-obsidian leading-tight mb-2">
                    Tops &amp; glove.
                  </h1>
                  <p className="text-sm text-charcoal/45 mb-10">
                    So we can get your fit right from day one.
                  </p>

                  {/* Shirt */}
                  <div className="mb-8">
                    <h3 className="text-sm font-medium text-obsidian mb-3">Shirt size</h3>
                    <div className="flex flex-wrap gap-2">
                      {FIT_SHIRT_SIZES.map((s) => (
                        <PillButton key={s} label={s} active={shirtSize === s} onClick={() => setShirtSize(shirtSize === s ? "" : s)} />
                      ))}
                    </div>
                  </div>

                  {/* Glove */}
                  <div className="mb-10">
                    <h3 className="text-sm font-medium text-obsidian mb-3">Glove</h3>
                    <div className="flex flex-wrap gap-2 mb-3">
                      {FIT_GLOVE_HANDS.map((h) => (
                        <PillButton key={h} label={h} active={gloveHand === h} onClick={() => setGloveHand(gloveHand === h ? "" : h)} />
                      ))}
                    </div>
                    {gloveHand && (
                      <div className="flex flex-wrap gap-2 animate-fade-up">
                        {FIT_GLOVE_SIZES.map((s) => (
                          <PillButton key={s} label={s} active={gloveSize === s} onClick={() => setGloveSize(gloveSize === s ? "" : s)} />
                        ))}
                      </div>
                    )}
                  </div>

                  <FitNav
                    onBack={() => setStep(2)}
                    onSkip={() => handleComplete("member")}
                    onNext={() => setFitStep(2)}
                  />
                </div>
              )}

              {/* Fit 2/2: Bottoms & Shoes */}
              {fitStep === 2 && (
                <div className="animate-substep-in">
                  <FitDots current={2} />

                  <h1 className="font-serif text-3xl md:text-4xl text-obsidian leading-tight mb-2">
                    Bottoms &amp; shoes.
                  </h1>
                  <p className="text-sm text-charcoal/45 mb-10">
                    Almost there. Just a few more to lock in your profile.
                  </p>

                  {/* Waist */}
                  <div className="mb-8">
                    <h3 className="text-sm font-medium text-obsidian mb-3">Waist</h3>
                    <div className="flex flex-wrap gap-2">
                      {FIT_WAIST_SIZES.map((s) => (
                        <PillButton key={s} label={s} active={waistSize === s} onClick={() => setWaistSize(waistSize === s ? "" : s)} />
                      ))}
                    </div>
                  </div>

                  {/* Pants Inseam */}
                  <div className="mb-8">
                    <h3 className="text-sm font-medium text-obsidian mb-3">Pants inseam</h3>
                    <div className="flex flex-wrap gap-2">
                      {FIT_PANTS_INSEAMS.map((s) => (
                        <PillButton key={s} label={s} active={pantsInseam === s} onClick={() => setPantsInseam(pantsInseam === s ? "" : s)} />
                      ))}
                    </div>
                  </div>

                  {/* Shorts Inseam */}
                  <div className="mb-8">
                    <h3 className="text-sm font-medium text-obsidian mb-3">Shorts inseam</h3>
                    <div className="flex flex-wrap gap-2">
                      {FIT_SHORTS_INSEAMS.map((s) => (
                        <PillButton key={s} label={s} active={shortsInseam === s} onClick={() => setShortsInseam(shortsInseam === s ? "" : s)} />
                      ))}
                    </div>
                  </div>

                  {/* Shoe */}
                  <div className="mb-10">
                    <h3 className="text-sm font-medium text-obsidian mb-3">Shoe size</h3>
                    <div className="flex flex-wrap gap-2">
                      {FIT_SHOE_SIZES.map((s) => (
                        <PillButton key={s} label={s} active={shoeSize === s} onClick={() => setShoeSize(shoeSize === s ? "" : s)} />
                      ))}
                    </div>
                  </div>

                  <FitNav
                    onBack={() => setFitStep(1)}
                    onSkip={() => handleComplete("member")}
                    onNext={() => handleComplete("member")}
                    isLast
                  />
                </div>
              )}
            </>
          )}
        </div>
      </main>
    </div>
  );
}

/* ═══════════════════════════════════════════
   COMPONENTS
   ═══════════════════════════════════════════ */

function FeatureItem({ text, light }: { text: string; light?: boolean }) {
  return (
    <li className="flex items-center gap-2">
      <svg
        className={`w-3.5 h-3.5 shrink-0 ${light ? "text-sage" : "text-forest"}`}
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={2.5}
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
      <span className={`text-sm ${light ? "text-bone/65" : "text-charcoal/65"}`}>{text}</span>
    </li>
  );
}

/* ═══════════════════════════════════════════
   VIBE CHECK ICONS
   ═══════════════════════════════════════════ */

function HandIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M10.05 4.575a1.575 1.575 0 10-3.15 0v3m3.15-3v-1.5a1.575 1.575 0 013.15 0v1.5m-3.15 0l.075 5.925m3.075-5.925v2.7m0-2.7a1.575 1.575 0 013.15 0v2.7m0 0v1.65a4.237 4.237 0 01-.426 1.856L17.1 17.55a2.25 2.25 0 01-1.99 1.2H9.228a2.25 2.25 0 01-2.12-1.488l-1.96-5.49a1.575 1.575 0 012.106-1.894l.65.325" />
    </svg>
  );
}

function MusicIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M9 9l10.5-3m0 6.553v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 11-.99-3.467l2.31-.66a2.25 2.25 0 001.632-2.163zm0 0V2.25L9 5.25v10.303m0 0v3.75a2.25 2.25 0 01-1.632 2.163l-1.32.377a1.803 1.803 0 01-.99-3.467l2.31-.66A2.25 2.25 0 009 15.553z" />
    </svg>
  );
}

function WalkIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0013.5 3h-6a2.25 2.25 0 00-2.25 2.25v13.5A2.25 2.25 0 007.5 21h6a2.25 2.25 0 002.25-2.25V15m3 0l3-3m0 0l-3-3m3 3H9" />
    </svg>
  );
}

function HeadphonesIcon() {
  return (
    <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19.114 5.636a9 9 0 010 12.728M16.463 8.288a5.25 5.25 0 010 7.424M6.75 8.25l4.72-4.72a.75.75 0 011.28.53v15.88a.75.75 0 01-1.28.53l-4.72-4.72H4.51c-.88 0-1.704-.507-1.938-1.354A9.01 9.01 0 012.25 12c0-.83.112-1.633.322-2.396C2.806 8.756 3.63 8.25 4.51 8.25H6.75z" />
    </svg>
  );
}
