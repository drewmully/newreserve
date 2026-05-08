import posthog from "posthog-js";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    defaults: "2026-01-30",
    // Pageviews + most events are dispatched server-side via /api/analytics/track
    // (see src/lib/tracking.ts). The client SDK is kept lean for identify() +
    // feature flag eval. Bot UAs are filtered by PostHog defaults; we also flag
    // them server-side via the is_bot property in analytics.ts.
    autocapture: false,
    capture_dead_clicks: false,
    capture_heatmaps: false,
    capture_pageleave: false,
    capture_pageview: false,
    capture_performance: false,
    disable_session_recording: true,
    disable_surveys: true,
    disable_surveys_automatic_display: true,
    __preview_deferred_init_extensions: true,
    opt_out_useragent_filter: false,
  });
} else if (process.env.NODE_ENV === "development") {
  console.warn(
    "[PostHog] NEXT_PUBLIC_POSTHOG_KEY no esta definido. Tracking desactivado."
  );
}
