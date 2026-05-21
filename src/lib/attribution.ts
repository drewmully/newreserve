/**
 * Persistent ad-click attribution.
 *
 * When a visitor lands on a page with attribution params in the URL
 * (gclid, gbraid, wbraid, utm_*), this module stores them so they survive:
 *   1. Internal navigation within the site
 *   2. The hop out to Shopify checkout
 *   3. The bounce back to /auth/callback after purchase
 *
 * Storage strategy:
 *   - localStorage (mully_attr) for cross-tab persistence within the same
 *     browser session
 *   - first-party cookie (mully_attr) with 90-day TTL so the attribution
 *     survives even if localStorage is cleared (cookies are also sent on
 *     the request that returns from Shopify checkout, so they're robust
 *     against ITP-style storage clears between hosts)
 *
 * 90 days mirrors Google Ads' default click-through conversion window.
 */
export const ATTR_STORAGE_KEY = "mully_attr";
export const ATTR_COOKIE_NAME = "mully_attr";
const ATTR_TTL_DAYS = 90;

export interface AttributionPayload {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  fbclid?: string;
  utm_source?: string;
  utm_medium?: string;
  utm_campaign?: string;
  utm_content?: string;
  utm_term?: string;
  /** First page that captured this attribution. Useful for debugging. */
  first_landing_url?: string;
  /** Epoch ms when this attribution was first captured. */
  captured_at?: number;
}

const TRACKED_KEYS: (keyof AttributionPayload)[] = [
  "gclid",
  "gbraid",
  "wbraid",
  "fbclid",
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
];

function readParamsFromUrl(): AttributionPayload {
  if (typeof window === "undefined") return {};
  try {
    const params = new URLSearchParams(window.location.search);
    const result: Record<string, string> = {};
    for (const key of TRACKED_KEYS) {
      const value = params.get(key as string);
      if (value && value.trim().length > 0) {
        result[key as string] = value.trim();
      }
    }
    return result as AttributionPayload;
  } catch {
    return {};
  }
}

function readFromStorage(): AttributionPayload {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(ATTR_STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as AttributionPayload;
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {
    /* ignore */
  }
  // Fall back to cookie (e.g. if localStorage was wiped but cookie remained).
  try {
    const match = document.cookie
      .split(";")
      .map((c) => c.trim())
      .find((c) => c.startsWith(`${ATTR_COOKIE_NAME}=`));
    if (!match) return {};
    const raw = decodeURIComponent(match.split("=").slice(1).join("="));
    const parsed = JSON.parse(raw) as AttributionPayload;
    if (parsed && typeof parsed === "object") return parsed;
  } catch {
    /* ignore */
  }
  return {};
}

function writeToStorage(payload: AttributionPayload): void {
  if (typeof window === "undefined") return;
  const json = JSON.stringify(payload);
  try {
    window.localStorage.setItem(ATTR_STORAGE_KEY, json);
  } catch {
    /* ignore */
  }
  try {
    const maxAge = ATTR_TTL_DAYS * 24 * 60 * 60;
    document.cookie =
      `${ATTR_COOKIE_NAME}=${encodeURIComponent(json)};` +
      `path=/;` +
      `max-age=${maxAge};` +
      `SameSite=Lax`;
  } catch {
    /* ignore */
  }
}

/**
 * Capture attribution from the current URL and persist it.
 *
 * - If the URL has new attribution params, they REPLACE the stored ones
 *   (later clicks win — same as Google Ads' last-click model).
 * - If the URL has no attribution params, leaves stored attribution intact.
 *
 * Call this on every page load (cheap and idempotent).
 */
export function captureAttributionFromUrl(): AttributionPayload {
  if (typeof window === "undefined") return {};
  const fromUrl = readParamsFromUrl();
  const stored = readFromStorage();

  // No new attribution → keep what we have.
  if (Object.keys(fromUrl).length === 0) return stored;

  const merged: AttributionPayload = {
    ...stored,
    ...fromUrl,
    first_landing_url: stored.first_landing_url ?? window.location.href,
    captured_at: stored.captured_at ?? Date.now(),
  };

  // If a NEW gclid arrives (different from the stored one), treat this as
  // a fresh click — bump captured_at and update first_landing_url.
  if (fromUrl.gclid && fromUrl.gclid !== stored.gclid) {
    merged.first_landing_url = window.location.href;
    merged.captured_at = Date.now();
  }

  writeToStorage(merged);
  return merged;
}

/** Read the currently stored attribution payload (no URL capture). */
export function getStoredAttribution(): AttributionPayload {
  return readFromStorage();
}

/**
 * Convert attribution to a flat list of Shopify cart attribute key/value
 * pairs. Empty/missing fields are dropped.
 *
 * Shopify cart attributes appear on the order under `note_attributes`,
 * which is exactly where the orders-paid webhook reads from.
 */
export function attributionToCartAttributes(
  attr: AttributionPayload
): Array<{ key: string; value: string }> {
  const out: Array<{ key: string; value: string }> = [];
  for (const key of TRACKED_KEYS) {
    const value = attr[key];
    if (typeof value === "string" && value.length > 0) {
      out.push({ key, value });
    }
  }
  return out;
}
