import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prepareRefresh } from "@/lib/analytics/refreshPlan";
import { refreshFixture } from "../fixtures/analyticsRefresh";
import { fullProject } from "../fixtures/analyticsFull";
import { POST } from "@/app/api/analytics/ingest/refresh/route";
import { runRefreshPipeline } from "@/lib/analytics/refreshPipeline";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
const mocks = vi.hoisted(() => ({ run: vi.fn(), client: null as AnalyticsRpcClient | null }));
vi.mock("@/lib/analytics/fullPipeline", () => ({ runFullPipeline: mocks.run }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => mocks.client }));
let db: PGlite;
const client: AnalyticsRpcClient = { async rpc(name, args) {
  if (!["lean_refresh_claim", "lean_refresh_finish"].includes(name)) throw new Error("unknown_rpc");
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
    "024_full_orchestration", "025_refresh_queue"]) await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
}, 30000);
beforeEach(async () => {
  mocks.client = client; mocks.run.mockReset().mockResolvedValue({ state: "partial" });
  vi.stubGlobal("fetch", () => { throw new Error("external_network_forbidden"); });
  await db.exec(`truncate lean_private.refresh_queue; truncate lean_private.full_builds cascade;
    truncate lean_private.report_builds cascade; truncate lean_private.spend_jobs;
    truncate lean_private.history_jobs cascade; truncate lean_private.refresh_limits;
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
