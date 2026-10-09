/**
 * GET /cart/recover?c=<cart token>&k=<cart key>&p=<product handle>
 *
 * Cart-recovery email link. Checks the Storefront cart is still live and
 * non-empty, then redirects to its clean checkout URL; otherwise to the
 * product page or shop-all. With LIFECYCLE_RECOVERY_LINKS_ENABLED unset it
 * never reads the cart and always uses the safe fallback. No PII logged.
 */
import { NextResponse } from "next/server";
import { cartIdFromParams, RECOVERY_CART_QUERY, recoveryLinksEnabled, recoveryRedirect, type CartState } from "@/lib/lifecycle/recovery";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function readCart(id: string): Promise<CartState | null> {
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN, token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  if (!domain || !token) return null;
  try {
    const res = await fetch(`https://${domain}/api/2024-10/graphql.json`, {
      method: "POST", cache: "no-store", signal: AbortSignal.timeout(4000),
      headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": token },
      body: JSON.stringify({ query: RECOVERY_CART_QUERY, variables: { id } }),
    });
    if (!res.ok) return null;
    const body = await res.json() as { data?: { cart?: { checkoutUrl?: string; totalQuantity?: number } | null }; errors?: unknown };
    if (body.errors) return null;
    const cart = body.data?.cart;
    if (cart === null) return { exists: false, totalQuantity: 0, checkoutUrl: null };
    if (!cart) return null;
    return { exists: true, totalQuantity: Number(cart.totalQuantity) || 0, checkoutUrl: cart.checkoutUrl ?? null };
  } catch { return null; }
}

export async function GET(req: Request) {
  const params = new URL(req.url).searchParams;
  const id = recoveryLinksEnabled() ? cartIdFromParams(params) : null;
  const target = recoveryRedirect(params, id ? await readCart(id) : null);
  const res = NextResponse.redirect(target, 302);
  res.headers.set("Cache-Control", "no-store");
  res.headers.set("Referrer-Policy", "no-referrer");
  res.headers.set("X-Robots-Tag", "noindex");
  return res;
}
