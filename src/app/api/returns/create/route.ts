import { NextRequest, NextResponse } from "next/server";

/* ═══════════════════════════════════════════════════════════════
   POST /api/returns/create
   ═══════════════════════════════════════════════════════════════

   Submits a return request, issues store credit, and optionally
   creates a prepaid return shipping label.

   REQUEST BODY:
   {
     orderId: string,            // Shopify order GID from /api/returns/lookup
     items: Array<{
       lineItemId: string,       // Shopify line item ID
       quantity: number,         // how many to return
       reason: string            // user-selected return reason
     }>,
     customerEmail: string       // for store credit + label delivery
   }

   RESPONSE (200):
   {
     returnId: string,              // Shopify return ID
     creditAmount: number,          // total store credit issued
     labelUrl?: string,             // prepaid label PDF URL (if generated)
     labelTrackingNumber?: string,  // tracking number for return label
     status: "submitted"
   }

   IMPLEMENTATION STEPS FOR LEO:
   ─────────────────────────────────────────────────────────────

   1. CREATE RETURN IN SHOPIFY
      - Use Shopify Admin API:
        POST /admin/api/2024-01/orders/{orderId}/returns.json
      - Map each item to return_line_items:
        {
          line_item_id: item.lineItemId,
          quantity: item.quantity,
          return_reason: mapReasonToShopifyEnum(item.reason),
          // Shopify return reasons: "SIZE_TOO_SMALL", "SIZE_TOO_LARGE",
          // "UNWANTED", "DEFECTIVE", "WRONG_ITEM", "OTHER"
        }
      - Shopify will handle restocking logic automatically

   2. ISSUE STORE CREDIT
      - Option A: Shopify Gift Card (simplest)
        POST /admin/api/2024-01/gift_cards.json
        {
          gift_card: {
            initial_value: creditAmount,
            customer_id: customerId,
            note: "Return credit for order {orderName}",
            template_suffix: "return_credit"
          }
        }
      - Option B: If using Shopify's native store credit (Plus plans):
        Use the customerCreditAccountCreditAdd GraphQL mutation
      - Associate with customerEmail so it shows in their account

   3. CREATE RETURN SHIPPING LABEL (Optional — based on membership tier)
      - Check customer's membership tier (from your DB or Shopify customer tags)
      - For "member" and "black" tiers: generate free prepaid label
      - For "access" tier: generate label, deduct $5.95 from store credit
      - For "free" tier: skip label generation, provide return address only

      ShipStation label creation:
        POST https://ssapi.shipstation.com/shipments/createlabel
        {
          carrierCode: "ups",           // or preferred carrier
          serviceCode: "ups_ground",
          shipFrom: {                   // YOUR warehouse address
            name: "Mully Group",
            street1: "555 Friendly St.",
            city: "Pontiac",
            state: "MI",
            postalCode: "48341",
            country: "US"
          },
          shipTo: {                     // CUSTOMER address (from original order)
            name: customerName,
            street1: customerAddress.street1,
            city: customerAddress.city,
            state: customerAddress.state,
            postalCode: customerAddress.postalCode,
            country: "US"
          },
          weight: { value: estimatedWeight, units: "ounces" },
          // Note: For return labels, swap shipFrom/shipTo so the label
          // goes FROM customer TO your warehouse
        }
      - The response includes labelData (base64 PDF) and trackingNumber

   4. RETURN RESPONSE
      - Combine all data and return to the client
      - The frontend will display the confirmation with credit amount
        and optional label download

   REASON MAPPING HELPER:
   ─────────────────────────────────────────────────────────────
   function mapReasonToShopifyEnum(reason: string): string {
     const map: Record<string, string> = {
       "Wrong size": "SIZE_TOO_SMALL",         // or SIZE_TOO_LARGE
       "Didn't like the fit": "UNWANTED",
       "Not as described": "WRONG_ITEM",
       "Damaged or defective": "DEFECTIVE",
       "Changed my mind": "UNWANTED",
       "Other": "OTHER",
     };
     return map[reason] || "OTHER";
   }

   ENVIRONMENT VARIABLES NEEDED:
   - SHOPIFY_ADMIN_API_TOKEN
   - SHOPIFY_STORE_DOMAIN
   - SHIPSTATION_API_KEY
   - SHIPSTATION_API_SECRET

   ═══════════════════════════════════════════════════════════════ */

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, items, customerEmail } = body;

    if (!orderId || !items?.length || !customerEmail) {
      return NextResponse.json(
        { error: "orderId, items, and customerEmail are required." },
        { status: 400 }
      );
    }

    // ── TODO: Replace this stub with real implementation ──
    //
    // 1. Create return in Shopify
    // const shopifyReturn = await createShopifyReturn(orderId, items);
    //
    // 2. Calculate credit amount from line item prices × quantities
    // const creditAmount = await calculateCreditAmount(orderId, items);
    //
    // 3. Issue store credit (gift card or native credit)
    // const giftCard = await issueStoreCredit(customerEmail, creditAmount, orderId);
    //
    // 4. Optionally create return label via ShipStation
    // const memberTier = await getCustomerTier(customerEmail);
    // let labelUrl, labelTrackingNumber;
    // if (memberTier === "member" || memberTier === "black" || memberTier === "access") {
    //   const label = await createReturnLabel(orderId, customerEmail);
    //   labelUrl = label.labelUrl;
    //   labelTrackingNumber = label.trackingNumber;
    // }
    //
    // return NextResponse.json({
    //   returnId: shopifyReturn.id,
    //   creditAmount,
    //   labelUrl,
    //   labelTrackingNumber,
    //   status: "submitted",
    // });

    return NextResponse.json(
      { error: "Not implemented — wire up Shopify Returns API + ShipStation." },
      { status: 501 }
    );
  } catch {
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
