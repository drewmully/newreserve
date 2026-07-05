"use client";

/**
 * Guest-only Access upsell.
 *
 * Appears as a small, dismissible sheet at the bottom of the screen the
 * *first time* an anonymous visitor adds a product to their cart. Never
 * shown to signed-in users, never shown to paid tiers, never shown twice
 * per session.
 *
 * Behavior on tap:
 *   - We do NOT try to combine the $99/yr subscription into the visitor's
 *     current product cart. Reasons:
 *       1. Shopify Storefront `CartLineInput` in our `src/lib/shopify.ts`
 *          doesn't carry `sellingPlanId`; adding it there is a real,
 *          testable change touching the entire cart flow.
 *       2. The Reserve Access variant sells as a *subscription* — Loop
 *          expects the subscription line to originate from a canonical
 *          membership checkout, which is what `createMembershipCheckout`
 *          builds. Trying to mix a subscription line into a one-time
 *          product cart risks breaking Loop attribution + our orders-paid
 *          webhook.
 *   - Instead: we send them to the existing Access membership checkout,
 *     which is already wired end-to-end. The products they added stay in
 *     their guest cart (localStorage-persisted) and are still there when
 *     they return authenticated.
 *
 * If/when we want a true one-click "membership + first order" flow, the
 * work is:
 *   (a) Extend CartLineInput + cartLinesAdd to accept sellingPlanId.
 *   (b) Have this component call cartLinesAdd on the *current* cart with
 *       the Access merchandiseId + sellingPlanGid.
 *   (c) Verify Loop still recognizes the subscription line.
 *   (d) Verify orders-paid webhook handles the mixed order.
 */

import { useCallback, useEffect, useState } from "react";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { trackEvent } from "@/lib/tracking";

const DISMISS_KEY = "mully_editorial_access_upsell_dismissed";

interface AccessUpsellProps {
  /** Toggle from parent when a guest adds an item to cart. */
  visible: boolean;
  onDismiss: () => void;
}

export function AccessUpsell({ visible, onDismiss }: AccessUpsellProps) {
  const [loading, setLoading] = useState(false);
  const [everDismissed, setEverDismissed] = useState(false);

  useEffect(() => {
    try {
      setEverDismissed(sessionStorage.getItem(DISMISS_KEY) === "1");
    } catch {
      // sessionStorage disabled — treat as not dismissed
    }
  }, []);

  const dismiss = useCallback(() => {
    try {
      sessionStorage.setItem(DISMISS_KEY, "1");
    } catch {}
    setEverDismissed(true);
    onDismiss();
    void trackEvent("editorial_access_upsell_dismissed", { properties: {} });
  }, [onDismiss]);

  const activate = useCallback(async () => {
    if (loading) return;
    setLoading(true);
    void trackEvent("editorial_access_upsell_clicked", { properties: {} });
    try {
      await createMembershipCheckout("access", {
        attributes: [
          { key: "mully_upsell_source", value: "editorial_lp" },
        ],
      });
    } catch (err) {
      console.error("[AccessUpsell] checkout failed:", err);
      setLoading(false);
    }
  }, [loading]);

  const shouldShow = visible && !everDismissed;

  return (
    <div
      role="region"
      aria-label="Reserve Access offer"
      className={`fixed bottom-0 inset-x-0 z-30 px-4 pb-4 md:pb-6 pointer-events-none transition-transform duration-500 ${
        shouldShow ? "translate-y-0" : "translate-y-[120%]"
      }`}
    >
      <div className="pointer-events-auto mx-auto max-w-2xl bg-forest text-bone rounded-sm shadow-2xl overflow-hidden">
        <div className="px-5 py-4 md:px-6 md:py-5 flex items-center gap-4">
          <div className="flex-1 min-w-0">
            <div className="text-[10px] tracking-[0.25em] uppercase text-bone/60 mb-1">
              Before you check out
            </div>
            <div className="font-serif text-lg md:text-xl leading-snug">
              Add Reserve Access — <span className="text-bone/85">$99/yr, 15% off everything.</span>
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              onClick={activate}
              disabled={loading}
              className="px-4 py-2.5 bg-bone text-forest text-[11px] tracking-[0.22em] uppercase font-medium rounded-sm hover:bg-cream transition-colors cursor-pointer disabled:opacity-60 disabled:cursor-wait"
            >
              {loading ? "Loading…" : "Add"}
            </button>
            <button
              onClick={dismiss}
              aria-label="Dismiss"
              className="w-9 h-9 flex items-center justify-center text-bone/60 hover:text-bone transition-colors cursor-pointer"
            >
              <svg width="14" height="14" viewBox="0 0 14 14" stroke="currentColor" strokeWidth="1.4">
                <line x1="2" y1="2" x2="12" y2="12" />
                <line x1="12" y1="2" x2="2" y2="12" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
