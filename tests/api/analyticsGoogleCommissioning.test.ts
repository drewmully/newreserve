import { generateKeyPairSync } from "node:crypto";
import { describe, expect, it } from "vitest";
import { googleCommissioningPost } from "@/lib/analytics/googleCommissioningRuntime";
import { googleAutomaticDigest, type GoogleCaptureClaim } from "@/lib/analytics/googleAutomaticCapture";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";

const secret = "commission-fixture-capability-0123456789";
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ type: "pkcs8", format: "pem" });
const serviceAccount = Buffer.from(JSON.stringify({ type: "service_account", client_email: "fixture@example.invalid",
  private_key: privateKey, token_uri: "https://oauth2.googleapis.com/token" })).toString("base64");
const auth = { mode: "service_account" as const, serviceAccountJsonBase64: serviceAccount, subject: "fixture@example.invalid" };
const developerToken = "fixture-google-developer";
const env = () => ({ LEAN_GOOGLE_COMMISSION_ENABLED: "true", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
  LEAN_GOOGLE_COMMISSION_SECRET: secret, LEAN_GOOGLE_COMMISSION_GRANT_ID: "commission-fixture", LEAN_GOOGLE_COMMISSION_REVISION: "1",
  LEAN_ANALYTICS_PIPELINE_PROJECT_REF: "xnfjdbpjuaezxjgargto", LEAN_ANALYTICS_SUPABASE_URL: "https://xnfjdbpjuaezxjgargto.supabase.co",
  LEAN_GOOGLE_ADS_AUTH_MODE: "service_account", LEAN_GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64: serviceAccount,
  LEAN_GOOGLE_ADS_IMPERSONATE_EMAIL: auth.subject, LEAN_GOOGLE_ADS_DEVELOPER_TOKEN: developerToken });
const claim = (): GoogleCaptureClaim => ({ state: "capture", cycleId: "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa",
  grantId: "commission-fixture", revision: "1", projectRef: "xnfjdbpjuaezxjgargto", shop: "mullybox-store.myshopify.com",
  accountId: "4335795219", loginCustomerId: "9552995078", date: "2026-01-01", startedAt: new Date(Date.now()-1).toISOString(),
  deadline: new Date(Date.now()+60000).toISOString(), expiresAt: new Date(Date.now()+1800000).toISOString(),
  maxPages: 1, maxRequests: 7, maxBytes: 100000, sourceDeadlineSeconds: 30, approvalRef: "fixture:approval",
  actorRef: "fixture:owner", credentialBindingRef: "fixture:setup", credentialSha256: googleAutomaticDigest({ auth, developerToken }) });
const req = (body = '{"action":"capture"}', bearer = secret, suffix = "") => new Request(
  `https://example.invalid/api/analytics/ingest/google-commission${suffix}`, {
    method: "POST", headers: { Authorization: `Bearer ${bearer}` }, body });

function fixture(options: { claim?: Partial<GoogleCaptureClaim>; mismatch?: boolean; empty?: boolean;
  commitError?: boolean; nativeError?: boolean; metadataMismatch?: boolean } = {}) {
  const calls: string[] = [], queries: string[] = []; let consumed = false, attempts = 0, capture: unknown;
  const c = { ...claim(), ...options.claim };
  const client: AnalyticsRpcClient = { rpc(name, args) {
    calls.push(name);
    const result = Promise.resolve().then(() => {
      if (name === "lean_google_commission_claim") {
        if (consumed) return { data: null, error: "consumed" };
        consumed = true; return { data: c, error: null };
      }
      if (name !== "lean_google_commission_commit") throw Error("unexpected RPC");
      capture = args.p_capture;
      if (options.commitError) return { data: null, error: "unknown commit outcome" };
      return { data: { state: "captured", grantId: c.grantId, revision: c.revision, cycleId: c.cycleId,
        captureSha256: "a".repeat(64), registered: false, selected: false }, error: null };
    });
    return Object.assign(result, { abortSignal: () => result });
  } };
  const request: typeof fetch = async (url, init) => {
    attempts++;
    if (options.nativeError) throw Error("source failed");
    if (String(url) === "https://oauth2.googleapis.com/token") return Response.json({ access_token: "fixture-access", token_type: "Bearer" });
    expect(String(url)).toBe("https://googleads.googleapis.com/v25/customers/4335795219/googleAds:search");
    const q = JSON.parse(String(init?.body)).query; queries.push(q);
    if (q.startsWith("SELECT customer.id")) return Response.json({ results: [{ customer: { id: c.accountId,
      currencyCode: options.metadataMismatch ? "EUR" : "USD", timeZone: "America/New_York" } }] });
    if (q.includes("FROM customer")) return Response.json({ fieldMask: "segments.date,metrics.costMicros,metrics.clicks,metrics.impressions",
      results: [{ segments: { date: c.date }, metrics: { costMicros: options.mismatch ? "1" : "12000000", clicks: "4", impressions: "20" } }] });
    return Response.json({ fieldMask: "campaign.id,segments.date,metrics.costMicros,metrics.clicks,metrics.impressions",
      results: options.empty ? [] : [{ campaign: { id: "7" }, segments: { date: c.date },
        metrics: { costMicros: "12000000", clicks: "4", impressions: "20" } }] });
  };
  return { client, request, calls, queries, attempts: () => attempts, capture: () => capture };
}

