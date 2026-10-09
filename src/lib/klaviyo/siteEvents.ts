/**
 * Mirror selected first-party analytics events to Klaviyo as server-side
 * events, for known visitors only (see ./identity.ts).
 *
 *   proshop_product_viewed            -> "Mully Viewed Product"   (browse abandonment)
 *   add_to_cart                       -> "Mully Added to Cart"    (cart recovery)
 *   checkout_clicked (plan checkouts),
 *   quiz_completed, plan_selected,
 *   lp_consult_submit,
 *   lp_*_checkout_clicked             -> "Mully Reserve Intent"   (Reserve intent recovery)
 *
 * Events carry a deterministic unique_id per identity + item + time bucket,
 * so page refreshes and double fires collapse into one Klaviyo event.
 * Best effort: failures are dropped (no retry queue). Never logs PII.
 */

import { klaviyoRequest, KlaviyoError } from "./client";
import { identityKey, profileAttributes, type KlaviyoIdentity } from "./identity";
import {
  CART_DEDUPE_MINUTES,
  LIFECYCLE_METRICS,
  RESERVE_INTENT_DEDUPE_MINUTES,
  SITE_URL,
  VIEW_DEDUPE_MINUTES,
} from "./lifecycleConfig";
import { buildRecoveryUrl, recoveryLinksEnabled } from "@/lib/lifecycle/recovery";

/**
 * Reserve (membership) intent. `checkout_clicked` counts only for plan
 * checkouts, never the shop cart. `shop_outfit_reserve_clicked` is accepted only
 * in the track route's enabled Klaviyo-only lane, never legacy/ad analytics.
 */
export const RESERVE_INTENT_EVENTS = new Set([
  "checkout_clicked",
  "shop_outfit_reserve_clicked",
  "quiz_completed",
  "plan_selected",
  "lp_consult_submit",
  "lp_subscription_checkout_clicked",
  "lp_editorial_checkout_clicked",
]);

/** checkout_clicked is shared with the shop carts; only these are membership checkouts. */
const RESERVE_CHECKOUT_SOURCES = new Set(["choose_plan", "reserve_founders_lp"]);

export interface MappedSiteEvent {
  metric: string;
  properties: Record<string, unknown>;
  value?: number;
  /** unique_id before the identity prefix is added. */
  dedupeKey: string;
}

const ALLOWED_LINK_HOSTS = [
  "mymully.com",
  "www.mymully.com",
  "checkout.mymully.com",
  "mullybox-store.myshopify.com",
];
const ALLOWED_IMAGE_HOSTS = ["cdn.shopify.com", "www.mymully.com", "mymully.com"];

function str(value: unknown, max = 200): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : undefined;
}

function num(value: unknown): number | undefined {
  const n = typeof value === "string" ? Number(value) : value;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 && n < 100_000 ? Math.round(n * 100) / 100 : undefined;
}

function safeUrl(value: unknown, hosts: string[]): string | undefined {
  const raw = str(value, 2000);
  if (!raw) return undefined;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !hosts.includes(url.hostname)) return undefined;
    return url.toString();
  } catch {
    return undefined;
  }
}

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,150}$/;
function slug(value: unknown): string | undefined {
  const s = str(value, 160);
  return s && SLUG_RE.test(s) ? s : undefined;
}

function productUrl(handle: string): string {
  return `${SITE_URL}/shop/${handle}`;
}

function bucket(nowMs: number, minutes: number): number {
  return Math.floor(nowMs / (minutes * 60_000));
}

const clean = (obj: Record<string, unknown>) =>
  Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined && v !== null && v !== ""));

/**
 * Map a first-party analytics event to a Klaviyo event. Returns null for
 * events we do not mirror or that lack the fields a flow needs.
 * `fields` is the sanitized property bag from /api/analytics/track.
 */
