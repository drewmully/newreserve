/**
 * Gift a Season launch config. Launch values are env-overridable so copy never
 * hard-codes them.
 *
 *   - NEXT_PUBLIC_GIFT_SEASON_ORDER_BY      holiday order-by cutoff as an ISO
 *     date, e.g. "2026-12-15". It is the last day (US Eastern) to order for the
 *     first Reserve to arrive by Christmas. After that day the timing copy
 *     switches to "the reveal still arrives on time".
 *   - NEXT_PUBLIC_GIFT_SEASON_SHIP_WINDOW   first Reserve ship window, e.g. "1-2 business days"
 *   - NEXT_PUBLIC_GIFT_SEASON_FREE_SHIP_EXCHANGES  "true" only once free
 *     shipping and free exchanges are confirmed for gift orders (off by default)
 *
 * Unset values render as visible bracketed placeholders so they can't ship
 * unnoticed. NEXT_PUBLIC_ vars are inlined at build time, so a change needs a
 * redeploy. The before/after switch itself is evaluated at view time.
 */

export const GIFT_SEASON_PLACEHOLDER_ORDER_BY = "[cutoff date TBD]";
export const GIFT_SEASON_PLACEHOLDER_SHIP_WINDOW = "[ship window TBD]";

function clean(v: string | undefined): string {
  return (v ?? "").trim();
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/** Raw cutoff value from env ("2026-12-15"), or "" when unset. */
export const GIFT_SEASON_ORDER_BY_RAW: string = clean(process.env.NEXT_PUBLIC_GIFT_SEASON_ORDER_BY);

/** Parse "YYYY-MM-DD". Returns null for anything else. */
export function parseGiftSeasonCutoff(raw: string): { y: number; m: number; d: number } | null {
  const hit = /^(\d{4})-(\d{2})-(\d{2})$/.exec(raw.trim());
  if (!hit) return null;
  const y = Number(hit[1]), m = Number(hit[2]), d = Number(hit[3]);
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** "December 15" for display, the raw text if it is not an ISO date, or the placeholder. */
export function formatGiftSeasonCutoff(raw: string = GIFT_SEASON_ORDER_BY_RAW): string {
  const p = parseGiftSeasonCutoff(raw);
  if (p) return `${MONTHS[p.m - 1]} ${p.d}`;
  return raw || GIFT_SEASON_PLACEHOLDER_ORDER_BY;
}

/**
 * The moment ordering is "after the cutoff": midnight US Eastern at the end of
 * the cutoff day (05:00 UTC the next day, EST). Null when unset or not ISO.
 */
export function giftSeasonCutoffEndsAt(raw: string = GIFT_SEASON_ORDER_BY_RAW): number | null {
  const p = parseGiftSeasonCutoff(raw);
  if (!p) return null;
  return Date.UTC(p.y, p.m - 1, p.d + 1, 5, 0, 0);
}

/** True once the cutoff day has fully passed in US Eastern. */
export function isPastGiftSeasonCutoff(now: number = Date.now(), raw: string = GIFT_SEASON_ORDER_BY_RAW): boolean {
  const ends = giftSeasonCutoffEndsAt(raw);
  return ends !== null && now >= ends;
}

/** Holiday order-by cutoff for display, e.g. "December 15". */
export const GIFT_SEASON_ORDER_BY: string = formatGiftSeasonCutoff();

/** How long after sizing the first Reserve ships. */
export const GIFT_SEASON_SHIP_WINDOW: string =
  clean(process.env.NEXT_PUBLIC_GIFT_SEASON_SHIP_WINDOW) || GIFT_SEASON_PLACEHOLDER_SHIP_WINDOW;

/** Free shipping / free exchanges claim for gift orders. Off until confirmed. */
export const GIFT_SEASON_SHOW_FREE_SHIPPING_EXCHANGES: boolean =
  clean(process.env.NEXT_PUBLIC_GIFT_SEASON_FREE_SHIP_EXCHANGES) === "true";

/**
 * The timing line used under the picker and in the How it works steps.
 * Before the cutoff: order by the date for a Christmas arrival.
 * After it: the digital reveal still lands on the chosen date, and the first
 * Reserve ships the usual window after sizing.
 */
export function giftSeasonTimingLine(
  opts: { now?: number; raw?: string; window?: string; selfDeliver?: boolean } = {}
): string {
  const raw = opts.raw ?? GIFT_SEASON_ORDER_BY_RAW;
  const window = opts.window ?? GIFT_SEASON_SHIP_WINDOW;
  const now = opts.now ?? Date.now();
  if (isPastGiftSeasonCutoff(now, raw)) {
    const reveal = opts.selfDeliver
      ? "Your printable gift card still arrives on time by email."
      : "Their gift reveal still arrives on time by email.";
    return `${reveal} Their first Reserve ships ${window} after they confirm sizing.`;
  }
  return `Order by ${formatGiftSeasonCutoff(raw)} for their first Reserve to arrive by Christmas.`;
}

/** Which launch values are still placeholders (for admin/report use). */
export function pendingGiftSeasonPlaceholders(): string[] {
  const out: string[] = [];
  if (!parseGiftSeasonCutoff(GIFT_SEASON_ORDER_BY_RAW)) out.push("NEXT_PUBLIC_GIFT_SEASON_ORDER_BY");
  if (GIFT_SEASON_SHIP_WINDOW === GIFT_SEASON_PLACEHOLDER_SHIP_WINDOW) out.push("NEXT_PUBLIC_GIFT_SEASON_SHIP_WINDOW");
  if (!GIFT_SEASON_SHOW_FREE_SHIPPING_EXCHANGES) out.push("NEXT_PUBLIC_GIFT_SEASON_FREE_SHIP_EXCHANGES");
  return out;
}
