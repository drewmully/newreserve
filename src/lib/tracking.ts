/**
 * Client-side analytics tracking helper.
 * POSTs to /api/analytics/track with attribution data collected from:
 *   - localStorage  → anonymous_id  (generated once per browser)
 *   - URL params    → gclid / gbraid / wbraid
 *   - cookies       → _fbp / _fbc
 */

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
export async function trackEvent(
  eventName: string,
  properties?: Record<string, unknown>
): Promise<void> {
  try {
    await fetch("/api/analytics/track", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        event_name: eventName,
        anonymous_id: getOrCreateAnonId(),
        page_url:
          typeof window !== "undefined" ? window.location.href : undefined,
        properties: {
          ...(properties ?? {}),
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
