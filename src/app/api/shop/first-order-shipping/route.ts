/**
 * POST /api/shop/first-order-shipping { cartId, email? }
 *
 * Issues a single-use free-shipping code for a first-time shopper, valid
 * until midnight ET today. Eligibility: the Storefront cart exists and has
 * items, and no known email on the cart (or supplied by the site) belongs
 * to a Shopify customer with a prior order. Returning shoppers who are not
 * identified until they type an email at checkout can still use the code;
 * it is one use and expires tonight, so exposure is one shipping charge.
 *
 * Fails closed: any Shopify error means no offer is shown.
 * Kill switch: FIRST_ORDER_SHIPPING_ENABLED=false.
 */
import { NextRequest, NextResponse } from "next/server";
import { randomBytes } from "node:crypto";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";
import { FIRST_ORDER_SHIPPING_PREFIX } from "@/lib/firstOrderShipping";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const COOKIE = "mully_first_ship";
const TZ = "America/New_York";
const no = (status = 200) => NextResponse.json({ eligible: false }, { status, headers: { "Cache-Control": "private, no-store" } });

/** Midnight at the end of today in the store's time zone, as an ISO instant. */
function endOfTodayET(now = new Date()): Date {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
    timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(now).map(p => [p.type, p.value]));
  const asUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  const offsetMs = asUtc - Math.floor(now.getTime() / 1000) * 1000; // ET wall clock minus UTC
  const midnightWall = Date.UTC(+parts.year, +parts.month - 1, +parts.day + 1, 0, 0, 0);
  return new Date(midnightWall - offsetMs - 1000); // 11:59:59pm ET
}

async function readCart(id: string): Promise<{ quantity: number; email: string | null } | null> {
  const domain = process.env.NEXT_PUBLIC_SHOPIFY_STORE_DOMAIN, token = process.env.NEXT_PUBLIC_SHOPIFY_STOREFRONT_TOKEN;
  if (!domain || !token) return null;
  const res = await fetch(`https://${domain}/api/2024-10/graphql.json`, {
    method: "POST", cache: "no-store", signal: AbortSignal.timeout(4000),
    headers: { "Content-Type": "application/json", "X-Shopify-Storefront-Access-Token": token },
    body: JSON.stringify({ query: `query FirstShipCart($id: ID!) { cart(id: $id) { totalQuantity buyerIdentity { email } } }`, variables: { id } }),
  });
  if (!res.ok) return null;
  const body = await res.json() as { data?: { cart?: { totalQuantity: number; buyerIdentity?: { email?: string | null } } | null } };
  const cart = body.data?.cart;
  return cart ? { quantity: Number(cart.totalQuantity) || 0, email: cart.buyerIdentity?.email ?? null } : null;
}

async function hasPriorOrder(email: string): Promise<boolean> {
  const data = await shopifyGraphQL<{ customers: { nodes: { email: string | null; numberOfOrders: string | number }[] } }>(
    `query FirstShipCustomer($q: String!) { customers(first: 5, query: $q) { nodes { email numberOfOrders } } }`,
    { q: `email:${JSON.stringify(email)}` },
  );
  return data.customers.nodes.some(c => c.email?.toLowerCase() === email && Number(c.numberOfOrders) > 0);
}

const CREATE = `mutation FirstShip($input: DiscountCodeFreeShippingInput!) {
  discountCodeFreeShippingCreate(freeShippingCodeDiscount: $input) { codeDiscountNode { id } userErrors { field message } }
}`;

async function createCode(code: string, endsAt: Date) {
  const base = {
    title: `First order free shipping · ${code}`, code,
    startsAt: new Date().toISOString(), endsAt: endsAt.toISOString(),
    usageLimit: 1, appliesOncePerCustomer: true,
    appliesOnOneTimePurchase: true, appliesOnSubscription: false,
    destination: { all: true },
    combinesWith: { productDiscounts: true, orderDiscounts: true, shippingDiscounts: false },
  };
  type R = { discountCodeFreeShippingCreate: { codeDiscountNode: { id: string } | null; userErrors: { message: string }[] } };
  // Newer Admin versions use `context`; older ones use `customerSelection`.
  let data: R;
  try { data = await shopifyGraphQL<R>(CREATE, { input: { ...base, context: { all: "ALL" } } }); }
  catch { data = await shopifyGraphQL<R>(CREATE, { input: { ...base, customerSelection: { all: true } } }); }
  const out = data.discountCodeFreeShippingCreate;
  if (!out.codeDiscountNode || out.userErrors.length) throw new Error(out.userErrors.map(e => e.message).join("; ") || "create failed");
}

export async function POST(request: NextRequest) {
  if (process.env.FIRST_ORDER_SHIPPING_ENABLED === "false") return no();
  let body: { cartId?: unknown; email?: unknown };
  try { body = await request.json(); } catch { return no(400); }
  const cartId = typeof body.cartId === "string" && /^gid:\/\/shopify\/Cart\/[\w-]+(\?key=[\w-]+)?$/.test(body.cartId) ? body.cartId : null;
  if (!cartId) return no(400);

  // Same browser, same day: hand back the code already issued.
  const prior = request.cookies.get(COOKIE)?.value?.split("|");
  if (prior?.length === 2 && prior[0].startsWith(FIRST_ORDER_SHIPPING_PREFIX) && Date.parse(prior[1]) > Date.now()) {
    return NextResponse.json({ eligible: true, code: prior[0], endsAt: prior[1] }, { headers: { "Cache-Control": "private, no-store" } });
  }

  try {
    const cart = await readCart(cartId);
    if (!cart || cart.quantity < 1) return no();
    const emails = [cart.email, typeof body.email === "string" ? body.email : null]
      .map(e => e?.trim().toLowerCase()).filter((e): e is string => !!e && e.includes("@"));
    for (const email of new Set(emails)) if (await hasPriorOrder(email)) return no();

    const endsAt = endOfTodayET();
    const code = FIRST_ORDER_SHIPPING_PREFIX + randomBytes(5).toString("base64url").replace(/[^A-Za-z0-9]/g, "").slice(0, 6).toUpperCase();
    await createCode(code, endsAt);
    const res = NextResponse.json({ eligible: true, code, endsAt: endsAt.toISOString() }, { headers: { "Cache-Control": "private, no-store" } });
    res.cookies.set(COOKIE, `${code}|${endsAt.toISOString()}`, { httpOnly: true, secure: true, sameSite: "lax", path: "/", expires: endsAt });
    return res;
  } catch (err) {
    console.error("[first-order-shipping] not issued:", err instanceof Error ? err.message : "unknown");
    return no(503);
  }
}
