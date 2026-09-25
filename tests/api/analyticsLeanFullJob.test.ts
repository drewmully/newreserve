import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fullFixture, fullProject, fullShop } from "../fixtures/analyticsFull";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { POST } from "@/app/api/analytics/ingest/full/route";
import { readMullyCustomers, mapMullySource, mullyCustomerId } from "@/lib/analytics/mymullySource";
const port = vi.hoisted(() => ({ client: null as AnalyticsRpcClient | null }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => port.client }));
let db: PGlite;
const client: AnalyticsRpcClient = { async rpc(name, args) {
  if (!["lean_full_next", "lean_full_inputs", "lean_full_claim", "lean_full_fail", "lean_full_finish"].includes(name)) throw new Error("unknown_rpc");
  const entries = Object.entries(args);
  try {
    const result = await db.query<{ result: unknown }>(`select public.${name}(${
      entries.map(([name], i) => `${name}=>$${i + 1}`).join(",")}) result`,
    entries.map(([, v]) => typeof v === "object" ? JSON.stringify(v) : v));
    return { data: result.rows[0].result, error: null };
  } catch (error) { return { data: null, error }; }
} };
const options = () => ({ client, projectRef: fullProject, databaseUrl: `https://${fullProject}.supabase.co`,
  runId: "fixture", posthogKey: "fixture-key",
  request: vi.fn(async () => Response.json(fullFixture().wire)) });
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role service_role; create role anon; create role authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const migration of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs",
    "019_spend_jobs", "020_observed_report_jobs", "021_full_report_jobs", "022_full_release", "023_posthog_export",
    "024_full_orchestration", "026_journey_authority", "029_journey_decisions", "030_scoped_release"])
    await db.exec(readFileSync(`sql/analytics/${migration}.sql`, "utf8"));
}, 30000);
beforeEach(async () => {
  port.client = client;
  await db.exec("truncate lean_private.journey_grants cascade; truncate lean_private.journey_policies;");
  vi.stubGlobal("fetch", () => { throw new Error("external_network_forbidden"); });
  await db.exec("truncate lean_private.full_builds; truncate lean_private.report_builds cascade; truncate lean_private.publications cascade;");
  await db.exec("truncate lean_private.history_jobs cascade; truncate lean_private.spend_jobs");
  await db.exec("truncate lean_export.store_daily,lean_export.product_daily,lean_export.acquisition_daily,lean_export.customer_cohorts,lean_export.funnel_daily");
  const f = fullFixture();
  await db.query(`insert into lean_private.report_builds
    (run_id,project_ref,shop,history_runs,from_date,through_date,policy,approval_ref,actor_ref,enabled,completed_at,result_hash)
    values('base',$1,$2,array['fixture-history'],'2026-01-01','2026-01-01','{}','fixture:approval','fixture:actor',true,now(),'fixture')`,
  [fullProject, fullShop]);
  await db.exec("insert into lean_private.publications(publication_id,contract_version) values('observed:base','lean-v1-draft.1')");
  for (const [table, rows] of Object.entries(f.base))
    await db.query(`insert into lean_private.${table} select * from jsonb_populate_recordset(null::lean_private.${table},$1)`,
      [JSON.stringify(rows.map(r => ({ ...r, publication_id: "observed:base" })))]);
  await db.query(`insert into lean_private.full_builds
    (run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,enabled)
    values('fixture',$1,'base',$2,$3,$4,'fixture:approval','fixture:actor',true)`,
  [fullProject, JSON.stringify(f.policy), JSON.stringify(f.evidence), JSON.stringify(f.behavior)]);
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
afterAll(async () => { await db?.close(); });
it("runs the source reader through real SQL inserts for all five reports, without publishing", async () => {
  const opt = options();
  expect(await runFullReportJob(opt)).toMatchObject({ state: "complete",
    reports: { store_daily: 1, product_daily: 1, acquisition_daily: 1, customer_cohorts: 1, funnel_daily: 2 } });
  expect(opt.request).toHaveBeenCalledTimes(1);
  expect((await db.query("select * from lean_private.report_store_daily")).rows[0]).toMatchObject({
    eligible_orders: 1, collected_cash_usd: "20.000000", new_customers: 1, mer: "4.000000" });
  expect((await db.query("select * from lean_private.report_customer_cohorts")).rows[0]).toMatchObject({ revenue_ltv_usd: "20.000000" });
  expect((await db.query("select * from lean_analytics.store_daily")).rows).toEqual([]);
  expect((await db.query("select * from lean_private.certifications")).rows).toEqual([]);
  expect((await db.query<{ manifest: unknown }>("select manifest from lean_private.full_builds")).rows[0].manifest)
    .toMatchObject({ nativeEvents: 1, logicalEvents: 1 });
});
it("persists a custom conversion window in immutable policy without extending the event manifest", async () => {
  const f = fullFixture(), policy = { ...f.policy, conversionWindowDays: 2,
    definition: "fixture-two-day-v2", funnelVersion: "fixture-two-day-funnel-v2", asOf: "2026-01-04T11:00:00Z" };
  const behavior = { ...f.behavior, until: policy.asOf };
  await db.query(`insert into lean_private.full_builds
    (run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,enabled)
    values('custom-window',$1,'base',$2,$3,$4,'fixture:approval','fixture:actor',true)`,
  [fullProject, JSON.stringify(policy), JSON.stringify(f.evidence), JSON.stringify(behavior)]);
  expect(await runFullReportJob({ ...options(), runId: "custom-window" })).toMatchObject({ state: "complete" });
  const saved = (await db.query<{ policy: unknown; manifest: object }>(
    "select policy,manifest from lean_private.full_builds where run_id='custom-window'")).rows[0];
  expect(saved.policy).toEqual(policy);
  expect(Object.keys(saved.manifest).sort()).toEqual(["digest", "evidenceRef", "gates", "logicalEvents", "nativeEvents"]);
  expect((await db.query(`select funnel_version,conversion_window_complete,converted_session
    from lean_private.sessions where publication_id='full:custom-window'`)).rows).toEqual([{
    funnel_version: "fixture-two-day-funnel-v2", conversion_window_complete: true, converted_session: true,
  }]);
  expect((await db.query(`select definition_version from lean_private.report_funnel_daily
    where publication_id='full:custom-window' and stage_id='all_sessions'`)).rows)
    .toEqual([{ definition_version: "fixture-two-day-v2" }]);
  await expect(db.query(`update lean_private.full_builds set policy=$1 where run_id='custom-window'`,
    [JSON.stringify({ ...policy, conversionWindowDays: 3 })])).rejects.toThrow("immutable");
});
it("persists real-schema customer mappings through the full job without inventing complete customer history", async () => {
  const f = fullFixture();
  const snapshot = await readMullyCustomers({ projectRef: fullProject, shop: fullShop,
    capturedAt: f.policy.asOf, customerIds: ["123"], entities: ["shopify"] }, "fixture",
  async () => Response.json([{ id: "123", firebase_uid: "uid-fixture", entity: "shopify",
    created_at: "2025-01-01T00:00:00Z", updated_at: "2026-01-01T00:00:00Z" }],
  { headers: { "Content-Range": "0-0/1" } }));
  const mapped = mapMullySource({ snapshot, mappingVersion: f.policy.mappingVersion,
    orders: [{ shop: fullShop, apiVersion: "2026-07",
      order: { id: "gid://shopify/Order/1", customer: { id: "gid://shopify/Customer/123" } } }],
    permissions: [{ customerId: "123", from: "2025-01-01T00:00:00Z", to: null,
      permitted: true, removed: false, evidenceRef: "fixture:analytics-authority" }],
  });
  const evidence = { ...f.evidence, ...mapped, proofs: [], externalControls: {} };
  f.behavior.families.page_view.identityNamespace = "shopify_customer";
  f.wire.results[0][3] = "123";
  await db.exec("delete from lean_private.full_builds");
  await db.query(`insert into lean_private.full_builds
    (run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,enabled)
    values('fixture',$1,'base',$2,$3,$4,'fixture:approval','fixture:actor',true)`,
  [fullProject, JSON.stringify(f.policy), JSON.stringify(evidence), JSON.stringify(f.behavior)]);
  const opt = { ...options(), request: vi.fn(async () => Response.json(f.wire)) };
  expect(await runFullReportJob(opt)).toMatchObject({ state: "complete" });
  const canonical = mullyCustomerId(fullProject, fullShop, "123");
  expect((await db.query("select customer_id from lean_private.orders where publication_id='full:fixture'")).rows)
    .toEqual([{ customer_id: canonical }]);
  expect((await db.query("select customer_id,history_complete from lean_private.customers where publication_id='full:fixture'")).rows)
    .toEqual([{ customer_id: canonical, history_complete: false }]);
  expect((await db.query("select new_customers from lean_private.report_store_daily")).rows)
    .toEqual([{ new_customers: null }]);
  expect((await db.query("select * from lean_export.store_daily")).rows).toEqual([]);
});
it("does not query the vendor again after completion or while disabled/blocked", async () => {
  const opt = options(); await runFullReportJob(opt); await runFullReportJob(opt);
  expect(opt.request).toHaveBeenCalledTimes(1);
  await db.exec("update lean_private.full_builds set enabled=false");
  expect(await runFullReportJob(opt)).toEqual({ state: "disabled" });
  expect(opt.request).toHaveBeenCalledTimes(1);
});
it("builds explicitly scoped commerce without a PostHog key or request and keeps browser metrics withheld", async () => {
  const f = fullFixture();
  await db.exec("delete from lean_private.full_builds");
  await db.query(`insert into lean_private.full_builds
    (run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,enabled)
    values('fixture',$1,'base',$2,$3,'{}','fixture:approval','fixture:actor',true)`,
  [fullProject, JSON.stringify({ ...f.policy, behaviorMode: "excluded" }), JSON.stringify(f.evidence)]);
  const opt = { ...options(), posthogKey: "", request: vi.fn(async () => { throw new Error("no_vendor"); }) };
  expect(await runFullReportJob(opt)).toMatchObject({ state: "complete" });
  expect(opt.request).not.toHaveBeenCalled();
  expect((await db.query("select * from lean_private.report_store_daily")).rows[0]).toMatchObject({
    eligible_orders: 1, collected_cash_usd: "20.000000",
  });
  const manifest = (await db.query<{ manifest: { nativeEvents: number; gates: { gates: Record<string, boolean> }[] } }>(
    "select manifest from lean_private.full_builds")).rows[0].manifest;
  expect(manifest.nativeEvents).toBe(0);
  expect(manifest.gates[0].gates).toMatchObject({ behavior: false, attribution: false, orders: true });
  const funnels = (await db.query<{ readiness: Record<string, string> }>(
    "select readiness from lean_private.report_funnel_daily")).rows;
  expect(funnels.every(r => Object.values(r.readiness).every(v => v === "withheld"))).toBe(true);
  await expect(db.query(`select public.lean_scoped_release('fixture',$1,array['funnel_daily'],$2,
    'fixture:signoff','fixture:review','fixture:operator')`,
  [fullProject, JSON.stringify({ funnel_daily: null })])).rejects.toThrow();
  await db.query(`select public.lean_scoped_release('fixture',$1,array['store_daily'],$2,
    'fixture:signoff','fixture:review','fixture:operator')`,
  [fullProject, JSON.stringify({ store_daily: null })]);
  expect((await db.query("select domain from lean_private.selected_publications")).rows)
    .toEqual([{ domain: "store_daily" }]);
});
it("does not silently downgrade a required behavior source after an outage", async () => {
  const opt = { ...options(), request: vi.fn(async () => new Response(null, { status: 503 })) };
  await expect(runFullReportJob(opt)).rejects.toThrow("full_transform_unavailable");
  expect((await db.query("select * from lean_private.report_store_daily")).rows).toEqual([]);
  expect(opt.request).toHaveBeenCalledTimes(1);
});
it("rejects policy changes, wrong targets and runtime registration", async () => {
  await expect(db.exec("update lean_private.full_builds set policy='{}'")).rejects.toThrow("immutable");
  expect((await client.rpc("lean_full_inputs", { p_run: "fixture", p_project_ref: "b".repeat(20) })).error).toBeTruthy();
  expect((await db.query(`select r as role,
    has_function_privilege(r,'public.lean_full_inputs(text,text)','execute') as can_read,
    has_table_privilege(r,'lean_private.full_builds','insert') as can_register
    from unnest(array['anon','authenticated','service_role']) r`)).rows).toEqual([
    { role: "anon", can_read: false, can_register: false },
    { role: "authenticated", can_read: false, can_register: false },
    { role: "service_role", can_read: true, can_register: false },
  ]);
});
it("rolls back the entire batch when a report tries to self-certify", async () => {
  const wrapped: AnalyticsRpcClient = { async rpc(name, args) {
    if (name === "lean_full_finish") {
      const reports = structuredClone(args.p_reports) as Record<string, Record<string, unknown>[]>;
      reports.funnel_daily[0].readiness = { measured_sessions: "ready" };
      return client.rpc(name, { ...args, p_reports: reports });
    }
    return client.rpc(name, args);
  } };
  await expect(runFullReportJob({ ...options(), client: wrapped })).rejects.toThrow("storage_unavailable");
  expect((await db.query("select * from lean_private.publications where publication_id='full:fixture'")).rows).toEqual([]);
  expect((await db.query("select * from lean_private.report_store_daily")).rows).toEqual([]);
  expect((await db.query("select completed_at from lean_private.full_builds")).rows[0]).toEqual({ completed_at: null });
});
it("rechecks the base kill switch and input hash before committing", async () => {
  const wrapped: AnalyticsRpcClient = { async rpc(name, args) {
    if (name === "lean_full_finish") await db.exec("update lean_private.report_builds set enabled=false");
    return client.rpc(name, args);
  } };
  expect(await runFullReportJob({ ...options(), client: wrapped })).toMatchObject({ state: "changed" });
  expect((await db.query("select * from lean_private.publications where publication_id='full:fixture'")).rows).toEqual([]);
});
it("does not replay an ambiguous finish, and a retry observes the committed state", async () => {
  const wrapped: AnalyticsRpcClient = { async rpc(name, args) {
    const result = await client.rpc(name, args);
    if (name === "lean_full_finish") throw new Error("lost response");
    return result;
  } };
  await expect(runFullReportJob({ ...options(), client: wrapped })).rejects.toThrow("storage_unavailable");
  const opt = options();
  expect(await runFullReportJob(opt)).toEqual({ state: "complete" });
  expect(opt.request).not.toHaveBeenCalled();
});
it("keeps the new endpoint disabled and rejects arbitrary caller input", async () => {
  const req = (suffix = "", body?: string, secret = "x".repeat(32)) =>
    new NextRequest(`https://fixture.invalid/api/analytics/ingest/full${suffix}`, {
      method: "POST", headers: { authorization: `Bearer ${secret}` }, ...(body ? { body } : {}),
    });
  expect((await POST(req())).status).toBe(404);
  vi.stubEnv("LEAN_ANALYTICS_FULL_ENABLED", "true"); vi.stubEnv("LEAN_ANALYTICS_FULL_SECRET", "x".repeat(32));
  expect((await POST(req("", undefined, "wrong"))).status).toBe(401);
  expect((await POST(req("?project=other"))).status).toBe(400);
  expect((await POST(req("", "{}"))).status).toBe(400);
});
it("an authenticated completed-run check makes no external request", async () => {
  await runFullReportJob(options());
  for (const [name, value] of Object.entries({
    LEAN_ANALYTICS_FULL_ENABLED: "true", LEAN_ANALYTICS_FULL_SECRET: "x".repeat(32),
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: fullProject,
    LEAN_ANALYTICS_SUPABASE_URL: `https://${fullProject}.supabase.co`,
    LEAN_ANALYTICS_FULL_RUN_ID: "fixture",
  })) vi.stubEnv(name, value);
  const response = await POST(new NextRequest("https://fixture.invalid/api/analytics/ingest/full", {
    method: "POST", headers: { authorization: `Bearer ${"x".repeat(32)}` },
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual({ state: "complete" });
});
it("bounds paid query attempts and prevents a second worker from querying an active lease", async () => {
  await db.exec(`update lean_private.full_builds set lease_token='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    lease_until=now()+interval '1 minute'`);
  const opt = options();
  expect(await runFullReportJob(opt)).toEqual({ state: "busy_or_exhausted" });
  expect(opt.request).not.toHaveBeenCalled();
  await db.exec("update lean_private.full_builds set lease_until=null");
  const failed = { ...opt, request: vi.fn(async () => new Response(null, { status: 503 })) };
  for (let i = 0; i < 3; i++)
    await expect(runFullReportJob(failed)).rejects.toThrow("full_transform_unavailable");
  expect(await runFullReportJob(failed)).toEqual({ state: "busy_or_exhausted" });
  expect(failed.request).toHaveBeenCalledTimes(3);
});
it("keeps large decimal values exact across database JSON readback", async () => {
  await db.exec("update lean_private.payments set source_amount=12345678901234.123456");
  const result = await client.rpc("lean_full_inputs", { p_run: "fixture", p_project_ref: fullProject });
  expect(result.data).toMatchObject({ facts: { payments: [{ source_amount: "12345678901234.123456" }] } });
});
it("walks all saved dependencies in order, and validates the whole inventory before a source read", async () => {
  await db.exec("truncate lean_private.full_builds; truncate lean_private.report_builds cascade");
  await db.query(`insert into lean_private.history_jobs
    (run_id,project_ref,shop,from_time,until_time,page_size,max_pages,approval_ref,actor_ref,enabled)
    select h,$1,$2,'2026-01-01','2026-02-01',1,1,'fixture:approval','fixture:actor',true
      from unnest(array['h1','h2']) h`, [fullProject, fullShop]);
  await db.query(`insert into lean_private.spend_jobs
    (run_id,project_ref,account_id,report_date,max_pages,approval_ref,actor_ref,enabled)
    values('s1',$1,'1234567890','2026-01-01',1,'fixture:approval','fixture:actor',true)`, [fullProject]);
  await db.query(`insert into lean_private.report_builds
    (run_id,project_ref,shop,history_runs,spend_runs,from_date,through_date,policy,approval_ref,actor_ref,enabled)
    values('base',$1,$2,array['h1','h2'],array['s1'],'2026-01-01','2026-01-01','{}','fixture:a','fixture:a',true)`,
  [fullProject, fullShop]);
  const f = fullFixture();
  await db.query(`insert into lean_private.full_builds
    (run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,enabled)
    values('fixture',$1,'base',$2,$3,$4,'fixture:a','fixture:a',true)`,
  [fullProject, JSON.stringify(f.policy), JSON.stringify(f.evidence), JSON.stringify(f.behavior)]);
  const next = async () => (await client.rpc("lean_full_next", { p_run: "fixture", p_project_ref: fullProject })).data;
  expect(await next()).toMatchObject({ stage: "history", runId: "h1" });
  await db.exec("update lean_private.spend_jobs set enabled=false");
  expect(await next()).toEqual({ state: "blocked" });
  await db.exec("update lean_private.spend_jobs set enabled=true; update lean_private.history_jobs set complete=true where run_id='h1'");
  expect(await next()).toMatchObject({ stage: "history", runId: "h2" });
  await db.exec("update lean_private.history_jobs set complete=true");
  expect(await next()).toMatchObject({ stage: "spend", runId: "s1" });
  await db.exec("update lean_private.spend_jobs set base='{}'");
  expect(await next()).toMatchObject({ stage: "reports", runId: "base" });
  await db.exec("update lean_private.report_builds set completed_at=now(),result_hash='fixture'");
  expect(await next()).toMatchObject({ stage: "full", runId: "fixture" });
});
const emptyPrevious = { store_daily: null, acquisition_daily: null, product_daily: null, customer_cohorts: null, funnel_daily: null };
it("requires a separate operator release, then selects all five domains atomically", async () => {
  await runFullReportJob(options());
  expect((await db.query(`select has_function_privilege('service_role',
    'public.lean_full_release(text,text,jsonb,text,text,text)','execute') as allowed`)).rows).toEqual([{ allowed: false }]);
  await db.query("select public.lean_full_release('fixture',$1,$2,'fixture:signoff','fixture:independent-review','fixture:operator')",
    [fullProject, JSON.stringify(emptyPrevious)]);
  expect((await db.query("select count(*)::int n from lean_private.selected_publications")).rows[0]).toEqual({ n: 5 });
  expect((await db.query("select * from lean_analytics.store_daily")).rows[0]).toMatchObject({
    is_stale: false, mer: "4.000000", readiness: expect.objectContaining({ mer: "ready" }) });
  await expect(db.exec("update lean_private.report_store_daily set mer=99")).rejects.toThrow("immutable");
});
it("rolls back all release changes on a stale expected selection", async () => {
  await runFullReportJob(options());
  await expect(db.query("select public.lean_full_release('fixture',$1,$2,'fixture:signoff','fixture:review','fixture:operator')",
    [fullProject, JSON.stringify({ ...emptyPrevious, funnel_daily: "old-wrong" })])).rejects.toThrow("selection changed");
  expect((await db.query("select * from lean_private.selected_publications")).rows).toEqual([]);
  expect((await db.query("select * from lean_private.certifications")).rows).toEqual([]);
  expect((await db.query("select state from lean_private.publications where publication_id='full:fixture'")).rows)
    .toEqual([{ state: "candidate" }]);
});
it("exports only a reviewed selection and gives the dormant PostHog role read-only report access", async () => {
  await runFullReportJob(options());
  await expect(db.query("select public.lean_full_export('fixture',$1,'fixture:export','fixture:operator')",
    [fullProject])).rejects.toThrow("selection");
  await db.query("select public.lean_full_release('fixture',$1,$2,'fixture:signoff','fixture:review','fixture:operator')",
    [fullProject, JSON.stringify(emptyPrevious)]);
  const result = await db.query<{ counts: unknown }>(
    "select public.lean_full_export('fixture',$1,'fixture:export','fixture:operator') counts", [fullProject]);
  expect(result.rows[0].counts).toEqual({ store_daily: 1, product_daily: 1, acquisition_daily: 1,
    customer_cohorts: 1, funnel_daily: 2 });
  expect((await db.query("select rolcanlogin,rolsuper,rolreplication,rolbypassrls from pg_roles where rolname='lean_posthog_reader'"))
    .rows[0]).toEqual({ rolcanlogin: false, rolsuper: false, rolreplication: false, rolbypassrls: false });
  await db.exec("set role lean_posthog_reader");
  try {
    expect((await db.query("select mer from lean_export.store_daily")).rows[0]).toEqual({ mer: "4.000000" });
    await expect(db.exec("select * from lean_private.identity_map")).rejects.toThrow("permission");
    await expect(db.exec("delete from lean_export.store_daily")).rejects.toThrow("permission");
    await expect(db.query("select public.lean_full_export('fixture',$1,'x','x')", [fullProject])).rejects.toThrow("permission");
  } finally { await db.exec("reset role"); }
  await db.query("select public.lean_full_export('fixture',$1,'fixture:retry','fixture:operator')", [fullProject]);
  expect((await db.query("select count(*)::int n from lean_export.store_daily")).rows[0]).toEqual({ n: 1 });
});
it("can review and export one independently ready reporting domain without certifying the others", async () => {
  await runFullReportJob(options());
  expect((await db.query(`select has_function_privilege('service_role',
    'public.lean_scoped_release(text,text,text[],jsonb,text,text,text)','execute') allowed`)).rows)
    .toEqual([{ allowed: false }]);
  await db.query(`select public.lean_scoped_release('fixture',$1,array['store_daily'],$2,
    'fixture:store-signoff','fixture:store-reconciliation','fixture:operator')`,
  [fullProject, JSON.stringify({ store_daily: null })]);
  expect((await db.query("select domain from lean_private.selected_publications")).rows)
    .toEqual([{ domain: "store_daily" }]);
  expect((await db.query("select state from lean_private.publications where publication_id='full:fixture'")).rows)
    .toEqual([{ state: "certified" }]);
  await expect(db.query(`select public.lean_scoped_export('fixture',$1,array['product_daily'],
    'fixture:export','fixture:operator')`, [fullProject])).rejects.toThrow("selection");
  const result = await db.query<{ counts: unknown }>(`select public.lean_scoped_export('fixture',$1,
    array['store_daily'],'fixture:export','fixture:operator') counts`, [fullProject]);
  expect(result.rows[0].counts).toEqual({ store_daily: 1 });
  expect((await db.query("select count(*)::int n from lean_export.product_daily")).rows[0]).toEqual({ n: 0 });
});
it("scoped release preserves withheld metrics and rolls back a multi-domain stale selection", async () => {
  const f = fullFixture(); f.evidence.dateCoverage[0].gates.cash = false;
  await db.exec("delete from lean_private.full_builds");
  await db.query(`insert into lean_private.full_builds
    (run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,enabled)
    values('fixture',$1,'base',$2,$3,$4,'fixture:approval','fixture:actor',true)`,
  [fullProject, JSON.stringify(f.policy), JSON.stringify(f.evidence), JSON.stringify(f.behavior)]);
  await runFullReportJob(options());
  await expect(db.query(`select public.lean_scoped_release('fixture',$1,array['store_daily','product_daily'],$2,
    'fixture:signoff','fixture:review','fixture:operator')`,
  [fullProject, JSON.stringify({ store_daily: null, product_daily: "stale" })])).rejects.toThrow("selection");
  expect((await db.query("select * from lean_private.selected_publications")).rows).toEqual([]);
  expect((await db.query("select * from lean_private.certifications")).rows).toEqual([]);
  await db.query(`select public.lean_scoped_release('fixture',$1,array['store_daily'],$2,
    'fixture:signoff','fixture:review','fixture:operator')`,
  [fullProject, JSON.stringify({ store_daily: null })]);
  expect((await db.query("select collected_cash_usd,readiness from lean_analytics.store_daily")).rows[0])
    .toMatchObject({ collected_cash_usd: null,
      readiness: expect.objectContaining({ collected_cash_usd: "withheld", eligible_orders: "ready" }) });
});
it("blocks selection and replay while a downstream privacy removal is unverified", async () => {
  await runFullReportJob(options());
  await db.query(`insert into lean_private.journey_policies
    (project_ref,shop,posthog_project,policy_version,approval_ref,ttl_seconds,enabled)
    values($1,$2,'353503','fixture:v1','fixture:privacy',3600,true)`, [fullProject, fullShop]);
  await db.query(`select public.lean_journey_issue($1,$2,'353503','fixture:v1',$3,$4,$5,null)`,
    [fullProject, fullShop, "b".repeat(64), "c".repeat(64), "11111111-1111-4111-8111-111111111111"]);
  await db.query("select public.lean_journey_withdraw($1,$2,$3)", [fullProject, fullShop, "b".repeat(64)]);
  await expect(db.query(`select public.lean_scoped_release('fixture',$1,array['store_daily'],$2,
    'fixture:signoff','fixture:reconciliation','fixture:operator')`,
  [fullProject, JSON.stringify({ store_daily: null })])).rejects.toThrow("privacy removal");
  await db.exec(`update lean_private.journey_removals set downstream_verified_at=clock_timestamp(),
    downstream_evidence_ref='fixture:verified-deletion'`);
  await expect(db.query(`select public.lean_scoped_release('fixture',$1,array['store_daily'],$2,
    'fixture:signoff','fixture:reconciliation','fixture:operator')`,
  [fullProject, JSON.stringify({ store_daily: null })])).rejects.toThrow("privacy removal");
});
it("rejects a missing report day rather than marking an incomplete output complete", async () => {
  const wrapped: AnalyticsRpcClient = { async rpc(name, args) {
    if (name === "lean_full_finish") {
      const reports = structuredClone(args.p_reports) as Record<string, unknown[]>;
      reports.store_daily = [];
      return client.rpc(name, { ...args, p_reports: reports });
    }
    return client.rpc(name, args);
  } };
  await expect(runFullReportJob({ ...options(), client: wrapped })).rejects.toThrow("storage_unavailable");
  expect((await db.query("select * from lean_private.report_store_daily")).rows).toEqual([]);
});
