import { afterEach, expect, it, vi } from "vitest";
import { googleStandingBinding } from "@/lib/analytics/googleStandingBinding";
import { runGoogleStandingPipeline } from "@/lib/analytics/googleStandingOperation";
import { googleDeliveryGet } from "@/lib/analytics/googleDeliveryRuntime";
import { googleDeliveryPath, prepareGoogleDeliveryReport } from "@/lib/analytics/googleDeliveryReport";
import { googleDeliveryFixture } from "../fixtures/analyticsGoogleDelivery";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";

const project = "xnfjdbpjuaezxjgargto", binding = { policy: "fixture-policy", revision: "1" };
const input = (client: AnalyticsRpcClient): Parameters<typeof runGoogleStandingPipeline>[0] => ({
  client, projectRef: project, databaseUrl: `https://${project}.supabase.co`, runId: "",
  shop: "mullybox-store.myshopify.com", shopifyToken: "", posthogKey: "",
  googleClientId: "", googleClientSecret: "", googleRefreshToken: "", now: new Date().toISOString(),
});
function lazyClient(response: (name: string, args: Record<string, unknown>) => unknown) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client: AnalyticsRpcClient = { rpc(name, args) {
    const pending = { then: <T>(resolve: (value: { data: unknown; error: null }) => T) => {
      calls.push({ name, args }); return Promise.resolve(resolve({ data: response(name, args), error: null }));
    }, abortSignal: (s: AbortSignal) => { s.throwIfAborted(); return pending; } };
    return pending as ReturnType<AnalyticsRpcClient["rpc"]>;
  } };
  return { client, calls };
}
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
it("requires explicit policy and revision before any dispatch", async () => {
  for (const revision of ["", "0", "-1", "1.1", "9223372036854775808"])
    expect(() => googleStandingBinding({ LEAN_GOOGLE_STANDING_POLICY_ID: "p",
      LEAN_GOOGLE_STANDING_POLICY_REVISION: revision })).toThrow();
  const c = lazyClient(() => { throw new Error("must_not_dispatch"); });
  await expect(runGoogleStandingPipeline(input(c.client), { ...binding, policy: "" })).rejects.toThrow();
  expect(c.calls).toEqual([]);
});
it.each(["disabled", "held", "exhausted", "not_due", "idle"])("does not run or finish a %s claim", async state => {
  const c = lazyClient(() => ({ state })), run = vi.fn();
  expect(await runGoogleStandingPipeline(input(c.client), binding, run)).toEqual({ state });
  expect(run).not.toHaveBeenCalled(); expect(c.calls.map(c => c.name)).toEqual(["lean_google_standing_next"]);
});
it("advances one existing pipeline step and uses the same lease token for one finish", async () => {
  const c = lazyClient(name => name.endsWith("_next")
    ? { state: "ready", runId: "new-owner-run", deadline: new Date(Date.now() + 60000).toISOString() }
    : { state: "partial" });
  const run = vi.fn(async value => { expect(value.runId).toBe("new-owner-run"); return { state: "partial" }; });
  expect(await runGoogleStandingPipeline(input(c.client), binding, run)).toEqual({ state: "partial" });
  expect(c.calls.map(c => c.name)).toEqual(["lean_google_standing_next", "lean_google_standing_finish"]);
  expect(c.calls[0].args.p_token).toBe(c.calls[1].args.p_token);
  expect(c.calls[1].args).toMatchObject({ p_run: "new-owner-run", p_policy: "fixture-policy", p_revision: "1" });
});
it("never retries or clears a lease after ambiguous source/finish transport", async () => {
  const c = lazyClient(() => ({ state: "ready", runId: "new-owner-run", deadline: new Date(Date.now() + 60000).toISOString() }));
  await expect(runGoogleStandingPipeline(input(c.client), binding, async () => { throw new Error("lost_response"); }))
    .rejects.toThrow("lost_response");
  expect(c.calls.map(c => c.name)).toEqual(["lean_google_standing_next"]);
});
it("refuses an already aborted request before dispatch and bounds an uncooperative worker", async () => {
  const abort = new AbortController(); abort.abort();
  const c = lazyClient(() => ({ state: "ready", runId: "new-owner-run", deadline: new Date(Date.now() + 30).toISOString() }));
  await expect(runGoogleStandingPipeline(input(c.client), binding, undefined, abort.signal)).rejects.toThrow();
  expect(c.calls).toEqual([]);
  await expect(runGoogleStandingPipeline(input(c.client), binding, () => new Promise(() => {})))
    .rejects.toThrow("google_standing_aborted");
  expect(c.calls.map(c => c.name)).toEqual(["lean_google_standing_next"]);
});
it("reads the policy-selected current generation without legacy run/hash env, and refuses mixed config", async () => {
  const f = googleDeliveryFixture(), report = prepareGoogleDeliveryReport(f.input);
  const data = { google_account_daily: [{ ...report, is_stale: false,
    readiness: Object.fromEntries(Object.entries(report.readiness).map(([k, v]) => [k, v === "observed_unverified" ? "ready" : v])) }],
  google_delivery_status: { state: "selected", report_scope: "single_google_account", run_id: "google-fixture",
    result_hash: "a".repeat(32), row_hash: "b".repeat(32), selection_revision: "2", row_count: "1",
    atomic_resource_refresh: false, not_before: new Date(Date.now() - 1000).toISOString(),
    expires_at: new Date(Date.now() + 60000).toISOString() } };
  const env = { LEAN_GOOGLE_DELIVERY_ENABLED: "true", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
    LEAN_GOOGLE_DELIVERY_SECRET: "fixture-only-google-delivery-32-characters",
    LEAN_GOOGLE_STANDING_ENABLED: "true", LEAN_GOOGLE_STANDING_POLICY_ID: "fixture-policy",
    LEAN_GOOGLE_STANDING_POLICY_REVISION: "1", LEAN_GOOGLE_DELIVERY_ACCOUNT_ID: "1234567890",
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project, LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`,
    LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "fixture-not-a-secret" };
  const req = new Request(`https://fixture.invalid${googleDeliveryPath}`,
    { headers: { authorization: `Bearer ${env.LEAN_GOOGLE_DELIVERY_SECRET}` } });
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toContain("/rpc/lean_google_standing_read");
    expect(JSON.parse(String(init?.body))).toEqual({ p_project_ref: project, p_policy: "fixture-policy",
      p_revision: "1", p_account_id: "1234567890" });
    return Response.json(data);
  });
  expect((await googleDeliveryGet(req, env, transport)).status).toBe(200);
  expect((await googleDeliveryGet(req, { ...env, LEAN_GOOGLE_DELIVERY_RUN_ID: "legacy" }, transport)).status).toBe(503);
  expect(transport).toHaveBeenCalledTimes(1);
  expect((await googleDeliveryGet(req, env, async () => Response.json(null))).status).toBe(503);
});
