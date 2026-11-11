/**
 * Christmas cutoff for the gift guide. Client-safe (no Shopify imports) so the
 * per-card restock note can compute against the shopper's clock.
 */

/**
 * Holiday ship-by dates. DREW TO CONFIRM before launch. This object is the
 * only place these dates live; the order-by note, the hero strip, the FAQ,
 * the per-card restock notes and the reminder signup all read from it.
 *
 *   standardOrderBy  Last day to order in-stock pieces for Christmas with
 *                    standard shipping (5 to 7 business days per
 *                    /policies/shipping). Christmas 2026 is a Friday.
 *   restockWeeks     Restocking pieces ship in about this many weeks
 *                    (matches EstShipDate's fallback). Their cutoff is
 *                    standardOrderBy minus this lead time (Monday, Nov 30).
 */
export const GIFT_SHIP_BY = {
  standardOrderBy: "2026-12-14",
  restockWeeks: 2,
} as const;

export const GIFT_ORDER_BY = GIFT_SHIP_BY.standardOrderBy;
export const GIFT_RESTOCK_WEEKS = GIFT_SHIP_BY.restockWeeks;

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

/** "Mon, Dec 14" for tight spaces (mobile hero strip). */
export function giftOrderByShort(): string {
  return new Date(ORDER_BY_END).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric", timeZone: "America/New_York" });
}
