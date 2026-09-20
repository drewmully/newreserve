/**
 * GET /api/admin/reports/chargebacks
 *
 * Returns Shopify Payments dispute data for the chargeback rate report.
 * Uses SHOPIFY_ADMIN_TOKEN with read_shopify_payments scope.
 *
 * Auth: Bearer CRON_SECRET (or vercel-cron user-agent).
 *
 * Query params:
 *   days   — lookback window in days for both disputes and orders (default 90)
 *
 * Response shape:
 *   {
 *     window: { days, start, end },
 *     disputes: [
 *       { id, initiatedAt, finalizedOn, status, type, amount, currency,
 *         reason, networkReasonCode, order: { name, createdAt, total, currency } | null }
 *     ],
 *     order_count_90d: number,
 *     chargeback_count_90d: number,
 *     rate_90d_pct: number
 *   }
 */

import { NextRequest, NextResponse } from "next/server";
import { shopifyGraphQL } from "@/app/api/_lib/shopifyAdmin";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return (req.headers.get("user-agent") || "").includes("vercel-cron");
}

type MoneyV2 = { amount: string; currencyCode: string };

interface DisputeNode {
  id: string;
  legacyResourceId: string;
  initiatedAt: string;
  finalizedOn: string | null;
  status: string;
  type: string;
  amount: MoneyV2;
  reasonDetails: { reason: string; networkReasonCode: string | null };
  order: {
    name: string;
    createdAt: string;
    totalPriceSet: { shopMoney: MoneyV2 };
  } | null;
}

interface DisputesResp {
  shopifyPaymentsAccount: {
    disputes: {
      edges: { node: DisputeNode }[];
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  } | null;
}

interface OrdersCountResp {
  ordersCount: { count: number };
}

async function fetchAllDisputes(startISO: string): Promise<DisputeNode[]> {
  const q = `
    query Disputes($cursor: String) {
      shopifyPaymentsAccount {
        disputes(first: 100, reverse: true, after: $cursor) {
          edges {
            node {
              id
              legacyResourceId
              initiatedAt
              finalizedOn
              status
              type
              amount { amount currencyCode }
              reasonDetails { reason networkReasonCode }
              order {
                name
                createdAt
                totalPriceSet { shopMoney { amount currencyCode } }
              }
            }
          }
          pageInfo { hasNextPage endCursor }
        }
      }
    }
  `;
  const results: DisputeNode[] = [];
  let cursor: string | null = null;
  const startMs = Date.parse(startISO);
  while (true) {
    const data: DisputesResp = await shopifyGraphQL<DisputesResp>(q, { cursor });
    const acct = data.shopifyPaymentsAccount;
    if (!acct) break;
    for (const e of acct.disputes.edges) {
      results.push(e.node);
    }
    if (!acct.disputes.pageInfo.hasNextPage) break;
    // Stop paginating once we're older than the window (list is reverse-chronological)
    const last = acct.disputes.edges.at(-1)?.node;
    if (last && Date.parse(last.initiatedAt) < startMs) break;
    cursor = acct.disputes.pageInfo.endCursor;
    if (!cursor) break;
  }
  return results.filter((d) => Date.parse(d.initiatedAt) >= startMs);
}

async function fetchOrderCount(startISO: string, endISO: string): Promise<number> {
  const q = `
    query OrdersCount($query: String!) {
      ordersCount(query: $query, limit: 10000) { count }
    }
  `;
  const query = `created_at:>=${startISO} created_at:<=${endISO}`;
  const data: OrdersCountResp = await shopifyGraphQL<OrdersCountResp>(q, { query });
  return data.ordersCount?.count ?? 0;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const days = Math.max(1, Math.min(365, parseInt(url.searchParams.get("days") ?? "90", 10)));

  const now = new Date();
  const end = now.toISOString();
  const start = new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

  try {
    const [disputes, orderCount] = await Promise.all([
      fetchAllDisputes(start),
      fetchOrderCount(start, end),
    ]);

    const shaped = disputes.map((d) => ({
      id: d.id,
      legacy_id: d.legacyResourceId,
      initiated_at: d.initiatedAt,
      finalized_on: d.finalizedOn,
      status: d.status,
      type: d.type,
      amount: parseFloat(d.amount.amount),
      currency: d.amount.currencyCode,
      reason: d.reasonDetails.reason,
      network_reason_code: d.reasonDetails.networkReasonCode,
      order: d.order
        ? {
            name: d.order.name,
            created_at: d.order.createdAt,
            total: parseFloat(d.order.totalPriceSet.shopMoney.amount),
            currency: d.order.totalPriceSet.shopMoney.currencyCode,
          }
        : null,
    }));

    const rate =
      orderCount > 0 ? (shaped.length / orderCount) * 100 : 0;

    return NextResponse.json({
      window: { days, start, end },
      disputes: shaped,
      order_count: orderCount,
      chargeback_count: shaped.length,
      rate_pct: Number(rate.toFixed(4)),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: "shopify_error", detail: message },
      { status: 502 }
    );
  }
}
