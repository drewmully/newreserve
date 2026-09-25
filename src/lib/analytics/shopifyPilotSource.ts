import {
  readShopifyAnalyticsOrder, SHOPIFY_ANALYTICS_API_VERSION, shopifyId, shopifyShop,
  sourceArray, sourceObject, type ShopifyOrderDocument, type SourceObject, type ShopifyProjection,
} from "./shopifySource";

const money = "{ shopMoney { amount currencyCode } }";
const page = "pageInfo { hasNextPage endCursor }";
// Separate fixed queries keep nested query cost bounded. Never accept caller SQL/GraphQL.
export const PILOT_FINANCIAL_QUERY = `query AnalyticsFinancial($id: ID!) {
  order(id: $id) {
    id updatedAt currencyCode
    originalTotalPriceSet ${money} totalTaxSet ${money}
    originalTotalDutiesSet ${money} originalTotalAdditionalFeesSet ${money}
    totalTipReceivedSet ${money}
    shippingLines(first: 100, includeRemovals: true) {
      nodes { id discountedPriceSet ${money} } ${page}
    }
    refunds { id updatedAt }
  }
}`;
export const PILOT_REFUND_QUERY = `query AnalyticsRefund($id: ID!) {
  refund(id: $id) {
    id createdAt updatedAt order { id } totalRefundedSet ${money}
    duties { amountSet ${money} }
    orderAdjustments(first: 1) { nodes { id } ${page} }
    refundLineItems(first: 100) {
      nodes { id quantity lineItem { id } subtotalSet ${money} totalTaxSet ${money} } ${page}
    }
    refundShippingLines(first: 100) {
      nodes { id shippingLine { id } subtotalAmountSet ${money} taxAmountSet ${money} } ${page}
    }
    transactions(first: 100) {
      nodes { id kind status processedAt amountSet ${money} } ${page}
    }
  }
}`;
export type PilotSource = {
  commerce: ShopifyOrderDocument;
  financial: SourceObject;
  refunds: SourceObject[];
};
/** Pilot bounds: <=500 original lines, <=100 shipping/refund components, <=3 refunds.
 * Exceeding a cap is an error, never a "complete" truncated result.
 */
export async function readPilotSource(options: {
  shop: string; accessToken: string; fetcher?: typeof fetch; signal: AbortSignal;
  projection?: ShopifyProjection;
}, orderGid: string): Promise<PilotSource> {
  const shop = shopifyShop(options.shop);
  shopifyId(orderGid, "Order");
  const fetcher = options.fetcher ?? fetch;
  async function query(query: string, id: string, field: string) {
    let response: Response;
    try {
      response = await fetcher(`https://${shop}/admin/api/${SHOPIFY_ANALYTICS_API_VERSION}/graphql.json`, {
        method: "POST", redirect: "error",
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(15000)]),
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": options.accessToken },
        body: JSON.stringify({ query, variables: { id } }),
      });
    } catch { throw new Error("shopify_transport_failed"); }
    if (!response.ok) throw new Error("shopify_http_failed");
    if (response.headers.get("X-Shopify-API-Version") !== SHOPIFY_ANALYTICS_API_VERSION)
      throw new Error("shopify_api_version_mismatch");
    const body = sourceObject(await response.json());
    if (body.errors !== undefined && (!Array.isArray(body.errors) || body.errors.length))
      throw new Error("shopify_graphql_failed");
    const result = sourceObject(sourceObject(body.data)[field]);
    if (result.id !== id) throw new Error("shopify_wrong_source");
    return result;
  }
  const commerce = await readShopifyAnalyticsOrder({ ...options, maxLinePages: 2 }, orderGid);
  const financial = await query(PILOT_FINANCIAL_QUERY, orderGid, "order");
  if (financial.updatedAt !== commerce.order.updatedAt || financial.currencyCode !== commerce.order.currencyCode ||
      JSON.stringify(financial.originalTotalPriceSet) !== JSON.stringify(commerce.order.originalTotalPriceSet))
    throw new Error("shopify_order_changed_during_read");
  const references = sourceArray(financial.refunds).map(sourceObject);
  if (references.length > 3 || new Set(references.map(r => r.id)).size !== references.length)
    throw new Error("pilot_refund_bound");
  const refunds: SourceObject[] = [];
  for (const reference of references) {
    shopifyId(reference.id, "Refund");
    const refund = await query(PILOT_REFUND_QUERY, reference.id as string, "refund");
    if (refund.updatedAt !== reference.updatedAt || sourceObject(refund.order).id !== orderGid)
      throw new Error("shopify_refund_changed_during_read");
    refunds.push(refund);
  }
  if (JSON.stringify(await query(PILOT_FINANCIAL_QUERY, orderGid, "order")) !== JSON.stringify(financial))
    throw new Error("shopify_order_changed_during_read");
  return { commerce, financial, refunds };
}
