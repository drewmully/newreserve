import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHash, randomUUID } from "node:crypto";
import { NextRequest } from "next/server";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
const ports = vi.hoisted(() => ({ rpc: vi.fn(), legacy: vi.fn(async () => undefined) }));
vi.mock("@/lib/analytics/serverClient", () => ({
  getAnalyticsSupabase: () => ({
    rpc: (name: string, args: Record<string, unknown>) => ({ abortSignal: () => ports.rpc(name, args) }),
  }),
}));
vi.mock("@/lib/firebase-admin", () => ({ adminAuth: {}, adminDb: {} }));
vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: () => ({ allowed: true }) }));
vi.mock("@/app/api/_lib/analytics", () => ({ dispatchAnalyticsEvent: ports.legacy }));
vi.mock("@/app/api/_lib/aiSalesAgents", () => ({ recordAISalesSignal: ports.legacy }));
vi.mock("@/app/api/_lib/kpiReporting", () => ({
  aggregateKpiDaily: ports.legacy, aggregateSegmentActivity: ports.legacy, persistAnalyticsEvent: ports.legacy,
}));
import { POST } from "@/app/api/analytics/track/route";
import { decideJourney } from "@/lib/analytics/journeyDecision";
import { attachJourneyDraft } from "@/lib/analytics/journeyRuntime";
import { reserveRuntime as target } from "@/lib/analytics/journeyPolicyRuntime";

