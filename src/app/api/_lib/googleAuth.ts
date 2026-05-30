/**
 * Google service-account token minting.
 *
 * Mints an access token from a base64-encoded service-account JSON using
 * the JWT-bearer flow. Optional `sub` enables domain-wide delegation so
 * the service account impersonates a real Google user (e.g. for Google
 * Ads, which requires the underlying user to have account access).
 *
 * Two env-var lookups are supported, in order:
 *   1. GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64 (Ads-specific override)
 *   2. GOOGLE_SERVICE_ACCOUNT_JSON_BASE64      (shared default)
 */

export interface GoogleTokenOptions {
  scope: string;
  /** Optional Google user to impersonate via domain-wide delegation. */
  sub?: string;
  /** Override which env var to read the base64 service-account from. */
  serviceAccountEnvVar?: string;
}

export async function mintGoogleAccessToken(
  opts: GoogleTokenOptions
): Promise<string | null> {
  const envVar = opts.serviceAccountEnvVar;
  const b64 = envVar
    ? process.env[envVar]
    : process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64 ??
      process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64;
  if (!b64) return null;

  const sa = JSON.parse(Buffer.from(b64, "base64").toString("utf-8")) as {
    client_email: string;
    private_key: string;
  };
  const { createSign } = await import("node:crypto");
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(
    JSON.stringify({ alg: "RS256", typ: "JWT" })
  ).toString("base64url");
  const claims: Record<string, unknown> = {
    iss: sa.client_email,
    scope: opts.scope,
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  };
  if (opts.sub) claims.sub = opts.sub;
  const claimsB64 = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${claimsB64}`);
  const sig = signer.sign(sa.private_key).toString("base64url");
  const jwt = `${header}.${claimsB64}.${sig}`;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: jwt,
    }),
  });
  if (!r.ok) {
    throw new Error(`google token: ${r.status} ${await r.text()}`);
  }
  return ((await r.json()) as { access_token: string }).access_token;
}
