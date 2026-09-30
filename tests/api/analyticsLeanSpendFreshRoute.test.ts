import { NextRequest } from "next/server";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/analytics/ingest/spend/advance/route";
import { prepareFreshGoogleSpend } from "@/lib/analytics/googleSpendRegistration";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import type { SpendBase } from "@/lib/analytics/spend";

const port = vi.hoisted(() => ({
  client: null as AnalyticsRpcClient | null, clientReads: vi.fn(), authReads: vi.fn(),
}));
vi.mock("@/lib/analytics/serverClient", () => ({
  getAnalyticsSupabase: () => { port.clientReads(); return port.client; },
}));
vi.mock("@/lib/analytics/googleSpendSource", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/analytics/googleSpendSource")>();
  return { ...actual, googleSpendAuthFromEnv: (...args: Parameters<typeof actual.googleSpendAuthFromEnv>) => {
    port.authReads(); return actual.googleSpendAuthFromEnv(...args);
  } };
});
const now = "2026-01-15T12:00:00.000Z", secret = "x".repeat(32);
const fixture = () => prepareFreshGoogleSpend({
  version: 1, projectRef: "a".repeat(20), accountId: "1234567890", loginCustomerId: null,
  approvalRef: "fixture:approval", actorRef: "fixture:actor", revisionRef: "fixture:revision",
  credentialBindingRef: "fixture:binding", coverage: "whole_account_campaign_day",
  sourceCurrency: "USD", sourceTimezone: "America/New_York",
  preparedAt: "2026-01-15T09:00:00Z", freshnessCutoffAt: "2026-01-15T10:00:00Z",
  expiresAt: "2026-01-16T12:00:00Z", maxPages: 1, maxRequestsPerDay: 3, deadlineSeconds: 10,
  days: [{ date: "2026-01-14", dueAt: "2026-01-15T10:00:00Z" }],
});
const request = (suffix = "", token = secret, body?: string, signal?: AbortSignal) => new NextRequest(
  `https://fixture.invalid/api/analytics/ingest/spend/advance${suffix}`,
  { method: "POST", headers: { authorization: `Bearer ${token}` }, ...(body ? { body } : {}), signal });
let rpc: ReturnType<typeof vi.fn<AnalyticsRpcClient["rpc"]>>, fetcher: ReturnType<typeof vi.fn<typeof fetch>>;
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  port.clientReads.mockClear(); port.authReads.mockClear();
  const prepared = fixture(), scope = prepared.registration.args.p_scope;
  for (const [key, value] of Object.entries({
    LEAN_ANALYTICS_SPEND_PILOT_ENABLED: "true", LEAN_ANALYTICS_SPEND_PILOT_SECRET: secret,
    LEAN_ANALYTICS_SPEND_PILOT_MODE: "fresh", LEAN_ANALYTICS_SPEND_FRESH_ENABLED: "true",
    LEAN_ANALYTICS_SPEND_FRESH_MANIFEST_JSON: JSON.stringify(prepared.manifest),
    LEAN_ANALYTICS_SPEND_PILOT_ID: scope.pilotId,
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: scope.projectRef,
    LEAN_ANALYTICS_SUPABASE_URL: `https://${scope.projectRef}.supabase.co`,
    LEAN_GOOGLE_ADS_AUTH_MODE: "oauth_refresh", LEAN_GOOGLE_ADS_OAUTH_CLIENT_ID: "fixture",
    LEAN_GOOGLE_ADS_OAUTH_CLIENT_SECRET: "fixture", LEAN_GOOGLE_ADS_REFRESH_TOKEN: "fixture",
  })) vi.stubEnv(key, value);
  let base: SpendBase | undefined;
  rpc = vi.fn<AnalyticsRpcClient["rpc"]>(async (name, args) => {
    if (name === "lean_spend_pilot_next") return { error: null, data: base
      ? { state: "complete" } : { state: "ready", runId: scope.days[0].runId, accountId: scope.accountId } };
    if (name === "lean_spend_claim") return { error: null, data: {
      state: "claimed", accountId: scope.accountId, loginCustomerId: scope.loginCustomerId,
      date: scope.days[0].date, maxPages: scope.maxPages, approvalRef: scope.approvalRef } };
    if (name === "lean_spend_finish") base = args.p_base as SpendBase;
    return { error: null, data: true };
  });
  port.client = { rpc };
  fetcher = vi.fn<typeof fetch>(async (url, init) => {
    if (url === "https://oauth2.googleapis.com/token")
      return Response.json({ access_token: "fixture", token_type: "Bearer" });
    const query = JSON.parse(String(init?.body)).query;
    return query.includes("FROM customer")
      ? Response.json({ results: [{ customer: { id: scope.accountId, currencyCode: "USD", timeZone: "America/New_York" } }] })
      : Response.json({ fieldMask: "campaign.id,segments.date,metrics.costMicros,metrics.clicks,metrics.impressions" });
  });
  vi.stubGlobal("fetch", fetcher); // Synthetic only; no real HTTP transport.
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

