"use client";

/**
 * /choose-plan
 *
 * Replaces the legacy /onboarding plan-selection step. The new low-friction
 * flow is:
 *
 *   1. Visitor enters email on the homepage EmailCTA.
 *   2. EmailCTA calls /api/auth/start-account, signs them in with a Firebase
 *      custom token (NO password), and sends them here.
 *   3. They pick "Continue free" or one of the paid tiers.
 *   4. Free  -> immediately to /home, where a one-time password / magic-link
 *              gate prompts them on first visit.
 *      Paid  -> Shopify checkout via createMembershipCheckout (Leo's
 *              ?return_url=/auth/callback pattern). Post-checkout they land
 *              authenticated on /home with the welcome experience.
 *
 * No fit profile, no SMS opt-in, no required username at this step. Profile
 * data is collected after payment via the welcome drawers in /home.
 *
 * Reserve Black is intentionally illustrative only ("invite only / earned
 * through spend") per Drew's spec, modeled after Delta diamond medallion.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMembership } from "../context/MembershipContext";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { trackEvent } from "@/lib/tracking";
import {
  fetchClientFlagOverrides,
  getABBucket,
  type FlagOverrideMap,
} from "@/lib/clientFlagOverrides";
import { PENDING_ONBOARDING_EMAIL_KEY } from "../components/EmailCTA";
import { auth } from "@/lib/firebase";
import { doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";

/* ─── Variant copy for the existing ob-plan-* A/B keys ─── */

const PLAN_VARIANTS = {
  planHeadline: {
    control: "Choose your membership.",
    "variant-a": "Your membership is ready.",
  },
  planSubtext: {
    control:
      "Start free or unlock the full Reserve experience. Upgrade anytime.",
    "variant-a":
      "Every tier includes Reserve pricing. Pick the level that fits your game.",
  },
} as const;

function pickVariant(
  key: keyof typeof PLAN_VARIANTS,
  bucket: number,
  overrides: FlagOverrideMap
): string {
  const flagKey = key === "planHeadline" ? "ob-plan-headline" : "ob-plan-subtext";
  const forced = overrides[flagKey];
  const v = PLAN_VARIANTS[key];
  if (forced === "control") return v.control;
  if (forced === "variant-a") return v["variant-a"];
  return bucket < 50 ? v.control : v["variant-a"];
}

/* ═══════════════════════════════════════════════════════════════ */

