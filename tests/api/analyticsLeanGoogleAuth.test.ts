import { generateKeyPairSync, createVerify } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { authorizeGoogleSpend, googleSpendAuthFromEnv, type GoogleSpendAuth } from "@/lib/analytics/googleSpendSource";
import { mintGoogleAccessToken } from "@/app/api/_lib/googleAuth";
import { checkGoogleSpend, type GoogleCheckScope } from "@/lib/analytics/googleSpendCheck";
import { readGoogleCheck } from "../../scripts/analytics/read-google-spend.mjs";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { spawnSync } from "node:child_process";
import { bundleGoogleCheck } from "../../scripts/analytics/bundle-google-check.mjs";

const keys = generateKeyPairSync("rsa", { modulusLength: 2048 });
const json = Buffer.from(JSON.stringify({ client_email: "fixture@fixture.iam.gserviceaccount.com",
  private_key: keys.privateKey.export({ type: "pkcs8", format: "pem" }) })).toString("base64");
const auth: GoogleSpendAuth = { mode: "service_account", serviceAccountJsonBase64: json, subject: "fixture@example.invalid" };
const scope: GoogleCheckScope = { accountId: "1234567890", loginCustomerId: "9876543210",
  fromDate: "2026-09-21", throughDate: "2026-09-23", maxPages: 5, maxRequests: 20,
  deadlineSeconds: 60, approvalRef: "fixture:approval", actorRef: "fixture:operator" };
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
function checkJwt(init?: RequestInit) {
  const body = new URLSearchParams(String(init?.body));
  expect(body.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
  const [head, claims, sig] = body.get("assertion")!.split(".");
  const value = JSON.parse(Buffer.from(claims, "base64url").toString());
  expect(value).toMatchObject({ iss: "fixture@fixture.iam.gserviceaccount.com",
    aud: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/adwords",
    sub: "fixture@example.invalid" });
  expect(value.exp - value.iat).toBe(3600);
  expect(createVerify("RSA-SHA256").update(`${head}.${claims}`).verify(keys.publicKey, Buffer.from(sig, "base64url"))).toBe(true);
}
function wire(control = "12") {
  return vi.fn<typeof fetch>(async (url, init) => {
    expect(init?.redirect).toBe("error");
    if (url === "https://oauth2.googleapis.com/token") {
      checkJwt(init); return Response.json({ access_token: "fixture:access", token_type: "Bearer" });
    }
    expect(url).toBe("https://googleads.googleapis.com/v25/customers/1234567890/googleAds:search");
    expect(init?.headers).toMatchObject({ "developer-token": "fixture:developer", "login-customer-id": "9876543210" });
    const query = JSON.parse(String(init?.body)).query as string;
    if (query.includes("customer.id")) return Response.json({
      results: [{ customer: { id: "1234567890", currencyCode: "USD", timeZone: "America/New_York" } }],
    });
    if (query.includes("FROM campaign")) {
      const date = query.match(/= '([^']+)'/)![1];
      return Response.json({ fieldMask: "campaign.id,segments.date,metrics.costMicros,metrics.clicks,metrics.impressions",
        results: [{ campaign: { id: "101" }, segments: { date }, metrics: { costMicros: "12" } }] });
    }
    expect(query).toBe("SELECT segments.date, metrics.cost_micros FROM customer WHERE segments.date BETWEEN '2026-09-21' AND '2026-09-23' ORDER BY segments.date");
    return Response.json({ fieldMask: "segments.date,metrics.costMicros",
      results: ["2026-09-21", "2026-09-22", "2026-09-23"].map(date => ({ segments: { date }, metrics: { costMicros: control } })) });
  });
}
const options = () => ({ scope, auth, developerToken: "fixture:developer", now: "2026-09-25T00:00:00Z" });
it("uses dedicated config, explicit impersonation, and no shared credential fallback", () => {
  expect(googleSpendAuthFromEnv({ GOOGLE_ADS_REFRESH_TOKEN: "forbidden" })).toEqual({
    mode: "oauth_refresh", clientId: "", clientSecret: "", refreshToken: "",
  });
  expect(googleSpendAuthFromEnv({ LEAN_GOOGLE_ADS_AUTH_MODE: "service_account",
    GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64: json, GOOGLE_ADS_IMPERSONATE_EMAIL: "forbidden" }))
    .toEqual({ mode: "service_account", serviceAccountJsonBase64: "", subject: undefined });
  expect(() => googleSpendAuthFromEnv({ LEAN_GOOGLE_ADS_AUTH_MODE: "fallback" })).toThrow("invalid_auth_mode");
});
it("mints a signed fixed-scope token with bounded redacted transport", async () => {
  const fetcher = wire();
  expect(await authorizeGoogleSpend({ auth, developerToken: "fixture:developer", fetcher,
    signal: AbortSignal.timeout(1000) })).toBe("fixture:access");
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("preserves the legacy shared helper environment and JWT behavior", async () => {
  vi.stubEnv("GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64", json);
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    checkJwt(init); return Response.json({ access_token: "legacy:access" });
  });
  vi.stubGlobal("fetch", fetcher);
  expect(await mintGoogleAccessToken({ scope: "https://www.googleapis.com/auth/adwords", sub: auth.subject })).toBe("legacy:access");
});
it("keeps OAuth refresh backward-compatible", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    expect(new URLSearchParams(String(init?.body)).get("grant_type")).toBe("refresh_token");
    return Response.json({ access_token: "oauth:access", token_type: "Bearer" });
  });
  expect(await authorizeGoogleSpend({ auth: { mode: "oauth_refresh", clientId: "client",
    clientSecret: "secret", refreshToken: "refresh" }, fetcher, signal: AbortSignal.timeout(1000) })).toBe("oauth:access");
});
it.each(["", "not-json", Buffer.from("{}").toString("base64")])("rejects invalid credentials without a source call", async value => {
  const fetcher = vi.fn();
  await expect(authorizeGoogleSpend({ auth: { ...auth, serviceAccountJsonBase64: value },
    developerToken: "fixture", fetcher, signal: AbortSignal.timeout(1000) })).rejects.toThrow("invalid_service_account");
  expect(fetcher).not.toHaveBeenCalled();
});
it("requires service-account developer token and rejects invalid explicit delegation", async () => {
  const fetcher = vi.fn(), signal = AbortSignal.timeout(1000);
  await expect(authorizeGoogleSpend({ auth, fetcher, signal })).rejects.toThrow("invalid_service_account");
  await expect(authorizeGoogleSpend({ auth: { ...auth, subject: "not-email" }, developerToken: "x", fetcher, signal }))
    .rejects.toThrow("invalid_service_account");
  expect(fetcher).not.toHaveBeenCalled();
});
it("does not leak upstream OAuth errors or accept a token without the Bearer contract", async () => {
  for (const response of [new Response("SECRET", { status: 403 }), Response.json({ access_token: "secret" })]) {
    await expect(authorizeGoogleSpend({ auth, developerToken: "fixture",
      fetcher: async () => response, signal: AbortSignal.timeout(1000) })).rejects.not.toThrow("SECRET");
  }
});
it("rejects late success after an active deadline abort", async () => {
  const stop = new AbortController();
  await expect(authorizeGoogleSpend({ auth, developerToken: "fixture", signal: stop.signal,
    fetcher: async () => { stop.abort(); return Response.json({ access_token: "late", token_type: "Bearer" }); } }))
    .rejects.toThrow("transport_failed");
});
it("reads all three dates using the actual source and independent account query, outputs only aggregates", async () => {
  const fetcher = wire();
  const result = await checkGoogleSpend({ ...options(), fetcher });
  expect(result).toMatchObject({ state: "sample_amounts_match", requests: 8, certification: "unverified",
    databaseWrites: false, independentCoverageCertified: false });
  expect(result.rows).toHaveLength(3);
  expect(JSON.stringify(result)).not.toMatch(/fixture:access|fixture:developer|private_key|campaignId/);
});
it("withholds a comparison mismatch and missing control days", async () => {
  expect((await checkGoogleSpend({ ...options(), fetcher: wire("11") })).state).toBe("sample_amounts_unverified");
  const source = wire();
  const result = await checkGoogleSpend({ ...options(), fetcher: async (url, init) =>
    String(init?.body).includes("BETWEEN") ? Response.json({ fieldMask: "segments.date,metrics.costMicros" }) : source(url, init) });
  expect(result.rows.every(row => row.controlMicros === null && !row.matches)).toBe(true);
});
it("reserves worst-case pages before reads and enforces the explicit scope", async () => {
  const fetcher = vi.fn();
  for (const change of [{ maxRequests: 19 }, { maxPages: 6 }, { throughDate: "2026-09-24" }, { extra: true }])
    await expect(checkGoogleSpend({ ...options(), scope: { ...scope, ...change }, fetcher })).rejects.toThrow("invalid_scope");
  expect(fetcher).not.toHaveBeenCalled();
});
it("rejects truncated control and excess response bytes", async () => {
  const source = wire();
  await expect(checkGoogleSpend({ ...options(), fetcher: async (url, init) => String(init?.body).includes("BETWEEN")
    ? Response.json({ fieldMask: "segments.date,metrics.costMicros", nextPageToken: "more" }) : source(url, init) }))
    .rejects.toThrow("control_incomplete");
  await expect(checkGoogleSpend({ ...options(), fetcher: async () => new Response("x".repeat(8 * 1024 * 1024 + 1)) }))
    .rejects.toThrow("transport_failed");
});
it("runs the actual command module against synthetic transport and stays disabled otherwise", async () => {
  const dir = mkdtempSync(join(tmpdir(), "google-check-test-")), file = join(dir, "scope.json");
  try {
    writeFileSync(file, JSON.stringify(scope));
    await expect(readGoogleCheck(file, { NODE_ENV: "test" }, wire())).rejects.toThrow("disabled");
    const result = await readGoogleCheck(file, { NODE_ENV: "test", LEAN_ANALYTICS_GOOGLE_CHECK_ENABLED: "true",
      LEAN_GOOGLE_ADS_AUTH_MODE: "service_account", LEAN_GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64: json,
      LEAN_GOOGLE_ADS_IMPERSONATE_EMAIL: auth.subject, LEAN_GOOGLE_ADS_DEVELOPER_TOKEN: "fixture:developer" }, wire());
    expect(result.state).toBe("sample_amounts_match");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
it("emits a single-file Node-only bundle with code identity and an actual disabled CLI", async () => {
  const dir = mkdtempSync(join(tmpdir(), "google-bundle-test-"));
  try {
    const file = join(dir, "check.cjs"), input = join(dir, "scope.json");
    const manifest = bundleGoogleCheck(file);
    expect(manifest.sourceSha256).toMatch(/^[a-f0-9]{64}$/);
    writeFileSync(input, JSON.stringify(scope));
    const bundled = createRequire(import.meta.url)(file);
    const result = await bundled.check(scope, { LEAN_ANALYTICS_GOOGLE_CHECK_ENABLED: "true",
      LEAN_GOOGLE_ADS_AUTH_MODE: "service_account", LEAN_GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64: json,
      LEAN_GOOGLE_ADS_IMPERSONATE_EMAIL: auth.subject, LEAN_GOOGLE_ADS_DEVELOPER_TOKEN: "fixture:developer" }, wire());
    expect(result.code.sourceSha256).toBe(manifest.sourceSha256);
    expect(result.state).toBe("sample_amounts_match");
    const child = spawnSync(process.execPath, [file, input], { encoding: "utf8", env: { NODE_ENV: "test" } });
    expect(child.status).toBe(1);
    expect(child.stdout).toBe("");
    expect(child.stderr.trim()).toBe("google_check_failed");
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
