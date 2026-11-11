/**
 * Seasonal gift-guide link on Journal and archive posts (SEO task s10).
 * Shows from Nov 15 through Dec 24, inclusive, on the America/New_York
 * calendar, every year. Evaluated on the server so the link is in the HTML.
 */

export const GIFT_SEASON_LINK = {
  label: "Shopping for a golfer? See our golf gifts for men, picked by price →",
  href: "/shop/gifts",
} as const;

/** Month (1-12) and day of `now` on the America/New_York calendar. */
function easternMonthDay(now: Date): { month: number; day: number } {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", month: "numeric", day: "numeric" }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { month: get("month"), day: get("day") };
}

/** True from Nov 15 00:00 through Dec 24 23:59:59 Eastern. */
export function isGiftSeason(now: Date = new Date()): boolean {
  const { month, day } = easternMonthDay(now);
  return (month === 11 && day >= 15) || (month === 12 && day <= 24);
}