let db: PGlite;
const key = "fixture-only-not-a-provider-key";
const provider = vi.fn<typeof fetch>(async url => {
  expect(url).toBe("https://us.i.posthog.com/capture/");
  return new Response(null, { status: 204 });
});
const founders = { source: "reserve_founders_lp", plan: "member", method: "shopify_checkout" };
function request(properties: Record<string, unknown>, token?: string, name = "checkout_clicked",
  headers: Record<string, string> = {}) {
  return new NextRequest(`${target.origin}/api/analytics/track`, { method: "POST",
    headers: { origin: target.origin, "content-type": "application/json",
      ...(token ? { cookie: `__Host-mully_analytics=${token}` } : {}), ...headers },
    body: JSON.stringify({ event_name: name, properties: { event_id: `evt-${randomUUID()}`, ...properties } }),
  });
}
const allow = async () => (await decideJourney(request({}), "allow")).token;
beforeAll(async () => {
  db = new PGlite();
  await db.exec("create role anon; create role authenticated; create role service_role;");
  for (const name of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs",
    "019_spend_jobs", "020_observed_report_jobs", "021_full_report_jobs", "022_full_release",
    "023_posthog_export", "026_journey_authority", "029_journey_decisions", "030_scoped_release",
    "031_draft_receipts", "037_canonical_journey_timestamps"])
    await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
  await db.exec(readFileSync("sql/analytics/proposed_journey_runtime_policy.sql", "utf8"));
}, 30000);
beforeEach(async () => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", provider);
  const env = { VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
    LEAN_ANALYTICS_JOURNEYS_ENABLED: "false", LEAN_ANALYTICS_PIPELINE_PROJECT_REF: target.project,
    LEAN_ANALYTICS_SUPABASE_URL: `https://${target.project}.supabase.co`,
    LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "fixture-only", LEAN_POSTHOG_CAPTURE_KEY: key };
  Object.entries(env).forEach(([k, v]) => vi.stubEnv(k, v));
  await db.exec("truncate lean_private.journey_grants cascade; delete from lean_private.journey_policies");
  await db.query(`insert into lean_private.journey_policies
    (project_ref,shop,posthog_project,policy_version,approval_ref,ttl_seconds,enabled,
      runtime_capture_key_sha256,runtime_valid_until)
    values($1,$2,$3,$4,'fixture:only',3600,true,$5,clock_timestamp()+interval '1 hour')`,
  [target.project, target.shop, target.posthog, target.policy, createHash("sha256").update(key).digest("hex")]);
  ports.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (!/^lean_journey_(runtime_(config|issue|grant|action)|issue|grant|action|withdraw)$/.test(name))
      throw Error("unexpected_rpc");
    const entries = Object.entries(args);
    try {
      await db.exec("set role service_role");
      const rows = await db.query<{ value: unknown }>(`select public.${name}(${
        entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) value`, entries.map(([, v]) => v));
      return { data: JSON.parse(JSON.stringify(rows.rows[0].value)), error: null };
    } catch (error) { return { data: null, error }; }
    finally { await db.exec("reset role"); }
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(async () => db?.close());

it("does not count generic shop carts, access plans or missing/unknown producer context as Reserve", async () => {
  const token = await allow();
  const variants = [
    { source: "shop_cart", plan: "member" }, { source: "slide_cart", plan: "member" },
    { source: "choose_plan", plan: "access" }, { source: "unknown", plan: "member" }, {},
    { source: "reserve_founders_lp", plan: "member" },
    { source: "reserve_founders_lp", plan: "member", method: "other" },
    { source: ["choose_plan"], plan: "member" },
  ];
  for (const context of variants) expect((await POST(request(context, token))).status).toBe(200);
  expect(provider).not.toHaveBeenCalled();
  expect((await db.query("select count(*)::int n from lean_private.journey_actions")).rows).toEqual([{ n: 0 }]);
  expect(ports.legacy).toHaveBeenCalledTimes(variants.length * 5);
});
it.each([founders, { source: "choose_plan", plan: "member" }])(
  "accepts existing Reserve intent through the actual track route without adding producer fields: %j", async context => {
    const token = await allow();
    expect((await POST(request(context, token))).status).toBe(200);
    expect(provider).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(String(provider.mock.calls[0][1]?.body));
    expect(payload.event).toBe("lean_reserve_checkout");
    expect(Object.keys(payload.properties).sort()).toEqual(
      ["$insert_id", "$process_person_profile", "$session_id", "analytics_permitted",
        "collection_version", "distinct_id", "journey", "step"].sort());
    expect((await db.query("select family from lean_private.journey_actions")).rows)
      .toEqual([{ family: "lean_reserve_checkout" }]);
    expect(ports.legacy).toHaveBeenCalledTimes(5);
  });
it("does not turn producer context into consent", async () => {
  expect((await POST(request(founders))).status).toBe(200);
  expect(provider).not.toHaveBeenCalled();
  expect((await db.query("select count(*)::int n from lean_private.journey_grants")).rows).toEqual([{ n: 0 }]);
});
it("preserves GPC, DNT, strict origin and real grant withdrawal", async () => {
  const token = await allow();
  const signals: Record<string, string>[] = [{ "sec-gpc": "1" }, { dnt: "1" }, { origin: "https://other.invalid" }];
  for (const headers of signals)
    expect((await POST(request(founders, token, "checkout_clicked", headers))).status).toBe(200);
  await decideJourney(request({}, token), "withdraw");
  expect((await POST(request(founders, token))).status).toBe(200);
  expect(provider).not.toHaveBeenCalled();
});
it("keeps the new outfit event explicitly withheld rather than expanding legacy dispatch", async () => {
  const token = await allow();
  expect((await POST(request({ source: "shop_guided_outfit" }, token, "shop_outfit_reserve_clicked"))).status).toBe(400);
  expect(provider).not.toHaveBeenCalled();
  expect(ports.legacy).not.toHaveBeenCalled();
});
it("does not unlock the marked checkout bridge after a valid Reserve intent", async () => {
  const token = await allow();
  expect((await POST(request(founders, token))).status).toBe(200);
  expect(await attachJourneyDraft(request({}, token), "123", target.shop, "fixture-user")).toBe(false);
  expect((await db.query("select count(*)::int n from lean_private.draft_receipts")).rows).toEqual([{ n: 0 }]);
  expect(provider).toHaveBeenCalledTimes(1);
});
it("preserves enabled legacy environment capture for generic checkout producers", async () => {
  await db.query(`insert into lean_private.journey_policies
    (project_ref,shop,posthog_project,policy_version,approval_ref,ttl_seconds,enabled)
    values($1,$2,$3,'fixture:legacy','fixture:legacy',3600,true)`, [target.project, target.shop, target.posthog]);
  for (const [k, v] of Object.entries({ LEAN_ANALYTICS_JOURNEYS_ENABLED: "true",
    LEAN_SHOPIFY_SHOP_DOMAIN: target.shop, LEAN_POSTHOG_PROJECT_ID: target.posthog,
    LEAN_ANALYTICS_PERMISSION_POLICY: "fixture:legacy", LEAN_POSTHOG_CAPTURE_ORIGIN: target.captureOrigin }))
    vi.stubEnv(k, v);
  const token = await allow();
  expect((await POST(request({ source: "shop_cart" }, token))).status).toBe(200);
  expect(provider).toHaveBeenCalledTimes(1);
  expect(ports.rpc.mock.calls.some(([name]) => String(name).startsWith("lean_journey_runtime_"))).toBe(false);
});
