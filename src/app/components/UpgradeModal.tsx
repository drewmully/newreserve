"use client";

import { useEffect, useCallback, useState } from "react";
import { buildCheckoutOriginAttributes } from "@/lib/shopifyCheckoutOrigin";
import { SHOPIFY_MEMBERSHIP_PLANS } from "@/lib/membershipConfig";
import { useMembership } from "@/app/context/MembershipContext";

/* ═══════════════════════════════════════════
   UPGRADE MODAL
   Plan selection only (checkout-first flow)
   ═══════════════════════════════════════════ */

type MemberTier = "free" | "access" | "member" | "black";

interface UpgradeModalProps {
  open: boolean;
  onClose: () => void;
  currentTier: MemberTier;
  onSelectPlan: (tier: MemberTier) => void;
}

export function UpgradeModal({ open, onClose, currentTier }: UpgradeModalProps) {
  const { user, subscriptions, setTier, refreshSubscriptionStatus } = useMembership();
  const [swapping, setSwapping] = useState(false);
  const [swapError, setSwapError] = useState<string | null>(null);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  // Escape key
  const handleEscape = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") handleClose();
    },
    [handleClose]
  );

  useEffect(() => {
    if (open) {
      document.addEventListener("keydown", handleEscape);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleEscape);
      document.body.style.overflow = "";
    };
  }, [open, handleEscape]);

  if (!open) return null;

  const hasActiveSubscription = !!(
    subscriptions?.mullybox_active && subscriptions.active_subscription_ids.length > 0
  );

  const PLANS = {
    access: {
      merchandiseId: SHOPIFY_MEMBERSHIP_PLANS.access.merchandiseId,
      sellingPlanId: SHOPIFY_MEMBERSHIP_PLANS.access.sellingPlanGid,
    },
    member: {
      merchandiseId: SHOPIFY_MEMBERSHIP_PLANS.member.merchandiseId,
      sellingPlanId: SHOPIFY_MEMBERSHIP_PLANS.member.sellingPlanGid,
    },
  };

  async function createCartAndCheckout(plan: keyof typeof PLANS) {
    const { merchandiseId, sellingPlanId } = PLANS[plan];
    const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
    const token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
    if (!domain || !token) {
      console.error("[UpgradeModal] missing Shopify storefront config");
      return;
    }

    const returnTo = `${window.location.origin}/auth/callback`;
    const attributes = buildCheckoutOriginAttributes(returnTo);

    const res = await fetch(`https://${domain}/api/2024-10/graphql.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Storefront-Access-Token": token,
      },
      body: JSON.stringify({
        query: `mutation CreateSubscriptionCart(
          $merchandiseId: ID!
          $sellingPlanId: ID!
          $attributes: [AttributeInput!]
        ) {
          cartCreate(input: {
            lines: [{
              merchandiseId: $merchandiseId,
              quantity: 1,
              sellingPlanId: $sellingPlanId
            }],
            attributes: $attributes
          }) {
            cart { checkoutUrl }
            userErrors { field message }
          }
        }`,
        variables: {
          merchandiseId,
          sellingPlanId,
          attributes,
        },
      }),
    });

    const json = await res.json();
    const checkoutUrl = json?.data?.cartCreate?.cart?.checkoutUrl;
    if (checkoutUrl) {
      try {
        const checkout = new URL(checkoutUrl);
        checkout.searchParams.set("return_url", returnTo);
        window.location.href = checkout.toString();
      } catch {
        const separator = checkoutUrl.includes("?") ? "&" : "?";
        window.location.href = `${checkoutUrl}${separator}return_url=${encodeURIComponent(returnTo)}`;
      }
    } else {
      console.error("[UpgradeModal] no checkoutUrl — errors:", json?.data?.cartCreate?.userErrors, json?.errors);
    }
  }

  async function swapAndUpgrade(targetTier: "access" | "member") {
    if (!user) return;
    setSwapping(true);
    setSwapError(null);
    try {
      const idToken = await user.getIdToken();
      const variantShopifyId = SHOPIFY_MEMBERSHIP_PLANS[targetTier].variantId;
      const res = await fetch("/api/loop/subscription/swap-product", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${idToken}`,
        },
        body: JSON.stringify({ variantShopifyId }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({})) as { error?: string; detail?: string };
        const msg = data.detail ? `${data.error}: ${data.detail}` : (data.error ?? `Swap failed (${res.status})`);
        throw new Error(msg);
      }
      setTier(targetTier);
      await refreshSubscriptionStatus();
      handleClose();
    } catch (err) {
      console.error("[UpgradeModal] swap failed:", err);
      setSwapError(err instanceof Error ? err.message : "Something went wrong. Please try again.");
    } finally {
      setSwapping(false);
    }
  }

  function handleChooseAccess() {
    if (hasActiveSubscription) {
      swapAndUpgrade("access").catch((err) =>
        console.error("[UpgradeModal] swapAndUpgrade access failed:", err)
      );
    } else {
      createCartAndCheckout("access").catch((err) =>
        console.error("[UpgradeModal] handleChooseAccess failed:", err)
      );
    }
  }

  function handleChooseMember() {
    if (hasActiveSubscription) {
      swapAndUpgrade("member").catch((err) =>
        console.error("[UpgradeModal] swapAndUpgrade member failed:", err)
      );
    } else {
      createCartAndCheckout("member").catch((err) =>
        console.error("[UpgradeModal] handleChooseMember failed:", err)
      );
    }
  }

  const showAccessCard = currentTier === "free";
  const showMemberCard = currentTier !== "member" && currentTier !== "black";

  return (
    <div className="fixed inset-0 z-[95]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-obsidian/50 backdrop-blur-sm animate-modal-backdrop"
        onClick={handleClose}
      />

      {/* Modal */}
      <div className="absolute inset-0 flex items-center justify-center p-4 sm:p-6 pointer-events-none">
        <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-2xl pointer-events-auto animate-modal-content glass-modal-center">
          {/* Close */}
          <button
            onClick={handleClose}
            className="absolute top-4 right-4 z-10 w-8 h-8 rounded-full bg-taupe/10 hover:bg-taupe/20 flex items-center justify-center transition-colors duration-300 cursor-pointer"
            aria-label="Close"
          >
            <svg className="w-4 h-4 text-charcoal/50" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>

          {/* ════════ PLAN SELECTION ════════ */}
          <div className="p-6 sm:p-8">
              <span className="inline-flex items-center gap-2 text-xs tracking-[0.3em] uppercase text-sage font-medium mb-4">
                <span className="w-6 h-px bg-sage/50" />
                Upgrade
                <span className="w-6 h-px bg-sage/50" />
              </span>
              <h2 className="font-serif text-2xl sm:text-3xl text-obsidian leading-tight mb-2">
                Elevate your membership.
              </h2>
              <p className="text-sm text-charcoal/55 leading-relaxed mb-8">
                Built for the modern golfer. Premium gear, concierge access, and a community that gets it.
              </p>

              <div className="space-y-4">
                {/* Reserve Access */}
                {showAccessCard && (
                  <div className="rounded-2xl p-6 glass-card glass-card-light">
                    <span className="text-[11px] tracking-[0.25em] uppercase text-forest font-medium">
                      Reserve Access
                    </span>
                    <div className="mt-2 mb-4">
                      <span className="font-serif text-2xl text-obsidian">$99</span>
                      <span className="text-charcoal/40 text-sm ml-1">/year</span>
                    </div>
                    <div className="border-t border-taupe/12 pt-4">
                      <ul className="space-y-2 mb-5">
                        <ModalFeature text="Reserve pricing unlocked" />
                        <ModalFeature text="Early access to drops" />
                        <ModalFeature text="Free 2-day shipping" />
                        <ModalFeature text="Partner benefit access" />
                      </ul>
                      <button
                        onClick={handleChooseAccess}
                        disabled={swapping}
                        className="h-11 px-8 rounded-xl bg-forest text-bone text-sm font-medium tracking-wider uppercase hover:bg-forest-dark transition-all duration-300 cursor-pointer btn-press disabled:opacity-60 disabled:cursor-default"
                      >
                        {swapping ? "Upgrading…" : "Join Reserve Access"}
                      </button>
                    </div>
                  </div>
                )}

                {/* Reserve Member (featured) */}
                {showMemberCard && (
                  <div className="relative">
                    <div className="absolute -top-3 left-6 z-20">
                      <span className="inline-block bg-sage text-bone text-[10px] tracking-[0.2em] uppercase font-semibold px-3 py-1 rounded-full shadow-sm">
                        Recommended
                      </span>
                    </div>
                    <div className="rounded-2xl overflow-hidden relative glass-card glass-card-dark">
                      <div className="relative z-10 p-6">
                        <span className="text-[11px] tracking-[0.25em] uppercase text-sage font-medium">
                          Reserve Member
                        </span>
                        <div className="mt-2 mb-1">
                          <span className="font-serif text-2xl text-bone">$249</span>
                          <span className="text-bone/45 text-sm ml-1">/quarter</span>
                        </div>
                        <p className="text-xs text-bone/40 mb-4">
                          Includes fit-profile powered curation for drops and member boxes.
                        </p>
                        <div className="border-t border-bone/10 pt-4">
                          <ul className="space-y-2 mb-5">
                            <ModalFeature text="Everything in Access" light />
                            <ModalFeature text="Personalized fit profile" light />
                            <ModalFeature text="Curated member boxes for him" light />
                            <ModalFeature text="Priority release access" light />
                            <ModalFeature text="Concierge booking support" light />
                            <ModalFeature text="Invite-only events" light />
                          </ul>
                          <button
                            onClick={handleChooseMember}
                            disabled={swapping}
                            className="h-11 px-8 rounded-xl bg-bone text-forest text-sm font-medium tracking-wider uppercase hover:bg-bone-dark transition-all duration-300 cursor-pointer btn-press disabled:opacity-60 disabled:cursor-default"
                          >
                            {swapping ? "Upgrading…" : "Join Reserve Member"}
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Reserve Black */}
                <div className="rounded-2xl p-6 relative overflow-hidden glass-card glass-card-light">
                  <div className="absolute top-0 left-0 right-0 h-1 bg-obsidian" />
                  <span className="text-[11px] tracking-[0.25em] uppercase text-charcoal/50 font-medium">
                    Reserve Black
                  </span>
                  <div className="mt-2 mb-4">
                    <span className="font-serif text-2xl text-obsidian">Invite Only</span>
                  </div>
                  <div className="border-t border-taupe/12 pt-4">
                    <ul className="space-y-2 mb-5">
                      <ModalFeature text="Everything in Member" />
                      <ModalFeature text="$1,000 quarterly credit" />
                      <ModalFeature text="Personal stylist" />
                      <ModalFeature text="Concierge phone line" />
                    </ul>
                    <div className="inline-block h-11 px-8 leading-[2.75rem] rounded-xl border border-charcoal/15 text-charcoal/40 text-sm font-medium tracking-wider uppercase cursor-default">
                      By Invitation
                    </div>
                  </div>
                </div>
              </div>

              {swapError && (
                <p className="text-center text-xs text-red-500 mt-4">{swapError}</p>
              )}

              <p className="text-center text-xs text-charcoal/35 mt-6 leading-relaxed">
                Cancel or change plans anytime. Complete your fit profile in onboarding or from your Account page.
              </p>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ═══════════════════════════════════════════
   SHARED FIT SUB-COMPONENTS
   (also exported for use in onboarding)
   ═══════════════════════════════════════════ */

export const FIT_SHIRT_SIZES = ["S", "M", "L", "XL", "XXL"];
export const FIT_GLOVE_HANDS = ["Left", "Right"];
export const FIT_GLOVE_SIZES = ["S", "M", "ML", "L", "XL"];
export const FIT_WAIST_SIZES = ["28", "30", "32", "34", "36", "38", "40"];
export const FIT_SHOE_SIZES = ["7", "7.5", "8", "8.5", "9", "9.5", "10", "10.5", "11", "11.5", "12", "13"];
export const FIT_PANTS_INSEAMS = ["28\"", "30\"", "32\"", "34\""];
export const FIT_SHORTS_INSEAMS = ["7\"", "9\"", "10\""];

export function FitDots({ current }: { current: number }) {
  return (
    <div className="flex items-center justify-center gap-0 mb-6">
      {[1, 2].map((dot) => (
        <div key={dot} className="flex items-center">
          <div
            className={`w-2 h-2 rounded-full transition-all duration-500 ${
              current >= dot ? "bg-forest" : "bg-taupe/30"
            }`}
          />
          {dot < 2 && (
            <div className="w-8 h-px mx-1">
              <div
                className={`h-full rounded-full transition-all duration-500 ${
                  current > dot ? "bg-forest" : "bg-taupe/20"
                }`}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function FitNav({
  onBack,
  onSkip,
  onNext,
  isLast,
}: {
  onBack: () => void;
  onSkip: () => void;
  onNext: () => void;
  isLast?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <button
        onClick={onBack}
        className="text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer flex items-center gap-1.5"
      >
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 19.5L8.25 12l7.5-7.5" />
        </svg>
        Back
      </button>
      <div className="flex items-center gap-4">
        <button
          onClick={onSkip}
          className="text-sm text-charcoal/40 hover:text-charcoal/60 transition-colors duration-300 cursor-pointer"
        >
          Skip
        </button>
        <button
          onClick={onNext}
          className="h-11 px-8 rounded-xl text-sm font-medium tracking-wider uppercase transition-all duration-300 cursor-pointer btn-press bg-forest text-bone hover:bg-forest-dark"
        >
          {isLast ? "Finish" : "Next"}
        </button>
      </div>
    </div>
  );
}

export function PillButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 rounded-xl text-sm transition-all duration-300 cursor-pointer border ${
        active
          ? "bg-forest text-bone border-forest"
          : "bg-cream border-taupe/25 text-charcoal/70 hover:border-forest/40"
      }`}
    >
      {label}
    </button>
  );
}

/* ── Internal to modal ── */

function ModalFeature({ text, light }: { text: string; light?: boolean }) {
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