export function mapSiteEvent(
  eventName: string,
  fields: Record<string, unknown>,
  nowMs = Date.now(),
): MappedSiteEvent | null {
  if (eventName === "proshop_product_viewed") {
    const handle = slug(fields.product_slug);
    const name = str(fields.name);
    if (!handle || !name) return null;
    const price = num(fields.price);
    return {
      metric: LIFECYCLE_METRICS.viewedProduct,
      value: price,
      dedupeKey: `view:${handle}:${bucket(nowMs, VIEW_DEDUPE_MINUTES)}`,
      properties: clean({
        ProductID: handle,
        ProductName: name,
        Brand: str(fields.brand),
        Categories: str(fields.collection) ? [str(fields.collection)] : undefined,
        Price: price,
        MemberPrice: num(fields.reserve_price),
        URL: productUrl(handle),
        ImageURL: safeUrl(fields.image_url, ALLOWED_IMAGE_HOSTS),
        VariantID: str(fields.variant_id),
        Source: str(fields.source, 80),
      }),
    };
  }

  if (eventName === "add_to_cart") {
    const handle = slug(fields.product_id);
    const name = str(fields.name);
    const variant = str(fields.variant_id);
    if (!handle || !name) return null;
    const price = num(fields.value);
    const cartTotal = num(fields.cart_total);
    const itemNames = Array.isArray(fields.cart_item_names)
      ? fields.cart_item_names.map((n) => str(n)).filter(Boolean).slice(0, 20)
      : undefined;
    return {
      metric: LIFECYCLE_METRICS.addedToCart,
      value: cartTotal ?? price,
      dedupeKey: `cart:${variant ?? handle}:${bucket(nowMs, CART_DEDUPE_MINUTES)}`,
      properties: clean({
        AddedItemProductID: handle,
        AddedItemProductName: name,
        AddedItemBrand: str(fields.brand),
        AddedItemVariantID: variant,
        AddedItemVariantTitle: str(fields.variant_title, 120),
        AddedItemPrice: price,
        AddedItemQuantity: num(fields.quantity),
        AddedItemURL: productUrl(handle),
        AddedItemImageURL: safeUrl(fields.image_url, ALLOWED_IMAGE_HOSTS),
        CheckoutURL: safeUrl(fields.checkout_url, ALLOWED_LINK_HOSTS),
        // First-party link that checks the cart is still live (off by default).
        RecoveryURL: recoveryLinksEnabled() ? buildRecoveryUrl(safeUrl(fields.checkout_url, ALLOWED_LINK_HOSTS), handle) : undefined,
        CartTotal: cartTotal,
        CartItemCount: num(fields.cart_item_count),
        ItemNames: itemNames && itemNames.length ? itemNames : undefined,
      }),
    };
  }

  if (RESERVE_INTENT_EVENTS.has(eventName)) {
    if (eventName === "checkout_clicked" && !RESERVE_CHECKOUT_SOURCES.has(String(fields.source ?? "")) && !str(fields.plan)) {
      return null;
    }
    const products = Array.isArray(fields.products)
      ? fields.products.map(slug).filter(Boolean).slice(0, 6)
      : undefined;
    return {
      metric: LIFECYCLE_METRICS.reserveIntent,
      dedupeKey: `reserve:${bucket(nowMs, RESERVE_INTENT_DEDUPE_MINUTES)}`,
      properties: clean({
        IntentSource: eventName,
        Source: str(fields.source, 80),
        Plan: str(fields.plan, 60),
        Products: products && products.length ? products : undefined,
        ProductURLs: products && products.length ? products.map((p) => productUrl(p!)) : undefined,
        ReserveURL: `${SITE_URL}/subscription`,
      }),
    };
  }

  return null;
}

export type SiteEventResult = "sent" | "failed";

export async function sendSiteEventToKlaviyo(
  identity: KlaviyoIdentity,
  mapped: MappedSiteEvent,
  nowMs = Date.now(),
): Promise<SiteEventResult> {
  try {
    await klaviyoRequest("/api/events", {
      body: {
        data: {
          type: "event",
          attributes: {
            metric: { data: { type: "metric", attributes: { name: mapped.metric } } },
            profile: { data: { type: "profile", attributes: profileAttributes(identity) } },
            properties: { ...mapped.properties, IdentitySource: identity.kind },
            ...(mapped.value !== undefined ? { value: mapped.value, value_currency: "USD" } : {}),
            time: new Date(nowMs).toISOString(),
            unique_id: `${identityKey(identity)}:${mapped.dedupeKey}`,
          },
        },
      },
    });
    return "sent";
  } catch (err) {
    const code = err instanceof KlaviyoError ? err.message : "unexpected";
    console.warn(`[klaviyo-site-events] ${mapped.metric} not sent: ${code}`);
    return "failed";
  }
}
