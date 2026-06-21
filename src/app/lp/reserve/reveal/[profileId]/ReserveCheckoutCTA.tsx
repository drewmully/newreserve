"use client";

/**
 * Client island used by the SSR reveal page to start a Shopify membership
 * checkout while preserving the quiz attribution.
 *
 * Why a client island instead of a server form?
 *   `createMembershipCheckout` reads attribution from localStorage + sets
 *   cart attributes for the Shopify checkout origin. It must run in the
 *   browser. We pass only the profileId + styleBucket + line-item-property
 *   payload from the server so the CTA can stamp them onto the cart for
 *   later attribution + fulfillment.
 */

import { useCallback, useState } from "react";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { trackEvent } from "@/lib/tracking";
import type { StyleBucket } from "@/lib/styleProfiles/types";

export interface QuizLineItemPropsInput {
  styleBucket: StyleBucket | null;
  styleLabel: string | null;
  categoryPrefs: string[];
  fit: string | null;
  topSize: string | null;
  bottomSize: string | null;
  favoriteBrands: string[];
  playFrequency: string | null;
}

export function ReserveCheckoutCTA({
  profileId,
  styleBucket,
  quizLineItemProps,
}: {
  profileId: string;
  styleBucket: StyleBucket;
  /** Quiz answers to stamp onto the Reserve subscription line as Shopify
   *  line item properties. Visible in admin + order webhook. */
  quizLineItemProps: QuizLineItemPropsInput;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onClick = useCallback(async () => {
    setError(null);
    setLoading(true);
    trackEvent(
      "reveal_cta_clicked",
      {
        properties: {
          profileId,
          styleBucket,
          tier: "member",
          source: "lp_reveal",
        },
      },
      { includeAuth: false }
    ).catch(() => {});

    // Build line item properties. Underscore prefix hides them from the
    // storefront checkout summary but keeps them visible in Shopify admin
    // and the orders/paid webhook payload.
    const lineProps: Array<{ key: string; value: string }> = [
      { key: "_quiz_profile_id", value: profileId },
      {
        key: "Style",
        value: quizLineItemProps.styleLabel ?? styleBucket,
      },
    ];
    if (quizLineItemProps.fit) {
      lineProps.push({ key: "Fit", value: quizLineItemProps.fit });
    }
    if (quizLineItemProps.topSize) {
      lineProps.push({ key: "Top size", value: quizLineItemProps.topSize });
    }
    if (quizLineItemProps.bottomSize) {
      lineProps.push({ key: "Waist", value: quizLineItemProps.bottomSize });
    }
    if (quizLineItemProps.categoryPrefs.length) {
      lineProps.push({
        key: "Categories",
        value: quizLineItemProps.categoryPrefs.join(", "),
      });
    }
    if (quizLineItemProps.favoriteBrands.length) {
      lineProps.push({
        key: "Favorite brands",
        value: quizLineItemProps.favoriteBrands.join(", "),
      });
    }
    if (quizLineItemProps.playFrequency) {
      lineProps.push({
        key: "_play_frequency",
        value: quizLineItemProps.playFrequency,
      });
    }

    // Fired immediately before the redirect handoff. The gap between
    // reveal_cta_clicked and checkout_redirect_started measures any
    // checkout-build failures; the gap between this event and purchase
    // measures the Shopify-side drop. Without these intermediate events
    // we cannot tell which leg of the funnel is leaking.
    trackEvent(
      "checkout_redirect_started",
      {
        properties: {
          profileId,
          styleBucket,
          tier: "member",
          source: "lp_reveal",
        },
      },
      { includeAuth: false }
    ).catch(() => {});

    try {
      await createMembershipCheckout("member", {
        returnPath: "/auth/callback",
        attributes: [
          { key: "lp_source", value: "lp_reveal" },
          { key: "quiz_profile_id", value: profileId },
          { key: "style_bucket", value: styleBucket },
        ],
        subscriptionLineAttributes: lineProps,
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not start checkout. Try again, or email drew@mymully.com."
      );
      setLoading(false);
    }
  }, [profileId, styleBucket, quizLineItemProps]);

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="w-full rounded-md bg-ember py-4 text-base font-medium tracking-wide text-bone transition hover:bg-ember/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Opening checkout…" : "Claim my Q3 Reserve edit"}
      </button>
      {error && (
        <p className="mt-3 text-center text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
