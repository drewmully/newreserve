/**
 * Reserve reveal tiers: discount codes and first-quarter price math.
 * Pure and client-safe. The live Shopify reads are in
 * reserveTierPricing.server.ts.
 */

export type ReserveTier = "discovery" | "signature" | "reserve";

/** Shopify discount code applied at checkout per tier ("" = full price). */
export const RESERVE_TIER_CODES: Record<ReserveTier, string> = {
  discovery: "MULLY_DISCOVER",
  signature: "MULLY_SIGNATURE",
  reserve: "",
};

/** First-quarter price in USD per tier, as sent to Meta as AddToCart value. */
export type ReserveTierValues = Record<ReserveTier, number>;

export type TierDiscount =
  | { kind: "amount"; amount: number }
  | { kind: "percent"; percentage: number };

/**
 * First-quarter price per tier from the RES-MEM variant price and each
 * tier's discount. Returns null when the base price or a needed discount is
 * missing, so callers fall back instead of sending a wrong value.
 */
export function computeReserveTierValues(
  basePrice: number | null,
  discounts: Partial<Record<string, TierDiscount | null>>
): ReserveTierValues | null {
  if (basePrice === null || !Number.isFinite(basePrice) || basePrice <= 0) return null;
  const out = {} as ReserveTierValues;
  for (const tier of Object.keys(RESERVE_TIER_CODES) as ReserveTier[]) {
    const code = RESERVE_TIER_CODES[tier];
    if (!code) {
      out[tier] = round2(basePrice);
      continue;
    }
    const d = discounts[code];
    if (!d) return null;
    const value =
      d.kind === "amount" ? basePrice - d.amount : basePrice * (1 - d.percentage);
    out[tier] = round2(Math.max(0, value));
  }
  return out;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
