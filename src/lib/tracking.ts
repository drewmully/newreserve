/**
 * Client-side analytics tracking helper.
 * POSTs to /api/analytics/track with attribution data collected from:
 *   - localStorage  → anonymous_id  (generated once per browser)
 *   - URL params    → gclid / gbraid / wbraid (first event of the landing)
 *   - mully_attr    → persisted utm params + gclid (every subsequent event)
 *   - cookies       → _fbp / _fbc
 */

import { getStoredAttribution } from "@/lib/attribution";

const ANON_ID_KEY = "mully_anon_id";
const SESSION_ID_KEY = "mully_session_id";

function createTrackingId(prefix: string): string {
  try {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
  } catch {
    // Fall through to the non-crypto fallback below.
  }

  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Returns the persistent localStorage anonymous_id used by every client
 * trackEvent call. Exported so server-bound POSTs (e.g. /api/quiz/complete)
 * can forward the SAME anon to the server, which prevents PostHog from
 * creating duplicate persons when both client and server fire the same
 * funnel event.
 */
export function getClientAnonymousId(): string {
  return getOrCreateAnonId();
}

function getOrCreateAnonId(): string {
  try {
    const existing = localStorage.getItem(ANON_ID_KEY);
    if (existing) return existing;
    const id = createTrackingId("anon");
    localStorage.setItem(ANON_ID_KEY, id);
    return id;
  } catch {
    return createTrackingId("anon");
  }
}

function getOrCreateSessionId(): string {
  try {
    const existing = sessionStorage.getItem(SESSION_ID_KEY);
    if (existing) return existing;
    const id = createTrackingId("session");
    sessionStorage.setItem(SESSION_ID_KEY, id);
    return id;
  } catch {
    return createTrackingId("session");
  }
}

function getUrlParam(name: string): string | null {
  try {
    return new URLSearchParams(window.location.search).get(name);
  } catch {
    return null;
  }
}

function getCookie(name: string): string | null {
  try {
    const match = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${name}=`));
    return match ? match.split("=").slice(1).join("=") : null;
  } catch {
    return null;
  }
}

/**
 * Reads the A/B bucket from the `mr_ab` cookie and returns the
 * variant assignments that should be attached to every analytics event.
 * This ensures PostHog events (page_view, purchase, etc.) carry the
 * same variant properties that PostHogFlagSync registers client-side.
 */
function getAbVariantProperties(): Record<string, string> {
  const raw = getCookie("mr_ab");
  if (raw === null) return {};
  const bucket = parseInt(raw, 10);
  if (Number.isNaN(bucket)) return {};

  return {
    "hero-headline": bucket < 34 ? "control" : bucket < 67 ? "variant-a" : "variant-b",
    "hero-cta": bucket < 50 ? "control" : "variant-a",
    "ob-plan-headline": bucket < 50 ? "control" : "variant-a",
    "ob-plan-subtext": bucket < 50 ? "control" : "variant-a",
  };
}

function getAttributionProperties(): Record<string, string | null> {
  // URL-first (covers the very first event of a landing, before
  // captureAttributionFromUrl has had a chance to persist), then fall back
  // to the persisted attribution (covers every subsequent navigation and
  // event where the URL no longer carries ?gclid / ?utm_*).
  //
  // Previously this function ONLY read getUrlParam(...) — which meant GA4
  // received utm_* and gclid on the very first /lp/subscription page_view
  // and then `null` on every quiz_completed / quiz_email_captured /
  // begin_checkout event that followed, because by then the user had
  // navigated to /lp/subscription/quiz/... and the params were gone. As a
  // result every funnel event downstream of the landing showed up in GA4
  // as session source `(not set)` / channel `Unassigned` and was
  // impossible to attribute back to the originating ad group.
  const stored =
    typeof window !== "undefined" ? getStoredAttribution() : ({} as Record<string, string | undefined>);
  const pick = (key: string): string | null => {
    const fromUrl = getUrlParam(key);
    if (fromUrl) return fromUrl;
    const fromStore = (stored as Record<string, string | undefined>)[key];
    return fromStore && fromStore.length > 0 ? fromStore : null;
  };
  return {
    utm_source: pick("utm_source"),
    utm_medium: pick("utm_medium"),
    utm_campaign: pick("utm_campaign"),
    utm_term: pick("utm_term"),
    utm_content: pick("utm_content"),
    gclid: pick("gclid"),
    gbraid: pick("gbraid"),
    wbraid: pick("wbraid"),
    fbp: getCookie("_fbp"),
    fbc: getCookie("_fbc"),
  };
}

/**
 * Mirror the event to the Meta Pixel (fbq) when it's loaded. Server-side
 * Meta CAPI events always fire from /api/analytics/track. This client mirror
 * is what powers Meta retargeting audiences ("users who hit quiz_started but
 * didn't quiz_complete") and gives Meta a high-match-quality browser signal.
 *
 * Uses the SAME `event_id` Meta CAPI uses on the server side, so Meta dedupes
 * the two and counts the event once. Without this, every funnel event would
 * be double-counted in Ads Manager.
 *
 * No-op when fbq is undefined — i.e. when NEXT_PUBLIC_META_PIXEL_ID is not
 * configured or the pixel script hasn't finished loading yet.
 */
const META_STANDARD_EVENTS: Record<string, string> = {
  page_view: "PageView",
  lp_subscription_view: "ViewContent",
  quiz_started: "InitiateCheckout",
  quiz_step_completed: "AddToCart",
  quiz_email_captured: "Lead",
  quiz_completed: "CompleteRegistration",
  reveal_viewed: "ViewContent",
  reveal_cta_clicked: "InitiateCheckout",
  add_to_cart: "AddToCart",
  initiate_checkout: "InitiateCheckout",
  checkout_clicked: "InitiateCheckout",
  purchase: "Purchase",
  login: "Contact",
  wallet_viewed: "ViewContent",
  // subscription_state intentionally NOT mapped: fires on every status refresh,
  // lacks value/currency. Real purchases go through "purchase" → Purchase.
  // subscription_state: "Subscribe",
  registry_applied: "Lead",
};

function mirrorToMetaPixel(
  eventName: string,
  eventId: string,
  properties: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  const fbq = (
    window as unknown as { fbq?: (...args: unknown[]) => void }
  ).fbq;
  if (typeof fbq !== "function") return;

  const metaEvent = META_STANDARD_EVENTS[eventName];
  if (!metaEvent) return;

  try {
    const eventData: Record<string, unknown> = {};
    // Purchase needs value + currency for Meta's optimizer.
    if (eventName === "purchase") {
      eventData.value = properties.value ?? 0;
      eventData.currency = properties.currency ?? "USD";
    }
    // {eventID} is Meta's dedup key against server-side CAPI; it MUST match
    // the event_id we pass through to fireMetaCAPI on the server.
    fbq("track", metaEvent, eventData, { eventID: eventId });
  } catch {
    // Never let analytics break the page.
  }
}

/**
 * Mirror the event to the OpenAI Ads pixel (oaiq) when it's loaded. Server-side
 * OpenAI Conversions API events fire from /api/analytics/track. This client
 * mirror is what powers OpenAI/ChatGPT Ads retargeting audiences and gives
 * the optimizer a high-quality browser-side signal.
 *
 * Uses the SAME `event_id` OpenAI CAPI uses on the server (passed via the
 * SDK's eventOptions.event_id), so OpenAI dedupes the two and counts the
 * event once. Without this, every funnel event would be double-counted.
 *
 * OpenAI event taxonomy (extracted from oaiq.min.js validator):
 *   page_viewed          → {type:"contents"}
 *   contents_viewed      → {type, amount, currency, contents}
 *   items_added          → {type, amount, currency, contents}
 *   checkout_started     → {type:"contents"}
 *   order_created        → {type, amount, currency, contents}
 *   registration_completed → {type:"customer_action", amount, currency}
 *   lead_created         → {type:"customer_action"}
 *   subscription_created → {type, plan_id, amount, currency, contents}
 *
 * No-op when oaiq is undefined — i.e. when NEXT_PUBLIC_OPENAI_PIXEL_ID is
 * not configured or the pixel script hasn't finished loading yet.
 */
const OPENAI_STANDARD_EVENTS: Record<
  string,
  { name: string; category: "contents" | "customer_action" | "plan_enrollment" }
> = {
  // page_view intentionally NOT mapped here — the layout.tsx OpenAI pixel
  // fires the initial page_viewed on script init. Firing it again from
  // trackEvent would double-count until we route it through a shared event_id.
  lp_subscription_view: { name: "contents_viewed", category: "contents" },
  reveal_viewed: { name: "contents_viewed", category: "contents" },
  wallet_viewed: { name: "contents_viewed", category: "contents" },
  add_to_cart: { name: "items_added", category: "contents" },
  quiz_step_completed: { name: "items_added", category: "contents" },
  // Intent → checkout_started
  quiz_started: { name: "checkout_started", category: "contents" },
  reveal_cta_clicked: { name: "checkout_started", category: "contents" },
  initiate_checkout: { name: "checkout_started", category: "contents" },
  checkout_clicked: { name: "checkout_started", category: "contents" },
  // Lead / registration — customer_action category
  quiz_email_captured: { name: "lead_created", category: "customer_action" },
  registry_applied: { name: "lead_created", category: "customer_action" },
  quiz_completed: {
    name: "registration_completed",
    category: "customer_action",
  },
  login: { name: "registration_completed", category: "customer_action" },
  // Money event
  purchase: { name: "order_created", category: "contents" },
};

function mirrorToOpenAI(
  eventName: string,
  eventId: string,
  properties: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  const oaiq = (
    window as unknown as { oaiq?: (...args: unknown[]) => void }
  ).oaiq;
  if (typeof oaiq !== "function") return;

  const mapping = OPENAI_STANDARD_EVENTS[eventName];
  if (!mapping) return;

  try {
    // Base payload always carries `type` (category) — required by validator.
    const data: Record<string, unknown> = { type: mapping.category };

    // Purchase / add_to_cart / view carry value+currency; registration too.
    if (mapping.category === "contents" || mapping.category === "customer_action") {
      if (properties.value !== undefined) data.amount = properties.value;
      if (properties.currency !== undefined) data.currency = properties.currency;
    }

    // Contents array (product-level detail) — only when we have line items
    // and only for content-carrying events. Shape enforced by validator:
    // [{id, name, content_type, quantity, amount, currency}].
    if (
      mapping.category === "contents" &&
      Array.isArray(properties.contents)
    ) {
      data.contents = properties.contents;
    }

    // Subscription/plan enrollment carries plan_id.
    if (
      mapping.category === "plan_enrollment" &&
      typeof properties.plan_id === "string"
    ) {
      data.plan_id = properties.plan_id;
    }

    // {event_id} is OpenAI's dedup key against server-side CAPI; it MUST match
    // the id we pass through to fireOpenAICAPI on the server.
    oaiq("measure", mapping.name, data, { event_id: eventId });
  } catch {
    // Never let analytics break the page.
  }
}

/**
 * Persists fbclid as the _fbc first-party cookie. Meta sets _fbc automatically
 * when the Pixel loads and a fbclid is in the URL — but only on the very first
 * landing, only when CSP/extensions don't block it, and only when the user
 * hasn't opted out of FB tracking. Doing it ourselves as a fallback raises
 * Meta event match quality from ~50% to 80%+ on the bottom of the funnel.
 *
 * Cookie format Meta expects: fb.1.<click_timestamp_ms>.<fbclid>
 */
function captureFbclidCookie(): void {
  if (typeof window === "undefined") return;
  try {
    const fbclid = getUrlParam("fbclid");
    if (!fbclid) return;
    // If Meta's pixel already wrote _fbc, leave it alone — theirs is canonical.
    const existing = getCookie("_fbc");
    if (existing && existing.includes(fbclid)) return;

    const value = `fb.1.${Date.now()}.${fbclid}`;
    // 90-day cookie scoped to mymully.com so subdomains (mail., reserve.,
    // checkout.) share the same _fbc and we don't lose attribution after
    // the user bounces through reserve.mymully.com.
    const maxAge = 90 * 24 * 60 * 60;
    const domain = window.location.hostname.endsWith("mymully.com")
      ? "; domain=.mymully.com"
      : "";
    document.cookie = `_fbc=${value}; path=/; max-age=${maxAge}; SameSite=Lax${domain}`;
  } catch {
    // Never let analytics break the page.
  }
}

/**
 * Mirror the event to client-side gtag.js when it's loaded. Server-side
 * GA4/Google Ads pings always fire from /api/analytics/track. This client
 * mirror is what populates Google Ads remarketing audiences ("users who hit
 * /choose-plan but didn't convert") and gives GA4 a real-time event stream.
 *
 * Uses a shared `event_id` so the server-side Measurement Protocol hit and
 * the client-side gtag hit are deduplicated by GA4 (same event, two sources).
 * No-op when window.gtag is undefined — i.e. when the Google tag in
 * layout.tsx has not been turned on yet via NEXT_PUBLIC_GA_MEASUREMENT_ID /
 * NEXT_PUBLIC_GOOGLE_ADS_CONVERSION_ID.
 */
function mirrorToGtag(
  eventName: string,
  eventId: string,
  properties: Record<string, unknown>
): void {
  if (typeof window === "undefined") return;
  const gtag = (
    window as unknown as { gtag?: (...args: unknown[]) => void }
  ).gtag;
  if (typeof gtag !== "function") return;

  try {
    gtag("event", eventName, {
      ...properties,
      event_id: eventId,
      // GA4 transaction_id field doubles as the dedup key for purchase events.
      // Other events use event_id above.
      transaction_id:
        (properties.order_id as string | undefined) ?? undefined,
    });
  } catch {
    // Never let analytics break the page.
  }
}

function getBrowserProperties(): Record<string, string | number | undefined> {
  if (typeof window === "undefined") return {};

  return {
    page_title: document.title || undefined,
    referrer: document.referrer || undefined,
    path: window.location.pathname,
    query: window.location.search || undefined,
    timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    locale: navigator.language,
    screen_width: window.screen?.width,
    screen_height: window.screen?.height,
    viewport_width: window.innerWidth,
    viewport_height: window.innerHeight,
    device_pixel_ratio: window.devicePixelRatio,
  };
}

/**
 * Fire an analytics event.
 * Safe to call without awaiting — failures are swallowed.
 */
export interface TrackEventPayload {
  user_id?: string;
  email?: string;
  phone?: string;
  segments?: string[];
  properties?: Record<string, unknown>;
  [key: string]: unknown;
}

interface TrackEventOptions {
  includeAuth?: boolean;
}

export interface IdentifyAnalyticsUserInput {
  reserve_user_id: string;
  email?: string | null;
  phone?: string | null;
}

export async function identifyAnalyticsUser({
  reserve_user_id,
  email,
  phone,
}: IdentifyAnalyticsUserInput): Promise<void> {
  try {
    const { default: posthog } = await import("posthog-js");
    posthog.identify(reserve_user_id, {
      email: email ?? undefined,
      phone: phone ?? undefined,
      reserve_user_id,
    });
  } catch {
    // Client analytics must never block auth.
  }
}

export async function trackEvent(
  eventName: string,
  payload: TrackEventPayload = {},
  options: TrackEventOptions = {}
): Promise<void> {
  const {
    user_id: explicitUserId,
    email: explicitEmail,
    phone,
    segments,
    properties,
    ...propertyLikeFields
  } = payload;

  const includeAuth = options.includeAuth ?? true;
  const currentUser = includeAuth
    ? (await import("@/lib/firebase")).auth.currentUser
    : null;
  let user_id = explicitUserId ?? currentUser?.uid;
  const email = explicitEmail ?? currentUser?.email ?? undefined;
  const anonymous_id = getOrCreateAnonId();
  const session_id = getOrCreateSessionId();

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    if (currentUser) {
      try {
        headers.Authorization = `Bearer ${await currentUser.getIdToken()}`;
      } catch {
        if (!explicitUserId) {
          user_id = undefined;
        }
      }
    }

    const eventId = createTrackingId("evt");
    const mergedProperties = {
      ...getBrowserProperties(),
      ...getAbVariantProperties(),
      ...(properties ?? {}),
      ...propertyLikeFields,
      anonymous_id,
      session_id,
      $session_id: session_id,
      event_id: eventId,
      ...getAttributionProperties(),
    };

    // Capture fbclid → _fbc cookie as a fallback before mirroring to Meta,
    // so the very first event after an ad click already carries _fbc.
    captureFbclidCookie();

    // Mirror to client-side gtag.js (GA4 + Google Ads). No-op when the
    // Google tag is not configured.
    mirrorToGtag(eventName, eventId, mergedProperties);

    // Mirror to client-side Meta Pixel (fbq). No-op when NEXT_PUBLIC_META_PIXEL_ID
    // is not configured. Uses the SAME eventId we pass to server-side CAPI
    // so Meta dedupes the two and counts the event once.
    mirrorToMetaPixel(eventName, eventId, mergedProperties);

    // Mirror to client-side OpenAI Ads pixel (oaiq). No-op when
    // NEXT_PUBLIC_OPENAI_PIXEL_ID is not configured. Uses the SAME eventId
    // we pass to server-side OpenAI CAPI so OpenAI dedupes the two.
    mirrorToOpenAI(eventName, eventId, mergedProperties);

    await fetch("/api/analytics/track", {
      method: "POST",
      headers,
      body: JSON.stringify({
        event_name: eventName,
        user_id,
        email,
        phone,
        segments,
        anonymous_id,
        page_url:
          typeof window !== "undefined" ? window.location.href : undefined,
        properties: mergedProperties,
      }),
    });
  } catch {
    // Tracking must never break the app
  }
}
