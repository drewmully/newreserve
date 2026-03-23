import posthog from "posthog-js";

const posthogKey = process.env.NEXT_PUBLIC_POSTHOG_KEY;

if (posthogKey) {
  posthog.init(posthogKey, {
    api_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
    defaults: "2026-01-30",
  });
} else if (process.env.NODE_ENV === "development") {
  console.warn(
    "[PostHog] NEXT_PUBLIC_POSTHOG_KEY no esta definido. Tracking desactivado."
  );
}
