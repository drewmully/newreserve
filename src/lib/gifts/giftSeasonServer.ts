/**
 * Gift a Season: server-only side effects (Shopify Admin, PostHog, Supabase).
 *
 * Every function here is best-effort or explicitly throws; callers decide.
 * Never import from client components.
 */

import { PostHog } from "posthog-node";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { SHOPIFY_MEMBERSHIP_PLANS } from "@/lib/membershipConfig";
import type { GiftOrderDoc } from "@/lib/gifts/giftOrder";
import {
  GIFT_SEASON_ATTR,
  giftSeasonChildTags,
  isValidGiftAddress,
  needsNextAddress,
  seasonProgress,
  type GiftShipAddress,
} from "@/lib/gifts/giftSeason";
import { formatSizingLine, sanitizeSizing, sizingLineAttributes } from "@/lib/gifts/giftSizing";

// ── Analytics ───────────────────────────────────────────────────────────────

export type GiftSeasonEvent =
  | "gift_season_purchased"
  | "gift_season_gifter_confirmation_sent"
  | "gift_season_address_copied"
  | "gift_season_address_requested"
  | "gift_season_address_reminder_sent"
  | "gift_season_address_collected"
  | "gift_season_address_blocked"
  | "gift_season_sizing_updated"
  | "gift_season_notice_sent"
  | "gift_season_box_dispatched"
  | "gift_season_box_shipped"
  | "gift_season_completed"
  | "gift_season_continue_offer_sent"
  | "gift_season_converted"
  | "gift_season_error";

/**
 * PostHog-only capture (same pattern as Style Game). Keeps gift lifecycle
 * events off Meta / Google Ads; the paid order's normal purchase event
 * already carries purchase_type=gift for ad attribution.
 */
export async function captureGiftSeasonEvent(
  event: GiftSeasonEvent,
  distinctId: string | null | undefined,
  properties: Record<string, unknown> = {}
): Promise<void> {
  const apiKey =
    process.env.POSTHOG_PROJECT_API_KEY ?? process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!apiKey) return;
  const host =
    process.env.POSTHOG_HOST ??
    process.env.NEXT_PUBLIC_POSTHOG_HOST ??
    "https://us.i.posthog.com";
  const posthog = new PostHog(apiKey, { host });
  try {
    posthog.capture({
      distinctId: (distinctId ?? "").trim() || "gift_season_unknown",
      event,
      properties: { funnel: "gift_season", $lib: "mully-server", ...properties },
    });
  } catch (err) {
    console.error("[gift-season] posthog capture failed", event, err);
  } finally {
    await posthog.shutdown().catch(() => {});
  }
}

export function giftEventProps(id: string, data: Partial<GiftOrderDoc>) {
  const p = seasonProgress(data);
  return {
    gift_order_id: id,
    shopify_order_number: data.shopify_order_number ?? null,
    seasons_total: p.seasonsTotal,
    boxes_shipped: p.boxesShipped,
    boxes_remaining: p.boxesRemaining,
    value: data.total_price ?? null,
    currency: data.currency ?? "USD",
  };
}

/**
 * Mirror the season gift into Supabase public.gift_seasons so finance and
 * KPI agents can query it next to orders. Firestore stays the source of
 * truth; failures are logged, never thrown.
 */
export async function mirrorGiftSeasonToSupabase(
  id: string,
  data: GiftOrderDoc
): Promise<void> {
  try {
    const p = seasonProgress(data);
    const iso = (ms: number | null | undefined) =>
      ms ? new Date(ms).toISOString() : null;
    const sb = getSupabaseService();
    const { error } = await sb.from("gift_seasons").upsert(
      {
        gift_order_id: id,
        shopify_order_number: data.shopify_order_number,
        purchaser_email: data.purchaser_email || null,
        recipient_email: data.recipient_email,
        recipient_first_name: data.recipient_first_name,
        seasons_total: p.seasonsTotal,
        amount: data.total_price,
        currency: data.currency,
        status: data.status,
        boxes_dispatched: p.boxesDispatched,
        boxes_shipped: p.boxesShipped,
        boxes_remaining: p.boxesRemaining,
        next_box_due_on: p.nextBoxDueOn,
        box_orders: data.box_orders ?? [],
        deliver_on: data.deliver_on,
        ship_mode: data.ship_mode ?? null,
        address_needed: needsNextAddress(data),
        address_source: data.address_source ?? null,
        address_collected_at: iso(data.address_collected_at),
        address_request_sent_at: iso(data.address_request_sent_at),
        gifter_confirmation_sent_at: iso(data.gifter_confirmation_sent_at),
        recipient_emailed_at: iso(data.recipient_emailed_at),
        sizing_collected_at: iso(data.sizing_collected_at),
        first_box_shipped_at: iso(data.first_box_shipped_at),
        continue_offer_sent_at: iso(data.continue_offer_sent_at),
        converted_at: iso(data.converted_at),
        completed_at: iso(data.completed_at),
        created_at: iso(data.created_at),
        updated_at: new Date().toISOString(),
      },
      { onConflict: "gift_order_id" }
    );
    if (error) console.error("[gift-season] supabase mirror failed:", error.message);
  } catch (err) {
    console.error("[gift-season] supabase mirror threw:", err);
  }
}

