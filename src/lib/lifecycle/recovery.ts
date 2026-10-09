/**
 * Cart recovery links. Pure helpers, no I/O.
 *
 * Shopify's cart checkoutUrl (checkout.mymully.com/cart/c/<token>?key=<key>)
 * restores the shopper's exact cart, but it carries per-session tracking
 * parameters (_s, _y) and dies when the cart expires or is completed. Emails
 * therefore link to a first-party URL that checks the cart first:
 *
 *   https://www.mymully.com/cart/recover?c=<token>&k=<key>&p=<product-handle>
 *
 * Live, non-empty cart -> its clean checkout URL. Otherwise the product page,
 * otherwise shop-all. Never a dead link, never a guessed cart.
 */
import { SITE_URL } from "@/lib/klaviyo/lifecycleConfig";

export const SHOP_ALL_URL = `${SITE_URL}/shop/collection/shop-all`;
const CHECKOUT_HOSTS = new Set(["checkout.mymully.com", "www.mymully.com", "mullybox-store.myshopify.com"]);
const TOKEN_RE = /^[A-Za-z0-9_-]{10,120}$/;
const KEY_RE = /^[A-Za-z0-9_-]{10,400}$/;
const HANDLE_RE = /^[a-z0-9][a-z0-9-]{0,150}$/;

export function recoveryLinksEnabled(env: Record<string, string | undefined> = process.env) {
  return env.LIFECYCLE_RECOVERY_LINKS_ENABLED === "true";
}

/** Extract { token, key } from a Shopify cart checkoutUrl, or null. */
export function parseCartCheckoutUrl(raw: unknown): { token: string; key: string } | null {
  if (typeof raw !== "string") return null;
  try {
    const u = new URL(raw);
    if (u.protocol !== "https:" || !CHECKOUT_HOSTS.has(u.hostname)) return null;
    const m = u.pathname.match(/^\/cart\/c\/([^/]+)$/);
    const key = u.searchParams.get("key") ?? "";
    if (!m || !TOKEN_RE.test(m[1]) || !KEY_RE.test(key)) return null;
    return { token: m[1], key };
  } catch { return null; }
}

/** First-party recovery URL for an Added to Cart event, or undefined. */
export function buildRecoveryUrl(checkoutUrl: unknown, handle: string | undefined): string | undefined {
  const cart = parseCartCheckoutUrl(checkoutUrl);
  if (!cart) return undefined;
  const u = new URL(`${SITE_URL}/cart/recover`);
  u.searchParams.set("c", cart.token);
  u.searchParams.set("k", cart.key);
  if (handle && HANDLE_RE.test(handle)) u.searchParams.set("p", handle);
  return u.toString();
}

export interface CartState { exists: boolean; totalQuantity: number; checkoutUrl: string | null }

/** Decide where a recovery click goes. Unknown or broken input falls back safely. */
export function recoveryRedirect(params: URLSearchParams, cart: CartState | null): string {
  const handle = params.get("p") ?? "";
  const fallback = HANDLE_RE.test(handle) ? `${SITE_URL}/shop/${handle}` : SHOP_ALL_URL;
  if (!cart || !cart.exists || cart.totalQuantity <= 0) return fallback;
  const parsed = parseCartCheckoutUrl(cart.checkoutUrl);
  if (!parsed) return fallback;
  const clean = new URL(cart.checkoutUrl!);
  // Drop per-session tracking so a forwarded link never reuses someone's session.
  for (const k of [...clean.searchParams.keys()]) if (k !== "key") clean.searchParams.delete(k);
  return clean.toString();
}

/** Storefront cart id from the link parameters, or null when malformed. */
export function cartIdFromParams(params: URLSearchParams): string | null {
  const token = params.get("c") ?? "", key = params.get("k") ?? "";
  return TOKEN_RE.test(token) && KEY_RE.test(key) ? `gid://shopify/Cart/${token}?key=${key}` : null;
}

export const RECOVERY_CART_QUERY = `query MullyRecoveryCart($id: ID!) { cart(id: $id) { id checkoutUrl totalQuantity } }`;
