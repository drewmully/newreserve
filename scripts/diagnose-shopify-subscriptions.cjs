// Read-only, time-limited production-build probe. No runtime endpoint, writes,
// retries, alternate credentials, customer fields, or raw response/error logging.
const SHOP = "mullybox-store.myshopify.com";
const CLIENT_ID = "bd512503091105b19699875ae4c39eb3";
const EXPIRES_AT = Date.parse("2026-10-09T02:00:00Z");
const ENDPOINT = `https://${SHOP}/admin/api/2026-10/graphql.json`;
const IDENTITY_QUERY = `query MullySubscriptionAccessIdentity {
  shop { myshopifyDomain }
  currentAppInstallation { app { id apiKey title } accessScopes { handle } }
}`;
const SAMPLE_QUERY = `query MullySubscriptionAccessSample {
  subscriptionContracts(first: 5) {
    nodes { status app { id } }
    pageInfo { hasNextPage }
  }
}`;
const SAFE_CODES = new Set(["ACCESS_DENIED", "THROTTLED", "INTERNAL_SERVER_ERROR"]);
const STATUSES = new Set(["ACTIVE", "PAUSED", "CANCELLED", "EXPIRED", "FAILED"]);

async function diagnose(env = process.env, request = fetch, now = Date.now()) {
  if (env.VERCEL_ENV !== "production") return { result: "skipped_non_production" };
  if (!Number.isFinite(now) || now >= EXPIRES_AT) return { result: "skipped_expired" };
  const token = env.SHOPIFY_SUBSCRIPTIONS_TOKEN || "";
  const configuredClient = env.SHOPIFY_SUBSCRIPTIONS_APP_CLIENT_ID || "";
  const configuredShop = env.SHOPIFY_STORE_DOMAIN || "";
  const configuration = {
    tokenPresent: Boolean(token),
    clientIdMatchesExpected: configuredClient === CLIENT_ID,
    shopMatchesExpected: configuredShop === SHOP,
  };
  if (!token) return { result: "missing_token", ...configuration };
  if (!configuration.clientIdMatchesExpected || !configuration.shopMatchesExpected) {
    return { result: "unexpected_configuration", ...configuration };
  }
  if (token !== token.trim() || /^["'].*["']$/s.test(token)) {
    return { result: "malformed_token_configuration", ...configuration };
  }

  async function query(document) {
    try {
      const response = await request(ENDPOINT, {
        method: "POST",
        redirect: "error",
        signal: AbortSignal.timeout(12000),
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": token },
        body: JSON.stringify({ query: document }),
      });
      if (response.status !== 200) {
        return { failure: "http_error", status: response.status };
      }
      const body = await response.json();
      if (!body || typeof body !== "object") return { failure: "malformed_response" };
      if (body.errors !== undefined && (!Array.isArray(body.errors) || body.errors.length)) {
        const codes = Array.isArray(body.errors) ? body.errors.map(error => {
          const code = error?.extensions?.code;
          return SAFE_CODES.has(code) ? code : "UNCLASSIFIED";
        }) : ["UNCLASSIFIED"];
        return { failure: "graphql_error", codes: [...new Set(codes)] };
      }
      return { data: body.data };
    } catch {
      // Never log exception messages, raw payloads or request headers.
      return { failure: "request_failed" };
    }
  }

  const identity = await query(IDENTITY_QUERY);
  if (identity.failure) return { result: "identity_read_failed", ...configuration, ...identity };
  const installation = identity.data?.currentAppInstallation;
  const app = installation?.app;
  if (identity.data?.shop?.myshopifyDomain !== SHOP || app?.apiKey !== CLIENT_ID ||
      typeof app?.id !== "string" || !/^gid:\/\/shopify\/App\/\d+$/.test(app.id)) {
    return { result: "unexpected_identity", ...configuration };
  }
  if (!Array.isArray(installation.accessScopes) ||
      installation.accessScopes.some(scope => typeof scope?.handle !== "string")) {
    return { result: "malformed_scope_response", ...configuration };
  }
  const scopes = new Set(installation.accessScopes.map(scope => scope.handle));
  const permissions = {
    readOwnContracts: scopes.has("read_own_subscription_contracts"),
    writeOwnContracts: scopes.has("write_own_subscription_contracts"),
  };
  const verified = {
    ...configuration,
    appIdentityVerified: true,
    appTitleMatchesExpected: app.title === "mully-subscriptions-api",
    ...permissions,
  };
  if (!permissions.readOwnContracts && !permissions.writeOwnContracts) {
    return { result: "subscription_scope_missing", ...verified };
  }
  const sample = await query(SAMPLE_QUERY);
  if (sample.failure) return { result: "contract_read_failed", ...verified, ...sample };
  const connection = sample.data?.subscriptionContracts;
  if (!Array.isArray(connection?.nodes) || connection.nodes.length > 5 ||
      typeof connection.pageInfo?.hasNextPage !== "boolean" ||
      connection.nodes.some(node => !node || typeof node.status !== "string" ||
        (node.app !== null && (typeof node.app?.id !== "string" ||
          !/^gid:\/\/shopify\/App\/\d+$/.test(node.app.id))))) {
    return { result: "malformed_contract_response", ...verified };
  }
  const statusCounts = {};
  let ownedByCurrentApp = 0;
  let ownedByOtherApp = 0;
  let unresolvedOwner = 0;
  for (const contract of connection.nodes) {
    const status = STATUSES.has(contract.status) ? contract.status : "UNCLASSIFIED";
    statusCounts[status] = (statusCounts[status] || 0) + 1;
    if (contract.app === null) unresolvedOwner++;
    else if (contract.app.id === app.id) ownedByCurrentApp++;
    else ownedByOtherApp++;
  }
  return {
    result: "contract_read_succeeded",
    ...verified,
    sampleSize: connection.nodes.length,
    sampleLimit: 5,
    hasNextPage: connection.pageInfo.hasNextPage,
    statusCounts,
    ownedByCurrentApp,
    ownedByOtherApp,
    unresolvedOwner,
    // Even an empty complete app-owned list proves nothing about other apps.
    storewideCoverageVerified: false,
    nativeShopifyCoverageVerified: false,
    billingHistoryVerified: false,
    dispatchEligible: false,
  };
}

module.exports = { diagnose, EXPIRES_AT, IDENTITY_QUERY, SAMPLE_QUERY };
if (require.main === module) {
  diagnose().then(result => {
    console.log("[shopify-subscriptions-access]", JSON.stringify(result));
  }).catch(() => {
    // A diagnostic result must not block the storefront build.
    console.log("[shopify-subscriptions-access]", JSON.stringify({ result: "diagnostic_failed" }));
  });
}