// ── Shopify ─────────────────────────────────────────────────────────────────

type UserErrors = Array<{ field?: string[] | null; message: string }>;

// No order mutations here on purpose: the production Admin token has no
// write_orders. Gift parents are identified by SKU (RES-GIFT-<n>S) and carry
// sizing as line item properties from the Storefront cart. Child orders get
// tags, sizing and address at draftOrderCreate (write_draft_orders only).

export function formatSizingNote(sizing: Record<string, string> | null | undefined): string {
  const line = formatSizingLine(sizing ? sanitizeSizing(sizing) : null);
  const notes = sizing?.notes?.trim();
  if (!line && !notes) return "GIFT SIZING: pending";
  return `GIFT SIZING: ${[line, notes && `notes: ${notes}`].filter(Boolean).join(", ")}`;
}

interface MailingAddressInput {
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  address1?: string | null;
  address2?: string | null;
  city?: string | null;
  provinceCode?: string | null;
  countryCode?: string | null;
  zip?: string | null;
  phone?: string | null;
}

async function getParentShippingAddress(
  parentOrderId: string
): Promise<MailingAddressInput | null> {
  const res = await shopifyGraphQL<{
    order: {
      shippingAddress: {
        firstName: string | null;
        lastName: string | null;
        company: string | null;
        address1: string | null;
        address2: string | null;
        city: string | null;
        provinceCode: string | null;
        countryCodeV2: string | null;
        zip: string | null;
        phone: string | null;
      } | null;
    } | null;
  }>(
    `query GiftSeasonParent($id: ID!) {
      order(id: $id) {
        shippingAddress {
          firstName lastName company address1 address2 city provinceCode
          countryCodeV2 zip phone
        }
      }
    }`,
    { id: `gid://shopify/Order/${parentOrderId}` }
  );
  const a = res.order?.shippingAddress;
  if (!a) return null;
  return {
    firstName: a.firstName,
    lastName: a.lastName,
    company: a.company,
    address1: a.address1,
    address2: a.address2,
    city: a.city,
    provinceCode: a.provinceCode,
    countryCode: a.countryCodeV2,
    zip: a.zip,
    phone: a.phone,
  };
}

function toMailingAddress(a: GiftShipAddress): MailingAddressInput {
  return {
    firstName: a.first_name || null,
    lastName: a.last_name || null,
    address1: a.address1,
    address2: a.address2 || null,
    city: a.city,
    provinceCode: a.province_code || null,
    countryCode: a.country_code || "US",
    zip: a.zip,
    phone: a.phone || null,
  };
}

/** Look for a box order we already created (crash-safe idempotency). */
async function findExistingBoxOrder(
  parentOrderId: string,
  boxNumber: number,
  seasons: number
): Promise<{ id: string; name: string } | null> {
  const res = await shopifyGraphQL<{
    orders: { nodes: Array<{ id: string; name: string }> };
  }>(
    `query GiftSeasonExisting($q: String!) {
      orders(first: 1, query: $q) { nodes { id name } }
    }`,
    {
      q: `tag:'gift-parent-${parentOrderId}' AND tag:'gift-season-box-${boxNumber}-of-${seasons}'`,
    }
  );
  const n = res.orders.nodes[0];
  return n ? { id: n.id.split("/").pop() ?? n.id, name: n.name } : null;
}

/** Variant used on $0 box orders. Defaults to the Reserve Member SKU so the
 * box flows through ops exactly like a Loop renewal. */
function boxVariantGid(): string {
  const override = process.env.GIFT_SEASON_BOX_VARIANT_ID?.trim();
  if (override && /^\d+$/.test(override)) {
    return `gid://shopify/ProductVariant/${override}`;
  }
  return SHOPIFY_MEMBERSHIP_PLANS.member.merchandiseId;
}

/**
 * Create the $0 Shopify order for box `boxNumber` of a season gift: a draft
 * order with a 100% discount on the Reserve line, completed as paid. Tags,
 * sizing line properties and the shipping address are set at creation
 * (write_draft_orders only). Ships to gift.next_shipping_address. The draft has no email or
 * customer, so Shopify sends no order or shipping notifications; our
 * season-dispatch email covers the recipient.
 */
