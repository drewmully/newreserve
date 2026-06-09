"use client";

/**
 * WelcomeDrawers
 *
 * Three first-visit welcome surfaces, gated by tier:
 *  - FirstBoxWelcomeDrawer (tier=member): BLOCKING. Captures sizing for
 *    the first box. Calls completeOnboarding from MembershipContext.
 *  - AccessWelcomeBanner (tier=access): non-blocking banner introducing
 *    member benefits and store credit.
 *  - ProfileNudge (tier=free): soft prompt to upgrade or pick a plan.
 *
 * All three are skipped once `onboardingCompleted: true` in Firestore.
 */

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useMembership } from "../context/MembershipContext";
import {
  FIT_SHIRT_SIZES,
  FIT_GLOVE_HANDS,
  FIT_GLOVE_SIZES,
  FIT_WAIST_SIZES,
  FIT_SHOE_SIZES,
  FIT_PANTS_INSEAMS,
} from "./UpgradeModal";
import { trackEvent } from "@/lib/tracking";

/* ────────────────────────────────────────────
   FirstBoxWelcomeDrawer — tier=member
   ──────────────────────────────────────────── */

export function FirstBoxWelcomeDrawer() {
  const { email, username, fitProfile, completeOnboarding, onboardingProfile } =
    useMembership();
  const [step, setStep] = useState<"intro" | "sizing" | "done">("intro");
  const [shirt, setShirt] = useState(fitProfile.shirtSize || "M");
  const [gloveHand, setGloveHand] = useState(
    fitProfile.gloveHand || "Right"
  );
  const [gloveSize, setGloveSize] = useState(fitProfile.gloveSize || "M");
  const [waist, setWaist] = useState(fitProfile.waistSize || "32");
  const [shoe, setShoe] = useState(fitProfile.shoeSize || "10");
  const [pantsInseam, setPantsInseam] = useState(
    fitProfile.pantsInseam || "32\""
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fallbackUsername = (email || "member").split("@")[0];

  const handleSubmit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await completeOnboarding({
        username: username || fallbackUsername,
        onboardingProfile,
        fitProfile: {
          ...fitProfile,
          shirtSize: shirt,
          gloveHand,
          gloveSize,
          waistSize: waist,
          shoeSize: shoe,
          pantsInseam,
        },
      });
      try {
        trackEvent("first_box_sized", { tier: "member" });
      } catch {}
      // Advance to the hand-off step instead of closing the drawer.
      // This is where we route new members straight into the Pro Shop —
      // the single biggest lever for member engagement post-checkout.
      setStep("done");
    } catch (err) {
      console.error("[FirstBoxWelcomeDrawer] submit failed", err);
      setError(
        err instanceof Error
          ? err.message
          : "Could not save sizing. Try again."
      );
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end md:items-center justify-center bg-obsidian/70 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="first-box-title"
    >
      <div className="bg-bone w-full md:max-w-lg md:rounded-2xl rounded-t-2xl shadow-2xl p-7 md:p-9 max-h-[90vh] overflow-y-auto animate-slide-up">
        <p className="text-[10px] tracking-[0.32em] uppercase text-ember font-medium mb-3">
          Reserve Member
        </p>

        {step === "intro" && (
          <>
            <h2
              id="first-box-title"
              className="font-serif text-2xl md:text-[2rem] text-obsidian leading-tight mb-3"
            >
              Welcome in. Your first box ships next.
            </h2>
            <p className="text-sm text-obsidian/70 leading-relaxed mb-6">
              Quick sizing read so the next drop fits like it should. Two
              minutes, then you're in.
            </p>
            <ul className="space-y-2 mb-7 text-sm text-obsidian/70">
              <li className="flex gap-2">
                <span className="text-forest font-medium">•</span>
                Curated apparel and gear from Rhone, Greyson, Penfold, Quiet
                Golf, and more.
              </li>
              <li className="flex gap-2">
                <span className="text-forest font-medium">•</span>
                Average members save $400+ annually on the brands they already
                wear.
              </li>
              <li className="flex gap-2">
                <span className="text-forest font-medium">•</span>
                Every box is editable before it ships.
              </li>
            </ul>
            <button
              type="button"
              onClick={() => setStep("sizing")}
              className="w-full px-5 py-3.5 rounded-lg bg-forest text-bone text-sm font-medium hover:bg-forest/90 transition"
            >
              Set my sizes
            </button>
          </>
        )}

        {step === "sizing" && (
          <>
            <h2 className="font-serif text-2xl text-obsidian leading-tight mb-2">
              Quick sizing.
            </h2>
            <p className="text-xs text-obsidian/60 mb-5">
              You can edit any of this later in your profile.
            </p>

            <div className="space-y-4 mb-6">
              <SizeRow
                label="Shirt"
                value={shirt}
                onChange={setShirt}
                options={FIT_SHIRT_SIZES}
              />
              <div className="grid grid-cols-2 gap-3">
                <SizeRow
                  label="Glove hand"
                  value={gloveHand}
                  onChange={setGloveHand}
                  options={FIT_GLOVE_HANDS}
                />
                <SizeRow
                  label="Glove size"
                  value={gloveSize}
                  onChange={setGloveSize}
                  options={FIT_GLOVE_SIZES}
                />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <SizeRow
                  label="Waist"
                  value={waist}
                  onChange={setWaist}
                  options={FIT_WAIST_SIZES}
                />
                <SizeRow
                  label="Inseam"
                  value={pantsInseam}
                  onChange={setPantsInseam}
                  options={FIT_PANTS_INSEAMS}
                />
              </div>
              <SizeRow
                label="Shoe"
                value={shoe}
                onChange={setShoe}
                options={FIT_SHOE_SIZES}
              />
            </div>

            {error && (
              <p className="text-xs text-ember bg-ember/10 px-3 py-2 rounded-md mb-4">
                {error}
              </p>
            )}

            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setStep("intro")}
                className="px-4 py-3 text-sm text-obsidian/60 hover:text-obsidian"
              >
                Back
              </button>
              <button
                type="button"
                onClick={handleSubmit}
                disabled={submitting}
                className="flex-1 px-5 py-3 rounded-lg bg-forest text-bone text-sm font-medium hover:bg-forest/90 disabled:opacity-60 transition"
              >
                {submitting ? "Saving..." : "Save and finish"}
              </button>
            </div>
          </>
        )}

        {step === "done" && (
          <>
            <h2 className="font-serif text-2xl md:text-[2rem] text-obsidian leading-tight mb-3">
              You&rsquo;re set, {username || "friend"}.
            </h2>
            <p className="text-sm text-obsidian/70 leading-relaxed mb-5">
              Your next curation ships on its quarterly cadence. In the meantime,
              your Pro Shop is open — Rhone, Greyson, Penfold, Quiet Golf and
              more, at member pricing.
            </p>
            <ul className="space-y-2 mb-6 text-sm text-obsidian/70">
              <li className="flex gap-2">
                <span className="text-forest font-medium">•</span>
                15% off every item, every day.
              </li>
              <li className="flex gap-2">
                <span className="text-forest font-medium">•</span>
                Ships separately from your curation.
              </li>
              <li className="flex gap-2">
                <span className="text-forest font-medium">•</span>
                Free returns within 30 days.
              </li>
            </ul>
            <div className="flex flex-col gap-2">
              <a
                href="/dashboard?tab=shop&welcome=1"
                onClick={() => {
                  try {
                    trackEvent("post_checkout_proshop_cta_clicked", {
                      properties: { tier: "member", source: "first_box_drawer" },
                    });
                  } catch {}
                }}
                className="w-full text-center px-5 py-3.5 rounded-lg bg-forest text-bone text-sm font-medium hover:bg-forest/90 transition"
              >
                Browse the Pro Shop
              </a>
              <a
                href="/home"
                className="w-full text-center px-5 py-3 text-sm text-obsidian/60 hover:text-obsidian"
              >
                Maybe later
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function SizeRow({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="block text-[11px] tracking-[0.18em] uppercase text-obsidian/60 mb-1.5">
        {label}
      </label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2.5 rounded-lg border border-forest/20 bg-white focus:border-forest focus:outline-none focus:ring-2 focus:ring-forest/20 text-obsidian text-sm"
      >
        {options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}

/* ────────────────────────────────────────────
   AccessWelcomeBanner — tier=access
   ──────────────────────────────────────────── */

export function AccessWelcomeBanner() {
  const { username, completeOnboarding, onboardingProfile, fitProfile, email } =
    useMembership();
  const [dismissed, setDismissed] = useState(false);
  const fallbackUsername = (email || "member").split("@")[0];

  if (dismissed) return null;

  const handleDismiss = async () => {
    setDismissed(true);
    try {
      await completeOnboarding({
        username: username || fallbackUsername,
        onboardingProfile,
        fitProfile,
      });
      trackEvent("welcome_banner_dismissed", { tier: "access" });
    } catch (err) {
      console.error("[AccessWelcomeBanner] dismiss failed", err);
    }
  };

  return (
    <section className="px-6 md:px-12 max-w-6xl mx-auto mb-8">
      <div className="rounded-2xl bg-gradient-to-br from-sage/10 to-forest/5 border border-sage/30 p-6 md:p-7 animate-fade-up">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-[10px] tracking-[0.32em] uppercase text-sage font-medium mb-2">
              Reserve Access
            </p>
            <h3 className="font-serif text-xl md:text-2xl text-obsidian leading-tight mb-2">
              You're in, {username || "friend"}.
            </h3>
            <p className="text-sm text-obsidian/70 leading-relaxed mb-4 max-w-xl">
              Member pricing on every drop, early access to private releases,
              and your first $25 in store credit is already loaded. Members
              save $400+ annually on the brands they wear.
            </p>
            <div className="flex flex-wrap gap-2">
              <a
                href="/dashboard?tab=shop&welcome=1"
                onClick={() => {
                  try {
                    trackEvent("post_checkout_proshop_cta_clicked", {
                      properties: { tier: "access", source: "access_banner" },
                    });
                  } catch {}
                }}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-forest text-bone text-sm font-medium hover:bg-forest/90 transition"
              >
                Browse the Pro Shop
              </a>
              <button
                type="button"
                onClick={handleDismiss}
                className="inline-flex items-center px-4 py-2 text-sm text-obsidian/60 hover:text-obsidian"
              >
                Got it
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}

/* ────────────────────────────────────────────
   ProfileNudge — tier=free
   ──────────────────────────────────────────── */

export function ProfileNudge() {
  const { username, completeOnboarding, onboardingProfile, fitProfile, email } =
    useMembership();
  const router = useRouter();
  const [dismissed, setDismissed] = useState(false);
  const fallbackUsername = (email || "guest").split("@")[0];

  if (dismissed) return null;

  const markSeen = async () => {
    setDismissed(true);
    try {
      await completeOnboarding({
        username: username || fallbackUsername,
        onboardingProfile,
        fitProfile,
      });
    } catch (err) {
      console.error("[ProfileNudge] dismiss failed", err);
    }
  };

  const handlePickPlan = async () => {
    trackEvent("profile_nudge_pick_plan_clicked", { tier: "free" });
    await markSeen();
    router.push("/choose-plan");
  };

  return (
    <section className="px-6 md:px-12 max-w-6xl mx-auto mb-8">
      <div className="rounded-2xl bg-bone border border-forest/15 p-6 md:p-7 animate-fade-up">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1">
            <p className="text-[10px] tracking-[0.32em] uppercase text-taupe font-medium mb-2">
              Welcome
            </p>
            <h3 className="font-serif text-xl md:text-2xl text-obsidian leading-tight mb-2">
              Glad you're here, {username || "friend"}.
            </h3>
            <p className="text-sm text-obsidian/70 leading-relaxed mb-4 max-w-xl">
              You're set up as a free account. Reserve members save $400+
              annually on Rhone, Greyson, Penfold, and the rest of the pro
              shop. Take a look when you're ready.
            </p>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={handlePickPlan}
                className="inline-flex items-center px-4 py-2 rounded-lg bg-forest text-bone text-sm font-medium hover:bg-forest/90 transition"
              >
                See plans
              </button>
              <button
                type="button"
                onClick={markSeen}
                className="inline-flex items-center px-4 py-2 text-sm text-obsidian/60 hover:text-obsidian"
              >
                Maybe later
              </button>
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