describe("one-use commissioning application boundary", () => {
  it("uses actual capture module with seven exchanges and no standing or destination dependency", async () => {
    const f = fixture(), response = await googleCommissioningPost(req(), env(), f.client, f.request);
    expect(response.status).toBe(200); expect(f.attempts()).toBe(7);
    expect(f.queries.filter(q => q.includes("FROM campaign"))).toHaveLength(2);
    expect(f.calls).toEqual(["lean_google_commission_claim", "lean_google_commission_commit"]);
    const output = await response.json(); expect(output.registered).toBe(false); expect(output.selected).toBe(false);
    expect(Object.keys(output).sort()).toEqual(["state","grantId","revision","cycleId","captureSha256","registered","selected"].sort());
    const capture = f.capture() as { receipt: { requests: number }; costControl: { totalCostMicros: string } };
    expect(capture.receipt.requests).toBe(7); expect(capture.costControl.totalCostMicros).toBe("12000000");
  });
  it("refuses repeated capture before a second source request", async () => {
    const f = fixture(); await googleCommissioningPost(req(), env(), f.client, f.request);
    expect((await googleCommissioningPost(req(), env(), f.client, f.request)).status).toBe(503);
    expect(f.attempts()).toBe(7);
  });
  it("does not retry or fail/reset after ambiguous commit", async () => {
    const f = fixture({ commitError: true });
    expect((await googleCommissioningPost(req(), env(), f.client, f.request)).status).toBe(503);
    expect(f.calls).toEqual(["lean_google_commission_claim", "lean_google_commission_commit"]);
    expect(f.attempts()).toBe(7);
  });
  it("leaves consumed claim after native failure without a failure write or fallback", async () => {
    const f = fixture({ nativeError: true });
    expect((await googleCommissioningPost(req(), env(), f.client, f.request)).status).toBe(503);
    expect((await googleCommissioningPost(req(), env(), f.client, f.request)).status).toBe(503);
    expect(f.attempts()).toBe(1); expect(f.calls).toEqual(["lean_google_commission_claim", "lean_google_commission_claim"]);
  });
  for (const [name, options] of Object.entries({ mismatch: { mismatch: true }, empty: { empty: true },
    wrongCurrency: { metadataMismatch: true }, byteOverflow: { claim: { maxBytes: 1 } },
    wrongCredential: { claim: { credentialSha256: "0".repeat(64) } },
    expired: { claim: { deadline: "2020-01-01T00:00:00.000Z" } },
    wrongGrant: { claim: { grantId: "other" } }, excessiveDeadline: { claim: { deadline: new Date(Date.now()+150000).toISOString() } } })) {
    it(`refuses ${name} with no packet commit`, async () => {
      const f = fixture(options);
      expect((await googleCommissioningPost(req(), env(), f.client, f.request)).status).toBe(503);
      expect(f.calls).toEqual(["lean_google_commission_claim"]);
    });
  }
  it("default-off, preview, wrong capability and scope injection never dispatch", async () => {
    const f = fixture();
    for (const e of [{ ...env(), LEAN_GOOGLE_COMMISSION_ENABLED: "false" }, { ...env(), VERCEL_ENV: "preview" }])
      expect((await googleCommissioningPost(req(), e, f.client, f.request)).status).toBe(404);
    expect((await googleCommissioningPost(req(undefined, "wrong"), env(), f.client, f.request)).status).toBe(401);
    expect((await googleCommissioningPost(req('{"action":"capture","date":"2026-01-02"}'), env(), f.client, f.request)).status).toBe(503);
    expect((await googleCommissioningPost(req(" ".repeat(257)), env(), f.client, f.request)).status).toBe(503);
    expect((await googleCommissioningPost(req(undefined, secret, "?date=2026-01-02"), env(), f.client, f.request)).status).toBe(400);
    expect(f.calls).toHaveLength(0); expect(f.attempts()).toBe(0);
  });
  it("refuses bearer reuse and generic-credential fallback before claim", async () => {
    const f = fixture();
    expect((await googleCommissioningPost(req(), { ...env(), LEAN_GOOGLE_DELIVERY_SECRET: secret }, f.client, f.request)).status).toBe(503);
    expect((await googleCommissioningPost(req(), { ...env(), LEAN_GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64: "",
      GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64: serviceAccount }, f.client, f.request)).status).toBe(503);
    expect(f.calls).toHaveLength(0);
  });
});
