/**
 * Gift a Season launch config. Values Drew still has to confirm are kept
 * here (env-overridable) so copy never hard-codes them.
 *
 * PLACEHOLDERS PENDING DREW (as of 2026-11-11):
 *   - NEXT_PUBLIC_GIFT_SEASON_ORDER_BY      holiday order-by cutoff, e.g. "December 15"
 *   - NEXT_PUBLIC_GIFT_SEASON_SHIP_WINDOW   first Reserve ship window, e.g. "5 to 7 business days"
 *   - NEXT_PUBLIC_GIFT_SEASON_FREE_SHIP_EXCHANGES  "true" only once free
 *     shipping and free exchanges are confirmed for gift orders (off by default)
 *
 * Unset values render as visible bracketed placeholders so they can't ship
 * unnoticed. NEXT_PUBLIC_ vars are inlined at build time, so a change needs a
 * redeploy.
 */

export const GIFT_SEASON_PLACEHOLDER_ORDER_BY = "[cutoff date TBD]";
export const GIFT_SEASON_PLACEHOLDER_SHIP_WINDOW = "[ship window TBD]";

function clean(v: string | undefined): string {
  return (v ?? "").trim();
}

/** Holiday order-by cutoff shown under the picker and in Step 3. */
export const GIFT_SEASON_ORDER_BY: string =
  clean(process.env.NEXT_PUBLIC_GIFT_SEASON_ORDER_BY) || GIFT_SEASON_PLACEHOLDER_ORDER_BY;

/** How long after sizing the first Reserve ships. */
export const GIFT_SEASON_SHIP_WINDOW: string =
  clean(process.env.NEXT_PUBLIC_GIFT_SEASON_SHIP_WINDOW) || GIFT_SEASON_PLACEHOLDER_SHIP_WINDOW;

/** Free shipping / free exchanges claim for gift orders. Off until confirmed. */
export const GIFT_SEASON_SHOW_FREE_SHIPPING_EXCHANGES: boolean =
  clean(process.env.NEXT_PUBLIC_GIFT_SEASON_FREE_SHIP_EXCHANGES) === "true";

/** The timing line used under the picker and in Step 3. */
export function giftSeasonTimingLine(
  orderBy: string = GIFT_SEASON_ORDER_BY,
  window: string = GIFT_SEASON_SHIP_WINDOW
): string {
  return `Order by ${orderBy} and we email their gift reveal on the date you choose. Their first Reserve ships ${window} after they confirm sizing.`;
}

/** Which launch values are still placeholders (for admin/report use). */
export function pendingGiftSeasonPlaceholders(): string[] {
  const out: string[] = [];
  if (GIFT_SEASON_ORDER_BY === GIFT_SEASON_PLACEHOLDER_ORDER_BY) out.push("NEXT_PUBLIC_GIFT_SEASON_ORDER_BY");
  if (GIFT_SEASON_SHIP_WINDOW === GIFT_SEASON_PLACEHOLDER_SHIP_WINDOW) out.push("NEXT_PUBLIC_GIFT_SEASON_SHIP_WINDOW");
  if (!GIFT_SEASON_SHOW_FREE_SHIPPING_EXCHANGES) out.push("NEXT_PUBLIC_GIFT_SEASON_FREE_SHIP_EXCHANGES");
  return out;
}
