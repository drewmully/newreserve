import posthog from "posthog-js";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    defaults: "2026-01-30",
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
  });
} else if (process.env.NODE_ENV === "development") {
  console.warn(
    "[PostHog] NEXT_PUBLIC_POSTHOG_KEY no esta definido. Tracking desactivado."
  );
}
