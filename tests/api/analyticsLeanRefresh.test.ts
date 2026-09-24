import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prepareRefresh } from "@/lib/analytics/refreshPlan";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { refreshFixture } from "../fixtures/analyticsRefresh";
import { inventoryFixture } from "../fixtures/analyticsDiscovery";
import { fullProject } from "../fixtures/analyticsFull";
import { POST } from "@/app/api/analytics/ingest/refresh/route";
import { GET as healthGET } from "@/app/api/analytics/ingest/health/route";
import { runRefreshPipeline } from "@/lib/analytics/refreshPipeline";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
const mocks = vi.hoisted(() => ({ run: vi.fn(), client: null as AnalyticsRpcClient | null }));
vi.mock("@/lib/analytics/fullPipeline", () => ({ runFullPipeline: mocks.run }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => mocks.client }));
let db: PGlite;
const client: AnalyticsRpcClient = { async rpc(name, args) {
  if (!["lean_refresh_claim", "lean_refresh_finish", "lean_refresh_health"].includes(name)) throw new Error("unknown_rpc");
  const entries = Object.entries(args);
  try {
    const result = await db.query<{ result: unknown }>(`select public.${name}(${
      entries.map(([name], i) => `${name}=>$${i + 1}`).join(",")}) result`,
    entries.map(([, value]) => value));
    return { data: result.rows[0].result, error: null };
  } catch (error) { return { data: null, error }; }
} };
const options = () => ({
  client, projectRef: fullProject, databaseUrl: `https://${fullProject}.supabase.co`,
  shop: "fixture.myshopify.com", shopifyToken: "fixture", posthogKey: "fixture",
  googleClientId: "fixture", googleClientSecret: "fixture", googleRefreshToken: "fixture",
  now: new Date().toISOString(),
});
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role service_role; create role anon; create role authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const name of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs", "019_spend_jobs",
    "020_observed_report_jobs", "021_full_report_jobs", "022_full_release", "023_posthog_export",
    "024_full_orchestration", "025_refresh_queue", "027_history_update_scans", "028_refresh_health",
    "034_commerce_only_refresh", "035_discovery_inventory_fence"])
    await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
}, 30000);
beforeEach(async () => {
  mocks.client = client; mocks.run.mockReset().mockResolvedValue({ state: "partial" });
  vi.stubGlobal("fetch", () => { throw new Error("external_network_forbidden"); });
  await db.exec(`truncate lean_private.refresh_queue; truncate lean_private.full_builds cascade;
    truncate lean_private.report_builds cascade; truncate lean_private.spend_jobs;
    truncate lean_private.history_jobs cascade; truncate lean_private.refresh_limits; truncate lean_private.refresh_monitor_targets;
    truncate lean_private.publications cascade`);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(async () => { await db?.close(); });
async function register() {
  const bundle = prepareRefresh(refreshFixture());
  await db.query("select public.lean_refresh_register($1)", [JSON.stringify(bundle)]);
  return bundle;
}
async function activate(run: string, budget = 5) {
  await db.query(`insert into lean_private.refresh_limits(project_ref,enabled,max_daily_steps,approval_ref,actor_ref)
    values($1,true,$2,'fixture:approval','fixture:actor')`, [fullProject, budget]);
  await db.query("update lean_private.refresh_queue set enabled=true where run_id=$1", [run]);
  await db.exec(`update lean_private.full_builds set enabled=true; update lean_private.report_builds set enabled=true;
    update lean_private.history_jobs set enabled=true; update lean_private.spend_jobs set enabled=true`);
}
it("prepares deterministic fresh-evidence revisions instead of mutating completed snapshots", () => {
  const input = refreshFixture(), a = prepareRefresh(input);
  expect(prepareRefresh(input)).toEqual(a);
  input.revision = "fixture-v2";
  expect(prepareRefresh(input).runId).not.toBe(a.runId);
  expect(a.history).toHaveLength(1); expect(a.spend).toHaveLength(1);
  expect(a.full.evidence.ref).toContain(a.evidenceDigest);
});
it("registers and replays the sealed inventory as immutable hashed base policy", async () => {
  const input = refreshFixture(), inventory = inventoryFixture();
  input.commercePolicy.sourceInventory = inventory;
  input.history = inventory.windows.map(({ from, until, pageSize, maxPages }) => ({ from, until, pageSize, maxPages }));
  // Fixture capture is independent of wall-clock test execution.
  inventory.capturedAt = input.intake.asOf;
  const { digest: ignored, ...payload } = inventory;
  expect(ignored).toMatch(/^[a-f0-9]{64}$/);
  inventory.digest = evidenceDigest(payload);
  const bundle = prepareRefresh(input);
  await db.query("select public.lean_refresh_register($1)", [JSON.stringify(bundle)]);
  await db.query("select public.lean_refresh_register($1)", [JSON.stringify(bundle)]);
  expect((await db.query("select policy->'sourceInventory' inventory,enabled from lean_private.report_builds")).rows)
    .toEqual([{ inventory, enabled: false }]);
  await expect(db.exec("update lean_private.report_builds set policy=policy-'sourceInventory'"))
    .rejects.toThrow("immutable");
});
it("reports unconfigured and missing expected work instead of treating no data as healthy", async () => {
  const args = { p_project_ref: fullProject, p_shop: "fixture.myshopify.com" };
  expect((await client.rpc("lean_refresh_health", args)).data).toMatchObject({ state: "unconfigured" });
  await db.query(`insert into lean_private.refresh_monitor_targets
    (project_ref,shop,enabled,max_candidate_age_seconds,max_export_age_seconds,approval_ref,actor_ref)
    values($1,$2,true,3600,7200,'fixture','fixture')`, Object.values(args));
  const result = (await client.rpc("lean_refresh_health", args)).data;
  expect(result).toMatchObject({ state: "attention", posthogReadbackVerified: false,
    issues: ["refresh_disabled", "no_completed_candidate", "full_selection_missing_or_mixed"] });
  expect(JSON.stringify(result)).not.toMatch(/customer|uid|token|secret/i);
});
it("reports stuck leases and exhausted daily budgets without changing the queue", async () => {
  const bundle = await register(); await activate(bundle.runId, 1);
  await db.query(`insert into lean_private.refresh_monitor_targets
    (project_ref,shop,enabled,max_candidate_age_seconds,max_export_age_seconds,require_export,approval_ref,actor_ref)
    values($1,$2,true,3600,7200,false,'fixture','fixture')`, [fullProject, "fixture.myshopify.com"]);
  await db.query("select public.lean_refresh_claim($1,$2)", [fullProject, randomUUID()]);
  await db.exec("update lean_private.refresh_queue set lease_until=clock_timestamp()-interval '1 second'");
  const before = (await db.query("select * from lean_private.refresh_queue")).rows;
  const result = (await client.rpc("lean_refresh_health", { p_project_ref: fullProject, p_shop: "fixture.myshopify.com" })).data;
  expect(result).toMatchObject({ state: "attention", counts: { ambiguous: 1 } });
  expect((result as { issues: string[] }).issues).toContain("daily_budget_exhausted");
  expect((await db.query("select * from lean_private.refresh_queue")).rows).toEqual(before);
  expect((await db.query(`select r,has_function_privilege(r,'public.lean_refresh_health(text,text)','execute') allowed,
    has_table_privilege(r,'lean_private.refresh_monitor_targets','update') configure
    from unnest(array['anon','authenticated','service_role','lean_posthog_reader']) r`)).rows).toEqual([
    { r: "anon", allowed: false, configure: false }, { r: "authenticated", allowed: false, configure: false },
    { r: "service_role", allowed: true, configure: false }, { r: "lean_posthog_reader", allowed: false, configure: false },
  ]);
});
it("protects the read-only health endpoint with a separate secret and fixed target", async () => {
  const req = (query = "", auth = "x".repeat(32)) => new NextRequest(`https://fixture.invalid/api/analytics/ingest/health${query}`,
    { headers: { authorization: `Bearer ${auth}` } });
  expect((await healthGET(req())).status).toBe(404);
  vi.stubEnv("LEAN_ANALYTICS_MONITOR_ENABLED", "true");
  vi.stubEnv("LEAN_ANALYTICS_MONITOR_SECRET", "x".repeat(32));
  vi.stubEnv("LEAN_ANALYTICS_PIPELINE_PROJECT_REF", fullProject);
  vi.stubEnv("LEAN_ANALYTICS_SUPABASE_URL", `https://${fullProject}.supabase.co`);
  vi.stubEnv("LEAN_SHOPIFY_SHOP_DOMAIN", "fixture.myshopify.com");
  expect((await healthGET(req("", "wrong"))).status).toBe(401);
  expect((await healthGET(req("?project=other"))).status).toBe(400);
  const response = await healthGET(req());
  expect(response.status).toBe(503);
  expect(response.headers.get("cache-control")).toBe("no-store");
  expect(await response.json()).toMatchObject({ state: "unconfigured" });
});
it.each([0, 172800])("checks source vintage rather than completion/export time (age %s)", async age => {
  const bundle = await register(); await activate(bundle.runId);
  await db.query(`insert into lean_private.refresh_monitor_targets
    (project_ref,shop,enabled,max_candidate_age_seconds,max_export_age_seconds,approval_ref,actor_ref)
    values($1,$2,true,3600,7200,'fixture','fixture')`, [fullProject, "fixture.myshopify.com"]);
  // An owner-created synthetic record, not a production permission bypass.
  await db.query(`insert into lean_private.full_builds
    (run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,enabled,completed_at,result_hash)
    select 'fixture:old',project_ref,base_run,
      jsonb_set(policy,'{asOf}',to_jsonb((clock_timestamp()-make_interval(secs=>$2))::text)),
      evidence,behavior,approval_ref,actor_ref,true,clock_timestamp(),'fixture'
    from lean_private.full_builds where run_id=$1`, [bundle.runId, age]);
  await db.exec(`insert into lean_private.publications(publication_id,contract_version) values('full:fixture:old','fixture');
    insert into lean_private.certifications(publication_id,domain,evidence_ref,source_reconciliation_ref,approved_by)
      select 'full:fixture:old',d,'fixture','fixture','fixture' from unnest(array[
        'store_daily','product_daily','acquisition_daily','customer_cohorts','funnel_daily']) d;
    update lean_private.publications set state='certified',evidence_ref='fixture' where publication_id='full:fixture:old';
    insert into lean_private.selected_publications(domain,publication_id)
      select domain,publication_id from lean_private.certifications;
    insert into lean_private.export_audit(publication_id,approval_ref,actor_ref,row_counts)
      values('full:fixture:old','fixture','fixture','{}')`);
  const result = (await client.rpc("lean_refresh_health",
    { p_project_ref: fullProject, p_shop: "fixture.myshopify.com" })).data;
  expect(result).toMatchObject(age
    ? { state: "attention", issues: ["candidate_stale", "selected_candidate_stale"] }
    : { state: "healthy", issues: [], posthogReadbackVerified: false });
  if (!age) {
    await db.exec("update lean_private.selected_publications set is_stale=true where domain='store_daily'");
    const stale = (await client.rpc("lean_refresh_health",
      { p_project_ref: fullProject, p_shop: "fixture.myshopify.com" })).data;
    expect(stale).toMatchObject({ state: "attention", issues: ["selected_candidate_stale"] });
  }
});
it("registers creation and late-update scans as separate immutable source jobs", async () => {
  const input = refreshFixture();
  input.history.push({ ...input.history[0], scanBasis: "updated_at" });
  input.maxSteps = 128;
  const bundle = prepareRefresh(input);
  await db.query("select public.lean_refresh_register($1)", [JSON.stringify(bundle)]);
  expect((await db.query("select scan_basis from lean_private.history_jobs order by scan_basis")).rows)
    .toEqual([{ scan_basis: "created_at" }, { scan_basis: "updated_at" }]);
  input.history.push({ ...input.history[1] });
  expect(() => prepareRefresh(input)).toThrow("overlapping");
});
it("refuses stale evidence, overlapping windows, duplicate accounts and undersized budgets", () => {
  for (const mutate of [
    (f: ReturnType<typeof refreshFixture>) => { f.history.push(f.history[0]); },
    (f: ReturnType<typeof refreshFixture>) => { f.accounts.push(f.accounts[0]); },
    (f: ReturnType<typeof refreshFixture>) => { f.maxSteps = 3; },
    (f: ReturnType<typeof refreshFixture>) => { f.intake.bindings[0].maxAgeSeconds = 60; },
    (f: ReturnType<typeof refreshFixture>) => { f.policy.project = "999"; },
  ]) {
    const input = refreshFixture(); mutate(input);
    expect(() => prepareRefresh(input)).toThrow();
  }
});
it("registers the whole dependency graph disabled, idempotently and without sources or publication", async () => {
  const bundle = await register();
  await db.query("select public.lean_refresh_register($1)", [JSON.stringify(bundle)]);
  expect((await db.query("select count(*)::int n,bool_or(enabled) enabled from lean_private.history_jobs")).rows)
    .toEqual([{ n: 1, enabled: false }]);
  expect((await db.query("select count(*)::int n,bool_or(enabled) enabled from lean_private.full_builds")).rows)
    .toEqual([{ n: 1, enabled: false }]);
  expect((await db.query("select * from lean_private.publications")).rows).toEqual([]);
  expect(await runRefreshPipeline(options())).toEqual({ state: "disabled" });
  expect(mocks.run).not.toHaveBeenCalled();
});
it("registers explicit commerce-only scope without any behavior configuration", async () => {
  const input = refreshFixture(); input.policy.behaviorMode = "excluded";
  input.behavior = {} as typeof input.behavior;
  const bundle = prepareRefresh(input);
  expect(bundle.full.behavior).toEqual({});
  await db.query("select public.lean_refresh_register($1)", [JSON.stringify(bundle)]);
  await db.query("select public.lean_refresh_register($1)", [JSON.stringify(bundle)]);
  expect((await db.query("select enabled,behavior,policy->>'behaviorMode' mode from lean_private.full_builds")).rows)
    .toEqual([{ enabled: false, behavior: {}, mode: "excluded" }]);
  bundle.full.policy.behaviorMode = "required";
  await expect(db.query("select public.lean_refresh_register($1)", [JSON.stringify(bundle)]))
    .rejects.toThrow("conflict");
});
it.each(["unknown", "implicit-exclusion", "unexpected-source"])(
  "rejects invalid behavior scope at registration without saving dependencies: %s", async failure => {
    const input = refreshFixture(); input.policy.behaviorMode = "excluded";
    const bundle = prepareRefresh(input);
    if (failure === "unknown") bundle.full.policy.behaviorMode = "fallback" as "excluded";
    if (failure === "implicit-exclusion") delete bundle.full.policy.behaviorMode;
    if (failure === "unexpected-source") bundle.full.behavior = input.behavior;
    await expect(db.query("select public.lean_refresh_register($1)", [JSON.stringify(bundle)]))
      .rejects.toThrow(/behavior mode|dependencies/);
    expect((await db.query("select * from lean_private.history_jobs")).rows).toEqual([]);
    expect((await db.query("select * from lean_private.refresh_queue")).rows).toEqual([]);
  },
);
it("rejects conflicting registrations and rolls back a bad dependency", async () => {
  const bundle = await register();
  bundle.approvalRef = "fixture:changed";
  await expect(db.query("select public.lean_refresh_register($1)", [JSON.stringify(bundle)])).rejects.toThrow("conflict");
  const next = refreshFixture(); next.revision = "fixture-next";
  const bad = prepareRefresh(next); bad.full.projectRef = "b".repeat(20);
  await expect(db.query("select public.lean_refresh_register($1)", [JSON.stringify(bad)])).rejects.toThrow("dependencies");
  expect((await db.query("select count(*)::int n from lean_private.history_jobs")).rows).toEqual([{ n: 1 }]);
});
it("enforces runtime permissions even under broad hosted default grants", async () => {
  expect((await db.query(`select r,
    has_function_privilege(r,'public.lean_refresh_register(jsonb)','execute') register,
    has_function_privilege(r,'public.lean_refresh_claim(text,uuid)','execute') claim,
    has_table_privilege(r,'lean_private.refresh_queue','update') activate
    from unnest(array['anon','authenticated','service_role','lean_posthog_reader']) r`)).rows).toEqual([
    { r: "anon", register: false, claim: false, activate: false },
    { r: "authenticated", register: false, claim: false, activate: false },
    { r: "service_role", register: false, claim: true, activate: false },
    { r: "lean_posthog_reader", register: false, claim: false, activate: false },
  ]);
});
it("advances saved checkpoints within a project-wide daily budget", async () => {
  const bundle = await register(); await activate(bundle.runId, 1);
  expect(await runRefreshPipeline(options())).toEqual({ state: "partial" });
  expect(mocks.run.mock.calls[0][0].runId).toBe(bundle.runId);
  expect(await runRefreshPipeline(options())).toEqual({ state: "budget_exhausted" });
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
it("serializes queue claims and fences another token", async () => {
  const bundle = await register(); await activate(bundle.runId);
  const a = randomUUID(), b = randomUUID();
  expect((await client.rpc("lean_refresh_claim", { p_project_ref: fullProject, p_token: a })).data)
    .toMatchObject({ state: "claimed" });
  expect((await client.rpc("lean_refresh_claim", { p_project_ref: fullProject, p_token: b })).data)
    .toEqual({ state: "busy" });
  expect((await client.rpc("lean_refresh_finish", { p_project_ref: fullProject, p_run: bundle.runId,
    p_token: b, p_state: "partial" })).data).toBe(false);
});
it("blocks failures instead of silently retrying on every cron tick", async () => {
  const bundle = await register(); await activate(bundle.runId);
  mocks.run.mockResolvedValue({ state: "failed" });
  expect(await runRefreshPipeline(options())).toEqual({ state: "failed" });
  expect(await runRefreshPipeline(options())).toEqual({ state: "idle" });
  expect((await db.query("select status,last_state from lean_private.refresh_queue")).rows)
    .toEqual([{ status: "blocked", last_state: "failed" }]);
});
it("never replays an ambiguous source completion and requires completion proof", async () => {
  const bundle = await register(); await activate(bundle.runId);
  mocks.run.mockRejectedValue(new Error("lost-response"));
  await expect(runRefreshPipeline(options())).rejects.toThrow("ambiguous");
  expect(await runRefreshPipeline(options())).toEqual({ state: "busy" });
  expect(mocks.run).toHaveBeenCalledTimes(1);
});
it("does not accept false complete acknowledgements", async () => {
  const bundle = await register(); await activate(bundle.runId);
  mocks.run.mockResolvedValue({ state: "complete" });
  await expect(runRefreshPipeline(options())).rejects.toThrow("storage_unavailable");
  expect((await db.query("select status from lean_private.refresh_queue")).rows).toEqual([{ status: "queued" }]);
});
it("fences unleased or disabled refresh publications", async () => {
  const bundle = await register(); await activate(bundle.runId);
  await expect(db.query("insert into lean_private.publications(publication_id,contract_version) values($1,'lean-v1-draft.1')",
    [`full:${bundle.runId}`])).rejects.toThrow("expired or unleased");
});
it("keeps the refresh route off by default and rejects arbitrary scopes or body input", async () => {
  const req = (suffix = "", body?: string, secret = "x".repeat(32)) => new NextRequest(
    `https://fixture.invalid/api/analytics/ingest/refresh${suffix}`,
    { method: "POST", headers: { authorization: `Bearer ${secret}` }, ...(body ? { body } : {}) });
  expect((await POST(req())).status).toBe(404);
  vi.stubEnv("LEAN_ANALYTICS_REFRESH_ENABLED", "true"); vi.stubEnv("LEAN_ANALYTICS_REFRESH_SECRET", "x".repeat(32));
  expect((await POST(req("", undefined, "wrong"))).status).toBe(401);
  expect((await POST(req("?project=other"))).status).toBe(400);
  expect((await POST(req("", "{}"))).status).toBe(400);
});
