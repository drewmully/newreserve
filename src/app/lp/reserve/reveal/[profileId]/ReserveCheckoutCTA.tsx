"use client";

/**
 * Client island used by the SSR reveal page to start a Shopify membership
 * checkout while preserving the quiz attribution.
 *
 * Why a client island instead of a server form?
 *   `createMembershipCheckout` reads attribution from localStorage + sets
 *   cart attributes for the Shopify checkout origin. It must run in the
 *   browser. We pass only the profileId + styleBucket from the server so
 *   the CTA can stamp them onto the cart for later attribution joins.
 */

import { useCallback, useState } from "react";
import { createMembershipCheckout } from "@/lib/shopifyCheckout";
import { trackEvent } from "@/lib/tracking";
import type { StyleBucket } from "@/lib/styleProfiles/types";

export function ReserveCheckoutCTA({
  profileId,
  styleBucket,
}: {
  profileId: string;
  styleBucket: StyleBucket;
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

    try {
      await createMembershipCheckout("member", {
        returnPath: "/auth/callback",
        attributes: [
          { key: "lp_source", value: "lp_reveal" },
          { key: "quiz_profile_id", value: profileId },
          { key: "style_bucket", value: styleBucket },
        ],
      });
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : "Could not start checkout. Try again, or email drew@mymully.com."
      );
      setLoading(false);
    }
  }, [profileId, styleBucket]);

  return (
    <div>
      <button
        type="button"
        onClick={onClick}
        disabled={loading}
        className="w-full rounded-xl bg-zinc-900 py-5 text-lg font-medium text-white transition hover:bg-black disabled:cursor-not-allowed disabled:opacity-60"
      >
        {loading ? "Opening checkout…" : "Start your Reserve — $250"}
      </button>
      {error && (
        <p className="mt-3 text-center text-sm text-red-600" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}
