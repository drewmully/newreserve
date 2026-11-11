/**
 * Gift a Season checkout: one-time Storefront cart for the prepaid
 * "Reserve Gift Season" variant (no selling plan, so nothing renews).
 *
 * Cart attributes become order note_attributes, which the orders-paid
 * webhook reads to create the gift_orders doc (same keys as the legacy
 * /lp/gift funnel, plus gift_kind / gift_seasons).
 */

import { buildCheckoutOriginAttributes } from "./shopifyCheckoutOrigin";
import { recordJourneyCart } from "./analytics/journeyClient";
import { recordSourceSessionCart } from "./analytics/journeySourceSessionClient";
import { getStoredAttribution, attributionToCartAttributes } from "./attribution";
import {
  GIFT_SEASON_ATTR,
  getGiftSeasonOption,
  type GiftSeasonCount,
} from "./gifts/giftSeason";

export interface GiftSeasonCheckoutInput {
  seasons: GiftSeasonCount;
  recipientName: string;
  recipientEmail: string;
  message: string;
  /** YYYY-MM-DD or "" for send now. */
  deliverOn: string;
  lpSource: string;
  /**
   * "I'll give it myself": the reveal and a printable gift card go to the
   * gifter's checkout email instead, and the recipient email is optional.
   */
  selfDeliver?: boolean;
}

const MESSAGE_MAX = 500;

export function validateGiftSeasonInput(
  input: GiftSeasonCheckoutInput,
  todayIso: string
): string | null {
  if (!getGiftSeasonOption(input.seasons)) return "Pick a gift length.";
  if (!input.recipientName.trim()) return "Add the recipient's first name.";
  const email = input.recipientEmail.trim();
  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
  if (input.selfDeliver) {
    if (email && !emailOk) return "Check the recipient's email, or leave it blank.";
  } else if (!email || !emailOk) {
    return "Add the recipient's email so we can send the gift.";
  }
  if (input.deliverOn) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.deliverOn)) return "Pick a valid send date.";
    if (input.deliverOn < todayIso) return "Pick a send date of today or later.";
  }
  if (input.message.length > MESSAGE_MAX) {
    return `Keep the note under ${MESSAGE_MAX} characters.`;
  }
  return null;
}

/** Pure: the cart lines + attributes for a season gift. */
export function buildGiftSeasonCart(input: GiftSeasonCheckoutInput): {
  merchandiseId: string;
  attributes: Array<{ key: string; value: string }>;
} {
  const option = getGiftSeasonOption(input.seasons);
  if (!option) throw new Error("Unknown gift length");
  const attrs: Array<{ key: string; value: string }> = [
    { key: "lp_source", value: input.lpSource },
    { key: "gift", value: "true" },
    { key: GIFT_SEASON_ATTR.kind, value: "season" },
    { key: GIFT_SEASON_ATTR.seasons, value: String(input.seasons) },
    { key: "gift_recipient_name", value: input.recipientName.trim().slice(0, 100) },
    { key: "gift_recipient_email", value: input.recipientEmail.trim().toLowerCase() },
    { key: "gift_deliver_on", value: input.deliverOn },
    { key: "gift_message", value: input.message.trim().slice(0, MESSAGE_MAX) },
    { key: GIFT_SEASON_ATTR.selfDeliver, value: input.selfDeliver ? "true" : "" },
  ];
  return {
    merchandiseId: `gid://shopify/ProductVariant/${option.variantId}`,
    attributes: attrs.filter((a) => a.value !== ""),
  };
}

/** Creates the Storefront cart and returns the Shopify checkout URL. */
export async function createGiftSeasonCheckout(
  input: GiftSeasonCheckoutInput,
  returnPath = "/auth/callback"
): Promise<string> {
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  const token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  if (!domain || !token) throw new Error("Checkout is temporarily unavailable.");

  const returnTo = `${window.location.origin}${returnPath}`;
  const { merchandiseId, attributes } = buildGiftSeasonCart(input);
  const txnId =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `mully-${Date.now()}`;
  try {
    window.localStorage.setItem("mully_pending_txn_id", txnId);
  } catch {
    /* ignore */
  }

  const res = await fetch(`https://${domain}/api/2024-10/graphql.json`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Storefront-Access-Token": token,
    },
    body: JSON.stringify({
      query: `mutation GiftSeasonCart($lines: [CartLineInput!]!, $attributes: [AttributeInput!]) {
        cartCreate(input: { lines: $lines, attributes: $attributes }) {
          cart { id checkoutUrl }
          userErrors { field message code }
        }
      }`,
      variables: {
        lines: [{ merchandiseId, quantity: 1 }],
        attributes: [
          ...buildCheckoutOriginAttributes(returnTo),
          ...attributionToCartAttributes(getStoredAttribution()),
          { key: "mully_txn_id", value: txnId },
          ...attributes,
        ],
      },
    }),
  });
  const json = await res.json().catch(() => ({}));
  const cart = json?.data?.cartCreate?.cart;
  if (!cart?.checkoutUrl) {
    const msg =
      json?.data?.cartCreate?.userErrors?.[0]?.message ??
      json?.errors?.[0]?.message ??
      "Could not start checkout.";
    console.error("[giftSeasonCheckout] cartCreate failed", json);
    throw new Error(msg);
  }
  await recordJourneyCart(cart.id);
  await recordSourceSessionCart(cart.id);
  const url = new URL(cart.checkoutUrl);
  url.searchParams.set("return_url", returnTo);
  return url.toString();
}
