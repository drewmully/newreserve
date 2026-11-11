/**
 * Shared Meta (Pixel + Conversions API) event helpers.
 *
 * Used by BOTH the browser mirror (src/lib/tracking.ts) and the server CAPI
 * dispatcher (src/app/api/_lib/analytics.ts) so the two sides always agree on
 * the standard event name and the standard custom_data fields. Meta dedupes
 * browser + server copies by event_name + event_id, so the names must match.
 */

/** Internal event name → Meta standard event. */
export const META_STANDARD_EVENTS: Record<string, string> = {
  page_view: "PageView",
  // Reserve acquisition funnel
  lp_subscription_view: "ViewContent",
  // Quiz progress is NOT a cart or checkout. These used to send AddToCart /
  // InitiateCheckout, which inflated both standard events (every quiz step
  // was an AddToCart). They now go to Meta as custom events; the real
  // Reserve checkout start (reveal_cta_clicked) and Purchase are unchanged.
  quiz_started: "QuizStart",
  quiz_step_completed: "QuizStep",
  quiz_email_captured: "Lead",
  quiz_completed: "CompleteRegistration",
  reveal_viewed: "ViewContent",
  // Reveal CTA puts the RES-MEM line into a Shopify cart, then sends the
  // buyer to checkout: AddToCart first, then InitiateCheckout (separate
  // trackEvent calls, so each has its own event_id).
  reserve_added_to_cart: "AddToCart",
  reveal_cta_clicked: "InitiateCheckout",
  // Shop (headless storefront). proshop_product_viewed fires once per PDP
  // view; before this mapping existed no shop PDP ever sent ViewContent, so
  // shop browsers never entered "viewed" retargeting audiences.
  proshop_product_viewed: "ViewContent",
  add_to_cart: "AddToCart",
  initiate_checkout: "InitiateCheckout",
  checkout_clicked: "InitiateCheckout",
  purchase: "Purchase",
  // Member surface
  login: "Contact",
  wallet_viewed: "ViewContent",
  // subscription_state intentionally NOT mapped: fires on every status
  // refresh and lacks value/currency. Real purchases go through "purchase".
  registry_applied: "Lead",
  // Consult LP phone capture (Martine funnel)
  lp_consult_view: "ViewContent",
  lp_consult_submit: "Lead",
  // Paid-media SMS bridge (/text-mully)
  sms_click: "Lead",
};

/**
 * Meta event names above that are custom (not Meta standard events). The
 * browser must send these with fbq("trackCustom", …); fbq("track", …) only
 * accepts standard names. CAPI takes the same name in event_name either way.
 */
export const META_CUSTOM_EVENTS = new Set<string>(["QuizStart", "QuizStep"]);

function num(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const n = Number(value.replace(/[^0-9.-]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/**
 * Shopify variant GIDs ("gid://shopify/ProductVariant/50380713099456") → the
 * bare numeric id. That is the id the Shopify Facebook & Instagram channel
 * sends as content_ids on checkout, and the id in the Shopify-synced catalog,
 * so using it keeps storefront and checkout events on the same product key.
 */
export function shopifyNumericId(value: unknown): string | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string" || !value.trim()) return undefined;
  const m = value.match(/(\d{6,})\s*$/);
  return m ? m[1] : value.trim();
}

/**
 * Standard Meta custom_data fields (content_ids, content_type, contents,
 * value, currency, num_items, content_name) derived from our internal event
 * properties. Returns only the fields we can fill.
 */
export function buildMetaStandardData(
  eventName: string,
  properties: Record<string, unknown>
): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const metaEvent = META_STANDARD_EVENTS[eventName];
  if (!metaEvent || metaEvent === "PageView") return data;

  const currency =
    typeof properties.currency === "string" && properties.currency
      ? properties.currency
      : "USD";

  if (
    eventName === "proshop_product_viewed" ||
    eventName === "add_to_cart" ||
    eventName === "reserve_added_to_cart"
  ) {
    const id =
      shopifyNumericId(properties.variant_id) ??
      shopifyNumericId(properties.product_slug) ??
      shopifyNumericId(properties.product_id);
    const price = num(properties.price) ?? num(properties.value);
    const quantity = num(properties.quantity) ?? 1;
    if (id) {
      data.content_ids = [id];
      data.content_type = "product";
      data.contents = [{ id, quantity, ...(price !== undefined ? { item_price: price } : {}) }];
    }
    const name = properties.name ?? properties.product_name;
    if (typeof name === "string" && name) data.content_name = name;
    if (typeof properties.brand === "string" && properties.brand) {
      data.content_category = properties.brand;
    }
    if (price !== undefined) {
      data.value = price;
      data.currency = currency;
    }
    return data;
  }

  if (eventName === "checkout_clicked" || eventName === "initiate_checkout") {
    const value = num(properties.cart_total) ?? num(properties.value);
    const items = num(properties.cart_items) ?? num(properties.cart_item_count);
    if (value !== undefined) {
      data.value = value;
      data.currency = currency;
    }
    if (items !== undefined) data.num_items = items;
    return data;
  }

  if (eventName === "purchase") {
    data.value = num(properties.value) ?? 0;
    data.currency = currency;
    return data;
  }

  return data;
}

/**
 * Keys that must never be forwarded to Meta as custom_data: browser/user
 * identifiers (they belong in user_data or nowhere), cart/checkout tokens,
 * raw query strings and referrers (may carry emails, tokens or click ids).
 */
const META_CUSTOM_DATA_DENYLIST = new Set([
  "fbp",
  "fbc",
  "gclid",
  "gbraid",
  "wbraid",
  "anonymous_id",
  "session_id",
  "$session_id",
  "event_id",
  "user_id",
  "email",
  "phone",
  "query",
  "search",
  "url",
  "referrer",
  "checkout_url",
  "klaviyo_kx",
]);

const GIFT_TOKEN_PATH = /\/(gift-(?:address|card|continue|sizing))\/[^/?#]+/g;
const PATH_KEYS = new Set(["path", "$pathname", "pathname", "page_path"]);

/**
 * Gift recipient pages carry a bearer token in the path
 * (/gift-card/<token>, ...). Replace it before the path or URL goes to CAPI.
 */
export function redactGiftTokenPath(value: string): string {
  return value.replace(GIFT_TOKEN_PATH, "/$1/[token]");
}

/** Server-side CAPI custom_data: standard fields + sanitized extra props. */
export function buildMetaCapiCustomData(
  eventName: string,
  properties: Record<string, unknown>
): Record<string, unknown> {
  const extra: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(properties)) {
    if (META_CUSTOM_DATA_DENYLIST.has(key)) continue;
    if (value === undefined || value === null) continue;
    extra[key] =
      PATH_KEYS.has(key) && typeof value === "string" ? redactGiftTokenPath(value) : value;
  }
  return { ...extra, ...buildMetaStandardData(eventName, properties) };
}
