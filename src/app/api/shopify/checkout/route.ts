/**
 * POST /api/shopify/checkout
 *
 * Builds a Shopify checkout URL for the current user.
 * - Free tier: returns the Storefront cart's checkoutUrl as-is.
 * - Paid tier: creates a Shopify Draft Order with a 15% order-level discount.
 *   The Shopify REST API requires `amount` (the calculated dollar value of the
 *   discount) — without it the field is silently ignored.
 *
 * Body: {
 *   checkoutUrl: string,
 *   cartItems: Array<{
 *     variantId: string,   // "gid://shopify/ProductVariant/123"
 *     quantity: number,
 *     retailPrice: number, // full price — used to compute discount amount
 *   }>
 * }
 * Auth: Authorization: Bearer <Firebase ID token>
 *
 * Response: { checkoutUrl: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { MEMBER_DISCOUNT_RATE } from "@/lib/shopify";

async function verifyFirebaseBearer(request: NextRequest): Promise<string> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  return decoded.uid;
}

interface CartItemInput {
  variantId: string;
  quantity: number;
  retailPrice: number;
}

async function createMemberDraftOrder(
  cartItems: CartItemInput[],
  email?: string
): Promise<string> {
  const token =
    process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;
  if (!token) throw new Error("Missing Shopify Admin credentials");

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) throw new Error("Missing SHOPIFY_STORE_DOMAIN");

  const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";

  const lineItems = cartItems.map((item) => {
    const numericId = item.variantId.startsWith("gid://")
      ? parseInt(item.variantId.split("/").pop() ?? "0", 10)
      : parseInt(item.variantId, 10);

    return { variant_id: numericId, quantity: item.quantity };
  });

  // Shopify requires `amount` = the calculated dollar value of the discount.
  // Without it the applied_discount is silently ignored.
  const totalDiscount = cartItems.reduce(
    (sum, item) => sum + item.retailPrice * item.quantity * MEMBER_DISCOUNT_RATE,
    0
  );

  const body: Record<string, unknown> = {
    line_items: lineItems,
    applied_discount: {
      title: "Member Price",
      description: "Reserve member benefit — 15% off",
      value_type: "percentage",
      value: (MEMBER_DISCOUNT_RATE * 100).toFixed(1),
      amount: totalDiscount.toFixed(2),
    },
  };
  if (email) body.email = email;

  const res = await fetch(
    `https://${domain}/admin/api/${apiVersion}/draft_orders.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ draft_order: body }),
    }
  );

  if (!res.ok) {
    throw new Error(
      `Draft order creation failed ${res.status}: ${await res.text()}`
    );
  }

  const json = (await res.json()) as { draft_order: { invoice_url: string } };
  return json.draft_order.invoice_url;
}

export async function POST(request: NextRequest) {
  let uid: string;
  try {
    uid = await verifyFirebaseBearer(request);
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let checkoutUrl: string;
  let cartItems: CartItemInput[] = [];
  try {
    const body = await request.json() as {
      checkoutUrl?: string;
      cartItems?: CartItemInput[];
    };
    if (!body.checkoutUrl) throw new Error("Missing checkoutUrl");
    checkoutUrl = body.checkoutUrl;
    cartItems = body.cartItems ?? [];
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  try {
    const userDoc = await adminDb.collection("users").doc(uid).get();
    const data = userDoc.data();
    const tier = data?.tier as string | undefined;
    const email = data?.email as string | undefined;

    if (tier && tier !== "free" && cartItems.length > 0) {
      const invoiceUrl = await createMemberDraftOrder(cartItems, email);
      return NextResponse.json({ checkoutUrl: invoiceUrl });
    }
  } catch (err) {
    console.error("[checkout] draft order failed, falling back:", err);
  }

  return NextResponse.json({ checkoutUrl });
}
