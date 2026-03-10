/**
 * Client-side analytics tracking helper.
 * POSTs to /api/analytics/track with attribution data collected from:
 *   - localStorage  → anonymous_id  (generated once per browser)
 *   - URL params    → gclid / gbraid / wbraid
 *   - cookies       → _fbp / _fbc
 */

import { auth } from "@/lib/firebase";

const ANON_ID_KEY = "mully_anon_id";

function getOrCreateAnonId(): string {
  try {
    const existing = localStorage.getItem(ANON_ID_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    localStorage.setItem(ANON_ID_KEY, id);
    return id;
  } catch {
    return "anon";
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

export async function trackEvent(
  eventName: string,
  payload: TrackEventPayload = {}
): Promise<void> {
  const {
    user_id: explicitUserId,
    email: explicitEmail,
    phone,
    segments,
    properties,
    ...propertyLikeFields
  } = payload;

  const currentUser = auth.currentUser;
  const user_id = explicitUserId ?? currentUser?.uid;
  const email = explicitEmail ?? currentUser?.email ?? undefined;

  try {
    await fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_name: eventName,
        user_id,
        email,
        phone,
        segments,
        anonymous_id: getOrCreateAnonId(),
        page_url:
          typeof window !== "undefined" ? window.location.href : undefined,
        properties: {
          ...(properties ?? {}),
          ...propertyLikeFields,
          gclid: getUrlParam("gclid"),
          gbraid: getUrlParam("gbraid"),
          wbraid: getUrlParam("wbraid"),
          fbp: getCookie("_fbp"),
          fbc: getCookie("_fbc"),
        },
      }),
    });
  } catch {
    // Tracking must never break the app
  }
}
