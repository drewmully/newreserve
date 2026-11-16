import { NextRequest, NextResponse } from "next/server";
import { checkRateLimit } from "@/lib/rateLimit";
import { loadOrderEligibility } from "@/lib/returns/eligibility";
import { outsideWindowMessage, returnShippingCostByTier } from "@/lib/returns/policy";
import { returnTokenError, signReturnToken } from "@/lib/returns/token";
import { resolveReturnTier } from "@/lib/returns/tier";

const STORE_DOMAIN = process.env.SHOPIFY_STORE_DOMAIN!;
const API_VERSION = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";

function adminHeaders() {
  const token =
    process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;
  if (!token) throw new Error("Missing Shopify Admin credentials.");
  return {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token,
  };
}

function getClientIp(request: NextRequest): string {
  return (
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    "unknown"
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderNumber, email } = body as {
      orderNumber: string;
      email: string;
    };

    if (!orderNumber || !email) {
      return NextResponse.json(
        { error: "Order number and email are required." },
        { status: 400 }
      );
    }

    const normalizedEmail = String(email).trim().toLowerCase();
    const normalized = String(orderNumber).replace(/^#/, "").trim();

    if (
      !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
      !/^\d{1,12}$/.test(normalized)
    ) {
      return NextResponse.json(
        { error: "Order number and email are required." },
        { status: 400 }
      );
    }

    const clientIp = getClientIp(request);
    const ipLimit = checkRateLimit("returns_lookup_ip", clientIp, {
      maxHits: 10,
      windowMs: 10 * 60 * 1000,
    });
    if (!ipLimit.allowed) {
      return NextResponse.json(
        { error: "Too many return lookups. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(ipLimit.retryAfterSeconds),
          },
        }
      );
    }

    const targetLimit = checkRateLimit(
      "returns_lookup_target",
      `${normalizedEmail}:${normalized}`,
      {
        maxHits: 5,
        windowMs: 30 * 60 * 1000,
      }
    );
    if (!targetLimit.allowed) {
      return NextResponse.json(
        { error: "Too many return lookups. Please try again later." },
        {
          status: 429,
          headers: {
            "Retry-After": String(targetLimit.retryAfterSeconds),
          },
        }
      );
    }

    const url = `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/orders.json?name=%23${normalized}&status=any&fields=id,name,email`;
    const res = await fetch(url, { headers: adminHeaders() });

    if (!res.ok) {
      throw new Error(`Shopify Admin error ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as { orders: ShopifyOrderSummary[] };

    // Verify email matches the order's customer
    const match = json.orders.find(
      (o) => o.email?.toLowerCase() === normalizedEmail
    );

    if (!match) {
      return NextResponse.json(
        { error: "Order not found. Please check your order number and email." },
        { status: 404 }
      );
    }

    // One GraphQL call: fulfillments + delivery dates, returns, images.
    const order = await loadOrderEligibility(String(match.id));
    if (!order || order.email !== normalizedEmail) {
      return NextResponse.json(
        { error: "Order not found. Please check your order number and email." },
        { status: 404 }
      );
    }

    // Return window: shared policy (days from delivery, per order type).
    if (order.allFulfillmentsOutsideWindow) {
      return NextResponse.json(
        { error: outsideWindowMessage(order.rules), code: "outside_window" },
        { status: 422 }
      );
    }

    const returnToken = signReturnToken({
      orderId: order.orderId,
      orderName: order.orderName,
      email: order.email,
      orderType: order.orderType,
    });
    if (!returnToken) {
      console.error("[returns/lookup] RETURNS_TOKEN_SECRET / CRON_SECRET not configured");
      const { status, body } = returnTokenError("unconfigured");
      return NextResponse.json(body, { status });
    }

    const tier = await resolveReturnTier(request, order.email);

    const items = order.lines.map((line) => ({
      lineItemId: line.lineItemId,
      sku: line.sku,
      title: line.title,
      variantTitle: line.variantTitle,
      quantity: line.quantity,
      returnableQty: line.returnableQty,
      price: line.unitPrice,
      image: line.image,
      isChildSku: false,
      isFinalSale: line.isFinalSale,
      alreadyReturned: line.ineligibleReason === "already_returned",
      ineligibleReason: line.ineligibleReason,
      returnDeadline: line.returnDeadline,
    }));

    return NextResponse.json({
      orderId: order.orderId,
      orderName: order.orderName,
      orderDate: new Date(order.createdAt).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      items,
      returnToken,
      orderType: order.orderType,
      policy: {
        windowDays: order.rules.windowDays,
        resolution: order.rules.resolution,
        exchangeAllowed: order.rules.exchangeAllowed,
      },
      returnShippingCost: returnShippingCostByTier(tier),
    });
  } catch (err) {
    console.error("[returns/lookup]", err);
    return NextResponse.json(
      { error: "We couldn't look up your order right now. Please try again, or email info@mymully.com." },
      { status: 500 }
    );
  }
}

/* ── Shopify REST types (minimal) ── */

interface ShopifyOrderSummary {
  id: number;
  name: string;
  email: string | null;
}
