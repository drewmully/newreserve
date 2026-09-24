// Synthetic subprocess transport: never falls back to the network.
if (process.env.NODE_ENV !== "test") throw new Error("test_fixture_only");
globalThis.fetch = async (url, init) => {
  if (String(url) !== "https://fixture.myshopify.com/admin/api/2026-07/graphql.json" ||
      init?.method !== "POST" || init?.redirect !== "error") throw new Error("unexpected_fixture_target");
  const { query, variables } = JSON.parse(init.body);
  let data;
  if (query.includes("AnalyticsHistoryAccess")) {
    data = { currentAppInstallation: { accessScopes: [{ handle: "read_orders" }, { handle: "read_all_orders" }] } };
  } else if (query.includes("AnalyticsHistory(")) {
    const more = process.env.DISCOVERY_TEST_EXHAUSTED === "true" || variables.cursor === null;
    const id = variables.cursor === null ? "1" : "2";
    data = { orders: { nodes: [{ id: `gid://shopify/Order/${id}`,
      createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-01-02T12:00:00Z" }],
    pageInfo: { hasNextPage: more, endCursor: more ? `cursor-${id}` : null } } };
  } else if (query.includes("AnalyticsOrder(")) {
    data = { order: { id: variables.id, customer: null, cartToken: null,
      createdAt: "2026-01-01T12:00:00Z", updatedAt: "2026-01-02T12:00:00Z",
      lineItems: { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } } } };
  } else throw new Error("unexpected_fixture_query");
  return Response.json({ data }, { headers: { "X-Shopify-API-Version": "2026-07" } });
};
