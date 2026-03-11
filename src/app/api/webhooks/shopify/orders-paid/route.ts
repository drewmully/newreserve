/**
 * POST /api/webhooks/shopify/orders-paid
 *
 * Shopify webhook: orders/paid
 * Verifies the HMAC signature, then fires a "purchase" event
 * through the analytics + KPI pipeline.
 *
 * Required env vars:
 *   SHOPIFY_WEBHOOK_SECRET — the secret set on the webhook in Shopify admin
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { randomUUID } from "crypto";
import { dispatchAnalyticsEvent } from "@/app/api/_lib/analytics";
import {
  persistAnalyticsEvent,
  aggregateKpiDaily,
} from "@/app/api/_lib/kpiReporting";
import { adminDb } from "@/lib/firebase-admin";

// ─── HMAC verification ────────────────────────────────────────────────────────

async function verifyShopifyHmac(
  request: NextRequest,
  rawBody: string
): Promise<boolean> {
  const secret = process.env.SHOPIFY_WEBHOOK_SECRET;
  if (!secret) return false;

  const hmacHeader = request.headers.get("x-shopify-hmac-sha256");
  if (!hmacHeader) return false;

  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, "base64"),
      Buffer.from(hmacHeader, "base64")
    );
  } catch {
    return false;
  }
}

async function isDuplicateWebhook(request: NextRequest): Promise<boolean> {
  const webhookId = request.headers.get("x-shopify-webhook-id");
  if (!webhookId) return false;

  const dedupeKey = `shopify-orders-paid:${webhookId}`;
  const ref = adminDb.collection("webhook_receipts").doc(dedupeKey);

  try {
    const existing = await ref.get();
    if (existing.exists) return true;

    await ref.set({
      webhook_id: webhookId,
      topic: request.headers.get("x-shopify-topic") ?? "orders/paid",
      provider: "shopify",
      received_at: Date.now(),
    });
  } catch (err) {
    // Non-fatal: if dedupe storage is unavailable, continue processing.
    console.error("[orders-paid] webhook dedupe check failed:", err);
  }

  return false;
}

// ─── Tier resolution ──────────────────────────────────────────────────────────

type MemberTier = "free" | "access" | "member" | "black";

// Maps Shopify variant IDs to member tiers
const VARIANT_TIER_MAP: Record<number, MemberTier> = {
  47601025482944: "access",  // Reserve Access — $99/year
  47601025122496: "member",  // Reserve Member — $249/quarter
  47601025679552: "member",  // Back 9 Legacy
};

function resolveTierFromLineItems(
  lineItems: { variant_id: number | null }[]
): MemberTier | null {
  for (const item of lineItems) {
    if (item.variant_id && VARIANT_TIER_MAP[item.variant_id]) {
      return VARIANT_TIER_MAP[item.variant_id];
    }
  }
  return null;
}

// ─── Shopify order shape (minimal) ───────────────────────────────────────────

interface ShopifyLineItem {
  id: number;
  title: string;
  quantity: number;
  price: string;
  sku: string | null;
  variant_id: number | null;
}

interface ShopifyOrder {
  id: number;
  order_number: number;
  email: string | null;
  phone: string | null;
  total_price: string;
  currency: string;
  customer?: {
    id: number;
    email: string | null;
  };
  line_items: ShopifyLineItem[];
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  // Read raw body first (needed for HMAC before JSON.parse)
  const rawBody = await request.text();

  // ── Verify webhook signature ──────────────────────────────────────────────
  const isValid = await verifyShopifyHmac(request, rawBody);
  if (!isValid) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const isDuplicate = await isDuplicateWebhook(request);
  if (isDuplicate) {
    return NextResponse.json({ ok: true, duplicate: true });
  }

  // ── Parse order ───────────────────────────────────────────────────────────
  let order: ShopifyOrder;
  try {
    order = JSON.parse(rawBody) as ShopifyOrder;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const email = order.email ?? order.customer?.email ?? undefined;
  const shopifyCustomerId = order.customer?.id?.toString();
  const value = parseFloat(order.total_price);

  const event = {
    event_name: "purchase" as const,
    user_id: shopifyCustomerId,
    email,
    properties: {
      order_id: String(order.order_number),
      shopify_order_id: String(order.id),
      value,
      currency: order.currency,
      items: order.line_items.map((item) => ({
        id: item.sku ?? String(item.id),
        name: item.title,
        quantity: item.quantity,
        price: parseFloat(item.price),
        variant_id: item.variant_id,
      })),
    },
    timestamp: Math.floor(Date.now() / 1000),
  };

  const eventId = randomUUID();

  // ── Update Firestore user tier ────────────────────────────────────────────
  const tierUpdate = email
    ? (async () => {
        const tier = resolveTierFromLineItems(order.line_items);
        if (!tier || tier === "free") return;
        try {
          const snap = await adminDb
            .collection("users")
            .where("email", "==", email)
            .limit(1)
            .get();
          if (!snap.empty) {
            const userDoc = snap.docs[0];
            const updates: Record<string, unknown> = { tier };
            if (shopifyCustomerId && !userDoc.data().shopify_customer_id) {
              updates.shopify_customer_id = shopifyCustomerId;
            }
            await userDoc.ref.update(updates);
          }
        } catch (err) {
          console.error("[orders-paid] tier update failed:", err);
        }
      })()
    : Promise.resolve();

  await Promise.allSettled([
    dispatchAnalyticsEvent(event),
    persistAnalyticsEvent(eventId, event),
    aggregateKpiDaily(event),
    tierUpdate,
  ]);

  // Shopify expects a 200 response quickly or it will retry
  return NextResponse.json({ ok: true });
}
