"use client";

import { useEffect } from "react";
import posthog from "posthog-js";

export function PostHogFlagSync({
  flags,
}: {
  flags: Record<string, string>;
}) {
  useEffect(() => {
    if (posthog.__loaded) {
      posthog.register(flags);
    }
  }, [flags]);

  return null;
}
