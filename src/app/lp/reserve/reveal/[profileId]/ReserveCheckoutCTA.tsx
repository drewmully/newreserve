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

/**
 * Storage bridge used by /lp/discover. When a visitor picks a tier on that
 * page we stash the choice under this key so the reveal CTA (this file) can
 * apply the matching Shopify discount code + cart attribute + FIRST-BOX
 * line-item property when it starts checkout. Cleared once consumed so a
 * later organic visit to /lp/reserve/reveal doesn't accidentally reapply.
 *
 * The tier -> discount-code -> display-name map is inlined here (rather
 * than imported from DiscoverLPClient) so this reveal path stays a
 * self-contained page and doesn't force a bundle from the discover LP.
 */
const DISCOVER_TIER_STORAGE_KEY = "mully_discover_tier";
const DISCOVER_TIER_MAP: Record<
  string,
  { code: string; label: string; firstBoxPrice: string }
> = {
  discovery: {
    code: "MULLY_DISCOVER",
    label: "Discovery",
    firstBoxPrice: "$50",
  },
  signature: {
    code: "MULLY_SIGNATURE",
    label: "Signature Preview",
    firstBoxPrice: "$125",
  },
  reserve: {
    code: "", // full-price tier, no code applied
    label: "Reserve Collection",
    firstBoxPrice: "$250",
  },
};

function readAndConsumeDiscoverTier():
  | { tier: string; code: string; label: string; firstBoxPrice: string }
  | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(DISCOVER_TIER_STORAGE_KEY);
    if (!raw) return null;
    const meta = DISCOVER_TIER_MAP[raw];
    if (!meta) {
      window.localStorage.removeItem(DISCOVER_TIER_STORAGE_KEY);
      return null;
    }
    // Do NOT consume here — checkout may be retried after an error. The
    // orders-paid webhook is the authoritative consumer via note-attr.
    return { tier: raw, ...meta };
  } catch {
    return null;
  }
}

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

    // Read the mr_ab bucket cookie so we can stamp the /lp/consult A/B
    // arm the visitor started on onto both the PostHog reveal_cta_clicked
    // event and the Shopify checkout attributes. This is what lets us tie
    // final Purchase back to modal_quiz vs inline_quiz for CVR analysis.
    // Cookie-based (not prop-based) because the reveal page can be reached
    // from either arm without a variant hint in the URL.
    const mrAb = (() => {
      if (typeof document === "undefined") return null;
      const match = document.cookie.match(/(?:^|;\s*)mr_ab=(\d+)/);
      if (!match) return null;
      const n = Number(match[1]);
      if (!Number.isFinite(n)) return null;
      return n;
    })();
    const abVariant: "modal_quiz" | "inline_quiz" | null =
      mrAb === null ? null : mrAb >= 50 ? "inline_quiz" : "modal_quiz";

    trackEvent(
      "reveal_cta_clicked",
      {
        properties: {
          profileId,
          styleBucket,
          tier: "member",
          source: "lp_reveal",
          ab_variant: abVariant,
          mr_ab_bucket: mrAb,
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

    // /lp/discover bridge. If the visitor picked a tier on /lp/discover
    // before starting the quiz, apply the matching discount code, stamp a
    // discover_tier cart attribute for the orders-paid webhook, override
    // the lp_source for attribution, and add a VISIBLE First Box Edition
    // line-item property so the ShipHero packing slip and Shopify admin
    // line item show the picker which edit to pack.
    const discover = readAndConsumeDiscoverTier();
    if (discover) {
      lineProps.push({
        key: "First Box Edition",
        value: discover.label,
      });
    }

    try {
      await createMembershipCheckout("member", {
        returnPath: "/auth/callback",
        discountCodes: discover && discover.code ? [discover.code] : undefined,
        attributes: [
          {
            key: "lp_source",
            value: discover ? "lp_discover" : "lp_reveal",
          },
          { key: "quiz_profile_id", value: profileId },
          { key: "style_bucket", value: styleBucket },
          // Discover tier is the signal the orders-paid webhook reads to
          // apply the discover-tier-<tier> order tag on the first order.
          ...(discover
            ? [{ key: "discover_tier", value: discover.tier }]
            : []),
          // A/B stamps flow into Shopify order attributes so the
          // orders-paid webhook can pass them through to PostHog
          // purchase events, closing the funnel loop by arm.
          ...(abVariant
            ? [{ key: "ab_variant", value: abVariant }]
            : []),
          ...(mrAb !== null
            ? [{ key: "mr_ab_bucket", value: String(mrAb) }]
            : []),
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
        {loading ? "Opening checkout…" : "Start your Reserve — $250 / quarter"}
      </button>
      {error && (
        <p className="mt-3 text-center text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
