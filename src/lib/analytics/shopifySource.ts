import { collectPages } from "./primitives";

export const SHOPIFY_ANALYTICS_API_VERSION = "2026-07";
export type SourceObject = Record<string, unknown>;
export function sourceObject(value: unknown): SourceObject {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("shopify_schema_drift");
  return value as SourceObject;
}
export function sourceString(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("shopify_schema_drift");
  return value;
}
export function sourceArray(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("shopify_schema_drift");
  return value;
}
export function shopifyId(value: unknown, resource: string): string {
  const match = sourceString(value).match(new RegExp(`^gid://shopify/${resource}/([1-9]\\d*)$`));
  if (!match) throw new Error("invalid_shopify_id");
  return match[1]; // Never pass 64-bit Shopify identifiers through Number().
}
export function shopifyShop(value: string): string {
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(value)) throw new Error("invalid_shopify_shop");
  return value;
}

/** A fixed read-only query. No caller-supplied GraphQL and no environment fallback. */
export const SHOPIFY_ANALYTICS_ORDER_QUERY = `
query AnalyticsOrder($id: ID!, $cursor: String) {
  order(id: $id) {
    id createdAt updatedAt currencyCode edited taxesIncluded test cancelledAt
    shippingAddress { countryCodeV2 provinceCode }
    originalTotalPriceSet { shopMoney { amount currencyCode } }
    subtotalPriceSet { shopMoney { amount currencyCode } }
    transactionsCount { count precision }
    transactions(first: 250) {
      id kind status gateway test createdAt processedAt
      amountSet { shopMoney { amount currencyCode } }
      parentTransaction { id gateway }
    }
    lineItems(first: 250, after: $cursor) {
      nodes {
        id sku quantity isGiftCard product { id }
        originalUnitPriceSet { shopMoney { amount currencyCode } }
        originalTotalSet { shopMoney { amount currencyCode } }
        discountAllocations { allocatedAmountSet { shopMoney { amount currencyCode } } }
      }
      pageInfo { hasNextPage endCursor }
    }
  }
}`;

export type ShopifyOrderDocument = {
  shop: string;
  apiVersion: typeof SHOPIFY_ANALYTICS_API_VERSION;
  order: SourceObject;
};
type ReaderOptions = { shop: string; accessToken: string; fetcher?: typeof fetch; maxLinePages?: number; signal?: AbortSignal };

/** One order at a time, bounded nested pagination, no writes or automatic retries.
 * The caller must persist this source document before invoking the mapper.
 */
export async function readShopifyAnalyticsOrder(options: ReaderOptions, orderGid: string): Promise<ShopifyOrderDocument> {
  const shop = shopifyShop(options.shop);
  shopifyId(orderGid, "Order");
  if (!options.accessToken.trim()) throw new Error("missing_shopify_access_token");
  const fetcher = options.fetcher ?? fetch;
  async function request(cursor: string | null): Promise<SourceObject> {
    let response: Response;
    try {
      response = await fetcher(`https://${shop}/admin/api/${SHOPIFY_ANALYTICS_API_VERSION}/graphql.json`, {
        method: "POST", redirect: "error", signal: AbortSignal.any([AbortSignal.timeout(15000), ...(options.signal ? [options.signal] : [])]),
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": options.accessToken },
        body: JSON.stringify({ query: SHOPIFY_ANALYTICS_ORDER_QUERY, variables: { id: orderGid, cursor } }),
      });
    } catch { throw new Error("shopify_transport_failed"); }
    if (!response.ok) throw new Error("shopify_http_failed");
    if (response.headers.get("X-Shopify-API-Version") !== SHOPIFY_ANALYTICS_API_VERSION)
      throw new Error("shopify_api_version_mismatch");
    let body: SourceObject;
    try { body = sourceObject(await response.json()); }
    catch { throw new Error("shopify_invalid_response"); }
    // Reject partial GraphQL data as well as errors-only responses; never log raw errors.
    if (body.errors !== undefined && (!Array.isArray(body.errors) || body.errors.length))
      throw new Error("shopify_graphql_failed");
    const order = sourceObject(sourceObject(body.data).order);
    if (order.id !== orderGid) throw new Error("shopify_wrong_order");
    return order;
  }
  let initial: SourceObject | undefined;
  let revision = "";
  const metadata = (order: SourceObject) => JSON.stringify(
    Object.fromEntries(Object.entries(order).filter(([name]) => name !== "lineItems")),
  );
  const lines = await collectPages(async cursor => {
    const order = await request(cursor);
    if (!initial) { initial = order; revision = metadata(order); }
    else if (metadata(order) !== revision) throw new Error("shopify_order_changed_during_read");
    const connection = sourceObject(order.lineItems);
    const page = sourceObject(connection.pageInfo);
    if (typeof page.hasNextPage !== "boolean" || (page.endCursor !== null && typeof page.endCursor !== "string"))
      throw new Error("shopify_schema_drift");
    return { rows: sourceArray(connection.nodes), hasNextPage: page.hasNextPage, endCursor: page.endCursor as string | null };
  }, options.maxLinePages ?? 20);
  // Catch changes during the final page, including a one-page read.
  if (metadata(await request(null)) !== revision) throw new Error("shopify_order_changed_during_read");
  const ids = lines.map(line => shopifyId(sourceObject(line).id, "LineItem"));
  if (new Set(ids).size !== ids.length) throw new Error("shopify_duplicate_line");
  return { shop, apiVersion: SHOPIFY_ANALYTICS_API_VERSION, order: {
    ...initial, lineItems: { nodes: lines, pageInfo: { hasNextPage: false, endCursor: null } },
  } };
}
