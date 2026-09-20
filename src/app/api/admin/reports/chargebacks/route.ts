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

export const runtime = "nodejs";
export const maxDuration = 60;

/**
 * Mint a short-lived Admin API access token via the client_credentials grant
 * against the mully-subscriptions-api app (which has the read_shopify_payments
 * scope). The token is valid for 24h; we mint fresh on every invocation since
 * the report only runs weekly.
 */
async function mintPaymentsAccessToken(): Promise<string> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const clientId = process.env.SHOPIFY_PAYMENTS_CLIENT_ID;
  const clientSecret = process.env.SHOPIFY_PAYMENTS_CLIENT_SECRET;
  if (!domain || !clientId || !clientSecret) {
    throw new Error(
      "Missing SHOPIFY_STORE_DOMAIN / SHOPIFY_PAYMENTS_CLIENT_ID / SHOPIFY_PAYMENTS_CLIENT_SECRET."
    );
  }
  const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "client_credentials",
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Token mint failed ${res.status}: ${body}`);
  }
  const data: { access_token: string; scope?: string; expires_in?: number } =
    await res.json();
  return data.access_token;
}

async function paymentsGraphQL<T>(
  token: string,
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";
  if (!domain) throw new Error("Missing SHOPIFY_STORE_DOMAIN");
  const res = await fetch(
    `https://${domain}/admin/api/${version}/graphql.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Shopify-Access-Token": token,
      },
      body: JSON.stringify({ query, variables }),
    }
  );
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`Shopify HTTP ${res.status}: ${text}`);
  }
  const json: { data?: T; errors?: unknown } = JSON.parse(text);
  if (json.errors) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  if (!json.data) throw new Error("Shopify returned no data");
  return json.data;
}

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

async function fetchAllDisputes(
  token: string,
  startISO: string
): Promise<DisputeNode[]> {
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
    const data: DisputesResp = await paymentsGraphQL<DisputesResp>(token, q, {
      cursor,
    });
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

async function fetchOrderCount(
  token: string,
  startISO: string,
  endISO: string
): Promise<number> {
  const q = `
    query OrdersCount($query: String!) {
      ordersCount(query: $query, limit: 10000) { count }
    }
  `;
  const query = `created_at:>=${startISO} created_at:<=${endISO}`;
  const data: OrdersCountResp = await paymentsGraphQL<OrdersCountResp>(
    token,
    q,
    { query }
  );
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
    const token = await mintPaymentsAccessToken();
    const [disputes, orderCount] = await Promise.all([
      fetchAllDisputes(token, start),
      fetchOrderCount(token, start, end),
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
