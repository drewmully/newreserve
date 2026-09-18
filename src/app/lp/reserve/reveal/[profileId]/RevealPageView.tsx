"use client";

/**
 * Mount-once analytics beacon for the SSR reveal page.
 * Fires `reveal_viewed` to client analytics (PostHog autocapture, GA4 client,
 * Meta browser pixel) — server-side dispatchers are not invoked from the
 * reveal page itself; the visitor is already past the email gate.
 */

import { useEffect } from "react";
import { trackEvent } from "@/lib/tracking";
import type { StyleBucket } from "@/lib/styleProfiles/types";

export function RevealPageView({
  profileId,
  bucket,
  variant,
}: {
  profileId: string;
  bucket: StyleBucket;
  /**
   * Optional reveal variant tag included in the analytics event so we can
   * segment reveal_viewed by generation:
   *   v1 — legacy edit-grid page
   *   v2 — pick-ticket Brick
   *   v3_tier_picker — current: three-tier selection surface (2026-09-18)
   */
  variant?: "v1" | "v2" | "v3_tier_picker";
}) {
  useEffect(() => {
    trackEvent(
      "reveal_viewed",
      {
        properties: {
          profileId,
          styleBucket: bucket,
          source: "lp_reveal",
          ...(variant ? { variant } : {}),
        },
      },
      { includeAuth: false }
    ).catch(() => {});
  }, [profileId, bucket, variant]);
  return null;
}