export default function ChoosePlanPage() {
  const router = useRouter();
  const { user, tier, refreshSubscriptionStatus } = useMembership();
  const [overrides, setOverrides] = useState<FlagOverrideMap>({});
  const [bucket, setBucket] = useState(0);
  const [submittingTier, setSubmittingTier] = useState<
    "free" | "access" | "member" | null
  >(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [storedEmail, setStoredEmail] = useState<string | null>(null);

  // Pull flag overrides + bucket once on mount.
  useEffect(() => {
    setBucket(getABBucket());
    void fetchClientFlagOverrides().then(setOverrides);

    try {
      const e = sessionStorage.getItem(PENDING_ONBOARDING_EMAIL_KEY);
      if (e) setStoredEmail(e);
    } catch {
      // Ignore.
    }

    void trackEvent("choose_plan_view", {
      properties: { has_session_email: Boolean(storedEmail) },
    });
    // We only fire the tracking event on first mount; storedEmail dep
    // intentionally omitted.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // If the user lands here already authenticated AND already paid, send them
  // to /home (no reason to re-pick a plan).
  useEffect(() => {
    if (user && tier && tier !== "free") {
      router.replace("/home");
    }
  }, [user, tier, router]);

  const headline = useMemo(
    () => pickVariant("planHeadline", bucket, overrides),
    [bucket, overrides]
  );
  const subtext = useMemo(
    () => pickVariant("planSubtext", bucket, overrides),
    [bucket, overrides]
  );

  const checkoutEmail = useMemo(
    () => user?.email ?? storedEmail ?? undefined,
    [user, storedEmail]
  );

  /* ─── Handlers ─── */

  async function handleStartFree() {
    if (submittingTier) return;
    setSubmittingTier("free");

    void trackEvent("plan_selected", {
      properties: { plan: "free", method: "no_payment" },
    });
    void trackEvent("subscription_state", {
      properties: { plan: "free", state: "selected" },
    });

    // The user already has tier='free' from /api/auth/start-account. Just
    // make sure Firestore reflects that, then route to /home where the
    // welcome drawer + password gate prompts on first visit.
    if (user?.uid) {
      try {
        await updateDoc(doc(db, "users", user.uid), {
          tier: "free",
          updated_at: Date.now(),
        });
      } catch (err) {
        console.error("[choose-plan] free tier write failed:", err);
      }
      try {
        await refreshSubscriptionStatus?.();
      } catch {
        // Best effort.
      }
    }

    router.push("/home");
  }

  async function handlePaid(plan: "access" | "member") {
    if (submittingTier) return;
    setSubmittingTier(plan);

    void trackEvent("plan_selected", {
      properties: { plan, method: "shopify_checkout" },
    });
    void trackEvent("subscription_state", {
      properties: { plan, state: "selected" },
    });
    void trackEvent("checkout_clicked", {
      properties: { plan, source: "choose_plan" },
    });

    setCheckoutError(null);

    try {
      await createMembershipCheckout(plan, {
        email: checkoutEmail,
        // /auth/callback already exists and bounces authenticated buyers to
        // /home (Leo's pattern). Welcome drawers fire from /home.
        returnPath: "/auth/callback",
      });
    } catch (err) {
      console.error("[choose-plan] checkout failed:", err);
      setSubmittingTier(null);
      setCheckoutError(
        err instanceof Error
          ? err.message.replace(/^\[shopifyCheckout\]\s*/, "")
          : "Could not start checkout. Please try again."
      );
    }
  }

  /* ─── Render ─── */

  return (
    <main className="min-h-screen bg-bone px-6 py-12 md:py-20">
      <div className="max-w-2xl mx-auto">
        <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-4">
          <span className="w-6 h-px bg-sage/50" />
          You&apos;re in
          <span className="w-6 h-px bg-sage/50" />
        </span>

        <h1 className="font-serif text-3xl md:text-4xl text-obsidian leading-tight mb-3">
          {headline}
        </h1>
        <p className="text-base text-charcoal/55 leading-relaxed mb-10">
          {subtext}
        </p>

        <div className="space-y-5">
          {/* ────────── RESERVE ACCESS ────────── */}
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
                onClick={() => handlePaid("access")}
                disabled={submittingTier !== null}
                className="h-12 px-10 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-all duration-300 cursor-pointer btn-press disabled:opacity-60"
              >
                {submittingTier === "access"
                  ? "Loading checkout..."
                  : "Join Reserve Access"}
              </button>
            </div>
          </div>

          {/* ────────── RESERVE MEMBER (FEATURED) ────────── */}
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
                    <FeatureItem text="Quarterly Reserve Box" light />
                    <FeatureItem text="Guaranteed access windows" light />
                    <FeatureItem text="Priority release access" light />
                    <FeatureItem text="Concierge booking support" light />
                    <FeatureItem text="Invite-only events" light />
                  </ul>
                  <button
                    onClick={() => handlePaid("member")}
                    disabled={submittingTier !== null}
                    className="h-12 px-10 rounded-xl bg-bone text-forest text-sm font-medium tracking-wider uppercase hover:bg-bone-dark transition-all duration-300 cursor-pointer btn-press disabled:opacity-60"
                  >
                    {submittingTier === "member"
                      ? "Loading checkout..."
                      : "Join Reserve Member"}
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* ────────── RESERVE BLACK (ILLUSTRATIVE / INVITE ONLY) ────────── */}
          <ReserveBlackCard />
        </div>

        {checkoutError && (
          <div
            role="alert"
            className="mt-8 rounded-xl border border-ember/40 bg-ember/8 px-5 py-4 text-sm text-ember"
          >
            <strong className="font-medium">Checkout couldn&apos;t start:</strong>{" "}
            {checkoutError}
          </div>
        )}

        <p className="text-center text-sm text-charcoal/40 mt-8">
          Start free. Upgrade or cancel anytime. No commitments.
        </p>

        <div className="mt-4 text-center">
          <button
            onClick={handleStartFree}
            disabled={submittingTier !== null}
            className="text-sm text-charcoal/50 hover:text-charcoal/70 underline underline-offset-4 decoration-charcoal/25 hover:decoration-charcoal/50 transition-all duration-300 cursor-pointer disabled:opacity-60"
          >
            {submittingTier === "free" ? "Setting things up..." : "Continue free"}
          </button>
        </div>
      </div>
    </main>
  );
}

/* ─── Sub-components ─── */

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
      <span className={`text-sm ${light ? "text-bone/65" : "text-charcoal/65"}`}>
        {text}
      </span>
    </li>
  );
}

/**
 * Reserve Black is illustrative only. The card is visually muted, the action
 * is greyed out and non-interactive ("Invite Only"), and we surface the
 * "Earned through spend" micro-copy that mirrors how Delta promotes Diamond
 * Medallion. There is no path to self-purchase Reserve Black.
 */
function ReserveBlackCard() {
  return (
    <div
      aria-disabled="true"
      className="relative rounded-2xl p-7 md:p-8 border border-obsidian/15 bg-cream/60 overflow-hidden"
      style={{ filter: "saturate(0.85)" }}
    >
      <div className="absolute top-0 left-0 right-0 h-1 bg-obsidian" />

      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] tracking-[0.25em] uppercase text-charcoal/45 font-medium">
          Reserve Black
        </span>
        <span className="text-[10px] tracking-[0.2em] uppercase text-charcoal/35 font-medium border border-charcoal/15 rounded-full px-2.5 py-1">
          Illustrative
        </span>
      </div>

      <div className="mt-1 mb-1">
        <span className="font-serif text-3xl text-charcoal/60">Invite Only</span>
      </div>
      <p className="text-xs text-charcoal/45 mb-5 italic">
        Earned through spend. Like Delta&apos;s Diamond Medallion.
      </p>

      <div className="border-t border-taupe/12 pt-5">
        <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5 mb-6">
          <FeatureItem text="Everything in Member" />
          <FeatureItem text="$1,000 quarterly credit" />
          <FeatureItem text="Personal stylist" />
          <FeatureItem text="Concierge phone line" />
          <FeatureItem text="Invite-only experiences" />
        </ul>
        <button
          type="button"
          disabled
          aria-label="Reserve Black is invite only"
          className="h-12 px-10 rounded-xl border border-charcoal/15 text-charcoal/40 text-sm font-medium tracking-wider uppercase cursor-not-allowed bg-cream/40"
        >
          Invite Only
        </button>
      </div>
    </div>
  );
}
