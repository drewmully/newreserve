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

async function shopifyGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(
    `https://${STORE_DOMAIN}/admin/api/${API_VERSION}/graphql.json`,
    {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ query, variables }),
    }
  );
  if (!res.ok) {
    const text = await res.text();
    console.error("[returns/create] Shopify HTTP error", res.status, text);
    throw new Error(`Shopify GraphQL error ${res.status}: ${text}`);
  }
  const json = (await res.json()) as {
    data: T;
    errors?: { message: string }[];
  };
  if (json.errors?.length) {
    console.error("[returns/create] GraphQL errors:", json.errors);
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

const REASON_MAP: Record<string, string> = {
  "Wrong size": "SIZE_TOO_SMALL",
  "Didn't like the fit": "UNWANTED",
  "Not as described": "WRONG_ITEM",
  "Damaged or defective": "DEFECTIVE",
  "Changed my mind": "UNWANTED",
  Other: "OTHER",
};

// Tier-based shipping cost.
// TODO: replace with real carrier rate once Shopify Shipping or EasyPost is integrated.
function shippingCostByTier(tier: string): number {
  if (tier === "member" || tier === "black") return 0;
  if (tier === "access") return 5.95;
  return 9.95;
}

interface ReturnItem {
  lineItemId: string;
  quantity: number;
  reason: string;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { orderId, items, customerEmail, membershipTier } = body as {
      orderId: string;
      items: ReturnItem[];
      customerEmail: string;
      membershipTier: string;
    };

    if (!orderId || !items?.length || !customerEmail) {
      return NextResponse.json(
        { error: "orderId, items, and customerEmail are required." },
        { status: 400 }
      );
    }

    const orderGid = `gid://shopify/Order/${orderId}`;
    console.log("[returns/create] Starting return request for order", orderGid);

    // 1. Fetch fulfillment line items to map lineItemId → fulfillmentLineItemId + price
    const fulfillmentsData = await shopifyGraphQL<{
      order: {
        fulfillments: Array<{
          fulfillmentLineItems: {
            nodes: Array<{
              id: string;
              quantity: number;
              lineItem: {
                id: string;
                originalUnitPriceSet: { shopMoney: { amount: string } };
              };
            }>;
          };
        }>;
      } | null;
    }>(
      `query GetFulfillmentLineItems($orderId: ID!) {
        order(id: $orderId) {
          fulfillments(first: 10) {
            fulfillmentLineItems(first: 50) {
              nodes {
                id
                quantity
                lineItem {
                  id
                  originalUnitPriceSet { shopMoney { amount } }
                }
              }
            }
          }
        }
      }`,
      { orderId: orderGid }
    );

    if (!fulfillmentsData.order) {
      console.error("[returns/create] Order not found:", orderGid);
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    const lineItemMap: Record<string, { fulfillmentLineItemId: string; unitPrice: number }> = {};
    for (const fulfillment of fulfillmentsData.order.fulfillments) {
      for (const fli of fulfillment.fulfillmentLineItems.nodes) {
        const numericId = fli.lineItem.id.split("/").pop()!;
        lineItemMap[numericId] = {
          fulfillmentLineItemId: fli.id,
          unitPrice: parseFloat(fli.lineItem.originalUnitPriceSet.shopMoney.amount),
        };
      }
    }

    console.log("[returns/create] Fulfillment line item map built:", Object.keys(lineItemMap).length, "items");

    const missing = items.filter((item) => !lineItemMap[item.lineItemId]);
    if (missing.length) {
      console.error("[returns/create] Items not yet fulfilled:", missing.map((i) => i.lineItemId));
      return NextResponse.json(
        { error: "Some items are not yet fulfilled and cannot be returned." },
        { status: 422 }
      );
    }

    // 2. Submit return request via returnRequest mutation.
    //
    //    We use returnRequest (→ REQUESTED state) instead of returnCreate (→ OPEN).
    //    This is Shopify's correct customer-initiated returns flow:
    //      - REQUESTED: awaiting merchant review in Shopify Admin
    //      - On approval: returnApproveRequest with notifyCustomer:true → sends "return approved" email
    //      - Merchant generates label via Shopify Shipping in Admin → sends label email automatically
    //
    //    Note: returnRequest itself does NOT trigger any Shopify email to the customer.
    //    The notification chain starts when the merchant approves from the Admin.
    //    notifyCustomer on returnCreate was deprecated in API version 2024-10.
    const returnRequestData = await shopifyGraphQL<{
      returnRequest: {
        return: {
          id: string;
          status: string;
        } | null;
        userErrors: Array<{ field: string[]; message: string }>;
      };
    }>(
      `mutation ReturnRequest($input: ReturnRequestInput!) {
        returnRequest(input: $input) {
          return {
            id
            status
          }
          userErrors { field message }
        }
      }`,
      {
        input: {
          orderId: orderGid,
          returnLineItems: items.map((item) => ({
            fulfillmentLineItemId: lineItemMap[item.lineItemId].fulfillmentLineItemId,
            quantity: item.quantity,
            returnReason: REASON_MAP[item.reason] ?? "OTHER",
            customerNote: item.reason,
          })),
        },
      }
    );

    const userErrors = returnRequestData.returnRequest.userErrors;
    if (userErrors.length) {
      console.error("[returns/create] returnRequest userErrors:", userErrors);
      return NextResponse.json({ error: userErrors[0].message }, { status: 422 });
    }

    const shopifyReturn = returnRequestData.returnRequest.return!;
    console.log("[returns/create] Return created successfully:", shopifyReturn.id, "status:", shopifyReturn.status);

    // 3. Calculate credit amounts
    const itemsCreditAmount = items.reduce((sum, item) => {
      return sum + lineItemMap[item.lineItemId].unitPrice * item.quantity;
    }, 0);

    const shippingCost = shippingCostByTier(membershipTier ?? "free");
    const estimatedCreditAmount = Math.max(0, itemsCreditAmount - shippingCost);

    console.log("[returns/create] Credit breakdown — items:", itemsCreditAmount, "shipping:", shippingCost, "net:", estimatedCreditAmount);

    return NextResponse.json({
      returnId: shopifyReturn.id,
      returnStatus: shopifyReturn.status,
      itemsCreditAmount,
      shippingCost,
      estimatedCreditAmount,
      status: "submitted",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[returns/create] Unhandled error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