function untouched() {
  expect(port.authReads).not.toHaveBeenCalled(); expect(port.clientReads).not.toHaveBeenCalled();
  expect(rpc).not.toHaveBeenCalled(); expect(fetcher).not.toHaveBeenCalled();
}
it("preserves default-off, secret, authorization and empty-body/query guards with no-store", async () => {
  vi.stubEnv("LEAN_ANALYTICS_SPEND_PILOT_ENABLED", undefined);
  const disabled = await POST(request());
  expect(disabled.status).toBe(404); expect(disabled.headers.get("cache-control")).toBe("no-store");
  vi.stubEnv("LEAN_ANALYTICS_SPEND_PILOT_ENABLED", "true");
  vi.stubEnv("LEAN_ANALYTICS_SPEND_PILOT_SECRET", "short");
  expect((await POST(request())).status).toBe(503);
  vi.stubEnv("LEAN_ANALYTICS_SPEND_PILOT_SECRET", secret);
  expect((await POST(request("", "wrong"))).status).toBe(401);
  expect((await POST(request("?accountId=9876543210"))).status).toBe(400);
  expect((await POST(request("", secret, JSON.stringify(fixture().manifest)))).status).toBe(400);
  untouched();
});
it.each([
  ["LEAN_ANALYTICS_SPEND_FRESH_ENABLED", undefined],
  ["LEAN_ANALYTICS_SPEND_FRESH_ENABLED", "false"],
  ["LEAN_ANALYTICS_SPEND_FRESH_MANIFEST_JSON", undefined],
  ["LEAN_ANALYTICS_SPEND_FRESH_MANIFEST_JSON", "{"],
  ["LEAN_ANALYTICS_SPEND_FRESH_MANIFEST_JSON", " ".repeat(16385)],
  ["LEAN_ANALYTICS_SPEND_FRESH_MANIFEST_JSON", JSON.stringify(fixture().manifest, null, 2)],
  ["LEAN_ANALYTICS_SPEND_PILOT_ID", "historical:pilot"],
  ["LEAN_ANALYTICS_PIPELINE_PROJECT_REF", "b".repeat(20)],
  ["LEAN_ANALYTICS_SUPABASE_URL", "https://wrong.invalid"],
  ["LEAN_ANALYTICS_SPEND_PILOT_MODE", "typo"],
  ["LEAN_ANALYTICS_SPEND_PILOT_MODE", ""],
])("rejects invalid server binding %s before client/auth construction, without legacy fallback", async (key, value) => {
  vi.stubEnv(key, value);
  const response = await POST(request());
  expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toEqual({ state: "unavailable" });
  untouched();
});
it("rejects changed manifest policy without the matching hash-bound pilot ID", async () => {
  const m = { ...fixture().manifest, sourceCurrency: "EUR" };
  vi.stubEnv("LEAN_ANALYTICS_SPEND_FRESH_MANIFEST_JSON", JSON.stringify(m));
  expect((await POST(request())).status).toBe(503); untouched();
});
it("handles future, expired and canceled invocations before credential construction", async () => {
  vi.setSystemTime("2026-01-15T08:59:59Z");
  expect((await POST(request())).status).toBe(503);
  vi.setSystemTime("2026-01-16T12:00:00Z");
  expect(await (await POST(request())).json()).toEqual({ state: "expired" });
  vi.setSystemTime(now);
  expect((await POST(request("", secret, undefined, AbortSignal.abort()))).status).toBe(503);
  untouched();
});
it("runs the attended fresh route through the real wrapper/reader and does not collect twice", async () => {
  const first = await POST(request()), second = await POST(request());
  expect(first.status).toBe(200);
  expect(await first.json()).toEqual({ state: "complete", rows: 0 });
  expect(await second.json()).toEqual({ state: "complete" });
  expect(first.headers.get("cache-control")).toBe("no-store");
  expect(fetcher).toHaveBeenCalledTimes(3);
  expect(port.authReads).toHaveBeenCalledTimes(2);
  expect(rpc.mock.calls[0]).toEqual(["lean_spend_pilot_next", {
    p_pilot: fixture().registration.args.p_scope.pilotId, p_project_ref: fixture().manifest.projectRef }]);
  expect(rpc.mock.calls.some(([name]) => name === "lean_spend_pilot_register")).toBe(false);
});
it("keeps source failures and fresh-mode exceptions sanitized with no fallback", async () => {
  fetcher.mockRejectedValue(new Error("private source details"));
  const failed = await POST(request());
  expect(failed.status).toBe(422); expect(await failed.json()).toEqual({ state: "failed" });
  rpc.mockRejectedValue(new Error("private database details"));
  const unavailable = await POST(request());
  expect(unavailable.status).toBe(503); expect(await unavailable.json()).toEqual({ state: "unavailable" });
  expect(unavailable.headers.get("cache-control")).toBe("no-store");
});
it.each([undefined, "legacy"])("preserves legacy behavior with mode %s even if fresh configuration is invalid", async mode => {
  vi.stubEnv("LEAN_ANALYTICS_SPEND_PILOT_MODE", mode);
  vi.stubEnv("LEAN_ANALYTICS_SPEND_PILOT_ID", "fixture:legacy");
  vi.stubEnv("LEAN_ANALYTICS_SPEND_FRESH_MANIFEST_JSON", "invalid-unused");
  vi.stubEnv("LEAN_ANALYTICS_SPEND_FRESH_ENABLED", undefined);
  rpc.mockResolvedValue({ error: null, data: { state: "disabled" } });
  const response = await POST(request());
  expect(response.status).toBe(200); expect(await response.json()).toEqual({ state: "disabled" });
  expect(rpc).toHaveBeenCalledWith("lean_spend_pilot_next", {
    p_pilot: "fixture:legacy", p_project_ref: fixture().manifest.projectRef });
  expect(fetcher).not.toHaveBeenCalled();
});
