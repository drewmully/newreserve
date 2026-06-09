/**
 * POST /api/shopify/checkout
 *
 * Builds a Shopify checkout URL for the current user.
 * - Free tier: returns the Storefront cart's checkoutUrl as-is.
 * - Paid tier: creates (or updates) a Shopify Draft Order with a 15% order-level
 *   discount. The Shopify REST API requires `amount` (the calculated dollar value
 *   of the discount) — without it the field is silently ignored.
 *
 * IDEMPOTENCY: every paid member has at most one OPEN draft order at a time.
 * The draft_id is cached in users/{uid}.shopify_open_draft. On subsequent calls
 * we look up the cached draft; if it still exists and is OPEN, we PUT the new
 * line items onto it. Otherwise we create a new draft and cache the new id.
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

function getShopifyConfig() {
  const token =
    process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;
  if (!token) throw new Error("Missing Shopify Admin credentials");

  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  if (!domain) throw new Error("Missing SHOPIFY_STORE_DOMAIN");

  const apiVersion = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";
  return { token, domain, apiVersion };
}

function buildDraftOrderBody(
  cartItems: CartItemInput[],
  uid: string,
  email?: string
): Record<string, unknown> {
  const lineItems = cartItems
    .filter((item) => item.quantity >= 1)
    .map((item) => {
      const numericId = item.variantId.startsWith("gid://")
        ? parseInt(item.variantId.split("/").pop() ?? "0", 10)
        : parseInt(item.variantId, 10);
      return { variant_id: numericId, quantity: item.quantity };
    });

  if (lineItems.length === 0) {
    throw new Error("No valid line items to create draft order");
  }

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
    tags: `reserve_member,uid:${uid}`,
    note: `Reserve member draft for uid:${uid}`,
  };
  if (email) body.email = email;
  return body;
}

interface DraftOrderResponse {
  draft_order: {
    id: number;
    invoice_url: string;
    status: string;
  };
}

async function fetchDraft(
  draftId: number
): Promise<DraftOrderResponse["draft_order"] | null> {
  const { token, domain, apiVersion } = getShopifyConfig();
  const res = await fetch(
    `https://${domain}/admin/api/${apiVersion}/draft_orders/${draftId}.json`,
    { headers: { "X-Shopify-Access-Token": token } }
  );
  if (res.status === 404) return null;
  if (!res.ok) {
    console.error("[checkout] fetchDraft failed", res.status, await res.text());
    return null;
  }
  const json = (await res.json()) as DraftOrderResponse;
  return json.draft_order;
}

async function updateDraft(
  draftId: number,
  body: Record<string, unknown>
): Promise<string | null> {
  const { token, domain, apiVersion } = getShopifyConfig();
  const res = await fetch(
    `https://${domain}/admin/api/${apiVersion}/draft_orders/${draftId}.json`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ draft_order: body }),
    }
  );
  if (!res.ok) {
    console.error("[checkout] updateDraft failed", res.status, await res.text());
    return null;
  }
  const json = (await res.json()) as DraftOrderResponse;
  return json.draft_order.invoice_url;
}

async function createDraft(
  body: Record<string, unknown>
): Promise<{ id: number; invoiceUrl: string } | null> {
  const { token, domain, apiVersion } = getShopifyConfig();
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
  const json = (await res.json()) as DraftOrderResponse;
  return { id: json.draft_order.id, invoiceUrl: json.draft_order.invoice_url };
}

async function getOrCreateMemberDraftOrder(
  uid: string,
  cartItems: CartItemInput[],
  email: string | undefined
): Promise<string> {
  const body = buildDraftOrderBody(cartItems, uid, email);
  const userRef = adminDb.collection("users").doc(uid);
  const userDoc = await userRef.get();
  const data = userDoc.data() ?? {};

  const cachedDraftId =
    typeof data.shopify_open_draft_id === "number"
      ? data.shopify_open_draft_id
      : null;

  // Try to reuse the cached draft if it's still OPEN
  if (cachedDraftId) {
    const existing = await fetchDraft(cachedDraftId);
    if (existing && existing.status === "open") {
      const invoiceUrl = await updateDraft(cachedDraftId, body);
      if (invoiceUrl) {
        console.log(
          "[checkout] reused draft",
          cachedDraftId,
          "for uid",
          uid
        );
        return invoiceUrl;
      }
    }
    // Cached draft is gone or no longer open — clear the cache
    if (!existing || existing.status !== "open") {
      await userRef.set({ shopify_open_draft_id: null }, { merge: true });
    }
  }

  // No reusable draft — create a new one
  const created = await createDraft(body);
  if (!created) throw new Error("Draft order creation returned null");
  await userRef.set(
    { shopify_open_draft_id: created.id },
    { merge: true }
  );
  console.log("[checkout] created new draft", created.id, "for uid", uid);
  return created.invoiceUrl;
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
    const body = (await request.json()) as {
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
    const userRef = adminDb.collection("users").doc(uid);
    const userDoc = await userRef.get();
    const data = userDoc.data() ?? {};

    let tier = data.tier as string | undefined;
    const email = data.email as string | undefined;

    // Fallback: infer paid tier from cached subscription state if tier field missing
    if (!tier || tier === "free") {
      const subs = (data.subscriptions as Record<string, unknown> | undefined) ?? {};
      const subActive =
        subs.mullybox_active === true ||
        String(subs.status ?? "").toLowerCase() === "active";
      if (subActive) {
        tier = "access";
        await userRef.set({ tier: "access" }, { merge: true });
        console.log("[checkout] tier inferred from subscription and cached");
      }
    }

    console.log("[checkout] uid:", uid, "tier:", tier, "cartItems:", cartItems.length);

    if (tier && tier !== "free" && cartItems.length > 0) {
      const invoiceUrl = await getOrCreateMemberDraftOrder(uid, cartItems, email);
      console.log("[checkout] draft order invoice_url:", invoiceUrl);
      return NextResponse.json({ checkoutUrl: invoiceUrl });
    }

    console.log("[checkout] skipping draft order — tier:", tier, "items:", cartItems.length);
  } catch (err) {
    console.error("[checkout] draft order failed:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }

  return NextResponse.json({ checkoutUrl });
}
