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

    // Strip leading # so both "#1042" and "1042" work
    const normalized = String(orderNumber).replace(/^#/, "");

    const url = `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/orders.json?name=%23${normalized}&status=any`;
    const res = await fetch(url, { headers: adminHeaders() });

    if (!res.ok) {
      throw new Error(`Shopify Admin error ${res.status}: ${await res.text()}`);
    }

    const json = (await res.json()) as { orders: ShopifyOrder[] };

    // Verify email matches the order's customer
    const order = json.orders.find(
      (o) => o.email?.toLowerCase() === email.toLowerCase().trim()
    );

    if (!order) {
      return NextResponse.json(
        { error: "Order not found. Please check your order number and email." },
        { status: 404 }
      );
    }

    // Build a map of already-returned quantities from refunds
    const returnedQtyById: Record<string, number> = {};
    for (const refund of order.refunds ?? []) {
      for (const rli of refund.refund_line_items ?? []) {
        const id = String(rli.line_item_id);
        returnedQtyById[id] = (returnedQtyById[id] ?? 0) + rli.quantity;
      }
    }

    const items = order.line_items.map((li) => {
      const alreadyReturnedQty = returnedQtyById[String(li.id)] ?? 0;
      const returnableQty = li.quantity - alreadyReturnedQty;

      // Check for final-sale tag via line item properties
      const isFinalSale = (li.properties ?? []).some(
        (p) =>
          p.name === "_final_sale" ||
          (p.name === "Final Sale" && p.value !== "false")
      );

      return {
        lineItemId: String(li.id),
        sku: li.sku ?? "",
        title: li.title,
        variantTitle: li.variant_title ?? "",
        quantity: li.quantity,
        returnableQty,
        price: parseFloat(li.price),
        image: li.image?.src ?? "",
        isChildSku: false,
        isFinalSale,
        alreadyReturned: returnableQty <= 0,
      };
    });

    return NextResponse.json({
      orderId: String(order.id),
      orderName: order.name,
      orderDate: new Date(order.created_at).toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      }),
      items,
    });
  } catch (err) {
    console.error("[returns/lookup]", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/* ── Shopify REST types (minimal) ── */

interface ShopifyLineItemProperty {
  name: string;
  value: string;
}

interface ShopifyLineItem {
  id: number;
  sku: string | null;
  title: string;
  variant_title: string | null;
  quantity: number;
  price: string;
  image: { src: string } | null;
  properties: ShopifyLineItemProperty[];
}

interface ShopifyRefundLineItem {
  line_item_id: number;
  quantity: number;
}

interface ShopifyRefund {
  refund_line_items: ShopifyRefundLineItem[];
}

interface ShopifyOrder {
  id: number;
  name: string;
  email: string;
  created_at: string;
  line_items: ShopifyLineItem[];
  refunds: ShopifyRefund[];
}
