import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { prepareProductionBehaviorEvidence, type ProductionBehaviorSource } from "@/lib/analytics/productionBehaviorInput";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import { POST } from "@/app/api/analytics/ingest/full/route";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { fullFixture, fullProject, fullShop } from "../fixtures/analyticsFull";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";

const port = vi.hoisted(() => ({ client: null as AnalyticsRpcClient | null }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => port.client }));
const at = "2026-03-02T00:00:00Z";
function fixture() {
  const f = fullFixture();
  const behavior: ProductionBehaviorSource = { ...f.behavior, families: {
    lean_reserve_started: { ...f.behavior.families.page_view, identityNamespace: "lean_subject" },
  }, journeyPermissionSource: {
    version: "journey-permission-source-v1", projectRef: fullProject, shop: fullShop,
    posthogProject: f.behavior.project, from: f.behavior.from, until: f.behavior.until,
    approvalRef: "synthetic:permission-read", validUntil: "2026-03-02T00:05:00Z", maxReadAgeSeconds: 60,
  } };
  f.policy.stages = { started: "lean_reserve_started" };
  f.evidence.identity = [];
  f.evidence.currentlyPermitted = [];
  f.evidence.customerHistory = {};
  f.evidence.orderIdentities = [];
  f.evidence.campaigns = [];
  f.evidence.attributionCoverage.forEach(r => { r.coverage.identityComplete = false; });
  for (const proof of f.evidence.proofs) {
    if (proof.table === "customers") proof.expectedKeys = [];
    if (proof.table === "identity_map") proof.expectedKeys = [
      JSON.stringify(["lean_subject", "subject-fixture", "2026-01-01T10:00:00Z", f.policy.mappingVersion]),
    ];
  }
  f.wire.results[0][1] = "lean_reserve_started";
  f.wire.results[0][3] = "subject-fixture";
  const grants = [{ subjectId: "subject-fixture", validFrom: "2026-01-01T10:00:00Z",
    expiresAt: "2026-01-01T20:00:00Z", revokedAt: null as string | null,
    permissionEvidenceRef: "synthetic:current-authority" }];
  const request = vi.fn(async (url: string | URL | Request) => {
    if (String(url).endsWith("/rpc/lean_journey_permissions_read")) return Response.json(grants);
    if (String(url).startsWith(f.behavior.host)) return Response.json(f.wire);
    throw new Error("unexpected_network");
  });
  const inputs = { state: "ready", publication: f.publication, shop: f.shop,
    fromDate: f.fromDate, throughDate: f.throughDate, facts: f.base,
    policy: f.policy, evidence: f.evidence, behavior, deferredOrders: [], inputHash: "synthetic:input" };
  const rpc = vi.fn<AnalyticsRpcClient["rpc"]>(async name => {
    if (name === "lean_full_next") return { data: { state: "ready", stage: "full", runId: "fixture" }, error: null };
    if (name === "lean_full_inputs") return { data: inputs, error: null };
    if (["lean_full_claim", "lean_full_finish", "lean_full_fail"].includes(name)) return { data: true, error: null };
    throw new Error("unexpected_rpc");
  });
  const client: AnalyticsRpcClient = { rpc };
  const options = { client, projectRef: fullProject, databaseUrl: `https://${fullProject}.supabase.co`,
    runId: "fixture", posthogKey: "synthetic:posthog-key", journeyPermissionReadKey: "synthetic:read-key",
    journeyPermissionReadApproved: true, clock: () => at, request };
  const preparation = { behavior, evidence: f.evidence, projectRef: fullProject, shop: fullShop,
    mappingVersion: f.policy.mappingVersion, readKey: options.journeyPermissionReadKey,
    sourceReadApproved: true, clock: options.clock, request };
  const finish = () => rpc.mock.calls.find(([name]) => name === "lean_full_finish")?.[1] as
    { p_facts: Record<string, Record<string, unknown>[]>; p_reports: Record<string, Record<string, unknown>[]> };
  return { ...f, behavior, grants, request, rpc, options, preparation, inputs, finish };
}
beforeEach(() => { vi.stubGlobal("fetch", () => { throw new Error("external_network_forbidden"); }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.useRealTimers(); });

it("composes anonymous current authority without Shopify, customer history or fabricated controls", async () => {
  const f = fixture(), original = structuredClone(f.evidence);
  const prepared = await prepareProductionBehaviorEvidence(f.preparation);
  expect(prepared.evidence.identity).toEqual([{
    namespace: "lean_subject", identifier: "subject-fixture", customerId: null,
    from: f.grants[0].validFrom, to: f.grants[0].expiresAt, type: "analytics_permission_authority",
    evidenceRef: f.grants[0].permissionEvidenceRef, mappingVersion: f.policy.mappingVersion,
    resolution: "unresolved", consent: "permitted", removal: "active",
  }]);
  expect({ ...prepared.evidence, identity: [] }).toEqual(original);
  expect(f.evidence).toEqual(original);
  expect(f.request).toHaveBeenCalledTimes(1);
  const [url, request] = f.request.mock.calls[0] as unknown as [string, RequestInit];
  expect(url).toBe(`https://${fullProject}.supabase.co/rest/v1/rpc/lean_journey_permissions_read`);
  expect(JSON.parse(String(request.body))).toEqual({ p_project: fullProject, p_shop: fullShop,
    p_posthog: f.policy.project, p_from: f.behavior.from, p_until: f.behavior.until });
  expect(request.redirect).toBe("error");
});

it("runs the real source reader and report builder: anonymous measured session and conversion, no ROAS or customer history", async () => {
  const f = fixture();
  expect(await runFullReportJob(f.options)).toMatchObject({ state: "complete", certification: "unverified" });
  const { p_facts: facts, p_reports: reports } = f.finish();
  expect(facts.customers).toEqual([]);
  expect(facts.sessions[0]).toMatchObject({ customer_id: null, analytics_eligible: true,
    conversion_window_complete: true, converted_session: true });
  expect(reports.funnel_daily.find(r => r.stage_id === "all_sessions")).toMatchObject({
    measured_sessions: 1, mature_sessions: 1, converted_sessions: 1, session_conversion_rate: "1.000000",
  });
  expect(reports.acquisition_daily.every(r => r.first_party_roas === null)).toBe(true);
  expect(reports.store_daily[0].new_customers).toBeNull();
  expect(f.request).toHaveBeenCalledTimes(2);
});

it("withholds conversion without independent order completeness, while measured sessions remain numeric", async () => {
  const f = fixture();
  f.evidence.proofs = f.evidence.proofs.filter(p => p.table !== "orders");
  await runFullReportJob(f.options);
  expect(f.finish().p_reports.funnel_daily.find(r => r.stage_id === "all_sessions")).toMatchObject({
    measured_sessions: 1, mature_sessions: null, converted_sessions: null, session_conversion_rate: null,
  });
});

it("requires the explicit checkout link and never derives it from matching timestamps", async () => {
  const f = fixture();
  f.evidence.checkout = [];
  await runFullReportJob(f.options);
  expect(f.finish().p_facts.orders[0]).toMatchObject({ checkout_session_key: null, checkout_link_status: "missing" });
  expect(f.finish().p_reports.funnel_daily.find(r => r.stage_id === "all_sessions")).toMatchObject({
    measured_sessions: 1, mature_sessions: 1, converted_sessions: 0, session_conversion_rate: "0.000000",
  });
});

it.each(["revoked", "absent"] as const)("does not recover a %s permission from the event boolean", async state => {
  const f = fixture();
  if (state === "revoked") f.grants[0].revokedAt = "2026-02-01T00:00:00Z";
  else f.grants.length = 0;
  await runFullReportJob(f.options);
  expect(f.finish().p_facts.sessions).toEqual([]);
  expect(f.finish().p_reports.funnel_daily.every(r => r.measured_sessions === null)).toBe(true);
});

it("keeps legacy invocation byte-compatible and performs no permission read when the policy is absent", async () => {
  const f = fullFixture(), request = vi.fn(async () => { throw new Error("must_not_read"); });
  const result = await prepareProductionBehaviorEvidence({ behavior: f.behavior, evidence: f.evidence,
    projectRef: fullProject, shop: fullShop, mappingVersion: f.policy.mappingVersion, request });
  expect(result.evidence).toBe(f.evidence);
  result.assertFresh();
  expect(request).not.toHaveBeenCalled();
});

it("keeps existing resolved-customer acquisition and purchase ROAS without requiring complete customer history", async () => {
  const legacy = fullFixture(), f = fixture();
  legacy.evidence.customerHistory = {};
  Object.assign(f.inputs, { policy: legacy.policy, evidence: legacy.evidence, behavior: legacy.behavior });
  f.request.mockImplementation(async () => Response.json(legacy.wire));
  await runFullReportJob({ ...f.options, journeyPermissionReadKey: "", journeyPermissionReadApproved: false });
  expect(f.finish().p_reports.acquisition_daily[0]).toMatchObject({
    credited_orders: "1.000000", attributed_purchase_merchandise_net_usd: "20.000000",
    spend_usd: "5.000000", first_party_roas: "4.000000", ncac_usd: null,
  });
  expect(f.finish().p_reports.store_daily[0].new_customers).toBeNull();
  expect(f.request).toHaveBeenCalledTimes(1);
});

it.each([
  ["wrong project", { projectRef: "b".repeat(20) }],
  ["wrong shop", { shop: "other.myshopify.com" }],
  ["wrong event project", { posthogProject: "1" }],
  ["wider window", { from: "2025-11-01T00:00:00Z" }],
  ["unknown key", { fallback: true }],
  ["missing approval", { approvalRef: "" }],
  ["invalid age", { maxReadAgeSeconds: 301 }],
  ["invalid version", { version: "next" }],
  ["invalid expiry", { validUntil: "tomorrow" }],
] as const)("rejects %s before claim or network", async (_name, change) => {
  const f = fixture();
  Object.assign(f.behavior.journeyPermissionSource!, change);
  await expect(runFullReportJob(f.options)).rejects.toThrow();
  expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["lean_full_inputs"]);
  expect(f.request).not.toHaveBeenCalled();
});

