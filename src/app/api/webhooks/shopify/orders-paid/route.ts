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

  await Promise.allSettled([
    dispatchAnalyticsEvent(event),
    persistAnalyticsEvent(eventId, event),
    aggregateKpiDaily(event),
  ]);

  // Shopify expects a 200 response quickly or it will retry
  return NextResponse.json({ ok: true });
}
