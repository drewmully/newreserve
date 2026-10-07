/**
 * Klaviyo lifecycle foundation: configuration for the server-side events and
 * profile properties that power the Klaviyo flows (browse, cart, Reserve
 * intent, back in stock, member onboarding and win-back).
 *
 * Every feature has its own switch and is OFF unless its env var is "true"
 * AND KLAVIYO_PRIVATE_API_KEY is set. Nothing here is secret.
 */

export const SITE_URL = "https://www.mymully.com";

/** Klaviyo metric names. Changing a name creates a new metric in Klaviyo. */
export const LIFECYCLE_METRICS = {
  viewedProduct: "Mully Viewed Product",
  addedToCart: "Mully Added to Cart",
  reserveIntent: "Mully Reserve Intent",
  backInStock: "Mully Back in Stock",
} as const;

export type LifecycleFeature = "site_events" | "member_sync" | "restock";

const FLAG_ENV: Record<LifecycleFeature, string> = {
  site_events: "KLAVIYO_SITE_EVENTS_ENABLED",
  member_sync: "KLAVIYO_MEMBER_SYNC_ENABLED",
  restock: "KLAVIYO_RESTOCK_ENABLED",
};

export function isLifecycleEnabled(feature: LifecycleFeature): boolean {
  return process.env[FLAG_ENV[feature]] === "true" && Boolean(process.env.KLAVIYO_PRIVATE_API_KEY);
}

/** First-party identity cookie set after a website signup. */
export const IDENTITY_COOKIE = "mully_kid";
export const IDENTITY_MAX_AGE_SECONDS = 180 * 24 * 60 * 60;

/** Signing secret for the identity cookie. Returns null when unset or too short. */
export function identitySecret(): string | null {
  const secret = process.env.KLAVIYO_IDENTITY_SECRET ?? "";
  return secret.length >= 32 ? secret : null;
}

/**
 * Dedupe windows. Klaviyo drops events whose unique_id it has already seen,
 * so the bucket size is the minimum gap between two identical events.
 */
export const VIEW_DEDUPE_MINUTES = 30;
export const CART_DEDUPE_MINUTES = 5;
export const RESERVE_INTENT_DEDUPE_MINUTES = 60;

/** Back-in-stock requests older than this are expired instead of notified. */
export const RESTOCK_MAX_AGE_DAYS = 120;
