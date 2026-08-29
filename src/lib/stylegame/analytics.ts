/**
 * Server-side Style Game analytics.
 *
 * PostHog-only captures for the Style Game funnel lifecycle. Keeps
 * server-side events off Meta / GA / Google Ads on purpose:
 *
 *   - Meta only fires Purchase for RES-MEM SKUs (PR #101 gating). The
 *     Style Game $5 review is a different intent signal and shouldn't
 *     pollute the pixel that ad delivery optimizes against.
 *   - Google Ads purchase upload rides on PR #121 (uploadClickConversions),
 *     not on this path.
 *   - GA4 gets the funnel from the client-side `sg_*` captures in the
 *     game HTML — no server duplication needed.
 *
 * Public surface:
 *   captureStylegameEvent(event, distinctId, properties?)
 *
 * `distinctId` should be the `mully_anon_id` for played/checkout events
 * (matches client-side identify), and the `shopify_customer_id` (as a
 * string) once the customer is identified through Loop.
 */

import { PostHog } from "posthog-node";

/** Style Game funnel event names. Keep in sync with the game HTML config. */
export type StylegameEvent =
  | "sg_played" // server received /api/stylegame/played
  | "sg_checkout_start" // server received /api/stylegame/checkout
  | "sg_paid" // orders/paid webhook matched a stylegame_lead
  | "sg_approved" // /api/stylegame/approve succeeded
  | "sg_declined" // /api/stylegame/decline succeeded
  | "sg_billed" // future: cycle 2 fired
  | "sg_refunded"; // future: cycle 2 refunded

/**
 * Best-effort PostHog capture. Never throws — caller code is not blocked
 * by analytics failure. Missing PostHog env vars → silent no-op (matches
 * the existing `firePostHog` behavior in _lib/analytics.ts).
 */
export async function captureStylegameEvent(
  event: StylegameEvent,
  distinctId: string | null | undefined,
  properties?: Record<string, unknown>,
): Promise<void> {
  const apiKey =
    process.env.POSTHOG_PROJECT_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return;

  const distinct = (distinctId ?? "").trim() || "stylegame_anon_unknown";

  const host =
    process.env.POSTHOG_HOST ??
    process.env.NEXT_PUBLIC_POSTHOG_HOST ??
    "https://us.i.posthog.com";

  const posthog = new PostHog(apiKey, { host });

  try {
    posthog.capture({
      distinctId: distinct,
      event,
      properties: {
        funnel: "stylegame",
        $lib: "mully-server",
        ...(properties ?? {}),
      },
    });
  } catch (err) {
    // Swallow — analytics failure must never block Style Game business logic.
    console.error("[stylegame/analytics] posthog capture failed", {
      event,
      err: (err as Error)?.message,
    });
  } finally {
    try {
      await posthog.shutdown();
    } catch {
      /* ignore shutdown errors */
    }
  }
}
