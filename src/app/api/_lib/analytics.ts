/**
 * Server-side analytics dispatcher.
 * Fires events to: Meta CAPI, GA4 Measurement Protocol,
 * Google Ads conversion ping, and PostHog capture API.
 *
 * All providers are fire-and-forget (Promise.allSettled).
 * A missing env var silently skips that provider.
 *
 * Required env vars per provider:
 *   Meta CAPI:    META_PIXEL_ID, META_ACCESS_TOKEN
 *   GA4:          GA4_MEASUREMENT_ID, GA4_API_SECRET
 *   Google Ads:   GOOGLE_ADS_CONVERSION_ID
 *                 GOOGLE_ADS_LABEL_PAGE_VIEW        (page_view events)
 *                 GOOGLE_ADS_LABEL_CHECKOUT_INIT    (initiate_checkout, checkout_clicked)
 *                 GOOGLE_ADS_LABEL_FUNNEL_CONVERSION (purchase events)
 *   PostHog:      POSTHOG_PROJECT_API_KEY or NEXT_PUBLIC_POSTHOG_KEY
 *                 POSTHOG_HOST or NEXT_PUBLIC_POSTHOG_HOST
 */

import crypto from "crypto";
import { PostHog } from "posthog-node";

export interface AnalyticsEvent {
  event_name: string;
  user_id?: string;
  anonymous_id?: string;
  email?: string;
  phone?: string;
  ip?: string;
  user_agent?: string;
  page_url?: string;
  segments?: string[];
  properties?: Record<string, unknown>;
  /** Unix epoch seconds */
  timestamp?: number;
}

// ─── Meta Conversions API ────────────────────────────────────────────────────

const META_EVENT_MAP: Record<string, string> = {
  page_view: "PageView",
  add_to_cart: "AddToCart",
  initiate_checkout: "InitiateCheckout",
  checkout_clicked: "InitiateCheckout",
  purchase: "Purchase",
  login: "Contact",
  wallet_viewed: "ViewContent",
  subscription_state: "Subscribe",
  registry_applied: "Lead",
};

function sha256hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function fireMetaCAPI(event: AnalyticsEvent): Promise<void> {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!pixelId || !accessToken) return;

  const userData: Record<string, unknown> = {};
  if (event.user_id) {
    userData.external_id = sha256hex(event.user_id.trim());
  }
  if (event.email)
    userData.em = sha256hex(event.email.trim().toLowerCase());
  if (event.phone)
    userData.ph = sha256hex(event.phone.replace(/\D/g, ""));
  const fbp = event.properties?.fbp;
  if (typeof fbp === "string" && fbp.trim().length > 0) {
    userData.fbp = fbp.trim();
  }
  const fbc = event.properties?.fbc;
  if (typeof fbc === "string" && fbc.trim().length > 0) {
    userData.fbc = fbc.trim();
  }
  if (event.ip) userData.client_ip_address = event.ip;
  if (event.user_agent) userData.client_user_agent = event.user_agent;

  await fetch(
    `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [
          {
            event_name: META_EVENT_MAP[event.event_name] ?? "CustomEvent",
            event_time:
              event.timestamp ?? Math.floor(Date.now() / 1000),
            user_data: userData,
            custom_data: {
              ...(event.properties ?? {}),
              user_id: event.user_id,
              segments: event.segments ?? [],
            },
            action_source: "website",
            event_source_url: event.page_url,
          },
        ],
      }),
    }
  );
}

// ─── GA4 Measurement Protocol ────────────────────────────────────────────────

async function fireGA4(event: AnalyticsEvent): Promise<void> {
  const measurementId = process.env.GA4_MEASUREMENT_ID;
  const apiSecret = process.env.GA4_API_SECRET;
  if (!measurementId || !apiSecret) return;
  const segmentTags =
    event.segments && event.segments.length > 0
      ? event.segments.join(",")
      : undefined;

  await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id:
          event.anonymous_id ??
          event.user_id ??
          `anon-${crypto.randomUUID()}`,
        user_id: event.user_id,
        events: [
          {
            name: event.event_name,
            params: {
              ...(event.properties ?? {}),
              page_location: event.page_url,
              reserve_user_id: event.user_id,
              segment_tags: segmentTags,
              engagement_time_msec: 100,
            },
          },
        ],
      }),
    }
  );
}

// ─── Google Ads conversion ping ──────────────────────────────────────────────

/** Maps event names to the env var key that holds the Google Ads label. */
const GOOGLE_ADS_LABEL_ENV: Record<string, string> = {
  page_view: "GOOGLE_ADS_LABEL_PAGE_VIEW",
  initiate_checkout: "GOOGLE_ADS_LABEL_CHECKOUT_INIT",
  checkout_clicked: "GOOGLE_ADS_LABEL_CHECKOUT_INIT",
  purchase: "GOOGLE_ADS_LABEL_FUNNEL_CONVERSION",
};

async function fireGoogleAds(event: AnalyticsEvent): Promise<void> {
  const conversionId = process.env.GOOGLE_ADS_CONVERSION_ID;
  if (!conversionId) return;

  const labelEnvKey = GOOGLE_ADS_LABEL_ENV[event.event_name];
  if (!labelEnvKey) return; // event type not tracked via Google Ads

  const label = process.env[labelEnvKey];
  if (!label) return;

  const url = new URL(
    `https://www.googleadservices.com/pagead/conversion/${conversionId}/`
  );
  url.searchParams.set("label", label);

  // Enrich purchase events with transaction data
  if (event.event_name === "purchase") {
    const value = (event.properties?.value as number) ?? 0;
    const currency = (event.properties?.currency as string) ?? "USD";
    const orderId = event.properties?.order_id as string | undefined;
    url.searchParams.set("value", String(value));
    url.searchParams.set("currency_code", currency);
    if (orderId) url.searchParams.set("transaction_id", orderId);
  }

  await fetch(url.toString(), { method: "GET" });
}

// ─── PostHog capture API ─────────────────────────────────────────────────────

async function firePostHog(event: AnalyticsEvent): Promise<void> {
  const apiKey =
    process.env.POSTHOG_PROJECT_API_KEY ??
    process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return;

  const host =
    process.env.POSTHOG_HOST ??
    process.env.NEXT_PUBLIC_POSTHOG_HOST ??
    "https://us.i.posthog.com";
  const distinctId = event.user_id ?? event.email ?? "anonymous";

  const posthog = new PostHog(apiKey, { host });

  try {
    posthog.capture({
      distinctId,
      event: event.event_name,
      properties: {
        ...(event.properties ?? {}),
        $ip: event.ip,
        $user_agent: event.user_agent,
        $current_url: event.page_url,
        segments: event.segments,
      },
      timestamp: event.timestamp
        ? new Date(event.timestamp * 1000)
        : new Date(),
    });
  } finally {
    // Ensure pending events are flushed before the request lifecycle ends.
    await posthog.shutdown();
  }
}

// ─── Public dispatcher ───────────────────────────────────────────────────────

/**
 * Fire an analytics event to all configured providers concurrently.
 * Individual provider failures are swallowed so one bad integration
 * never blocks the others.
 */
export async function dispatchAnalyticsEvent(
  event: AnalyticsEvent
): Promise<void> {
  await Promise.allSettled([
    fireMetaCAPI(event),
    fireGA4(event),
    fireGoogleAds(event),
    firePostHog(event),
  ]);
}
