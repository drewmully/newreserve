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
}: {
  profileId: string;
  bucket: StyleBucket;
}) {
  useEffect(() => {
    trackEvent(
      "reveal_viewed",
      {
        properties: { profileId, styleBucket: bucket, source: "lp_reveal" },
      },
      { includeAuth: false }
    ).catch(() => {});
  }, [profileId, bucket]);
  return null;
}