export async function createSeasonBoxOrder(
  parentOrderId: string,
  gift: GiftOrderDoc,
  boxNumber: number
): Promise<{ id: string; name: string; reused: boolean }> {
  const seasons = gift.seasons_total ?? 0;
  const existing = await findExistingBoxOrder(parentOrderId, boxNumber, seasons);
  if (existing) return { ...existing, reused: true };

  // Seasons 2..N ship to the stored next-season address. Ship-to-them gifts
  // copy it from the paid order at purchase; ship-to-me gifts collect it on
  // /gift-address. Docs from before ship_mode existed fall back to the
  // parent order (read_orders only).
  let shippingAddress: MailingAddressInput | null = isValidGiftAddress(gift.next_shipping_address)
    ? toMailingAddress(gift.next_shipping_address as GiftShipAddress)
    : null;
  if (!shippingAddress && gift.ship_mode !== "to_purchaser") {
    shippingAddress = await getParentShippingAddress(parentOrderId);
  }
  if (!shippingAddress) {
    throw new Error(`gift ${parentOrderId} has no next-season address`);
  }

  const tags = [...giftSeasonChildTags(boxNumber, seasons), `gift-parent-${parentOrderId}`];
  const note = [
    `RESERVE GIFT SEASON: box ${boxNumber} of ${seasons} (prepaid on order #${gift.shopify_order_number}).`,
    `Recipient: ${gift.recipient_first_name ?? ""} <${gift.recipient_email}>`.trim(),
    formatSizingNote(gift.sizing),
  ].join("\n");

  const created = await shopifyGraphQL<{
    draftOrderCreate: {
      draftOrder: { id: string } | null;
      userErrors: UserErrors;
    };
  }>(
    `mutation GiftSeasonDraft($input: DraftOrderInput!) {
      draftOrderCreate(input: $input) {
        draftOrder { id }
        userErrors { field message }
      }
    }`,
    {
      input: {
        // No email or customer on purpose: Shopify sends an order confirmation
        // for any completed draft that has contact info. The recipient hears
        // from us via the season-dispatch email instead.
        note,
        tags,
        shippingAddress,
        customAttributes: [
          { key: GIFT_SEASON_ATTR.child, value: "true" },
          { key: GIFT_SEASON_ATTR.parentOrderId, value: parentOrderId },
          { key: GIFT_SEASON_ATTR.boxNumber, value: String(boxNumber) },
          { key: GIFT_SEASON_ATTR.seasons, value: String(seasons) },
          { key: "gift", value: "true" },
        ],
        lineItems: [
          {
            variantId: boxVariantGid(),
            quantity: 1,
            appliedDiscount: {
              title: "Reserve Gift Season (prepaid)",
              description: `Box ${boxNumber} of ${seasons}`,
              valueType: "PERCENTAGE",
              value: 100,
            },
            // Same line properties as the paid order so the stylist sees
            // sizes on every season.
            customAttributes: [
              ...(gift.recipient_first_name ? [{ key: "Recipient", value: gift.recipient_first_name }] : []),
              ...sizingLineAttributes(sanitizeSizing(gift.sizing)),
              { key: "Season", value: `${boxNumber} of ${seasons}` },
              { key: "_gift_season_box", value: `${boxNumber} of ${seasons}` },
            ],
          },
        ],
        shippingLine: { title: "Reserve Gift Season", price: "0.00" },
      },
    }
  );
  const draftErrors = created.draftOrderCreate.userErrors;
  const draftId = created.draftOrderCreate.draftOrder?.id;
  if (draftErrors.length || !draftId) {
    throw new Error(
      `draftOrderCreate: ${draftErrors.map((e) => e.message).join("; ") || "no draft id"}`
    );
  }

  const completed = await shopifyGraphQL<{
    draftOrderComplete: {
      draftOrder: { order: { id: string; name: string } | null } | null;
      userErrors: UserErrors;
    };
  }>(
    `mutation GiftSeasonComplete($id: ID!) {
      draftOrderComplete(id: $id, paymentPending: false) {
        draftOrder { order { id name } }
        userErrors { field message }
      }
    }`,
    { id: draftId }
  );
  const order = completed.draftOrderComplete.draftOrder?.order;
  if (completed.draftOrderComplete.userErrors.length || !order) {
    throw new Error(
      `draftOrderComplete: ${
        completed.draftOrderComplete.userErrors.map((e) => e.message).join("; ") ||
        "no order"
      }`
    );
  }
  return { id: order.id.split("/").pop() ?? order.id, name: order.name, reused: false };
}
