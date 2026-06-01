"use client";

/**
 * /choose-plan
 *
 * Two-tier decision page. Free tier and illustrative Reserve Black removed
 * 2026-06 to eliminate decision fatigue; only Digital Membership ($99/yr)
 * and Curated Box Membership ($250/qtr) remain.
 *
 * Flow:
 *   1. Visitor enters email on the homepage EmailCTA.
 *   2. EmailCTA calls /api/auth/start-account, signs them in with a Firebase
 *      custom token (NO password), and sends them here.
 *   3. They pick Digital ($99/yr) or Curated Box ($250/qtr).
 *   4. Either choice -> Shopify checkout via createMembershipCheckout (Leo's
 *      ?return_url=/auth/callback pattern). Post-checkout they land
 *      authenticated on /home with the welcome experience.
 *
 * No fit profile, no SMS opt-in, no required username at this step. Profile
 * data is collected after payment via the welcome drawers in /home.
 */

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useMembership } from "../context/MembershipContext";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { trackEvent } from "@/lib/tracking";
import { PENDING_ONBOARDING_EMAIL_KEY } from "../components/EmailCTA";
import { GuaranteedValue } from "../components/GuaranteedValue";

/* ═══════════════════════════════════════════════════════════════ */

export default function ChoosePlanPage() {
  const router = useRouter();
  const { user, tier } = useMembership();
  const [submittingTier, setSubmittingTier] = useState<
    "access" | "member" | null
  >(null);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [storedEmail, setStoredEmail] = useState<string | null>(null);

  useEffect(() => {
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

  const checkoutEmail = useMemo(
    () => user?.email ?? storedEmail ?? undefined,
    [user, storedEmail]
  );

  /* ─── Handlers ─── */

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
          Pick your membership.
        </h1>
        <p className="text-base text-charcoal/55 leading-relaxed mb-8">
          Two ways in: get insider pricing on our curations, or get the
          curated box delivered every quarter.
        </p>

        {/* ─── Guarantee — Above the cards so it frames the choice ─── */}
        <GuaranteedValue className="mb-8" />

        <div className="space-y-5">
          {/* ────────── DIGITAL MEMBERSHIP (RESERVE ACCESS) ────────── */}
          <div className="bg-cream rounded-2xl p-7 md:p-8 border border-taupe/20">
            <span className="text-[11px] tracking-[0.25em] uppercase text-forest font-medium">
              Digital Membership
            </span>
            <div className="mt-2 mb-5">
              <span className="font-serif text-3xl text-obsidian">$99</span>
              <span className="text-charcoal/40 text-sm ml-1">/year</span>
            </div>
            <p className="text-sm text-charcoal/65 mb-5 leading-relaxed">
              Insider pricing on every curation. Shop the brands we curate at
              member prices and get first access to every drop.
            </p>
            <div className="border-t border-taupe/12 pt-5">
              <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5 mb-6">
                <FeatureItem text="Reserve pricing on all gear" />
                <FeatureItem text="First access to drops" />
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
                  : "Get Digital Membership"}
              </button>
            </div>
          </div>

          {/* ────────── CURATED BOX (RESERVE MEMBER, FEATURED) ────────── */}
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
                  Curated Box Membership
                </span>
                <div className="mt-2 mb-5">
                  <span className="font-serif text-3xl text-bone">$250</span>
                  <span className="text-bone/45 text-sm ml-1">/quarter</span>
                </div>
                <p className="text-sm text-bone/70 mb-5 leading-relaxed">
                  4&ndash;6 hand-picked pieces from Rhone, Greyson, Quiet Golf
                  and more. $300+ retail value, every quarter. Free shipping.
                  Cancel anytime after your first box.
                </p>
                <div className="border-t border-bone/10 pt-5">
                  <ul className="grid grid-cols-2 gap-x-6 gap-y-2.5 mb-6">
                    <FeatureItem text="Quarterly curated box" light />
                    <FeatureItem text="Everything in Digital" light />
                    <FeatureItem text="Free shipping" light />
                    <FeatureItem text="Exchange anything, free" light />
                    <FeatureItem text="Concierge support" light />
                    <FeatureItem text="Invite-only events" light />
                  </ul>
                  <button
                    onClick={() => handlePaid("member")}
                    disabled={submittingTier !== null}
                    className="h-12 px-10 rounded-xl bg-bone text-forest text-sm font-medium tracking-wider uppercase hover:bg-bone-dark transition-all duration-300 cursor-pointer btn-press disabled:opacity-60"
                  >
                    {submittingTier === "member"
                      ? "Loading checkout..."
                      : "Start the Curated Box"}
                  </button>
                </div>
              </div>
            </div>
          </div>
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
          Cancel anytime. Exchange anything, free.
        </p>
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

