/**
 * Client-side analytics tracking helper.
 * POSTs to /api/analytics/track with attribution data collected from:
 *   - localStorage  → anonymous_id  (generated once per browser)
 *   - URL params    → gclid / gbraid / wbraid
 *   - cookies       → _fbp / _fbc
 */

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
  return {
    utm_source: getUrlParam("utm_source"),
    utm_medium: getUrlParam("utm_medium"),
    utm_campaign: getUrlParam("utm_campaign"),
    utm_term: getUrlParam("utm_term"),
    utm_content: getUrlParam("utm_content"),
    gclid: getUrlParam("gclid"),
    gbraid: getUrlParam("gbraid"),
    wbraid: getUrlParam("wbraid"),
    fbp: getCookie("_fbp"),
    fbc: getCookie("_fbc"),
  };
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

    // Mirror to client-side gtag.js (GA4 + Google Ads). No-op when the
    // Google tag is not configured.
    mirrorToGtag(eventName, eventId, mergedProperties);

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
