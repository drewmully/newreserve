import { agreementCollectionSource, agreementCollectionTransport } from "./agreement-collection-source.mjs";
const money = amount => ({ shopMoney: { amount, currencyCode: "USD" } });
const connection = nodes => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
export function partitionSource(number) {
  const original = agreementCollectionSource(), id = `gid://shopify/Order/${number}`;
  const createdAt = number > 100 ? "2026-01-02T12:00:00Z" : "2026-01-01T12:00:00Z";
  const order = number === 1 ? original.order : {
    id, customer: null, createdAt, updatedAt: "2026-01-03T12:00:00Z", currencyCode: "USD",
    edited: false, taxesIncluded: false, test: false, cancelledAt: null, shippingAddress: null,
    originalTotalPriceSet: money("20"), subtotalPriceSet: money("20"), cartToken: null,
    transactionsCount: { count: 1, precision: "EXACT" }, transactions: [{
      id: `gid://shopify/OrderTransaction/${1000 + number}`, kind: "SALE", status: "SUCCESS", gateway: "fixture",
      test: false, createdAt, processedAt: createdAt.replace("12:00:", "12:01:"),
      amountSet: money("20"), parentTransaction: null,
    }], lineItems: connection([{ id: `gid://shopify/LineItem/${1000 + number}`, sku: "SKU", quantity: 2,
      isGiftCard: false, product: { id: "gid://shopify/Product/3" }, originalUnitPriceSet: money("10"),
      originalTotalSet: money("20"), discountAllocations: [], customAttributes: [] }]),
  };
  order.customer = { id: "gid://shopify/Customer/7" };
  return { commerce: { shop: "fixture.myshopify.com", apiVersion: "2026-07", order },
    financial: { id, updatedAt: order.updatedAt, currencyCode: "USD", originalTotalPriceSet: money("20"),
      totalTaxSet: money(number === 1 ? "2" : "0"), totalTipReceivedSet: money("0"),
      originalTotalDutiesSet: null, originalTotalAdditionalFeesSet: null, shippingLines: connection([]), refunds: [] },
    refunds: [] };
}
export function partitionTransport() {
  const original = agreementCollectionSource(); original.order = partitionSource(1).commerce.order;
  const agreements = agreementCollectionTransport(original);
  return async (url, init) => {
    const target = new URL(String(url));
    if (target.origin === `https://${"a".repeat(20)}.supabase.co` && target.pathname === "/rest/v1/customers" &&
        init?.method === "GET" && init.redirect === "error")
      return new Response(JSON.stringify([{ id: "7", firebase_uid: null, created_at: "2025-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z", entity: "mully" }]), { headers: { "Content-Range": "0-0/1" } });
    if (target.href !== "https://fixture.myshopify.com/admin/api/2026-07/graphql.json" ||
        init?.method !== "POST" || init.redirect !== "error" ||
        init.headers["X-Shopify-Access-Token"] !== "synthetic-shopify")
      throw new Error("synthetic_partition_source_only");
    const { query, variables } = JSON.parse(init.body);
    const reply = data => new Response(JSON.stringify({ data }), { headers: { "X-Shopify-API-Version": "2026-07" } });
    if (query.includes("AnalyticsHistoryAccess"))
      return reply({ currentAppInstallation: { accessScopes: [{ handle: "read_orders" }, { handle: "read_all_orders" }] } });
    if (query.includes("AnalyticsHistory(")) {
      const second = variables.search.startsWith("created_at:>='2026-01-02");
      const offset = variables.cursor === null ? 0 : Number(variables.cursor), size = second ? 1 : 100;
      const count = Math.min(variables.first, size - offset);
      const nodes = Array.from({ length: count }, (_, i) => partitionSource((second ? 101 : 1) + offset + i).commerce.order);
      return reply({ orders: { nodes: nodes.map(({ id, createdAt, updatedAt }) => ({ id, createdAt, updatedAt })),
        pageInfo: { hasNextPage: offset + count < size, endCursor: String(offset + count) } } });
    }
    if (query.includes("AnalyticsAgreements") || query.includes("AnalyticsAgreementRevision")) return agreements(url, init);
    const source = partitionSource(Number(String(variables.id).split("/").at(-1)));
    if (query.includes("AnalyticsOrder")) return reply({ order: source.commerce.order });
    if (query.includes("AnalyticsFinancial")) return reply({ order: source.financial });
    throw new Error("synthetic_partition_query_only");
  };
}
