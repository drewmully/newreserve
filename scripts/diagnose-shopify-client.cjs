// Temporary production-build diagnostic. Uses secrets only inside the deployment
// environment, never exposes their values, and cannot authorize a real customer.
const TOKEN_URL = "https://shopify.com/authentication/56105304256/oauth/token";
const CLIENT_ID = "7575784d-4926-4f17-8cc5-71cada3c71bd";
const SAFE_ERRORS = new Set([
  "invalid_client", "unauthorized_client", "invalid_grant",
  "invalid_request", "unsupported_grant_type", "invalid_scope",
]);

async function diagnose(env = process.env, request = fetch) {
  if (env.VERCEL_ENV !== "production") return { result: "skipped_non_production" };
  const id = env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_ID || "";
  const secret = env.SHOPIFY_CUSTOMER_ACCOUNT_CLIENT_SECRET || "";
  const configuration = {
    clientIdMatchesExpected: id === CLIENT_ID,
    secretPresent: Boolean(secret),
    secretHasSurroundingWhitespace: secret !== secret.trim(),
    secretWrappedInQuotes: /^["'].*["']$/s.test(secret),
  };
  if (!id || !secret) return { result: "missing_configuration", ...configuration };
  if (id !== CLIENT_ID) return { result: "unexpected_client_id", ...configuration };
  try {
    const response = await request(TOKEN_URL, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(12000),
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Origin: "https://www.mymully.com",
        Authorization: `Basic ${Buffer.from(`${id}:${secret}`, "utf8").toString("base64")}`,
      },
      body: new URLSearchParams({
        client_id: id,
        grant_type: "authorization_code",
        redirect_uri: "https://www.mymully.com/api/shopify-customer/callback",
        code: "mully-build-diagnostic-not-a-real-authorization-code",
        code_verifier: "a".repeat(43),
      }),
    });
    const body = await response.json().catch(() => ({}));
    const error = SAFE_ERRORS.has(body.error) ? body.error : "unclassified_response";
    // invalid_grant is expected for the intentionally invalid code and indicates
    // we have moved past client authentication. It is NOT an end-to-end login test.
    return {
      ...configuration,
      status: response.status,
      error,
      result: error === "invalid_grant" ? "client_accepted_invalid_code_rejected"
        : error === "invalid_client" || error === "unauthorized_client" ? "client_rejected"
          : "inconclusive",
    };
  } catch {
    // Never log raw exceptions: fetch libraries can attach request headers.
    return { ...configuration, result: "request_failed" };
  }
}

module.exports = { diagnose };
if (require.main === module) {
  diagnose().then(result => {
    console.log("[shopify-client-build-diagnostic]", JSON.stringify(result));
  }).catch(() => {
    console.log("[shopify-client-build-diagnostic]", JSON.stringify({ result: "diagnostic_failed" }));
  });
}
