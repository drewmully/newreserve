import { afterEach, expect, it, vi } from "vitest";
import { googleDeliveryGet, validGoogleDeliveryPayload } from "@/lib/analytics/googleDeliveryRuntime";
import { googleDeliveryPath, prepareGoogleDeliveryReport } from "@/lib/analytics/googleDeliveryReport";
import { googleDeliveryFixture } from "../fixtures/analyticsGoogleDelivery";
const project = "xnfjdbpjuaezxjgargto";
function fixture() {
  const f = googleDeliveryFixture(), report = prepareGoogleDeliveryReport(f.input);
  const row = { ...report, is_stale: false, readiness: Object.fromEntries(
    Object.entries(report.readiness).map(([k, v]) => [k, v === "observed_unverified" ? "ready" : v])) };
  const data = { google_account_daily: [row], google_delivery_status: {
    state: "selected", report_scope: "single_google_account", run_id: "google-fixture",
    result_hash: "a".repeat(32), row_hash: "b".repeat(32), selection_revision: "1",
    row_count: "1", atomic_resource_refresh: false, not_before: new Date(Date.now() - 1000).toISOString(),
    expires_at: new Date(Date.now() + 60000).toISOString(),
  } };
  const env = { LEAN_GOOGLE_DELIVERY_ENABLED: "true", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
    LEAN_GOOGLE_DELIVERY_SECRET: "fixture-only-google-delivery-32-characters",
    LEAN_GOOGLE_DELIVERY_RUN_ID: "google-fixture", LEAN_GOOGLE_DELIVERY_RESULT_HASH: "a".repeat(32),
    LEAN_GOOGLE_DELIVERY_ACCOUNT_ID: "1234567890", LEAN_GOOGLE_DELIVERY_DATE: "2026-01-01",
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project, LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`,
    LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "fixture-only-not-a-secret" };
  const req = new Request(`https://fixture.invalid${googleDeliveryPath}`,
    { headers: { authorization: `Bearer ${env.LEAN_GOOGLE_DELIVERY_SECRET}` } });
  return { data, env, req };
}
afterEach(() => vi.useRealTimers());
it("reads one explicitly selected row through one bounded RPC, without mutation or personal fields", async () => {
  const f = fixture(), transport = vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe(`https://${project}.supabase.co/rest/v1/rpc/lean_google_delivery_read`);
    expect(JSON.parse(String(init?.body))).toEqual({ p_project_ref: project, p_run: "google-fixture",
      p_result_hash: "a".repeat(32), p_account_id: "1234567890", p_date: "2026-01-01" });
    expect(init?.redirect).toBe("error"); return Response.json(f.data);
  });
  const response = await googleDeliveryGet(f.req, f.env, transport);
  expect(response.status).toBe(200); expect(await response.json()).toEqual(f.data);
  expect(response.headers.get("cache-control")).toBe("no-store"); expect(transport).toHaveBeenCalledTimes(1);
});
it.each(["disabled", "preview", "unauthorized", "query", "body_header", "generic_only", "wrong_target", "reused_bearer"] as const)(
  "refuses %s before any RPC", async bad => {
    const f = fixture(), env: Record<string, string | undefined> = { ...f.env };
    let req = f.req, expected = 503;
    if (bad === "disabled") { delete env.LEAN_GOOGLE_DELIVERY_ENABLED; expected = 404; }
    if (bad === "preview") { env.VERCEL_ENV = "preview"; expected = 404; }
    if (bad === "unauthorized") { req = new Request(f.req.url); expected = 401; }
    if (bad === "query") { req = new Request(`${f.req.url}?run=other`, { headers: f.req.headers }); expected = 400; }
    if (bad === "body_header") {
      req = new Request(f.req.url, { headers: { ...Object.fromEntries(f.req.headers), "content-length": "1" } }); expected = 400;
    }
    if (bad === "generic_only") { delete env.LEAN_GOOGLE_DELIVERY_SECRET; env.LEAN_PRODUCTION_REPORTS_SECRET = f.env.LEAN_GOOGLE_DELIVERY_SECRET; }
    if (bad === "wrong_target") env.LEAN_ANALYTICS_SUPABASE_URL = "https://wrong.supabase.co";
    if (bad === "reused_bearer") env.LEAN_PRODUCTION_REPORTS_SECRET = f.env.LEAN_GOOGLE_DELIVERY_SECRET;
    const fetcher = vi.fn(() => { throw new Error("must_not_read"); });
    expect((await googleDeliveryGet(req, env, fetcher)).status).toBe(expected);
    expect(fetcher).not.toHaveBeenCalled();
  });
it.each(["extra", "wrong_account", "wrong_run", "wrong_hash", "wrong_date", "expired", "coerced", "readiness", "duplicate"] as const)(
  "fails closed on %s response", async bad => {
    const f = fixture(), data = f.data as unknown as { google_account_daily: Record<string, unknown>[]; google_delivery_status: Record<string, unknown> };
    if (bad === "extra") data.google_account_daily[0].customer_id = "forbidden";
    if (bad === "wrong_account") data.google_account_daily[0].account_id = "9999999999";
    if (bad === "wrong_run") data.google_delivery_status.run_id = "other";
    if (bad === "wrong_hash") data.google_delivery_status.result_hash = "c".repeat(32);
    if (bad === "wrong_date") data.google_account_daily[0].report_date = "2026-01-02";
    if (bad === "expired") data.google_delivery_status.expires_at = new Date(Date.now() - 1).toISOString();
    if (bad === "coerced") data.google_account_daily[0].clicks = 4;
    if (bad === "readiness") data.google_account_daily[0].readiness = {};
    if (bad === "duplicate") data.google_account_daily.push(data.google_account_daily[0]);
    expect((await googleDeliveryGet(f.req, f.env, async () => Response.json(data))).status).toBe(503);
  });
it("enforces the byte limit without returning provider/database error text", async () => {
  const f = fixture();
  const response = await googleDeliveryGet(f.req, f.env, async () => new Response("sensitive".repeat(3000)));
  expect(response.status).toBe(503); expect(await response.text()).toBe("");
});
it("stops an uncooperative hanging transport at the deadline", async () => {
  vi.useFakeTimers(); const f = fixture();
  const response = googleDeliveryGet(f.req, f.env, () => new Promise<Response>(() => {}));
  await vi.advanceTimersByTimeAsync(15000);
  expect((await response).status).toBe(503);
});
it("honors an already aborted request without reading", async () => {
  const f = fixture(), c = new AbortController(); c.abort();
  const transport = vi.fn(() => { throw new Error("must_not_read"); });
  expect((await googleDeliveryGet(new Request(f.req, { signal: c.signal }), f.env, transport)).status).toBe(503);
  expect(transport).not.toHaveBeenCalled();
});
it("validates the persisted metric types without default zeros", () => {
  const f = fixture();
  Object.assign(f.data.google_account_daily[0], { clicks: null, ctr: null, cpc_usd: null });
  Object.assign(f.data.google_account_daily[0].readiness, { clicks: "withheld", ctr: "withheld", cpc_usd: "withheld" });
  expect(validGoogleDeliveryPayload(f.data, { runId: "google-fixture", resultHash: "a".repeat(32),
    accountId: "1234567890", date: "2026-01-01" })).toBe(true);
});
