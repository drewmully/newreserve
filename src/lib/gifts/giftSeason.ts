/**
 * Gift a Season: prepaid Reserve gifts with no auto-renewal.
 *
 * Pure helpers + constants shared by the LP, the webhooks and the crons.
 * Safe to import from client components (no server-only deps).
 *
 * How a season gift works:
 *   - The gifter buys one variant of the "Reserve Gift Season" product
 *     (1, 2 or 4 seasons) in a single one-time Shopify checkout.
 *   - That paid order is box 1. The gifter enters the recipient's sizes in
 *     Step 2, so it ships right away (no reveal, no sizing precondition),
 *     either to the recipient or to the gifter to hand over.
 *   - Boxes 2..N are $0 Shopify orders the season-dispatch cron creates on
 *     the normal quarterly cycle (every 3 months after box 1 ships), so they
 *     land in the same fulfillment queue as Loop renewals.
 *   - The Firestore gift_orders doc tracks seasons_total / boxes_shipped.
 *     Remaining = seasons_total - boxes_shipped.
 *   - When the final box is dispatched the recipient gets an offer to
 *     continue as a regular Reserve Member.
 */

export type GiftSeasonCount = 1 | 2 | 4;

export interface GiftSeasonOption {
  seasons: GiftSeasonCount;
  label: string;
  /** Gift price in dollars. Mirrors the Shopify variant price; the LP
   *  replaces it with the live Storefront price when the variant is
   *  published. */
  price: number;
  sku: string;
  /** Numeric Shopify variant id (string to stay JSON safe). */
  variantId: string;
}

/** Regular Reserve Member price per season (used by the continue offer).
 *  Never $249. Gift prices are separate, see GIFT_SEASON_PRICES. */
export const RESERVE_SEASON_PRICE = 250;

/**
 * Gift a Season prices set by Drew on 2026-11-11. These mirror the draft
 * Shopify variants (RES-GIFT-1S/2S/4S) and are only a fallback: the LP reads
 * live variant prices from the Storefront when available, and per-season
 * math is always derived from the variant price.
 */
export const GIFT_SEASON_PRICES: Record<GiftSeasonCount, number> = {
  1: 299,
  2: 550,
  4: 1000,
};

/** Months between Reserve boxes (normal quarterly cycle). */
export const SEASON_INTERVAL_MONTHS = 3;

// Draft product "Reserve Gift Season" (gid://shopify/Product/10327639392448)
// created 2026-11-11. Env overrides let ops swap variants without a deploy.
const DEFAULT_VARIANT_IDS: Record<GiftSeasonCount, string> = {
  1: "50765708820672",
  2: "50765708853440",
  4: "50765708886208",
};

function envVariant(n: GiftSeasonCount): string {
  const raw =
    n === 1
      ? process.env.NEXT_PUBLIC_SHOPIFY_GIFT_SEASON_1_VARIANT_ID
      : n === 2
        ? process.env.NEXT_PUBLIC_SHOPIFY_GIFT_SEASON_2_VARIANT_ID
        : process.env.NEXT_PUBLIC_SHOPIFY_GIFT_SEASON_4_VARIANT_ID;
  const trimmed = raw?.trim();
  return trimmed && /^\d+$/.test(trimmed) ? trimmed : DEFAULT_VARIANT_IDS[n];
}

export const GIFT_SEASON_OPTIONS: GiftSeasonOption[] = ([1, 2, 4] as const).map(
  (seasons) => ({
    seasons,
    label: seasons === 1 ? "1 season" : `${seasons} seasons`,
    price: GIFT_SEASON_PRICES[seasons],
    sku: `RES-GIFT-${seasons}S`,
    variantId: envVariant(seasons),
  })
);

export function getGiftSeasonOption(
  seasons: number
): GiftSeasonOption | null {
  return GIFT_SEASON_OPTIONS.find((o) => o.seasons === seasons) ?? null;
}

/** Price per season derived from the variant price (cents-rounded). */
export function perSeasonPrice(price: number, seasons: number): number {
  if (!seasons || seasons <= 0) return price;
  return Math.round((price / seasons) * 100) / 100;
}

/**
 * Savings vs buying the 1-season gift N times, derived from variant prices
 * (never hard-coded). 0 for the 1-season option or when there is no saving.
 */
