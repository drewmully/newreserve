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
  if (!res.ok)
    throw new Error(`Shopify GraphQL error ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    data: T;
    errors?: { message: string }[];
  };
  if (json.errors?.length)
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors)}`);
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

    const orderGid = `gid://shopify/Order/${orderId}`;

    // 1. Fetch fulfillment line items to map lineItemId → fulfillmentLineItemId
    //    We also grab the unit price here to calculate credit server-side.
    const fulfillmentsData = await shopifyGraphQL<{
      order: {
        fulfillments: Array<{
          fulfillmentLineItems: {
            nodes: Array<{
              id: string;
              quantity: number;
              lineItem: {
                id: string;
                originalUnitPriceSet: {
                  shopMoney: { amount: string };
                };
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
                  originalUnitPriceSet {
                    shopMoney { amount }
                  }
                }
              }
            }
          }
        }
      }`,
      { orderId: orderGid }
    );

    if (!fulfillmentsData.order) {
      return NextResponse.json({ error: "Order not found." }, { status: 404 });
    }

    // Build map: numeric lineItemId → { fulfillmentLineItemGid, unitPrice }
    const lineItemMap: Record<
      string,
      { fulfillmentLineItemId: string; unitPrice: number }
    > = {};

    for (const fulfillment of fulfillmentsData.order.fulfillments) {
      for (const fli of fulfillment.fulfillmentLineItems.nodes) {
        const numericId = fli.lineItem.id.split("/").pop()!;
        lineItemMap[numericId] = {
          fulfillmentLineItemId: fli.id,
          unitPrice: parseFloat(
            fli.lineItem.originalUnitPriceSet.shopMoney.amount
          ),
        };
      }
    }

    // Validate all selected items have a fulfillment line item
    const missing = items.filter((item) => !lineItemMap[item.lineItemId]);
    if (missing.length) {
      return NextResponse.json(
        {
          error:
            "Some items are not yet fulfilled and cannot be returned. Please contact support.",
        },
        { status: 422 }
      );
    }

    // 2. Create return via GraphQL returnRequest mutation (REQUESTED state)
    //    returnRequest → REQUESTED state (customer-initiated, requires merchant approval)
    //    returnCreate  → OPEN state (merchant-initiated, already approved)
    const returnData = await shopifyGraphQL<{
      returnRequest: {
        return: { id: string; status: string } | null;
        userErrors: Array<{ field: string; message: string }>;
      };
    }>(
      `mutation returnRequest($input: ReturnRequestInput!) {
        returnRequest(input: $input) {
          return { id status }
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
          })),
        },
      }
    );

    const userErrors = returnData.returnRequest.userErrors;
    if (userErrors.length) {
      console.error("[returns/create] returnRequest errors:", userErrors);
      return NextResponse.json(
        { error: userErrors[0].message },
        { status: 422 }
      );
    }

    // 3. Calculate estimated credit from server-side prices
    const estimatedCreditAmount = items.reduce((sum, item) => {
      return sum + lineItemMap[item.lineItemId].unitPrice * item.quantity;
    }, 0);

    const returnId = returnData.returnRequest.return!.id;

    return NextResponse.json({
      returnId,
      estimatedCreditAmount,
      status: "submitted",
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[returns/create]", message);
    return NextResponse.json(
      { error: message },
      { status: 500 }
    );
  }
}
