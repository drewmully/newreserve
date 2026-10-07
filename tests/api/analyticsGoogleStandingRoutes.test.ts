import { NextRequest } from "next/server";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { POST } from "@/app/api/analytics/ingest/full/route";
import { GET } from "@/app/api/analytics/ingest/health/route";
const mock = vi.hoisted(() => ({ run: vi.fn(), standing: vi.fn(), rpc: vi.fn() }));
vi.mock("@/lib/analytics/fullPipeline", () => ({ runFullPipeline: mock.run }));
vi.mock("@/lib/analytics/googleStandingOperation", () => ({ runGoogleStandingPipeline: mock.standing }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => ({ rpc: mock.rpc }) }));
const project = "xnfjdbpjuaezxjgargto", secret = "fixture-route-secret-32-characters";
const req = (path: string, method = "GET", auth = secret) => new NextRequest(`https://fixture.invalid/api/analytics/ingest/${path}`,
  { method, headers: { authorization: `Bearer ${auth}` } });
beforeEach(() => {
  vi.resetAllMocks();
  for (const [k, v] of Object.entries({
    LEAN_ANALYTICS_FULL_ENABLED: "true", LEAN_ANALYTICS_FULL_SECRET: secret,
    LEAN_ANALYTICS_MONITOR_ENABLED: "true", LEAN_ANALYTICS_MONITOR_SECRET: secret,
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project, LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`,
    LEAN_SHOPIFY_SHOP_DOMAIN: "mullybox-store.myshopify.com", LEAN_GOOGLE_STANDING_ENABLED: "",
    LEAN_ANALYTICS_FULL_RUN_ID: "legacy-run",
  })) vi.stubEnv(k, v);
  mock.run.mockResolvedValue({ state: "partial" });
  mock.standing.mockResolvedValue({ state: "complete" });
  mock.rpc.mockResolvedValue({ data: { state: "healthy", issues: [], posthogReadbackVerified: false }, error: null });
});
afterEach(() => vi.unstubAllEnvs());
function standing() {
  vi.stubEnv("LEAN_GOOGLE_STANDING_ENABLED", "true");
  vi.stubEnv("LEAN_GOOGLE_STANDING_POLICY_ID", "fixture-policy");
  vi.stubEnv("LEAN_GOOGLE_STANDING_POLICY_REVISION", "1");
  vi.stubEnv("LEAN_ANALYTICS_FULL_RUN_ID", "");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("VERCEL_GIT_COMMIT_REF", "main");
}
it("leaves the unbound full and monitor branches unchanged", async () => {
  expect(await (await POST(req("full", "POST"))).json()).toEqual({ state: "partial" });
  expect(mock.run).toHaveBeenCalledTimes(1);
  expect(mock.run.mock.calls[0][0].runId).toBe("legacy-run");
  expect(mock.standing).not.toHaveBeenCalled();
  expect(await (await GET(req("health"))).json()).toEqual({ state: "healthy", issues: [], posthogReadbackVerified: false });
  expect(mock.rpc.mock.calls.map(c => c[0])).toEqual(["lean_refresh_health"]);
});
it("dispatches only the explicitly bound production policy and rejects auth or mixed legacy config", async () => {
  standing();
  expect((await POST(req("full", "POST", "wrong"))).status).toBe(401);
  expect(mock.standing).not.toHaveBeenCalled();
  expect((await POST(req("full", "POST"))).status).toBe(200);
  expect(mock.standing.mock.calls[0][1]).toEqual({ policy: "fixture-policy", revision: "1" });
  expect(mock.run).not.toHaveBeenCalled();
  vi.stubEnv("LEAN_ANALYTICS_FULL_RUN_ID", "legacy-run");
  expect((await POST(req("full", "POST"))).status).toBe(503);
  vi.stubEnv("LEAN_ANALYTICS_FULL_RUN_ID", "");
  vi.stubEnv("VERCEL_ENV", "preview");
  expect((await POST(req("full", "POST"))).status).toBe(503);
  expect(mock.standing).toHaveBeenCalledTimes(1);
});
it("adds expiry and missing dedicated import proof without promoting other families", async () => {
  standing();
  mock.rpc.mockImplementation(async name => ({ data: name === "lean_refresh_health"
    ? { state: "attention", issues: ["stale:store_daily"], posthogReadbackVerified: false }
    : { state: "attention", issues: ["google_selection_expired", "google_import_unverified"],
      googleImportAcceptanceVerified: false, posthogReadbackVerified: false }, error: null }));
  const response = await GET(req("health"));
  expect(response.status).toBe(503);
  expect(await response.json()).toEqual({ state: "attention",
    issues: ["google_import_unverified", "google_selection_expired", "stale:store_daily"],
    googleImportAcceptanceVerified: false, posthogReadbackVerified: false });
  expect(mock.rpc.mock.calls.map(c => c[0])).toEqual(["lean_refresh_health", "lean_google_standing_health"]);
});
it("refuses a false healthy Google assertion", async () => {
  standing();
  mock.rpc.mockImplementation(async name => ({ data: name === "lean_refresh_health"
    ? { state: "healthy", issues: [] }
    : { state: "healthy", issues: ["google_import_unverified"], googleImportAcceptanceVerified: false }, error: null }));
  expect(await (await GET(req("health"))).json()).toEqual({ state: "unavailable" });
});
