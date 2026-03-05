import { NextRequest, NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════════════════
   POST /api/returns/lookup
   ═══════════════════════════════════════════════════════════════

   Looks up an order by number + email and returns returnable items.

   REQUEST BODY:
   {
     orderNumber: string,   // e.g. "#1042" or "1042"
     email: string           // customer email for verification
   }

   RESPONSE (200):
   {
     orderId: string,                // Shopify order GID
     orderName: string,              // e.g. "#1042"
     orderDate: string,              // formatted date string
     items: Array<{
       lineItemId: string,           // Shopify line item ID
       sku: string,
       title: string,
       variantTitle: string,         // e.g. "Navy / L"
       quantity: number,             // original ordered qty
       returnableQty: number,        // qty minus already-returned
       price: number,                // unit price
       image: string,                // product image URL from Shopify
       isChildSku: boolean,          // true if expanded from a ShipStation bundle
       parentSku?: string,           // parent SKU if isChildSku === true
       isFinalSale?: boolean,        // true if item was marked final sale
       alreadyReturned?: boolean,    // true if fully returned already
     }>
   }

   IMPLEMENTATION STEPS FOR LEO:
   ─────────────────────────────────────────────────────────────

   1. SHOPIFY ORDER LOOKUP
      - Use Shopify Admin API: GET /admin/api/2024-01/orders.json?name={orderNumber}&email={email}
      - Verify the order exists and email matches the customer
      - Extract line_items with: id, sku, title, variant_title, quantity, price, image
      - Check order.refunds to calculate already-returned quantities per line item

   2. SHIPSTATION SHIPMENT LOOKUP
      - Use ShipStation API: GET /shipments?orderNumber={orderNumber}
      - The shipment's items may include child SKUs for bundles/kits
      - Compare ShipStation items against Shopify line items
      - If a Shopify line item is a "parent" bundle SKU, expand it into
        individual child SKUs from the ShipStation data so users can
        do partial returns on bundle contents

   3. MERGE & RETURN
      - Combine Shopify line items with ShipStation child SKU expansion
      - Calculate returnableQty = original quantity - already returned quantity
      - Flag items as isFinalSale if they have the "final-sale" tag in Shopify
      - Return the merged payload

   ENVIRONMENT VARIABLES NEEDED:
   - SHOPIFY_ADMIN_API_TOKEN — Shopify Admin API access token
   - SHOPIFY_STORE_DOMAIN — e.g. "mully-reserve.myshopify.com"
   - SHIPSTATION_API_KEY — ShipStation API key
   - SHIPSTATION_API_SECRET — ShipStation API secret

   ═══════════════════════════════════════════════════════════════ */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderNumber, email } = body;

    if (!orderNumber || !email) {
      return NextResponse.json(
        { error: "Order number and email are required." },
        { status: 400 }
      );
    }

    // ── TODO: Replace this stub with real Shopify + ShipStation calls ──
    //
    // const shopifyOrder = await fetchShopifyOrder(orderNumber, email);
    // const shipstationShipment = await fetchShipStationShipment(orderNumber);
    // const items = mergeAndExpandItems(shopifyOrder.line_items, shipstationShipment.items);
    //
    // return NextResponse.json({
    //   orderId: shopifyOrder.id,
    //   orderName: shopifyOrder.name,
    //   orderDate: new Date(shopifyOrder.created_at).toLocaleDateString("en-US", {
    //     year: "numeric", month: "long", day: "numeric",
    //   }),
    //   items,
    // });

    return NextResponse.json(
      { error: "Not implemented — wire up Shopify Admin API + ShipStation." },
      { status: 501 }
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
