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
 *   OpenAI CAPI:  OPENAI_PIXEL_ID, OPENAI_CAPI_KEY
 *   GA4:          GA4_MEASUREMENT_ID, GA4_API_SECRET
 *   Google Ads:   GOOGLE_ADS_CONVERSION_ID
 *                 GOOGLE_ADS_LABEL_PAGE_VIEW         (page_view events)
 *                 GOOGLE_ADS_LABEL_EMAIL_SUBMITTED   (email_submitted, account_created)
 *                 GOOGLE_ADS_LABEL_VIEW_ITEM         (view_item, plan_selected, choose_plan_view)
 *                 GOOGLE_ADS_LABEL_CHECKOUT_INIT     (initiate_checkout, checkout_clicked)
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

/**
 * Maps internal event names to Meta standard events. Standard events are the
 * only ones Meta's algorithm can optimize ad delivery against — anything
 * else lands in CAPI as a CustomEvent which Meta can read but cannot target.
 *
 * Reserve funnel mapping rationale:
 *   - lp_subscription_view / reveal_viewed → ViewContent (top of funnel)
 *   - quiz_started / reveal_cta_clicked   → InitiateCheckout (intent)
 *   - quiz_step_completed                 → AddToCart (mid-funnel progress)
 *   - quiz_email_captured                 → Lead (the optimization target for
 *                                              cold acquisition campaigns)
 *   - quiz_completed                      → CompleteRegistration (warm lead)
 *   - purchase                            → Purchase (graduate to this once we
 *                                              have 50+ purchases/week)
 */
const META_EVENT_MAP: Record<string, string> = {
  page_view: "PageView",
  // Reserve acquisition funnel
  lp_subscription_view: "ViewContent",
  quiz_started: "InitiateCheckout",
  quiz_step_completed: "AddToCart",
  quiz_email_captured: "Lead",
  quiz_completed: "CompleteRegistration",
  reveal_viewed: "ViewContent",
  reveal_cta_clicked: "InitiateCheckout",
  // Generic ecom
  add_to_cart: "AddToCart",
  initiate_checkout: "InitiateCheckout",
  checkout_clicked: "InitiateCheckout",
  purchase: "Purchase",
  // Member surface
  login: "Contact",
  wallet_viewed: "ViewContent",
  // subscription_state intentionally NOT mapped: it fires on every status
  // refresh (not just new purchases) and lacks value/currency. Meta flags it
  // as low-quality Subscribe. Real subscription purchases flow through
  // "purchase" event which carries value+currency.
  registry_applied: "Lead",
  // Consult LP phone capture (Martine funnel)
  lp_consult_view: "ViewContent",
  lp_consult_submit: "Lead",
};

