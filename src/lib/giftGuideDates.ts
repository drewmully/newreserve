/**
 * Christmas cutoff for the gift guide. Client-safe (no Shopify imports) so the
 * per-card restock note can compute against the shopper's clock.
 */

/**
 * Last day to order in-stock pieces for Christmas delivery with standard
 * shipping (5 to 7 business days per /policies/shipping). Christmas 2026 is a
 * Friday. DREW TO CONFIRM before launch. This is the only place the date lives.
 */
export const GIFT_ORDER_BY = "2026-12-14";

/** Restocking pieces ship in about this many weeks (matches EstShipDate's fallback). */
export const GIFT_RESTOCK_WEEKS = 2;

const DAY = 24 * 60 * 60 * 1000;
const ORDER_BY_END = new Date(`${GIFT_ORDER_BY}T23:59:59-05:00`).getTime();

function label(ms: number, weekday = true): string {
  return new Date(ms).toLocaleDateString("en-US", {
    ...(weekday ? { weekday: "long" as const } : {}),
    month: "long",
    day: "numeric",
    timeZone: "America/New_York",
  });
}

/** "Monday, December 14" */
export function giftOrderByLabel(): string {
  return label(ORDER_BY_END);
}

export function isPastGiftOrderBy(now: Date = new Date()): boolean {
  return now.getTime() > ORDER_BY_END;
}

/** Last day to order a restocking piece: the order-by date minus its restock lead time. */
export function giftRestockCutoff(weeks: number = GIFT_RESTOCK_WEEKS): number {
  return ORDER_BY_END - weeks * 7 * DAY;
}

/** "Monday, November 30" */
export function giftRestockCutoffLabel(weeks: number = GIFT_RESTOCK_WEEKS): string {
  return label(giftRestockCutoff(weeks));
}

export function giftRestockCutoffShort(weeks: number = GIFT_RESTOCK_WEEKS): string {
  return new Date(giftRestockCutoff(weeks)).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });
}
