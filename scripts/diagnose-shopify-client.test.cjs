const { test } = require("node:test");
const assert = require("node:assert/strict");
const { diagnose } = require("./diagnose-shopify-client.cjs");
const env = {
  VERCEL_ENV: "production",
  SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID: "7575784d-4926-4f17-8cc5-71cada3c71bd",
  SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET: "fixture-secret-not-a-real-credential",
};
test("skips preview and never sends credentials", async () => {
  const result = await diagnose({ ...env, VERCEL_ENV: "preview" }, () => { throw Error("Must not request"); });
  assert.equal(result.result, "skipped_non_production");
});
test("reports missing configuration without a request", async () => {
  const result = await diagnose({ ...env, SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET: "" }, () => { throw Error("Must not request"); });
  assert.equal(result.result, "missing_configuration");
});
test("uses only the exact token endpoint and an intentionally unusable code", async () => {
  const result = await diagnose(env, async (url, options) => {
    assert.equal(url, "https://shopify.com/authentication/56105304256/oauth/token");
    assert.equal(options.redirect, "error");
    assert.equal(options.headers.Authorization, `Basic ${Buffer.from(`${env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID}:${env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET}`).toString("base64")}`);
    assert.equal(options.body.get("code"), "mully-build-diagnostic-not-a-real-authorization-code");
    return { status: 400, json: async () => ({ error: "invalid_grant", error_description: "Should never appear in logs" }) };
  });
  assert.equal(result.result, "client_accepted_invalid_code_rejected");
  assert.ok(!JSON.stringify(result).includes("fixture-secret"));
  assert.ok(!JSON.stringify(result).includes("Should never"));
});
test("distinguishes rejected client credentials", async () => {
  const result = await diagnose(env, async () => ({ status: 401, json: async () => ({ error: "invalid_client" }) }));
  assert.equal(result.result, "client_rejected");
});
test("does not echo token responses or exception messages", async () => {
  const result = await diagnose(env, async () => ({ status: 200, json: async () => ({ access_token: "never-log-token", error_description: "never-log-detail" }) }));
  assert.equal(result.result, "inconclusive");
  assert.ok(!JSON.stringify(result).includes("never-log"));
  const failed = await diagnose(env, async () => { throw Error("private-request-secret"); });
  assert.equal(failed.result, "request_failed");
  assert.ok(!JSON.stringify(failed).includes("private-request"));
});
