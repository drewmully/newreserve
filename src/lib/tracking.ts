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
        properties: {
          ...getBrowserProperties(),
          ...getAbVariantProperties(),
          ...(properties ?? {}),
          ...propertyLikeFields,
          anonymous_id,
          session_id,
          $session_id: session_id,
          ...getAttributionProperties(),
        },
      }),
    });
  } catch {
    // Tracking must never break the app
  }
}
