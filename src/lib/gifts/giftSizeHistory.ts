/**
 * Gift a Season orders must never feed customer size history
 * (sizing-extract -> customer_facts). The customer on a gift order is the
 * buyer, but the line sizes belong to the recipient, so mapping them would
 * overwrite the buyer's profile.
 *
 * An order is a gift season order when any of these is true:
 *   - a line has a RES-GIFT-* SKU (the paid parent order)
 *   - a line has the _gift_season_box property (the $0 season 2..N orders)
 *   - the order is tagged gift-season or gift-season-box*
 */

export type SizingOrderLine = {
  sku?: string | null;
  properties?: Record<string, string | null> | null;
};

export function isGiftSeasonSku(sku: string | null | undefined): boolean {
  return /^RES-GIFT-/i.test((sku ?? "").trim());
}

export function hasGiftSeasonTag(tags: string | null | undefined): boolean {
  return (tags ?? "")
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .some((t) => t === "gift-season" || t.startsWith("gift-season-box") || /^gift-season-\d+$/.test(t));
}

export function isGiftSeasonLine(line: SizingOrderLine): boolean {
  if (isGiftSeasonSku(line.sku)) return true;
  const props = line.properties ?? {};
  return Object.keys(props).some((k) => k.trim().toLowerCase() === "_gift_season_box");
}

export function isGiftSeasonSizingOrder(input: { tags?: string | null; lines: SizingOrderLine[] }): boolean {
  return hasGiftSeasonTag(input.tags) || input.lines.some(isGiftSeasonLine);
}
