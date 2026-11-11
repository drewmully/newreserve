/**
 * Read Gift a Season data off a paid Shopify order (webhook payload). Line
 * item properties (from Storefront cart line attributes) are what the
 * stylist sees; cart note_attributes carry the same values for the webhook.
 * Pure, so tests cover it without Shopify.
 */

import {
  GIFT_SEASON_ATTR,
  GIFT_SEASON_OPTIONS,
  parseShipMode,
  readAttr,
} from "@/lib/gifts/giftSeason";
import { sizingFromAttributes } from "@/lib/gifts/giftSizing";

type Prop = { name: string; value: string };
interface LineLike {
  sku?: string | null;
  variant_id?: number | string | null;
  properties?: Prop[] | null;
}

/** The gift season line on a paid order (matched by SKU or variant id). */
export function giftSeasonLine<T extends LineLike>(lineItems: T[] | null | undefined): T | null {
  return (
    (lineItems ?? []).find((li) => {
      const sku = (li.sku ?? "").trim().toUpperCase();
      if (/^RES-GIFT-\dS$/.test(sku)) return true;
      return GIFT_SEASON_OPTIONS.some((o) => o.variantId === String(li.variant_id ?? ""));
    }) ?? null
  );
}

/** Gift data from cart note_attributes, falling back to line properties. */
export function readGiftSeasonOrderData(order: {
  note_attributes?: Array<{ name: string; value: string }> | null;
  line_items: LineLike[];
}) {
  const line = giftSeasonLine(order.line_items);
  const props = (line?.properties ?? []).map((p) => ({ name: p.name, value: p.value }));
  const notes = order.note_attributes ?? [];
  const pick = (noteKey: string, propKey: string) =>
    readAttr(notes, noteKey) ?? readAttr(props, propKey);
  return {
    recipientName: pick("gift_recipient_name", "Recipient"),
    recipientEmail: (pick("gift_recipient_email", "_recipient_email") ?? "").toLowerCase(),
    message: readAttr(notes, "gift_message"),
    shipMode: parseShipMode(pick(GIFT_SEASON_ATTR.shipMode, "_gift_ship_mode")),
    token: pick(GIFT_SEASON_ATTR.token, "_gift_token"),
    // Note attributes first, line properties override (what the stylist sees).
    sizing: sizingFromAttributes([...notes, ...props]),
  };
}
