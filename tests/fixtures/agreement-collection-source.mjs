/** Local synthetic Shopify only; never delegates unknown requests to fetch. */
const gid = (kind, id) => `gid://shopify/${kind}/${id}`;
const bag = amount => ({ shopMoney: { amount, currencyCode: "USD" } });
export function agreementCollectionSource() {
  const created = "2026-01-01T12:00:00Z", updated = "2026-01-03T12:00:00Z";
  const sale = (id, total, tax, discount, quantity, actionType) => ({
    id: gid("ProductSale", id), __typename: "ProductSale", actionType, lineType: "PRODUCT", quantity,
    lineItem: { id: gid("LineItem", "3") }, totalAmount: bag(total), totalTaxAmount: bag(tax),
    totalDiscountAmountBeforeTaxes: bag(discount), totalDiscountAmountAfterTaxes: bag("0"),
  });
  return {
    order: { id: gid("Order", "1"), customer: null, cartToken: null, createdAt: created, updatedAt: updated,
      currencyCode: "USD", edited: true, taxesIncluded: true, test: false, cancelledAt: null,
      originalTotalPriceSet: bag("20"), subtotalPriceSet: bag("999"),
      lineItems: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } },
      transactionsCount: { count: 1, precision: "EXACT" },
      transactions: [{ id: gid("OrderTransaction", "8"), kind: "SALE", status: "SUCCESS", gateway: "fixture",
        test: false, createdAt: created, processedAt: "2026-01-01T12:01:00Z",
        amountSet: bag("20"), parentTransaction: null }] },
    agreements: [
      { id: gid("OrderAgreement", "10"), __typename: "OrderAgreement", reason: "ORDER", happenedAt: created,
        sales: [sale("11", "20", "2", "2", 2, "ORDER")] },
      { id: gid("RefundAgreement", "12"), __typename: "RefundAgreement", reason: "REFUND",
        happenedAt: "2026-01-02T12:00:00Z", sales: [sale("13", "-10", "-1", "-1", -1, "RETURN")] },
    ],
    policy: { decision: { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: true,
      approvalRef: "fixture:commerce" }, lineClasses: { "3": "merchandise" },
      financialApprovalRef: "fixture:finance", saleClock: "paid_at", changeClock: "agreement_happened_at" },
  };
}
export function agreementCollectionTransport(fixture = agreementCollectionSource(), mode = "normal") {
  return async (url, init) => {
    if (String(url) !== "https://fixture.myshopify.com/admin/api/2026-07/graphql.json" ||
        init?.method !== "POST" || init.redirect !== "error" ||
        init.headers["X-Shopify-Access-Token"] !== "synthetic-shopify")
      throw new Error("synthetic_source_scope");
    const { query, variables } = JSON.parse(init.body);
    const response = data => new Response(JSON.stringify({ data }),
      { headers: { "X-Shopify-API-Version": "2026-07" } });
    if (query.includes("AnalyticsHistoryAccess"))
      return response({ currentAppInstallation: { accessScopes: [{ handle: "read_orders" }, { handle: "read_all_orders" }] } });
    if (query.includes("AnalyticsHistory")) return response({ orders: {
      nodes: [{ id: fixture.order.id, createdAt: fixture.order.createdAt,
        updatedAt: fixture.order.updatedAt }], pageInfo: { hasNextPage: false, endCursor: "o1" },
    } });
    if (query.includes("AnalyticsAgreementRevision")) return response({ order: { id: fixture.order.id,
      updatedAt: mode === "revised" ? "2026-01-04T12:00:00Z" : fixture.order.updatedAt } });
    if (query.includes("AnalyticsAgreements")) {
      const index = variables.agreementCursor === null ? 0 : 1;
      const agreement = fixture.agreements[index], cursor = `a${index + 1}`;
      // Optional second sales page exercises the nested pagination budget without
      // duplicating a sale or altering the original financial fixture.
      const firstNested = mode === "nested" && index === 0 && variables.saleCursor === null;
      return response({ order: { id: fixture.order.id, updatedAt: fixture.order.updatedAt,
        agreements: { edges: [{ cursor, node: { ...agreement, sales: {
          nodes: mode === "nested" && index === 0 && !firstNested ? [] : agreement.sales,
          pageInfo: { hasNextPage: firstNested, endCursor: firstNested ? "s1" : null },
        } } }], pageInfo: { hasNextPage: index === 0, endCursor: cursor } },
      } });
    }
    if (query.includes("AnalyticsOrder")) return response({ order: fixture.order });
    throw new Error("synthetic_query_not_supported");
  };
}
