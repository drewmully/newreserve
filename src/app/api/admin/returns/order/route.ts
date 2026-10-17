/**
 * GET /api/admin/returns/order?name=#63048
 * Fulfilled line items for an order, used to build an exchange from a
 * customer request that has no Shopify return yet.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { adminGraphql, ORDER_LOOKUP_QUERY } from "@/lib/returnsAdmin";

export const dynamic = "force-dynamic";

type Fli = { id: string; quantity: number; lineItem: { id: string; title: string; variantTitle: string | null; sku: string | null; product: { id: string } | null; originalUnitPriceSet: { shopMoney: { amount: string } } } };

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;
  const raw = req.nextUrl.searchParams.get("name")?.trim().replace(/^#/, "");
  if (!raw) return NextResponse.json({ error: "name required" }, { status: 400 });

  try {
    const data = await adminGraphql<{
      orders: { nodes: { id: string; name: string; customer: { displayName: string; email: string | null } | null; fulfillments: { fulfillmentLineItems: { nodes: Fli[] } }[] }[] };
    }>(ORDER_LOOKUP_QUERY, { q: `name:#${raw}` });
    const o = data.orders.nodes[0];
    if (!o) return NextResponse.json({ error: "Order not found" }, { status: 404 });
    return NextResponse.json({
      order: {
        id: o.id,
        name: o.name,
        customerName: o.customer?.displayName ?? null,
        customerEmail: o.customer?.email ?? null,
        lines: o.fulfillments.flatMap((f) =>
          f.fulfillmentLineItems.nodes.map((n) => ({
            fulfillmentLineItemId: n.id,
            quantity: n.quantity,
            title: n.lineItem.title,
            variantTitle: n.lineItem.variantTitle,
            sku: n.lineItem.sku,
            productId: n.lineItem.product?.id ?? null,
            unitPrice: Number(n.lineItem.originalUnitPriceSet.shopMoney.amount),
          })),
        ),
      },
    });
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 500 });
  }
}
