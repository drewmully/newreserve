const { test } = require("node:test");
const assert = require("node:assert/strict");
const { diagnose, EXPIRES_AT, IDENTITY_QUERY, SAMPLE_QUERY } = require("./diagnose-shopify-subscriptions.cjs");
const NOW = Date.parse("2026-10-08T22:00:00Z");
const env = {
  VERCEL_ENV: "production",
  SHOPIFY_STORE_DOMAIN: "mullybox-store.myshopify.com",
  SHOPIFY_SUBSCRIPTIONS_APP_CLIENT_ID: "bd512503091105b19699875ae4c39eb3",
  SHOPIFY_SUBSCRIPTIONS_TOKEN: "fixture-only-not-a-real-token",
};
const APP_ID = "gid://shopify/App/123";
const never = () => { throw Error("must not fetch"); };
function identity(scopes = ["read_own_subscription_contracts"]) {
  return { data: {
    shop: { myshopifyDomain: env.SHOPIFY_STORE_DOMAIN },
    currentAppInstallation: {
      app: { id: APP_ID, apiKey: env.SHOPIFY_SUBSCRIPTIONS_APP_CLIENT_ID, title: "mully-subscriptions-api" },
      accessScopes: scopes.map(handle => ({ handle })),
    },
  } };
}
function sample(nodes = [], hasNextPage = false) {
  return { data: { subscriptionContracts: { nodes, pageInfo: { hasNextPage } } } };
}
function responder(bodies, inspect) {
  let calls = 0;
  const request = async (url, options) => {
    inspect?.(url, options, calls);
    assert.ok(calls < bodies.length, "unexpected request or retry");
    const body = bodies[calls++];
    return { status: 200, json: async () => body };
  };
  return { request, calls: () => calls };
}
test("skips previews, development and non-Vercel builds", async () => {
  for (const VERCEL_ENV of ["preview", "development", undefined]) {
    assert.equal((await diagnose({ ...env, VERCEL_ENV }, never, NOW)).result, "skipped_non_production");
  }
});
test("expires at the exact cutoff and rejects invalid clocks", async () => {
  for (const now of [EXPIRES_AT, EXPIRES_AT + 1, NaN, Infinity]) {
    assert.equal((await diagnose(env, never, now)).result, "skipped_expired");
  }
});
test("does not fall back to the generic Admin token", async () => {
  const result = await diagnose({ ...env, SHOPIFY_SUBSCRIPTIONS_TOKEN: "", SHOPIFY_ADMIN_TOKEN: "never-use" }, never, NOW);
  assert.equal(result.result, "missing_token");
  assert.ok(!JSON.stringify(result).includes("never-use"));
});
test("holds mismatched or missing shop/client configuration before network", async () => {
  for (const overrides of [
    { SHOPIFY_STORE_DOMAIN: "wrong-shop.myshopify.com" },
    { SHOPIFY_STORE_DOMAIN: "" },
    { SHOPIFY_SUBSCRIPTIONS_APP_CLIENT_ID: "wrong-client" },
    { SHOPIFY_SUBSCRIPTIONS_APP_CLIENT_ID: "" },
  ]) assert.equal((await diagnose({ ...env, ...overrides }, never, NOW)).result, "unexpected_configuration");
});
test("does not silently repair a malformed token", async () => {
  for (const token of [" padded ", '"quoted"', "'quoted'"]) {
    assert.equal((await diagnose({ ...env, SHOPIFY_SUBSCRIPTIONS_TOKEN: token }, never, NOW)).result, "malformed_token_configuration");
  }
});
test("pins HTTPS host, API version, redirects, timeout and read-only operations", async () => {
  const mock = responder([identity(), sample()], (url, options, index) => {
    assert.equal(url, "https://mullybox-store.myshopify.com/admin/api/2026-10/graphql.json");
    assert.equal(options.method, "POST");
    assert.equal(options.redirect, "error");
    assert.ok(options.signal instanceof AbortSignal);
    assert.equal(options.headers["X-Shopify-Access-Token"], env.SHOPIFY_SUBSCRIPTIONS_TOKEN);
    const query = JSON.parse(options.body).query;
    assert.equal(query, index === 0 ? IDENTITY_QUERY : SAMPLE_QUERY);
    assert.ok(query.startsWith("query "));
    assert.ok(!/\b(mutation|customer|email|phone|address|paymentMethod)\b/i.test(query));
  });
  assert.equal((await diagnose(env, mock.request, NOW)).result, "contract_read_succeeded");
  assert.equal(mock.calls(), 2);
});
test("stops on HTTP errors without reading raw bodies or retrying", async () => {
  for (const status of [401, 403, 429, 500]) {
    let calls = 0;
    const result = await diagnose(env, async () => {
      calls++;
      return { status, json: never };
    }, NOW);
    assert.equal(calls, 1);
    assert.equal(result.result, "identity_read_failed");
    assert.equal(result.status, status);
  }
});
test("sanitizes GraphQL errors and never accepts partial data", async () => {
  const mock = responder([{ ...identity(), errors: [
    { message: "secret-response-body", extensions: { code: "ACCESS_DENIED" } },
    { message: env.SHOPIFY_SUBSCRIPTIONS_TOKEN, extensions: { code: "arbitrary-private-text" } },
  ] }]);
  const result = await diagnose(env, mock.request, NOW);
  assert.equal(result.result, "identity_read_failed");
  assert.deepEqual(result.codes, ["ACCESS_DENIED", "UNCLASSIFIED"]);
  assert.equal(mock.calls(), 1);
  assert.ok(!JSON.stringify(result).includes("secret-response"));
  assert.ok(!JSON.stringify(result).includes("arbitrary-private"));
  assert.ok(!JSON.stringify(result).includes(env.SHOPIFY_SUBSCRIPTIONS_TOKEN));
});
test("sanitizes fetch exceptions and malformed JSON", async () => {
  for (const request of [
    async () => { throw Error(`private ${env.SHOPIFY_SUBSCRIPTIONS_TOKEN}`); },
    async () => ({ status: 200, json: async () => { throw Error("private-response"); } }),
  ]) {
    const result = await diagnose(env, request, NOW);
    assert.equal(result.failure, "request_failed");
    assert.ok(!JSON.stringify(result).includes("private"));
  }
});
test("rejects wrong returned identity before a contract request", async () => {
  for (const field of ["shop", "client", "id"]) {
    const body = identity();
    if (field === "shop") body.data.shop.myshopifyDomain = "wrong.myshopify.com";
    if (field === "client") body.data.currentAppInstallation.app.apiKey = "other";
    if (field === "id") body.data.currentAppInstallation.app.id = "gid://shopify/Customer/123";
    const mock = responder([body]);
    assert.equal((await diagnose(env, mock.request, NOW)).result, "unexpected_identity");
    assert.equal(mock.calls(), 1);
  }
});
test("checks granted scopes, not advertised/requested scopes", async () => {
  const body = identity(["read_orders", "read_all_orders"]);
  body.data.currentAppInstallation.app.requestedAccessScopes = [{ handle: "read_own_subscription_contracts" }];
  const mock = responder([body]);
  assert.equal((await diagnose(env, mock.request, NOW)).result, "subscription_scope_missing");
  assert.equal(mock.calls(), 1);
});
test("accepts the write-own grant only for these read queries", async () => {
  const mock = responder([identity(["write_own_subscription_contracts"]), sample()]);
  const result = await diagnose(env, mock.request, NOW);
  assert.equal(result.result, "contract_read_succeeded");
  assert.equal(result.readOwnContracts, false);
  assert.equal(result.writeOwnContracts, true);
});
test("rejects malformed scope evidence", async () => {
  for (const scopes of [null, {}, [null], [{ handle: 4 }]]) {
    const body = identity();
    body.data.currentAppInstallation.accessScopes = scopes;
    const mock = responder([body]);
    assert.equal((await diagnose(env, mock.request, NOW)).result, "malformed_scope_response");
  }
});
test("an empty app-owned result never verifies storewide or native coverage", async () => {
  const mock = responder([identity(), sample()]);
  const result = await diagnose(env, mock.request, NOW);
  assert.equal(result.sampleSize, 0);
  assert.equal(result.hasNextPage, false);
  assert.equal(result.storewideCoverageVerified, false);
  assert.equal(result.nativeShopifyCoverageVerified, false);
  assert.equal(result.billingHistoryVerified, false);
  assert.equal(result.dispatchEligible, false);
});
test("summarizes a bounded sample without IDs, raw titles or unexpected statuses", async () => {
  const body = identity();
  body.data.currentAppInstallation.app.title = "private-title-never-log";
  const mock = responder([body, sample([
    { status: "ACTIVE", app: { id: APP_ID } },
    { status: "PAUSED", app: { id: "gid://shopify/App/456" } },
    { status: "private-status-never-log", app: null },
  ], true)]);
  const result = await diagnose(env, mock.request, NOW);
  assert.equal(result.sampleSize, 3);
  assert.equal(result.hasNextPage, true);
  assert.equal(result.ownedByCurrentApp, 1);
  assert.equal(result.ownedByOtherApp, 1);
  assert.equal(result.unresolvedOwner, 1);
  assert.deepEqual(result.statusCounts, { ACTIVE: 1, PAUSED: 1, UNCLASSIFIED: 1 });
  assert.ok(!JSON.stringify(result).includes("gid://"));
  assert.ok(!JSON.stringify(result).includes("private-"));
  assert.equal(result.nativeShopifyCoverageVerified, false);
});
test("stops after a denied contract read without token fallback", async () => {
  const mock = responder([identity(), { errors: [{ extensions: { code: "ACCESS_DENIED" } }] }]);
  const result = await diagnose(env, mock.request, NOW);
  assert.equal(result.result, "contract_read_failed");
  assert.equal(mock.calls(), 2);
});
test("rejects malformed contract evidence or an unexpectedly oversized sample", async () => {
  const invalid = [
    { data: {} },
    sample(null),
    sample([null]),
    sample([{ status: "ACTIVE" }]),
    sample([{ status: "ACTIVE", app: { id: "gid://shopify/Customer/123" } }]),
    sample([{ status: null, app: null }]),
    sample([], "false"),
    sample(Array.from({ length: 6 }, () => ({ status: "ACTIVE", app: null }))),
  ];
  for (const body of invalid) {
    const mock = responder([identity(), body]);
    assert.equal((await diagnose(env, mock.request, NOW)).result, "malformed_contract_response");
  }
});
