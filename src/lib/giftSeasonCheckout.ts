/**
 * Gift a Season checkout: one-time Storefront cart for the prepaid
 * "Reserve Gift Season" variant (no selling plan, so nothing renews).
 *
 * No reveal: the gifter enters the recipient's sizes in Step 2 and season 1
 * ships right away. Everything the stylist and the webhook need rides on the
 * order without write_orders:
 *   - Cart LINE attributes become line item properties, visible to the
 *     stylist on the order (Recipient, Shirt, Waist, ..., Ships to). Keys
 *     starting with "_" are hidden from the customer.
 *   - Cart attributes become note_attributes, which the orders-paid webhook
 *     reads to create the gift_orders doc (same keys as the legacy /lp/gift
 *     funnel, plus gift_kind / gift_seasons / gift_ship_mode / gift_token).
 */

import { buildCheckoutOriginAttributes } from "./shopifyCheckoutOrigin";
import { recordJourneyCart } from "./analytics/journeyClient";
import { recordSourceSessionCart } from "./analytics/journeySourceSessionClient";
import { getStoredAttribution, attributionToCartAttributes } from "./attribution";
import {
  GIFT_SEASON_ATTR,
  SHIP_MODE_COPY,
  getGiftSeasonOption,
  type GiftSeasonCount,
  type GiftShipMode,
} from "./gifts/giftSeason";
import {
  SIZING_FIELDS,
  missingSizing,
  sizingLineAttributes,
  type GiftSizing,
} from "./gifts/giftSizing";

export interface GiftSeasonCheckoutInput {
  seasons: GiftSeasonCount;
  recipientName: string;
  /** Optional. Used later for address and sizing updates. */
  recipientEmail: string;
  message: string;
  sizing: GiftSizing;
  shipMode: GiftShipMode;
  /** Gift link token (also the /gift-address/[token] key). */
  giftToken: string;
  lpSource: string;
}

const MESSAGE_MAX = 500;

/** Same shape as the server's createSizingToken (32-char base64url). */
export function isGiftTokenShape(t: string): boolean {
  return /^[A-Za-z0-9_-]{24,64}$/.test(t);
}

export function createClientGiftToken(): string {
  const bytes = new Uint8Array(24);
  crypto.getRandomValues(bytes);
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function validateGiftSeasonInput(input: GiftSeasonCheckoutInput): string | null {
  if (!getGiftSeasonOption(input.seasons)) return "Pick a gift length.";
  if (!input.recipientName.trim()) return "Add the recipient's first name.";
  const missing = missingSizing(input.sizing);
  if (missing.length) return `Pick their ${missing[0].toLowerCase()}.`;
  const email = input.recipientEmail.trim();
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return "Check the recipient's email, or leave it blank.";
  }
  if (input.message.length > MESSAGE_MAX) {
    return `Keep the note under ${MESSAGE_MAX} characters.`;
  }
  if (!isGiftTokenShape(input.giftToken)) return "Something went wrong. Please refresh and try again.";
  return null;
}

/** Pure: the cart line + attributes for a season gift. */
export function buildGiftSeasonCart(input: GiftSeasonCheckoutInput): {
  merchandiseId: string;
  lineAttributes: Array<{ key: string; value: string }>;
  attributes: Array<{ key: string; value: string }>;
} {
  const option = getGiftSeasonOption(input.seasons);
  if (!option) throw new Error("Unknown gift length");
  const name = input.recipientName.trim().slice(0, 100);
  const email = input.recipientEmail.trim().toLowerCase();
  const message = input.message.trim().slice(0, MESSAGE_MAX);
  const lineAttributes = [
    { key: "Recipient", value: name },
    ...sizingLineAttributes(input.sizing),
    { key: "Ships to", value: SHIP_MODE_COPY[input.shipMode].lineValue },
    { key: "_gift_token", value: input.giftToken },
    { key: "_gift_ship_mode", value: input.shipMode },
    { key: "_recipient_email", value: email },
  ].filter((a) => a.value !== "");
  const attrs: Array<{ key: string; value: string }> = [
    { key: "lp_source", value: input.lpSource },
    { key: "gift", value: "true" },
    { key: GIFT_SEASON_ATTR.kind, value: "season" },
    { key: GIFT_SEASON_ATTR.seasons, value: String(input.seasons) },
    { key: GIFT_SEASON_ATTR.shipMode, value: input.shipMode },
    { key: GIFT_SEASON_ATTR.token, value: input.giftToken },
    { key: "gift_recipient_name", value: name },
    { key: "gift_recipient_email", value: email },
    { key: "gift_message", value: message },
    ...SIZING_FIELDS.map((f) => ({ key: `gift_size_${f.key}`, value: input.sizing[f.key] })),
    { key: "gift_size_notes", value: input.sizing.notes.trim() },
  ];
  return {
    merchandiseId: `gid://shopify/ProductVariant/${option.variantId}`,
    lineAttributes,
    attributes: attrs.filter((a) => a.value !== ""),
  };
}

/** Post-checkout return page with mode-specific next steps. */
export function giftSeasonConfirmedPath(input: Pick<GiftSeasonCheckoutInput, "giftToken" | "shipMode" | "seasons">): string {
  const q = new URLSearchParams({ t: input.giftToken, mode: input.shipMode, seasons: String(input.seasons) });
  return `/lp/gift-season/confirmed?${q.toString()}`;
}

/** Creates the Storefront cart and returns the Shopify checkout URL. */
export async function createGiftSeasonCheckout(
  input: GiftSeasonCheckoutInput,
  returnPath = giftSeasonConfirmedPath(input)
): Promise<string> {
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN;
  const token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  if (!domain || !token) throw new Error("Checkout is temporarily unavailable.");

  const returnTo = `${window.location.origin}${returnPath}`;
  const { merchandiseId, lineAttributes, attributes } = buildGiftSeasonCart(input);
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
        lines: [{ merchandiseId, quantity: 1, attributes: lineAttributes }],
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
