import { generateKeyPairSync } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/analytics/ingest/refresh/route";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import type { SpendBase } from "@/lib/analytics/spend";

const mocks = vi.hoisted(() => ({ client: null as AnalyticsRpcClient | null }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => mocks.client }));
const project = "a".repeat(20), account = "1234567890", manager = "9876543210";
const secret = "synthetic-refresh-secret-".repeat(2);
const developerToken = "synthetic-developer-token";
const privateKey = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey
  .export({ type: "pkcs8", format: "pem" }).toString();
const serviceAccount = Buffer.from(JSON.stringify({ type: "service_account",
  client_email: "synthetic@fixture.iam.gserviceaccount.com", private_key: privateKey })).toString("base64");
const request = () => new NextRequest("https://fixture.invalid/api/analytics/ingest/refresh", {
  method: "POST", headers: { authorization: `Bearer ${secret}` },
});
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime("2026-10-01T05:00:00Z");
  for (const [key, value] of Object.entries({
    LEAN_ANALYTICS_REFRESH_ENABLED: "true", LEAN_ANALYTICS_REFRESH_SECRET: secret,
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project,
    LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`,
    LEAN_GOOGLE_ADS_OAUTH_CLIENT_ID: "synthetic-client",
    LEAN_GOOGLE_ADS_OAUTH_CLIENT_SECRET: "synthetic-client-secret",
    LEAN_GOOGLE_ADS_REFRESH_TOKEN: "synthetic-refresh-token",
    LEAN_GOOGLE_ADS_DEVELOPER_TOKEN: developerToken,
    LEAN_GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64: serviceAccount,
    LEAN_GOOGLE_ADS_IMPERSONATE_EMAIL: "synthetic-operator@fixture.invalid",
  })) vi.stubEnv(key, value);
  vi.stubEnv("LEAN_GOOGLE_ADS_AUTH_MODE", undefined);
});
afterEach(() => {
  vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); vi.useRealTimers();
});

it.each([undefined, "oauth_refresh", "service_account"] as const)(
  "carries %s auth and developer token through the actual refresh, full and spend paths", async mode => {
    vi.stubEnv("LEAN_GOOGLE_ADS_AUTH_MODE", mode);
    let saved: SpendBase | undefined;
    const rpc = vi.fn<AnalyticsRpcClient["rpc"]>(async (name, args) => {
      if (name === "lean_refresh_claim") return { error: null, data: { state: "claimed", runId: "full-fixture" } };
      if (name === "lean_full_next") return { error: null, data: { state: "ready", stage: "spend", runId: "spend-fixture" } };
      if (name === "lean_spend_claim") return { error: null, data: { state: "claimed", accountId: account,
        loginCustomerId: manager, date: "2026-09-30", maxPages: 1, approvalRef: "synthetic-approval" } };
      if (name === "lean_spend_finish") { saved = args.p_base as SpendBase; return { error: null, data: true }; }
      if (name === "lean_refresh_finish") return { error: null, data: true };
      throw new Error(`unexpected_rpc:${name}`);
    });
    mocks.client = { rpc };
    const fetcher = vi.fn<typeof fetch>(async (url, init) => {
      if (url === "https://oauth2.googleapis.com/token")
        return Response.json({ access_token: "synthetic-access-token", token_type: "Bearer" });
      if (url !== `https://googleads.googleapis.com/v25/customers/${account}/googleAds:search`)
        throw new Error("unexpected_network");
      const query = JSON.parse(String(init?.body)).query as string;
      return query.includes("FROM customer")
        ? Response.json({ results: [{ customer: { id: account, currencyCode: "USD", timeZone: "America/New_York" } }] })
        : Response.json({ fieldMask: "campaign.id,segments.date,metrics.costMicros,metrics.clicks,metrics.impressions",
          results: [{ campaign: { id: "7" }, segments: { date: "2026-09-30" },
            metrics: { costMicros: "1200000", clicks: "2", impressions: "10" } }] });
    });
    vi.stubGlobal("fetch", fetcher);
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")];
    const response = await POST(request());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ state: "partial" });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "lean_refresh_claim", "lean_full_next", "lean_spend_claim", "lean_spend_finish", "lean_refresh_finish",
    ]);
    expect(fetcher).toHaveBeenCalledTimes(3);
    const tokenBody = new URLSearchParams(String(fetcher.mock.calls[0][1]?.body));
    if (mode === "service_account") {
      expect(tokenBody.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:jwt-bearer");
      const claims = JSON.parse(Buffer.from(tokenBody.get("assertion")!.split(".")[1], "base64url").toString());
      expect(claims).toMatchObject({ iss: "synthetic@fixture.iam.gserviceaccount.com",
        sub: "synthetic-operator@fixture.invalid", scope: "https://www.googleapis.com/auth/adwords" });
      expect(tokenBody.has("refresh_token")).toBe(false);
    } else {
      expect(Object.fromEntries(tokenBody)).toEqual({ grant_type: "refresh_token", client_id: "synthetic-client",
        client_secret: "synthetic-client-secret", refresh_token: "synthetic-refresh-token" });
    }
    for (const [, init] of fetcher.mock.calls.slice(1)) {
      const headers = new Headers(init?.headers);
      expect(headers.get("developer-token")).toBe(developerToken);
      expect(headers.get("login-customer-id")).toBe(manager);
    }
    expect(saved).toMatchObject({ accountId: account, date: "2026-09-30", paginationComplete: true,
      verifiedEmpty: false, rows: [{ campaignId: "7", costMicros: "1200000" }] });
    for (const log of logs) expect(log).not.toHaveBeenCalled();
  });

it("rejects an unsupported auth mode with a redacted response before claiming work or contacting a provider", async () => {
  vi.stubEnv("LEAN_GOOGLE_ADS_AUTH_MODE", "unsupported");
  const rpc = vi.fn<AnalyticsRpcClient["rpc"]>(); mocks.client = { rpc };
  const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
  const log = vi.spyOn(console, "error");
  const response = await POST(request());
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ state: "unavailable" });
  expect(rpc).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
  expect(log).not.toHaveBeenCalled();
});