function sha256hex(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

async function fireMetaCAPI(event: AnalyticsEvent): Promise<void> {
  const pixelId = process.env.META_PIXEL_ID;
  const accessToken = process.env.META_ACCESS_TOKEN;
  if (!pixelId || !accessToken) return;

  // Only fire to Meta if the event has a mapped standard event name. Skip
  // internal-only events (e.g. quiz_abandoned diagnostics) so we don't pollute
  // the pixel's signal with noise Meta can't optimize against.
  const metaEventName = META_EVENT_MAP[event.event_name];
  if (!metaEventName) return;

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

  // Deduplication: client-side Pixel and server-side CAPI fire the SAME event
  // with the same event_id. Meta dedupes them, picks the higher-quality match,
  // and counts the event ONCE. Without this, we'd double-count.
  const eventId =
    typeof event.properties?.event_id === "string"
      ? (event.properties.event_id as string)
      : undefined;

  // Purchase events need value + currency at the top level for Meta's optimizer.
  const props = event.properties ?? {};
  const customData: Record<string, unknown> = {
    ...props,
    user_id: event.user_id,
    segments: event.segments ?? [],
  };
  if (event.event_name === "purchase") {
    customData.value = props.value ?? 0;
    customData.currency = props.currency ?? "USD";
  }

  await fetch(
    `https://graph.facebook.com/v19.0/${pixelId}/events?access_token=${accessToken}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        data: [
          {
            event_name: metaEventName,
            event_time: event.timestamp ?? Math.floor(Date.now() / 1000),
            event_id: eventId,
            user_data: userData,
            custom_data: customData,
            action_source: "website",
            event_source_url: event.page_url,
          },
        ],
      }),
    }
  );
}

// ─── OpenAI Ads Conversions API ──────────────────────────────────

/**
 * Maps internal event names to OpenAI standard events + payload categories.
 * Category drives which fields the OpenAI validator accepts:
 *   contents        → type, amount, currency, contents
 *   customer_action → type, amount, currency
 *   plan_enrollment → type, plan_id, amount, currency, contents
 *
 * Same rationale as META_EVENT_MAP: only standard events are optimizable
 * by OpenAI's ad-delivery model. Internal-only diagnostics stay out.
 */
const OPENAI_EVENT_MAP: Record<
  string,
  { name: string; category: "contents" | "customer_action" | "plan_enrollment" }
> = {
  page_view: { name: "page_viewed", category: "contents" },
  // Reserve acquisition funnel
  lp_subscription_view: { name: "contents_viewed", category: "contents" },
  reveal_viewed: { name: "contents_viewed", category: "contents" },
  wallet_viewed: { name: "contents_viewed", category: "contents" },
  add_to_cart: { name: "items_added", category: "contents" },
  quiz_step_completed: { name: "items_added", category: "contents" },
  quiz_started: { name: "checkout_started", category: "contents" },
  reveal_cta_clicked: { name: "checkout_started", category: "contents" },
  initiate_checkout: { name: "checkout_started", category: "contents" },
  checkout_clicked: { name: "checkout_started", category: "contents" },
  quiz_email_captured: {
    name: "lead_created",
    category: "customer_action",
  },
  registry_applied: { name: "lead_created", category: "customer_action" },
  quiz_completed: {
    name: "registration_completed",
    category: "customer_action",
  },
  login: { name: "registration_completed", category: "customer_action" },
  purchase: { name: "order_created", category: "contents" },
};

/**
 * Fire an event to OpenAI Ads Conversions API.
 *
 * Endpoint: POST https://bzr.openai.com/v1/events?pid=<PIXEL_ID>
 * Auth:     Bearer <OPENAI_CAPI_KEY>
 * Dedup:    event.id must match the client-side eventOptions.event_id
 *           (passed through as properties.event_id from trackEvent).
 *
 * User-data matching (all SHA-256 hashed — same recipe as Meta CAPI):
 *   email_sha256, external_id_sha256, ip_address, user_agent, country,
 *   city, zip_code. The more high-entropy fields we supply, the higher
 *   the match rate for cookieless conversions.
 */
async function fireOpenAICAPI(event: AnalyticsEvent): Promise<void> {
  const pixelId = process.env.OPENAI_PIXEL_ID;
  const apiKey = process.env.OPENAI_CAPI_KEY;
  if (!pixelId || !apiKey) return;

  const mapping = OPENAI_EVENT_MAP[event.event_name];
  if (!mapping) return;

  const props = event.properties ?? {};

  const userData: Record<string, unknown> = {};
  if (event.email) {
    userData.email_sha256 = sha256hex(event.email.trim().toLowerCase());
  }
  if (event.user_id) {
    userData.external_id_sha256 = sha256hex(event.user_id.trim());
  }
  if (event.ip) userData.ip_address = event.ip;
  if (event.user_agent) userData.user_agent = event.user_agent;

  // Build payload data per OpenAI validator schema.
  const data: Record<string, unknown> = { type: mapping.category };
  if (
    mapping.category === "contents" ||
    mapping.category === "customer_action"
  ) {
    if (props.value !== undefined) data.amount = props.value;
    if (props.currency !== undefined) data.currency = props.currency;
  }
  if (
    mapping.category === "contents" &&
    Array.isArray(props.contents)
  ) {
    data.contents = props.contents;
  }
  if (
    mapping.category === "plan_enrollment" &&
    typeof props.plan_id === "string"
  ) {
    data.plan_id = props.plan_id;
  }

  // Purchase must carry amount + currency — default to safe values if the
  // caller didn't pass them (rare but non-fatal for OpenAI's model).
  if (event.event_name === "purchase") {
    data.amount = props.value ?? 0;
    data.currency = props.currency ?? "USD";
  }

  const eventId =
    typeof props.event_id === "string" ? props.event_id : undefined;

  const timestampMs =
    (event.timestamp ? event.timestamp * 1000 : undefined) ?? Date.now();

  const body = {
    validate_only: false,
    events: [
      {
        id: eventId,
        type: mapping.name,
        timestamp_ms: timestampMs,
        source_url: event.page_url,
        action_source: "web",
        user_data: Object.keys(userData).length > 0 ? userData : undefined,
        data,
      },
    ],
  };

  await fetch(
    `https://bzr.openai.com/v1/events?pid=${pixelId}`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
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

  const props = event.properties ?? {};
  const str = (k: string): string | undefined => {
    const v = props[k];
    return typeof v === "string" && v.length > 0 ? v : undefined;
  };

  // Resolve client_id with this priority:
  //   1. event.anonymous_id (Shopify webhook sets this from note_attributes
  //      ga_client_id — the GA4 client_id captured on the LP at first
  //      pageview, so server-side purchase stitches to the LP session).
  //   2. event.user_id (logged-in users)
  //   3. anon-<uuid> (last resort — produces unattributed traffic)
  const clientId =
    event.anonymous_id ?? event.user_id ?? `anon-${crypto.randomUUID()}`;

  // Surface campaign attribution at the GA4 event-param level. GA4
  // recognizes `source`, `medium`, `campaign`, `term`, `content` as
  // reserved param names and uses them to populate session_source /
  // session_medium / session_campaign dimensions, even on server-side
  // events delivered via Measurement Protocol. This is what flips
  // (direct)/(none) to the real ad source on the purchase event.
  const campaign = {
    source: str("utm_source"),
    medium: str("utm_medium"),
    campaign: str("utm_campaign"),
    term: str("utm_term"),
    content: str("utm_content"),
  };

  await fetch(
    `https://www.google-analytics.com/mp/collect?measurement_id=${measurementId}&api_secret=${apiSecret}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        user_id: event.user_id,
        events: [
          {
            name: event.event_name,
            params: {
              ...props,
              ...Object.fromEntries(
                Object.entries(campaign).filter(([, v]) => v !== undefined)
              ),
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
  email_submitted: "GOOGLE_ADS_LABEL_EMAIL_SUBMITTED",
  account_created: "GOOGLE_ADS_LABEL_EMAIL_SUBMITTED",
  view_item: "GOOGLE_ADS_LABEL_VIEW_ITEM",
  choose_plan_view: "GOOGLE_ADS_LABEL_VIEW_ITEM",
  plan_selected: "GOOGLE_ADS_LABEL_VIEW_ITEM",
  initiate_checkout: "GOOGLE_ADS_LABEL_CHECKOUT_INIT",
  checkout_clicked: "GOOGLE_ADS_LABEL_CHECKOUT_INIT",
  purchase: "GOOGLE_ADS_LABEL_FUNNEL_CONVERSION",
};

/**
 * Fire a Google Ads conversion.
 *
 * Carries gclid / gbraid / wbraid (from event.properties) so the conversion
 * is properly attributed to the original ad click — even when it happens
 * on a different page or hours later via the Shopify orders/paid webhook.
 *
 * Also sends a SHA-256 hashed email (Enhanced Conversions for Leads) so
 * Google Ads can still attribute the conversion when the gclid is missing
 * (cookieless / cross-device / Safari ITP / etc.).
 */
async function fireGoogleAds(event: AnalyticsEvent): Promise<void> {
  const conversionId = process.env.GOOGLE_ADS_CONVERSION_ID;
  if (!conversionId) return;

  const labelEnvKey = GOOGLE_ADS_LABEL_ENV[event.event_name];
  if (!labelEnvKey) return; // event type not tracked via Google Ads

  const label = process.env[labelEnvKey];
  if (!label) return;

  const props = event.properties ?? {};
  const gclid = typeof props.gclid === "string" ? props.gclid : undefined;
  const gbraid = typeof props.gbraid === "string" ? props.gbraid : undefined;
  const wbraid = typeof props.wbraid === "string" ? props.wbraid : undefined;

  const url = new URL(
    `https://www.googleadservices.com/pagead/conversion/${conversionId}/`
  );
  url.searchParams.set("label", label);

  // Attribution carry-through — any of these lets Ads tie the conversion
  // back to the original click.
  if (gclid) url.searchParams.set("gclid", gclid);
  if (gbraid) url.searchParams.set("gbraid", gbraid);
  if (wbraid) url.searchParams.set("wbraid", wbraid);

  // Enhanced Conversions for Leads — hashed email fallback.
  // Google Ads accepts the same SHA-256 format we already use for Meta CAPI.
  if (event.email) {
    url.searchParams.set(
      "em",
      sha256hex(event.email.trim().toLowerCase())
    );
  }
  if (event.phone) {
    url.searchParams.set("ph", sha256hex(event.phone.replace(/\D/g, "")));
  }

  // Enrich purchase events with transaction data
  if (event.event_name === "purchase") {
    const value = (props.value as number) ?? 0;
    const currency = (props.currency as string) ?? "USD";
    // Prefer explicit transaction_id (set on LP → carried through cart attrs)
    // so the client-side gtag fire on /auth/callback and this server-side
    // fire share the same id and Google dedupes them automatically.
    const transactionId =
      (props.transaction_id as string | undefined) ??
      (props.order_id as string | undefined);
    url.searchParams.set("value", String(value));
    url.searchParams.set("currency_code", currency);
    if (transactionId) url.searchParams.set("transaction_id", transactionId);
  }

  await fetch(url.toString(), { method: "GET" });
}

// ─── PostHog capture API ─────────────────────────────────────────────────────

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined)
  ) as T;
}

