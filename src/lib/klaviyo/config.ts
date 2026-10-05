/**
 * Klaviyo signup sync configuration.
 *
 * Nothing here is secret. The private key lives only in the Vercel env var
 * KLAVIYO_PRIVATE_API_KEY and is read at call time by ./client.ts.
 */

export const KLAVIYO_BASE_URL = "https://a.klaviyo.com";

/** Klaviyo API revision. Matches the default on Klaviyo's reference pages (Oct 2026). */
export const KLAVIYO_REVISION = "2026-07-15";

/**
 * "Mully | Website Signups". Consented website signups are subscribed into
 * this list. It is single opt-in and is the future welcome-flow trigger.
 * Set after the list is created in Klaviyo. While empty, consented stages
 * fail with `list_not_configured` and are retried, so nothing is lost.
 */
export const KLAVIYO_SIGNUP_LIST_ID = "SFJgUB";

/** Klaviyo metric name for every on-site capture. */
export const SIGNUP_METRIC = "Mully Site Signup";

/**
 * Q1 decision (Oct 4, 2026): popup SMS opt-ins are subscribed to Klaviyo SMS.
 * The popup shows the full SMS_CONSENT disclosure with an unticked checkbox,
 * so the request itself carries explicit SMS consent.
 */
export const SUBSCRIBE_POPUP_SMS = true;

/** Retry backoff in minutes, indexed by attempts already made (1-based). */
export const BACKOFF_MINUTES = [1, 5, 15, 30, 60, 120, 240, 480] as const;
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

/** Per-request timeout for a single Klaviyo call. */
export const REQUEST_TIMEOUT_MS = 5_000;

/** Every Klaviyo call (route hooks, cron, replay, backfill) is gated on this. */
export function isKlaviyoSyncEnabled(): boolean {
  return (
    process.env.KLAVIYO_SYNC_ENABLED === "true" &&
    Boolean(process.env.KLAVIYO_PRIVATE_API_KEY)
  );
}

/** Firestore collections the sync worker drains. */
export const SYNC_COLLECTIONS = [
  "shop_marketing_leads",
  "editorial_drop_list",
  "back_in_stock_requests",
  "klaviyo_sync_jobs",
] as const;
export type SyncCollection = (typeof SYNC_COLLECTIONS)[number];

export function isSyncCollection(value: unknown): value is SyncCollection {
  return typeof value === "string" && (SYNC_COLLECTIONS as readonly string[]).includes(value);
}
