/**
 * First-order free shipping: a same-day surprise revealed when a new shopper
 * heads to checkout. The server issues a single-use Shopify code that
 * expires at midnight ET, so "today" is real. Client side we only remember
 * the issued code so the bag can re-apply it.
 */
export const FIRST_ORDER_SHIPPING_PREFIX = "FIRSTSHIP-";
const STORAGE = "mully_first_ship_v1";
export type FirstOrderShipping = { code: string; endsAt: string };

export const isFirstOrderShippingCode = (code: string) => code.toUpperCase().startsWith(FIRST_ORDER_SHIPPING_PREFIX);

export function readFirstOrderShipping(): FirstOrderShipping | null {
  try {
    const raw = localStorage.getItem(STORAGE);
    if (!raw) return null;
    const v = JSON.parse(raw) as FirstOrderShipping;
    if (!v?.code || !isFirstOrderShippingCode(v.code) || !(Date.parse(v.endsAt) > Date.now())) return null;
    return v;
  } catch { return null; }
}

/** Ask the server for today's code. Resolves null when not eligible or slow. */
export async function claimFirstOrderShipping(cartId: string, email?: string | null): Promise<FirstOrderShipping | null> {
  const existing = readFirstOrderShipping();
  if (existing) return existing;
  try {
    const res = await fetch("/api/shop/first-order-shipping", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ cartId, email: email || undefined }),
      signal: AbortSignal.timeout(3500),
    });
    if (!res.ok) return null;
    const body = await res.json() as { eligible?: boolean; code?: string; endsAt?: string };
    if (!body.eligible || !body.code || !body.endsAt) return null;
    const v = { code: body.code, endsAt: body.endsAt };
    try { localStorage.setItem(STORAGE, JSON.stringify(v)); } catch { /* optional storage */ }
    return v;
  } catch { return null; }
}