it("rejects retained namespace collisions rather than replacing resolved ownership", async () => {
  const f = fixture();
  f.evidence.identity = [{ ...fullFixture().evidence.identity[0], namespace: "lean_subject" }];
  await expect(runFullReportJob(f.options)).rejects.toThrow("journey_permission_identity_collision");
  expect(f.request).not.toHaveBeenCalled();
});

it.each(["key", "approval", "expired", "denied", "malformed", "stale"] as const)(
  "fails the claimed job without fallback, event read or finish when permission source is %s", async kind => {
    const f = fixture();
    if (kind === "key") f.options.journeyPermissionReadKey = "";
    if (kind === "approval") f.options.journeyPermissionReadApproved = false;
    if (kind === "expired") f.behavior.journeyPermissionSource!.validUntil = at;
    if (kind === "denied") f.request.mockImplementation(async () => new Response(null, { status: 403 }));
    if (kind === "malformed") f.request.mockImplementation(async () => Response.json([{ raw: "not-authority" }]));
    if (kind === "stale") {
      let calls = 0;
      f.options.clock = () => calls++ ? "2026-03-02T00:01:01Z" : at;
    }
    await expect(runFullReportJob(f.options)).rejects.toThrow("full_transform_unavailable");
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["lean_full_inputs", "lean_full_claim", "lean_full_fail"]);
    expect(f.request.mock.calls.every(([url]) => String(url).endsWith("lean_journey_permissions_read"))).toBe(true);
  });

