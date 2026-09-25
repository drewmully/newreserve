import { partitionSource } from "./partition-collection-source.mjs";
/** Synthetic unedited originals only. No transport ever falls back to fetch. */
export function offerSource(number = 2) {
  const source = partitionSource(number === 1 ? 2 : number);
  const order = source.commerce.order, id = `gid://shopify/Order/${number}`;
  order.id = source.financial.id = id;
  order.transactions[0].id = `gid://shopify/OrderTransaction/${1000 + number}`;
  order.lineItems.nodes[0].id = `gid://shopify/LineItem/${1000 + number}`;
  for (const money of [order.originalTotalPriceSet, order.subtotalPriceSet,
    order.transactions[0].amountSet, source.financial.originalTotalPriceSet]) money.shopMoney.amount = "18";
  order.lineItems.nodes[0].discountAllocations = [{
    allocatedAmountSet: { shopMoney: { amount: "2", currencyCode: "USD" } },
    discountApplication: { __typename: "DiscountCodeApplication", index: 0, targetType: "LINE_ITEM", code: "FIXTURE-OFFER" },
  }];
  order.lineItems.nodes[0].customAttributes = [{ key: "bundle", value: "fixture" }];
  return source;
}
export function offerTransport(transform = source => source) {
  return async (url, init) => {
    const target = new URL(String(url));
    if (target.origin === `https://${"a".repeat(20)}.supabase.co` && target.pathname === "/rest/v1/customers" &&
        init?.method === "GET" && init.redirect === "error")
      return new Response(JSON.stringify([{ id: "7", firebase_uid: null, created_at: "2025-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z", entity: "mully" }]), { headers: { "Content-Range": "0-0/1" } });
    if (target.href !== "https://fixture.myshopify.com/admin/api/2026-07/graphql.json" ||
        init?.method !== "POST" || init.redirect !== "error" ||
        init.headers["X-Shopify-Access-Token"] !== "synthetic-shopify")
      throw new Error("synthetic_offer_source_only");
    const { query, variables } = JSON.parse(init.body);
    const reply = data => new Response(JSON.stringify({ data }), { headers: { "X-Shopify-API-Version": "2026-07" } });
    if (query.includes("AnalyticsHistoryAccess"))
      return reply({ currentAppInstallation: { accessScopes: [{ handle: "read_orders" }, { handle: "read_all_orders" }] } });
    if (query.includes("AnalyticsHistory(")) {
      const second = variables.search.startsWith("created_at:>='2026-01-02");
      const offset = variables.cursor === null ? 0 : Number(variables.cursor), size = second ? 1 : 100;
      const count = Math.min(variables.first, size - offset);
      const nodes = Array.from({ length: count }, (_, i) => transform(offerSource((second ? 101 : 1) + offset + i)).commerce.order);
      return reply({ orders: { nodes: nodes.map(({ id, createdAt, updatedAt }) => ({ id, createdAt, updatedAt })),
        pageInfo: { hasNextPage: offset + count < size, endCursor: String(offset + count) } } });
    }
    const source = transform(offerSource(Number(String(variables.id).split("/").at(-1))));
    if (query.includes("AnalyticsOrder")) return reply({ order: source.commerce.order });
    if (query.includes("AnalyticsFinancial")) return reply({ order: source.financial });
    throw new Error("synthetic_offer_query_only");
  };
}