/** Parse referring domain from a referrer URL. Returns undefined for empty/invalid. */
function parseReferringDomain(referrer: unknown): string | undefined {
  if (typeof referrer !== "string" || referrer.trim().length === 0) {
    return undefined;
  }
  try {
    const url = new URL(referrer.trim());
    return url.hostname || undefined;
  } catch {
    return undefined;
  }
}

/** Lightweight UA parsing for PostHog $browser / $device_type / $os fields. */
function parseBrowser(ua: string | undefined): string | undefined {
  if (!ua) return undefined;
  if (/Edg\//i.test(ua)) return "Edge";
  if (/OPR\/|Opera/i.test(ua)) return "Opera";
  if (/Chrome\//i.test(ua) && !/Chromium/i.test(ua)) return "Chrome";
  if (/Firefox\//i.test(ua)) return "Firefox";
  if (/Safari\//i.test(ua) && !/Chrome\//i.test(ua)) return "Safari";
  if (/MSIE |Trident\//i.test(ua)) return "Internet Explorer";
  return undefined;
}

function parseDeviceType(ua: string | undefined): string | undefined {
  if (!ua) return undefined;
  if (/iPad|Tablet|PlayBook|Nexus 7|Nexus 10/i.test(ua)) return "Tablet";
  if (/Mobi|iPhone|Android.*Mobile|Windows Phone|IEMobile|BlackBerry/i.test(ua))
    return "Mobile";
  return "Desktop";
}

function parseOS(ua: string | undefined): string | undefined {
  if (!ua) return undefined;
  if (/Windows NT/i.test(ua)) return "Windows";
  if (/Mac OS X/i.test(ua)) return "Mac OS X";
  if (/Android/i.test(ua)) return "Android";
  if (/(iPhone|iPad|iPod)/i.test(ua)) return "iOS";
  if (/Linux/i.test(ua)) return "Linux";
  return undefined;
}

/** Heuristic bot detection so we can flag obvious crawler hits. */
function looksLikeBot(ua: string | undefined): boolean {
  if (!ua) return false;
  return /bot|crawler|spider|crawling|slurp|bingpreview|facebookexternalhit|preview|headlesschrome|lighthouse|gptbot|claudebot|chatgpt-user|google-extended|applebot/i.test(
    ua
  );
}

function getPostHogDistinctId(event: AnalyticsEvent): string {
  return event.user_id ?? event.email ?? event.anonymous_id ?? "anonymous";
}

function getPostHogPersonId(event: AnalyticsEvent): string | undefined {
  return event.user_id ?? event.email;
}

function getEventDate(event: AnalyticsEvent): Date {
  return event.timestamp ? new Date(event.timestamp * 1000) : new Date();
}

function getPostHogPersonProperties(event: AnalyticsEvent) {
  const eventDate = getEventDate(event).toISOString();

  return compactObject({
    $set: compactObject({
      email: event.email,
      phone: event.phone,
      reserve_user_id: event.user_id,
      segments: event.segments?.length ? event.segments : undefined,
      last_seen_at: eventDate,
      last_seen_url: event.page_url,
      last_event_name: event.event_name,
    }),
    $set_once: compactObject({
      first_seen_at: eventDate,
      first_anonymous_id: event.anonymous_id,
    }),
    $anon_distinct_id:
      event.anonymous_id && event.anonymous_id !== getPostHogDistinctId(event)
        ? event.anonymous_id
        : undefined,
  });
}

function getPostHogEventProperties(event: AnalyticsEvent) {
  const props = event.properties ?? {};
  const referrer = props.referrer ?? props.$referrer;
  const path = props.path ?? props.$pathname;
  const referringDomain = parseReferringDomain(referrer);

  let pageHost: string | undefined;
  if (event.page_url) {
    try {
      pageHost = new URL(event.page_url).hostname;
    } catch {
      pageHost = undefined;
    }
  }

  return compactObject({
    ...props,
    reserve_user_id: event.user_id,
    anonymous_id: event.anonymous_id,
    email: event.email,
    phone: event.phone,
    is_authenticated: Boolean(event.user_id || event.email),
    // PostHog standard properties so HogQL filters like `$referring_domain`,
    // `$pathname`, `$browser`, `$device_type` actually resolve.
    $ip: event.ip,
    raw_ip: event.ip,
    $user_agent: event.user_agent,
    $current_url: event.page_url,
    $host: pageHost,
    $referrer: typeof referrer === "string" ? referrer : undefined,
    $referring_domain: referringDomain ?? "$direct",
    $pathname: typeof path === "string" ? path : undefined,
    $browser: parseBrowser(event.user_agent),
    $device_type: parseDeviceType(event.user_agent),
    $os: parseOS(event.user_agent),
    $lib: "mully-server",
    is_bot: looksLikeBot(event.user_agent),
    segments: event.segments?.length ? event.segments : undefined,
  });
}

async function firePostHog(event: AnalyticsEvent): Promise<void> {
  const apiKey =
    process.env.POSTHOG_PROJECT_API_KEY ??
    process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return;

  const host =
    process.env.POSTHOG_HOST ??
    process.env.NEXT_PUBLIC_POSTHOG_HOST ??
    "https://us.i.posthog.com";
  const distinctId = getPostHogDistinctId(event);
  const personId = getPostHogPersonId(event);

  const posthog = new PostHog(apiKey, { host });

  try {
    if (personId) {
      posthog.identify({
        distinctId: personId,
        properties: getPostHogPersonProperties(event),
      });
    }

    posthog.capture({
      distinctId,
      event: event.event_name,
      properties: getPostHogEventProperties(event),
      timestamp: getEventDate(event),
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
    fireOpenAICAPI(event),
    fireGA4(event),
    fireGoogleAds(event),
    firePostHog(event),
  ]);
}
