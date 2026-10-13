/**
 * First-order free shipping. One persistent Shopify code (FIRSTORDERSHIP):
 * free shipping on one-time orders of $100+, once per customer, combinable
 * with BOGO15 and the popup codes. The bag applies it for non-members so it
 * behaves like an automatic discount; Shopify enforces the limits.
 */
export const FIRST_ORDER_SHIPPING_CODE = "FIRSTORDERSHIP";
export const FIRST_ORDER_SHIPPING_MIN = 100;
const REVEALED = "mully_first_ship_revealed_v1";

/** Matches the current code and the retired per-shopper FIRSTSHIP- codes. */
export const isFirstOrderShippingCode = (code: string) => {
  const c = code.toUpperCase();
  return c === FIRST_ORDER_SHIPPING_CODE || c.startsWith("FIRSTSHIP-");
};

export function firstOrderShippingRevealed(): boolean {
  try { return localStorage.getItem(REVEALED) === "1"; } catch { return true; }
}
export function markFirstOrderShippingRevealed() {
  try { localStorage.setItem(REVEALED, "1"); } catch { /* optional storage */ }
}
