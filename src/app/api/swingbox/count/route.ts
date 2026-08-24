/**
 * GET /api/swingbox/count
 *
 * Returns the founding-member count for the Swing Box pre-sale.
 * Counts distinct paid Shopify orders that contain the Swing Box variant.
 *
 * Floor is 12 (the pre-sale seed). Once real paid orders exceed 12, we return
 * the live number. Cached briefly at the edge so we don't hammer the Admin API
 * on every poll from every visitor.
 */

import { NextResponse } from "next/server";
import { shopifyGraphQL } from "../../_lib/shopifyAdmin";

// Swing Box (Founding 100) — variant that must appear on the order
const VARIANT_ID = "gid://shopify/ProductVariant/48885734637760";
const FLOOR = 12;
const GOAL = 100;

// Cache at the CDN for 30s. Slightly-stale is fine for a hype counter.
export const revalidate = 30;
export const dynamic = "force-dynamic";

type OrdersResp = {
  orders: {
    nodes: Array<{
      id: string;
      displayFinancialStatus: string | null;
      lineItems: {
        nodes: Array<{ variant: { id: string } | null }>;
      };
    }>;
    pageInfo: { hasNextPage: boolean; endCursor: string | null };
  };
};

const ORDERS_QUERY = /* GraphQL */ `
  query FoundingCount($cursor: String) {
    orders(
      first: 100
      after: $cursor
      query: "financial_status:paid OR financial_status:partially_paid OR financial_status:authorized"
      sortKey: CREATED_AT
      reverse: true
    ) {
      pageInfo { hasNextPage endCursor }
      nodes {
        id
        displayFinancialStatus
        lineItems(first: 20) {
          nodes { variant { id } }
        }
      }
    }
  }
`;

async function countPaidOrdersForVariant(): Promise<number> {
  let cursor: string | null = null;
  let count = 0;
  // Hard cap of 5 pages (500 orders) so a runaway query can never stall the page.
  // Once we hit 100, we can stop early — the counter is capped by GOAL anyway.
  for (let i = 0; i < 5; i++) {
    const data: OrdersResp = await shopifyGraphQL<OrdersResp>(ORDERS_QUERY, {
      cursor,
    });
    for (const order of data.orders.nodes) {
      const hasVariant = order.lineItems.nodes.some(
        (li) => li.variant?.id === VARIANT_ID
      );
      if (hasVariant) count += 1;
      if (count >= GOAL) return count;
    }
    if (!data.orders.pageInfo.hasNextPage) break;
    cursor = data.orders.pageInfo.endCursor;
  }
  return count;
}

export async function GET() {
  try {
    const live = await countPaidOrdersForVariant();
    const count = Math.max(FLOOR, live);
    return NextResponse.json(
      {
        count,
        goal: GOAL,
        remaining: Math.max(0, GOAL - count),
        floor: FLOOR,
        live,
        seeded: live < FLOOR,
      },
      {
        status: 200,
        headers: {
          "Cache-Control":
            "public, s-maxage=30, stale-while-revalidate=120",
        },
      }
    );
  } catch (err) {
    // If Shopify fails for any reason, don't break the page — return the floor.
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        count: FLOOR,
        goal: GOAL,
        remaining: GOAL - FLOOR,
        floor: FLOOR,
        live: null,
        seeded: true,
        error: message,
      },
      {
        status: 200,
        headers: { "Cache-Control": "no-store" },
      }
    );
  }
}
