/**
 * Small helper that mirrors the daily ad_spend rows we already persist to
 * Supabase (marketing_spend_daily) into PostHog as an `ad_spend_daily`
 * event.
 *
 * Why: our PostHog growth dashboard needs blended CAC (spend / new_subs).
 * The subscription-purchase side already lives in PostHog. Blending
 * previously required a manual SQL join across Supabase — this helper
 * lets us keep spend + conversions in one place and query them together.
 *
 * The event is idempotent per (date, channel): capturing the same day
 * twice will produce two events, but the dashboard tile groups by day and
 * uses `max()` on the spend so re-runs during the 14-day Meta drift
 * window overwrite cleanly without inflating totals.
 *
 * Failure is non-fatal — spend is already durable in Supabase, so we log
 * and continue rather than break the cron.
 */

import { PostHog } from "posthog-node";

const CAPTURE_KEY = "phc_kq84Jxc8iEWeVwcfbkSP4q8PmMMaD6bCGOTDk7D717b";

export async function postAdSpendToPostHog(input: {
  channel: "google_ads" | "meta_ads";
  rows: Array<{
    spend_date: string;
    amount: number;
    impressions?: number | null;
    clicks?: number | null;
    initiate_checkouts?: number | null;
    purchases?: number | null;
  }>;
}): Promise<{ captured: number; skipped: boolean; error?: string }> {
  if (input.rows.length === 0) {
    return { captured: 0, skipped: true };
  }

  const apiKey =
    process.env.POSTHOG_PROJECT_API_KEY ??
    process.env.NEXT_PUBLIC_POSTHOG_KEY ??
    CAPTURE_KEY;

  const host =
    process.env.POSTHOG_HOST ??
    process.env.NEXT_PUBLIC_POSTHOG_HOST ??
    "https://us.i.posthog.com";

  const posthog = new PostHog(apiKey, { host });
  let captured = 0;

  try {
    for (const row of input.rows) {
      posthog.capture({
        distinctId: "system_ad_spend_cron",
        event: "ad_spend_daily",
        properties: {
          date: row.spend_date,
          channel: input.channel,
          spend: Number(row.amount ?? 0),
          impressions: Number(row.impressions ?? 0),
          clicks: Number(row.clicks ?? 0),
          initiate_checkouts: Number(row.initiate_checkouts ?? 0),
          purchases: Number(row.purchases ?? 0),
          source: `cron:${input.channel}_spend`,
        },
      });
      captured++;
    }
    return { captured, skipped: false };
  } catch (err) {
    return {
      captured,
      skipped: false,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    // Flush pending events before the request lifecycle ends.
    try {
      await posthog.shutdown();
    } catch (err) {
      console.error("[postAdSpendToPostHog] shutdown failed", err);
    }
  }
}