it("rechecks permission freshness after the behavior read and does not finish stale output", async () => {
  const f = fixture();
  let calls = 0;
  f.options.clock = () => calls++ < 2 ? at : "2026-03-02T00:01:01Z";
  await expect(runFullReportJob(f.options)).rejects.toThrow("full_transform_unavailable");
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["lean_full_inputs", "lean_full_claim", "lean_full_fail"]);
});

it("rejects a configured permission source in excluded behavior mode without any source read", async () => {
  const f = fixture();
  f.policy.behaviorMode = "excluded";
  await expect(runFullReportJob(f.options)).rejects.toThrow("excluded_journey_permission_source");
  expect(f.request).not.toHaveBeenCalled();
});

it("does not silently fall back to legacy spend when the configured fresh envelope is null", async () => {
  const f = fixture();
  Object.assign(f.inputs, { freshGoogleSpend: null });
  await expect(runFullReportJob(f.options)).rejects.toThrow("full_transform_unavailable");
  expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["lean_full_inputs", "lean_full_claim", "lean_full_fail"]);
  expect(f.request).not.toHaveBeenCalled();
});

it("passes the existing approved server read capability through the actual route and full pipeline", async () => {
  const f = fixture();
  port.client = f.options.client;
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date(at));
  vi.stubGlobal("fetch", f.request);
  for (const [name, value] of Object.entries({
    LEAN_ANALYTICS_FULL_ENABLED: "true", LEAN_ANALYTICS_FULL_SECRET: "s".repeat(32),
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF: fullProject, LEAN_ANALYTICS_SUPABASE_URL: f.options.databaseUrl,
    LEAN_ANALYTICS_FULL_RUN_ID: "fixture", LEAN_POSTHOG_QUERY_READ_KEY: f.options.posthogKey,
    LEAN_MULLY_SOURCE_READ_KEY: f.options.journeyPermissionReadKey, LEAN_MULLY_SOURCE_READ_APPROVED: "true",
  })) vi.stubEnv(name, value);
  const response = await POST(new NextRequest("https://fixture.invalid/api/analytics/ingest/full", {
    method: "POST", headers: { authorization: `Bearer ${"s".repeat(32)}` },
  }));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ state: "complete", certification: "unverified" });
  expect(f.request).toHaveBeenCalledTimes(2);
  expect(f.finish().p_facts.customers).toEqual([]);
});

