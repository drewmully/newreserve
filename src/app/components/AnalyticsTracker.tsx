"use client";

/**
 * AnalyticsTracker — fires a `page_view` event on every route change.
 *
 * Without this, PostHog stays empty: client-side `capture_pageview` is
 * disabled in instrumentation-client.ts (see comment there explaining the
 * server-side dispatch pattern), but nothing else was calling trackEvent()
 * on navigation. Net result: 0 sessions, 0 attribution, 0 visibility.
 *
 * This component listens for path/search changes and POSTs each pageview
 * through /api/analytics/track, which writes to PostHog server-side and
 * stamps gclid/fbclid/utm/anon_id/session_id for attribution.
 */

import { Suspense, useEffect, useRef } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { trackEvent } from "@/lib/tracking";

function AnalyticsTrackerInner() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const lastTracked = useRef<string | null>(null);

  useEffect(() => {
    if (!pathname) return;
    const search = searchParams?.toString() ?? "";
    const fullPath = search ? `${pathname}?${search}` : pathname;

    // Dedupe — React StrictMode + double-mount can fire twice on the same path.
    if (lastTracked.current === fullPath) return;
    lastTracked.current = fullPath;

    // Fire-and-forget. trackEvent already handles its own errors.
    void trackEvent("page_view", {
      path: pathname,
      url: typeof window !== "undefined" ? window.location.href : undefined,
      referrer:
        typeof document !== "undefined" ? document.referrer || undefined : undefined,
      search: search || undefined,
    });
  }, [pathname, searchParams]);

  return null;
}

export function AnalyticsTracker() {
  // useSearchParams requires a Suspense boundary in app router.
  return (
    <Suspense fallback={null}>
      <AnalyticsTrackerInner />
    </Suspense>
  );
}
