import { NextRequest, NextResponse } from "next/server";

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


const REASON_MAP: Record<string, string> = {
  "Wrong size": "SIZE_TOO_SMALL",
  "Didn't like the fit": "UNWANTED",
  "Not as described": "WRONG_ITEM",
  "Damaged or defective": "DEFECTIVE",
  "Changed my mind": "UNWANTED",
  Other: "OTHER",
};

interface ReturnItem {
  lineItemId: string;
  quantity: number;
  reason: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, items, customerEmail } = body as {
      orderId: string;
      items: ReturnItem[];
      customerEmail: string;
    };

    if (!orderId || !items?.length || !customerEmail) {
      return NextResponse.json(
        { error: "orderId, items, and customerEmail are required." },
        { status: 400 }
      );
    }

    // 1. Create return in Shopify Admin REST
    const returnRes = await fetch(
      `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/orders/${orderId}/returns.json`,
      {
        method: "POST",
        headers: adminHeaders(),
        body: JSON.stringify({
          return: {
            return_line_items: items.map((item) => ({
              line_item_id: item.lineItemId,
              quantity: item.quantity,
              return_reason: REASON_MAP[item.reason] ?? "OTHER",
            })),
            notify_customer: true,
          },
        }),
      }
    );

    if (!returnRes.ok) {
      const errText = await returnRes.text();
      console.error("[returns/create] Shopify return error:", errText);
      throw new Error(`Failed to create return: ${returnRes.status}`);
    }

    const returnJson = (await returnRes.json()) as {
      return: { id: number };
    };
    const returnId = String(returnJson.return.id);

    // 2. Fetch order line item prices to calculate credit amount
    const orderRes = await fetch(
      `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/orders/${orderId}.json?fields=line_items`,
      { headers: adminHeaders() }
    );
    if (!orderRes.ok)
      throw new Error(`Failed to fetch order: ${orderRes.status}`);

    const orderJson = (await orderRes.json()) as {
      order: { line_items: Array<{ id: number; price: string }> };
    };

    const priceById: Record<string, number> = {};
    for (const li of orderJson.order.line_items) {
      priceById[String(li.id)] = parseFloat(li.price);
    }

    const creditAmount = items.reduce((sum, item) => {
      return sum + (priceById[item.lineItemId] ?? 0) * item.quantity;
    }, 0);

    // Store credit is NOT issued here.
    // It will be issued manually by staff via Shopify admin once the
    // physical items are received and inspected.
    return NextResponse.json({
      returnId,
      estimatedCreditAmount: creditAmount,
      status: "submitted",
    });
  } catch (err) {
    console.error("[returns/create]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