it("round-trips the saved optional behavior policy through real full-input/finish SQL without selecting or certifying it", async () => {
  const f = fixture(), db = new PGlite();
  try {
    await db.exec("create role service_role; create role anon; create role authenticated;");
    for (const migration of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs",
      "019_spend_jobs", "020_observed_report_jobs", "021_full_report_jobs"])
      await db.exec(readFileSync(`sql/analytics/${migration}.sql`, "utf8"));
    await db.query(`insert into lean_private.report_builds
      (run_id,project_ref,shop,history_runs,from_date,through_date,policy,approval_ref,actor_ref,
       enabled,completed_at,result_hash)
      values('base',$1,$2,array['synthetic-history'],'2026-01-01','2026-01-01','{}',
       'synthetic:approval','synthetic:actor',true,now(),'synthetic')`, [fullProject, fullShop]);
    await db.exec("insert into lean_private.publications(publication_id,contract_version) values('observed:base','lean-v1-draft.1')");
    for (const [table, rows] of Object.entries(f.base))
      await db.query(`insert into lean_private.${table} select * from jsonb_populate_recordset(null::lean_private.${table},$1)`,
        [JSON.stringify(rows.map(r => ({ ...r, publication_id: "observed:base" })))]);
    await db.query(`insert into lean_private.full_builds
      (run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,enabled)
      values('fixture',$1,'base',$2,$3,$4,'synthetic:approval','synthetic:actor',true)`,
    [fullProject, JSON.stringify(f.policy), JSON.stringify(f.evidence), JSON.stringify(f.behavior)]);
    const calls: string[] = [];
    const client: AnalyticsRpcClient = { async rpc(name, args) {
      if (!["lean_full_inputs", "lean_full_claim", "lean_full_fail", "lean_full_finish"].includes(name))
        throw new Error("unexpected_sql");
      calls.push(name);
      const entries = Object.entries(args);
      try {
        const result = await db.query<{ result: unknown }>(`select public.${name}(${
          entries.map(([key], i) => `${key}=>$${i + 1}`).join(",")}) result`,
        entries.map(([, value]) => typeof value === "object" ? JSON.stringify(value) : value));
        return { data: result.rows[0].result, error: null };
      } catch (error) { return { data: null, error }; }
    } };
    expect(await runFullReportJob({ ...f.options, client })).toMatchObject({ state: "complete" });
    expect(calls).toEqual(["lean_full_inputs", "lean_full_claim", "lean_full_finish"]);
    expect((await db.query("select measured_sessions,converted_sessions,session_conversion_rate from lean_private.report_funnel_daily where stage_id='all_sessions'")).rows)
      .toEqual([{ measured_sessions: 1, converted_sessions: 1, session_conversion_rate: "1.000000" }]);
    expect((await db.query("select * from lean_private.selected_publications")).rows).toEqual([]);
    expect((await db.query("select * from lean_private.certifications")).rows).toEqual([]);
    expect((await db.query<{ behavior: unknown }>("select behavior from lean_private.full_builds")).rows[0].behavior)
      .toEqual(f.behavior);
    await expect(db.query("update lean_private.full_builds set behavior='{}'")).rejects.toThrow("immutable");
  } finally { await db.close(); }
}, 30000);
