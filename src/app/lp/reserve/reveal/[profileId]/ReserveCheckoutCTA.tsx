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
 *
 * Tier picker (2026-09-18):
 *   The reveal page is now a 3-tier picker. The visitor's selected tier is
 *   passed to this button as a prop rather than read from localStorage. The
 *   old /lp/discover localStorage bridge (mully_discover_tier) is removed
 *   because /lp/discover is retired and the tier decision now happens on
 *   the reveal page itself. The Shopify discount codes and cart attributes
 *   remain unchanged, so the orders-paid webhook and downstream fulfillment
 *   still work exactly as they did before.
 */

import { useCallback, useState } from "react";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { trackEvent } from "@/lib/tracking";
import type { StyleBucket } from "@/lib/styleProfiles/types";

/**
 * Canonical tier taxonomy for the reveal page.
 *
 * The tier ids match the storage/event taxonomy used since 2026-06 on the
 * previous /lp/discover tier picker. Discovery and Signature carry Shopify
 * discount codes that reduce the first quarter's price; Reserve is the full
 * quarterly rate. Every tier renews at $250 / quarter after the first.
 */
export type ReserveTier = "discovery" | "signature" | "reserve";

export const TIER_META: Record<
  ReserveTier,
  { code: string; label: string; firstBoxPrice: string; renewalCopy: string }
> = {
  discovery: {
    code: "MULLY_DISCOVER",
    label: "Discovery",
    firstBoxPrice: "$50",
    renewalCopy: "then $250 / quarter",
  },
  signature: {
    code: "MULLY_SIGNATURE",
    label: "Signature Preview",
    firstBoxPrice: "$125",
    renewalCopy: "then $250 / quarter",
  },
  reserve: {
    code: "", // full-price tier, no code applied
    label: "Reserve Collection",
    firstBoxPrice: "$250",
    renewalCopy: "$250 / quarter",
  },
};

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
  tier,
  quizLineItemProps,
}: {
  profileId: string;
  styleBucket: StyleBucket;
  /**
   * Reserve tier chosen on the reveal page. Determines the discount code +
   * cart attribute stamped on checkout. Required — no localStorage fallback.
   */
  tier: ReserveTier;
  /** Quiz answers to stamp onto the Reserve subscription line as Shopify
   *  line item properties. Visible in admin + order webhook. */
  quizLineItemProps: QuizLineItemPropsInput;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const tierMeta = TIER_META[tier];

  const onClick = useCallback(async () => {
    setError(null);
    setLoading(true);

    trackEvent(
      "reveal_cta_clicked",
      {
        properties: {
          profileId,
          styleBucket,
          tier, // discovery | signature | reserve
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
    // Visible first-box edition line-item property — surfaces on ShipHero
    // packing slips and Shopify admin so fulfillment knows which edit to pack.
    lineProps.push({
      key: "First Box Edition",
      value: tierMeta.label,
    });

    try {
      await createMembershipCheckout("member", {
        returnPath: "/auth/callback",
        discountCodes: tierMeta.code ? [tierMeta.code] : undefined,
        attributes: [
          { key: "lp_source", value: "lp_reveal" },
          { key: "quiz_profile_id", value: profileId },
          { key: "style_bucket", value: styleBucket },
          // Tier chosen on the reveal picker; the orders-paid webhook reads
          // this to apply a discover-tier-<tier> order tag on the first order
          // (kept as `discover_tier` for backward compatibility with the
          // existing webhook + downstream reporting).
          { key: "discover_tier", value: tier },
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
  }, [profileId, styleBucket, tier, tierMeta, quizLineItemProps]);

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="w-full rounded-md bg-ember py-4 text-base font-medium tracking-wide text-bone transition hover:bg-ember/90 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading
          ? "Opening checkout…"
          : `Start Reserve · ${tierMeta.firstBoxPrice} first quarter`}
      </button>
      {error && (
        <p className="mt-3 text-center text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