export function seasonSavings(
  price: number,
  seasons: number,
  singleSeasonPrice: number
): number {
  if (seasons <= 1) return 0;
  const saving = Math.round((singleSeasonPrice * seasons - price) * 100) / 100;
  return saving > 0 ? saving : 0;
}

/** "$1,000" or "$274.50": whole dollars when there are no cents. */
export function formatUsd(amount: number): string {
  const whole = Number.isInteger(amount);
  return `$${amount.toLocaleString("en-US", {
    minimumFractionDigits: whole ? 0 : 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Apply live variant prices (keyed by numeric variant id) over defaults. */
export function withLivePrices(
  options: GiftSeasonOption[],
  live: Record<string, number> | null | undefined
): GiftSeasonOption[] {
  if (!live) return options;
  return options.map((o) => {
    const p = live[o.variantId];
    return typeof p === "number" && Number.isFinite(p) && p > 0 ? { ...o, price: p } : o;
  });
}

export function parseSeasonCount(raw: unknown): GiftSeasonCount | null {
  const n = typeof raw === "number" ? raw : Number(String(raw ?? "").trim());
  return n === 1 || n === 2 || n === 4 ? n : null;
}

function normalizeVariantId(v: unknown): string | null {
  if (v === null || v === undefined) return null;
  const s = String(v).trim();
  const gid = s.match(/^gid:\/\/shopify\/ProductVariant\/(\d+)$/);
  if (gid) return gid[1];
  return /^\d+$/.test(s) ? s : null;
}

/**
 * Resolve the season count from a paid order's line items. Matches on
 * variant id first, then SKU (RES-GIFT-<n>S) so an env swap can't strand an
 * order. Returns null if no gift season line is present.
 */
export function seasonCountFromLineItems(
  lineItems: Array<{ variant_id?: unknown; sku?: string | null; quantity?: number }>
): GiftSeasonCount | null {
  for (const li of lineItems ?? []) {
    const vid = normalizeVariantId(li.variant_id);
    const byVariant = GIFT_SEASON_OPTIONS.find((o) => o.variantId === vid);
    if (byVariant) return byVariant.seasons;
    const skuMatch = (li.sku ?? "").trim().toUpperCase().match(/^RES-GIFT-(\d)S$/);
    if (skuMatch) {
      const n = parseSeasonCount(skuMatch[1]);
      if (n) return n;
    }
  }
  return null;
}

/** Cart / note attribute keys used by the season funnel. */
export const GIFT_SEASON_ATTR = {
  kind: "gift_kind", // "season"
  seasons: "gift_seasons", // "1" | "2" | "4"
  child: "gift_season_child", // "true" on $0 box orders we create
  parentOrderId: "gift_season_parent_order_id",
  boxNumber: "gift_season_box_number",
  shipMode: "gift_ship_mode", // "to_recipient" | "to_purchaser"
  token: "gift_token", // gift link token, also on the line as _gift_token
} as const;

// ── Ship mode ───────────────────────────────────────────────────────────────

/**
 * Where season 1 ships. "to_recipient": the gifter enters the recipient's
 * address as the Shopify shipping address. "to_purchaser": it ships to the
 * gifter, who hands it over; we collect the recipient's address later.
 */
export type GiftShipMode = "to_recipient" | "to_purchaser";

export function parseShipMode(raw: unknown): GiftShipMode {
  return String(raw ?? "").trim() === "to_purchaser" ? "to_purchaser" : "to_recipient";
}

export const SHIP_MODE_COPY: Record<GiftShipMode, { label: string; hint: string; lineValue: string }> = {
  to_recipient: {
    label: "Ship to them",
    hint: "Enter their address as the shipping address at checkout.",
    lineValue: "Recipient",
  },
  to_purchaser: {
    label: "Ship to me, I'll give it to them",
    hint: "Use your address at checkout. We'll ask for theirs after they open it.",
    lineValue: "Purchaser (gift hand-off)",
  },
};

// ── Next-season address ────────────────────────────────────────────────────

/** Address for seasons 2..N, stored on the gift doc (Shopify-ish keys). */
export interface GiftShipAddress {
  first_name: string;
  last_name: string;
  address1: string;
  address2: string;
  city: string;
  province_code: string;
  zip: string;
  country_code: string;
  phone: string;
}

export const US_STATES: Array<[code: string, name: string]> = [
  ["AL", "Alabama"], ["AK", "Alaska"], ["AZ", "Arizona"], ["AR", "Arkansas"], ["CA", "California"],
  ["CO", "Colorado"], ["CT", "Connecticut"], ["DE", "Delaware"], ["DC", "District of Columbia"],
  ["FL", "Florida"], ["GA", "Georgia"], ["HI", "Hawaii"], ["ID", "Idaho"], ["IL", "Illinois"],
  ["IN", "Indiana"], ["IA", "Iowa"], ["KS", "Kansas"], ["KY", "Kentucky"], ["LA", "Louisiana"],
  ["ME", "Maine"], ["MD", "Maryland"], ["MA", "Massachusetts"], ["MI", "Michigan"], ["MN", "Minnesota"],
  ["MS", "Mississippi"], ["MO", "Missouri"], ["MT", "Montana"], ["NE", "Nebraska"], ["NV", "Nevada"],
  ["NH", "New Hampshire"], ["NJ", "New Jersey"], ["NM", "New Mexico"], ["NY", "New York"],
  ["NC", "North Carolina"], ["ND", "North Dakota"], ["OH", "Ohio"], ["OK", "Oklahoma"], ["OR", "Oregon"],
  ["PA", "Pennsylvania"], ["RI", "Rhode Island"], ["SC", "South Carolina"], ["SD", "South Dakota"],
  ["TN", "Tennessee"], ["TX", "Texas"], ["UT", "Utah"], ["VT", "Vermont"], ["VA", "Virginia"],
  ["WA", "Washington"], ["WV", "West Virginia"], ["WI", "Wisconsin"], ["WY", "Wyoming"],
];

function str(v: unknown, max = 120): string {
  return typeof v === "string" ? v.trim().slice(0, max) : "";
}

/**
 * Validate a next-season address from the /gift-address form. US only, which
 * matches the Reserve shipping zone used for the parent order.
 */
export function validateGiftAddress(
  input: unknown
): { ok: true; address: GiftShipAddress } | { ok: false; error: string } {
  const src = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const address: GiftShipAddress = {
    first_name: str(src.first_name, 60),
    last_name: str(src.last_name, 60),
    address1: str(src.address1),
    address2: str(src.address2),
    city: str(src.city, 80),
    province_code: str(src.province_code, 2).toUpperCase(),
    zip: str(src.zip, 10),
    country_code: "US",
    phone: str(src.phone, 30),
  };
  if (!address.first_name || !address.last_name) return { ok: false, error: "Add a first and last name." };
  if (!address.address1) return { ok: false, error: "Add a street address." };
  if (!address.city) return { ok: false, error: "Add a city." };
  if (!US_STATES.some(([c]) => c === address.province_code)) return { ok: false, error: "Pick a state." };
  if (!/^\d{5}(-\d{4})?$/.test(address.zip)) return { ok: false, error: "Check the ZIP code." };
  return { ok: true, address };
}

/** A stored address is usable for a $0 season order. */
export function isValidGiftAddress(a: Partial<GiftShipAddress> | null | undefined): boolean {
  if (!a) return false;
  return !!(a.address1?.trim() && a.city?.trim() && a.zip?.trim() && a.country_code?.trim() &&
    (a.first_name?.trim() || a.last_name?.trim()));
}

/** Map a Shopify webhook shipping_address to our stored shape. */
export function addressFromShopify(
  a: Record<string, unknown> | null | undefined
): GiftShipAddress | null {
  if (!a) return null;
  const out: GiftShipAddress = {
    first_name: str(a.first_name, 60),
    last_name: str(a.last_name, 60),
    address1: str(a.address1),
    address2: str(a.address2),
    city: str(a.city, 80),
    province_code: str(a.province_code, 10),
    zip: str(a.zip, 12),
    country_code: str(a.country_code, 2) || "US",
    phone: str(a.phone, 30),
  };
  return isValidGiftAddress(out) ? out : null;
}

/** "Sam Lee, 12 Elm St, Austin, TX 78701" */
export function formatGiftAddress(a: Partial<GiftShipAddress> | null | undefined): string {
  if (!a) return "";
  const name = [a.first_name, a.last_name].filter(Boolean).join(" ");
  const street = [a.address1, a.address2].filter(Boolean).join(" ");
  const cityLine = [a.city, [a.province_code, a.zip].filter(Boolean).join(" ")].filter(Boolean).join(", ");
  return [name, street, cityLine].filter(Boolean).join(", ");
}

const DAY_MS = 86_400_000;
/** Ship-to-me: wait this long after season 1 ships so the ask can't spoil the gift. */
export const ADDRESS_REQUEST_DELAY_DAYS = 14;
/** No response from the recipient after this long: ask the purchaser. */
export const ADDRESS_FALLBACK_DAYS = 7;
/** Remind the purchaser this long before season 2 is due if still missing. */
export const ADDRESS_REMINDER_LEAD_DAYS = 14;
/** Season notice (with the update link) goes out this long before each due date. */
export const SEASON_NOTICE_LEAD_DAYS = 10;

export interface AddressStateInput {
  seasons_total?: number | null;
  box_orders?: Array<{ box_number: number; shipped_at?: number | null }> | null;
  first_box_shipped_at?: number | null;
  ship_mode?: GiftShipMode | null;
  next_shipping_address?: Partial<GiftShipAddress> | null;
  recipient_email?: string | null;
  purchaser_email?: string | null;
  address_request_sent_at?: number | null;
  address_request_target?: "recipient" | "purchaser" | null;
  address_fallback_sent_at?: number | null;
  address_reminder_sent_at?: number | null;
}

/** More seasons remain and there is no usable address for them yet. */
export function needsNextAddress(g: AddressStateInput): boolean {
  const p = seasonProgress(g);
  if (p.seasonsTotal <= 1 || p.nextBoxNumber === null) return false;
  return !isValidGiftAddress(g.next_shipping_address);
}

export type AddressEmailAction =
  | { kind: "request"; target: "recipient" | "purchaser" }
  | { kind: "fallback" }
  | { kind: "reminder" };

/**
 * Which address email (if any) is due now. Pure so the cron and tests agree.
 *   - Ship to me: 14 days after season 1 ships, ask the recipient (or the
 *     purchaser when no recipient email). 7 days without a response, ask
 *     the purchaser.
 *   - Any mode: 14 days before season 2 is due and still missing, remind
 *     the purchaser.
 */
export function addressEmailDue(g: AddressStateInput, nowMs: number): AddressEmailAction | null {
  if (!needsNextAddress(g) || !g.first_box_shipped_at) return null;
  if (g.ship_mode === "to_purchaser") {
    if (!g.address_request_sent_at) {
      if (nowMs >= g.first_box_shipped_at + ADDRESS_REQUEST_DELAY_DAYS * DAY_MS) {
        return { kind: "request", target: g.recipient_email ? "recipient" : "purchaser" };
      }
      return null;
    }
    if (
      g.address_request_target === "recipient" &&
      !g.address_fallback_sent_at &&
      nowMs >= g.address_request_sent_at + ADDRESS_FALLBACK_DAYS * DAY_MS
    ) {
      return { kind: "fallback" };
    }
  }
  const due2 = boxDueOn(g.first_box_shipped_at, 2);
  if (!g.address_reminder_sent_at && due2) {
    const dueMs = Date.parse(`${due2}T00:00:00Z`);
    if (nowMs >= dueMs - ADDRESS_REMINDER_LEAD_DAYS * DAY_MS) return { kind: "reminder" };
  }
  return null;
}

/**
 * Season notice: once per season 2..N, SEASON_NOTICE_LEAD_DAYS before it is
 * due, while the address is valid. Returns the season number or null.
 */
export function seasonNoticeDue(
  g: AddressStateInput & { season_notices_sent?: number[] | null },
  nowMs: number
): number | null {
  const p = seasonProgress(g);
  if (!p.nextBoxNumber || p.nextBoxNumber <= 1 || !p.nextBoxDueOn) return null;
  if (!isValidGiftAddress(g.next_shipping_address)) return null;
  if ((g.season_notices_sent ?? []).includes(p.nextBoxNumber)) return null;
  const dueMs = Date.parse(`${p.nextBoxDueOn}T00:00:00Z`);
  return nowMs >= dueMs - SEASON_NOTICE_LEAD_DAYS * DAY_MS ? p.nextBoxNumber : null;
}

/** Shopify order tags. Kept lowercase and stable for reporting. */
export function giftSeasonParentTags(seasons: number): string[] {
  return ["gift-season", `gift-season-${seasons}`, `gift-season-box-1-of-${seasons}`];
}

export function giftSeasonChildTags(boxNumber: number, seasons: number): string[] {
  return [
    "gift-season",
    "gift-season-box",
    `gift-season-${seasons}`,
    `gift-season-box-${boxNumber}-of-${seasons}`,
  ];
}

type Attr = { name?: string; key?: string; value?: string | null };

export function readAttr(attrs: Attr[] | undefined, key: string): string | null {
  if (!attrs) return null;
  const found = attrs.find(
    (a) => (a.name ?? a.key ?? "").toLowerCase() === key.toLowerCase()
  );
  const v = found?.value?.trim();
  return v ? v : null;
}

/** True for the $0 box orders the season-dispatch cron creates. */
export function isGiftSeasonChildOrder(
  attrs: Attr[] | undefined,
  tags?: string | null
): boolean {
  if (readAttr(attrs, GIFT_SEASON_ATTR.child) === "true") return true;
  const tagList = (tags ?? "").split(",").map((t) => t.trim().toLowerCase());
  return tagList.includes("gift-season-box");
}

/** Add whole calendar months in UTC, clamping to the last day of month. */
export function addMonthsUtc(ms: number, months: number): Date {
  const d = new Date(ms);
  const y = d.getUTCFullYear();
  const m = d.getUTCMonth() + months;
  const day = d.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(y, m, Math.min(day, lastDay), d.getUTCHours(), d.getUTCMinutes())
  );
}

/**
 * Due date (YYYY-MM-DD, UTC) for box `boxNumber` (1-indexed). Box 1 has no
 * due date (it ships from the paid order right away). Box N is due
 * (N-1) quarters after box 1 shipped.
 */
export function boxDueOn(
  firstBoxShippedAt: number | null | undefined,
  boxNumber: number
): string | null {
  if (!firstBoxShippedAt || boxNumber <= 1) return null;
  return addMonthsUtc(firstBoxShippedAt, SEASON_INTERVAL_MONTHS * (boxNumber - 1))
    .toISOString()
    .slice(0, 10);
}

export interface SeasonProgress {
  seasonsTotal: number;
  boxesDispatched: number;
  boxesShipped: number;
  boxesRemaining: number;
  nextBoxNumber: number | null;
  nextBoxDueOn: string | null;
}

/**
 * Derive progress from the stored counters. `boxesDispatched` counts orders
 * that exist in Shopify (box 1 = the paid order). Remaining counts boxes not
 * yet shipped.
 */
export function seasonProgress(input: {
  seasons_total?: number | null;
  box_orders?: Array<{ box_number: number; shipped_at?: number | null }> | null;
  first_box_shipped_at?: number | null;
}): SeasonProgress {
  const total = Math.max(0, input.seasons_total ?? 0);
  const boxes = input.box_orders ?? [];
  const dispatched = Math.min(total, boxes.length);
  const shipped = Math.min(total, boxes.filter((b) => !!b.shipped_at).length);
  const nextBoxNumber = dispatched < total ? dispatched + 1 : null;
  return {
    seasonsTotal: total,
    boxesDispatched: dispatched,
    boxesShipped: shipped,
    boxesRemaining: Math.max(0, total - shipped),
    nextBoxNumber,
    nextBoxDueOn: nextBoxNumber
      ? boxDueOn(input.first_box_shipped_at ?? null, nextBoxNumber)
      : null,
  };
}

/**
 * Should the cron create the next box order now? Only after box 1 has
 * shipped, only while boxes remain, and only once the previous box shipped
 * (never stack two open boxes for the same recipient).
 */
export function isNextBoxDue(
  input: Parameters<typeof seasonProgress>[0],
  nowMs: number
): boolean {
  const p = seasonProgress(input);
  if (!p.nextBoxNumber || p.nextBoxNumber <= 1 || !p.nextBoxDueOn) return false;
  if (p.boxesShipped < p.boxesDispatched) return false;
  return p.nextBoxDueOn <= new Date(nowMs).toISOString().slice(0, 10);
}

/**
 * Continue-as-member offer goes out once, when the final box is on its way:
 * for multi-season gifts that's when the last box order is created; for a
 * single season it's when box 1 ships.
 */
export function isContinueOfferDue(input: {
  seasons_total?: number | null;
  box_orders?: Array<{ box_number: number; shipped_at?: number | null }> | null;
  continue_offer_sent_at?: number | null;
  converted_at?: number | null;
}): boolean {
  if (input.continue_offer_sent_at || input.converted_at) return false;
  const p = seasonProgress(input);
  if (p.seasonsTotal <= 0) return false;
  if (p.seasonsTotal === 1) return p.boxesShipped >= 1;
  return p.boxesDispatched >= p.seasonsTotal;
}
