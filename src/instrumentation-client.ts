import posthog from "posthog-js";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    defaults: "2026-01-30",
    // Person profiles: "always" so anonymous LP viewers get a person profile
    // and $anon_distinct_id merges land correctly at signup / purchase. Prior
    // to 2026-07-18 this defaulted to "identified_only", which caused ~86% of
    // purchases to orphan-fail their alias merge back to the pre-signup anon
    // session (verified via HogQL: only 70 of 486 purchases in the prior 30d
    // were stitched to a same-person lp_view). This also enables auto-
    // populated $initial_utm_source / $initial_referrer / $initial_pathname
    // person properties.
    person_profiles: "always",
    // Client capture is enabled so PostHog Toolbar, heatmaps, dead-click /
    // rageclick detection, autocapture funnels, and session replay all work
    // on the live site. Business events (purchase, lp_subscription_*) still
    // fire server-side via /api/analytics/track for high-fidelity attribution.
    // PostHog dedupes by $insert_id, so the two streams coexist.
    autocapture: true,
    capture_dead_clicks: true,
    capture_heatmaps: true,
    capture_pageleave: true,
    // capture_pageview handled manually via AnalyticsTracker (page_view custom
    // event with full attribution + anonymous_id). We disable PostHog's
    // built-in $pageview to avoid double-counting page views in insights /
    // dashboards. Session replay + heatmaps continue to work — they attach
    // to the manual page_view via $insert_id linkage.
    capture_pageview: false,
    capture_performance: true,
    // Session replay: no masking (per Drew, 2026-06-03) — maximum debugging
    // signal. NOTE: this captures form values including email / address.
    // Revisit before launching any form that collects payment data outside
    // of Shopify's hosted checkout.
    disable_session_recording: false,
    session_recording: {
      maskAllInputs: false,
      maskTextSelector: undefined,
    },
    disable_surveys: true,
    disable_surveys_automatic_display: true,
    opt_out_useragent_filter: false,
  });
} else if (process.env.NODE_ENV === "development") {
  console.warn(
    "[PostHog] NEXT_PUBLIC_POSTHOG_KEY no esta definido. Tracking desactivado."
  );
}
