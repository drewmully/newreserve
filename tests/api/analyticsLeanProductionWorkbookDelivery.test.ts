/** Disposable SQL and synthetic provider responses only. No hosted acceptance. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from "vitest";
import { fullFixture, fullShop } from "../fixtures/analyticsFull";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { prepareFreshGoogleSpend } from "@/lib/analytics/googleSpendRegistration";
import { productionReportGet, productionReportPath, validProductionReportPayload } from "@/lib/analytics/productionReportDelivery";
import { validProductionWorkbookPayload, workbookResources } from "@/lib/analytics/productionWorkbookDelivery";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";

type Payload = Record<string, Record<string, unknown>[]>;
let db: PGlite;
let f: ReturnType<typeof fullFixture>;
// Reuse the existing route's fixed binding without adding a real identifier to fixtures.
const project = /const project = "([^"]+)"/.exec(readFileSync("src/lib/analytics/productionReportDelivery.ts", "utf8"))![1];
const domains = Object.keys(workbookResources);
const sql = (n: string) => readFileSync(`sql/analytics/${n}.sql`, "utf8");
async function rpc(name: string, args: Record<string, unknown>) {
  const entries = Object.entries(args);
  return (await db.query<{ result: unknown }>(`select public.${name}(${
    entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) result`,
  entries.map(([k, v]) => k === "p_domains" ? v :
    v !== null && typeof v === "object" ? JSON.stringify(v) : v))).rows[0].result;
}
const client: AnalyticsRpcClient = { async rpc(name, args) {
  if (!["lean_full_inputs", "lean_full_claim", "lean_full_finish", "lean_full_fail"].includes(name)) throw new Error("unexpected_rpc");
  try { return { data: await rpc(name, args), error: null }; }
  catch (error) { return { data: null, error }; }
} };
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role service_role;create role anon;create role authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const n of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs", "019_spend_jobs",
    "020_observed_report_jobs", "021_full_report_jobs", "022_full_release", "023_posthog_export",
    "024_full_orchestration", "026_journey_authority", "029_journey_decisions", "030_scoped_release",
    "031_draft_receipts", "037_canonical_journey_timestamps", "038_google_spend_pilot",
    "053_production_workbook_delivery"]) await db.exec(sql(n));
}, 30000);
beforeEach(async () => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("hosted_network_forbidden"); }));
  f = fullFixture();
  await db.exec(`truncate lean_private.full_builds cascade;truncate lean_private.report_builds cascade;
    truncate lean_private.publications cascade;truncate lean_private.history_jobs cascade;
    truncate lean_private.spend_pilots cascade;truncate lean_private.spend_jobs cascade;
    truncate lean_private.journey_grants cascade;
    insert into lean_private.production_workbook_delivery(singleton) values(true);`);
  await db.query(`insert into lean_private.report_builds
    (run_id,project_ref,shop,history_runs,from_date,through_date,policy,approval_ref,actor_ref,enabled,completed_at,result_hash)
    values('base',$1,$2,array['fixture-history'],'2026-01-01','2026-01-01','{}','fixture:approval','fixture:actor',true,now(),'fixture')`,
  [project, fullShop]);
  await db.exec("insert into lean_private.publications(publication_id,contract_version) values('observed:base','lean-v1-draft.1')");
  for (const [table, rows] of Object.entries(f.base)) {
    await db.query(`insert into lean_private.${table} select * from jsonb_populate_recordset(null::lean_private.${table},$1)`,
      [JSON.stringify(rows.map(r => ({ ...r, publication_id: "observed:base" })))]);
  }
  await registerFull();
});
afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
afterAll(async () => { await db.close(); });
async function registerFull(extra: Record<string, unknown> = {}) {
  await db.exec("delete from lean_private.full_builds where run_id='fixture'");
  await db.query(`insert into lean_private.full_builds
    (run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,enabled)
    values('fixture',$1,'base',$2,$3,$4,'fixture:approval','fixture:actor',true)`,
  [project, JSON.stringify({ ...f.policy, ...extra }), JSON.stringify(f.evidence), JSON.stringify(f.behavior)]);
}
async function build() {
  expect(await runFullReportJob({ client, projectRef: project, databaseUrl: `https://${project}.supabase.co`,
    runId: "fixture", posthogKey: "fixture-only", request: async () => Response.json(f.wire) }))
    .toMatchObject({ state: "complete" });
}
async function select(names = domains) {
  await rpc("lean_scoped_release", { p_run: "fixture", p_project_ref: project, p_domains: names,
    p_expected_previous: Object.fromEntries(names.map(n => [n, null])),
    p_approval: "fixture:release", p_reconciliation: "fixture:independent", p_actor: "fixture:operator" });
  await db.query(`update lean_private.production_workbook_delivery
    set enabled=true,run_id='fixture',project_ref=$1,shop=$2,approval_ref='fixture:delivery'`, [project, fullShop]);
}
async function read() {
  return await rpc("lean_production_workbook_reports_read", { p_project_ref: project }) as Payload;
}
const env = {
  LEAN_PRODUCTION_REPORTS_ENABLED: "true", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
  LEAN_PRODUCTION_REPORTS_SECRET: "fixture-only-narrow-bearer-32-characters",
  LEAN_PRODUCTION_REPORTS_MODE: "workbook", LEAN_PRODUCTION_WORKBOOK_REPORTS_ENABLED: "true",
  LEAN_PRODUCTION_WORKBOOK_REPORTS_SECRET: "fixture-only-workbook-bearer-32-characters",
  LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project, LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`,
  LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "fixture-only-service-key",
};
const request = (secret = env.LEAN_PRODUCTION_WORKBOOK_REPORTS_SECRET, suffix = "") =>
  new Request(`https://fixture.invalid${productionReportPath}${suffix}`, { headers: { authorization: `Bearer ${secret}` } });

it("installs off with fixed RPC-only service permissions and no alias bypass", async () => {
  expect(await read()).toBeNull();
  const r = (await db.query(`select
    has_function_privilege('service_role','public.lean_production_workbook_reports_read(text)','EXECUTE') reader,
    has_function_privilege('anon','public.lean_production_workbook_reports_read(text)','EXECUTE') anon,
    has_function_privilege('service_role','public.lean_full_inputs_021(text,text)','EXECUTE') alias,
    has_table_privilege('service_role','lean_private.production_workbook_delivery','UPDATE') gate,
    (select provolatile from pg_proc where oid='public.lean_production_workbook_reports_read(text)'::regprocedure) stability`)).rows[0];
  expect(r).toEqual({ reader: true, anon: false, alias: false, gate: false, stability: "s" });
});
it("delivers existing persisted five-family formulas through actual SQL and the canonical HTTP route", async () => {
  await build();
  expect(await read()).toBeNull(); // completed candidate is not a delivery approval
  await select();
  const data = await read();
  expect(validProductionWorkbookPayload(data)).toBe(true);
  expect(data.store_daily[0]).toMatchObject({ collected_cash_usd: "20.000000", spend_usd: "5.000000",
    new_customers: "1", ncac_usd: "5.000000", mer: "4.000000", aov_usd: "20.000000" });
  expect(data.acquisition_daily[0]).toMatchObject({ first_party_roas: "4.000000" });
  expect(data.customer_cohorts[0]).toMatchObject({ revenue_ltv_usd: "20.000000", repeat_purchase_rate: "0.000000" });
  expect(data.funnel_daily.find(r => r.stage_id === "all_sessions")).toMatchObject({
    measured_sessions: "1", converted_sessions: "1", session_conversion_rate: "1.000000" });
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe(`https://${project}.supabase.co/rest/v1/rpc/lean_production_workbook_reports_read`);
    expect(JSON.parse(String(init?.body))).toEqual({ p_project_ref: project });
    return Response.json(await read());
  });
  const response = await productionReportGet(request(), env, transport);
  expect(response.status).toBe(200); expect(await response.json()).toEqual(data);
  expect(JSON.stringify(data)).not.toMatch(/customer-fixture|uid-fixture|evidenceRef|gateway|nativeUuid/);
});
it("keeps selected sessions available with other domains unselected and commerce coverage withheld", async () => {
  f.evidence.dateCoverage[0].gates.orders = false;
  f.evidence.dateCoverage[0].gates.ledger = false;
  await registerFull(); await build(); await select(["funnel_daily"]);
  const data = await read();
  expect(validProductionWorkbookPayload(data)).toBe(true);
  expect(data).toMatchObject({ store_daily: [], product_daily: [], acquisition_daily: [], customer_cohorts: [] });
  expect(data.report_status.find(r => r.resource_name === "store_daily"))
    .toMatchObject({ state: "not_selected", row_count: null, is_stale: null, readiness: { eligible_orders: "unavailable" } });
  expect(data.report_status.find(r => r.resource_name === "funnel_daily"))
    .toMatchObject({ state: "selected", row_count: "2", is_stale: false, readiness: { measured_sessions: "ready" } });
  expect(data.funnel_daily[0]).toMatchObject({ measured_sessions: "1", converted_sessions: null,
    readiness: { measured_sessions: "ready", converted_sessions: "withheld" } });
});
it("preserves nulls and stale selection state without promoting candidate values", async () => {
  f.evidence.dateCoverage[0].gates.cash = false;
  await registerFull(); await build(); await select(["store_daily"]);
  await db.exec("update lean_private.selected_publications set is_stale=true");
  const data = await read();
  expect(validProductionWorkbookPayload(data)).toBe(true);
  expect(data.store_daily[0]).toMatchObject({ is_stale: true, collected_cash_usd: null,
    readiness: { collected_cash_usd: "withheld", spend_usd: "ready" } });
});
it("fails closed after selection invalidation or binding disable, without fallback", async () => {
  await build(); await select(["store_daily"]);
  await db.exec("delete from lean_private.selected_publications");
  expect(await read()).toBeNull();
  const response = await productionReportGet(request(), env, async () => Response.json(await read()));
  expect(response.status).toBe(503);
  await db.exec("update lean_private.production_workbook_delivery set enabled=false");
  expect(await read()).toBeNull();
});
it("blocks pending privacy removals even if a selected pointer still exists", async () => {
  await build(); await select();
  await db.query(`insert into lean_private.journey_grants
    (token_hash,project_ref,posthog_project,shop,subject_id,session_id,valid_from,expires_at,permission_evidence_ref,approval_ref)
    values($1,$2,'fixture-posthog',$3,'fixture-subject',$4,'2026-01-01T00:00:00Z','2026-01-02T00:00:00Z','fixture:permission','fixture:approval')`,
  ["a".repeat(64), project, fullShop, randomUUID()]);
  await db.query("insert into lean_private.journey_removals(token_hash) values($1)", ["a".repeat(64)]);
  expect(await read()).toBeNull();
});
it("pins field allowlists to existing workbook report contracts and manifest keys", () => {
  const contracts = JSON.parse(readFileSync("src/lib/analytics/reporting-contracts.json", "utf8"));
  for (const v of contracts.views) {
    const spec = workbookResources[v.name as keyof typeof workbookResources];
    expect([...Object.keys(spec.dimensions), "readiness", ...spec.integers, ...spec.decimals].sort())
      .toEqual(v.fields.map((field: { name: string }) => field.name).sort());
  }
  const manifest = JSON.parse(readFileSync("docs/analytics/production-workbook-posthog-manifest.json", "utf8"));
  expect(manifest.resources.map((r: { name: string }) => r.name).sort()).toEqual([...domains, "report_status"].sort());
  for (const r of manifest.resources) {
    expect(r.primary_key).toEqual(r.name === "report_status" ? ["resource_name", "publication_id"] :
      workbookResources[r.name as keyof typeof workbookResources].key);
    expect(r.endpoint).toEqual({ path: productionReportPath, method: "GET", data_selector: r.name, paginator: { type: "single_page" } });
  }
});
it.each(["coerced", "extra", "missing", "duplicate", "mixed_publication", "mixed_model", "mixed_funnel",
  "mixed_cutoff", "readiness", "unselected_values", "missing_day", "lost_status", "mixed_status_publication",
  "mixed_status_freshness", "false_atomicity"] as const)("rejects %s full payload", async bad => {
  await build(); await select();
  const data = await read();
  if (bad === "coerced") data.store_daily[0].spend_usd = 5;
  if (bad === "extra") data.store_daily[0].customer_id = "fixture-private";
  if (bad === "missing") delete data.store_daily[0].collected_cash_usd;
  if (bad === "duplicate") data.product_daily.push(data.product_daily[0]);
  if (bad === "mixed_publication") data.product_daily[0].publication_id = "full:other";
  if (bad === "mixed_model") data.acquisition_daily[0].model_version = "other";
  if (bad === "mixed_funnel") data.funnel_daily[0].funnel_version = "other";
  if (bad === "mixed_cutoff") data.customer_cohorts[0].as_of_at = "2026-03-02T00:00:00.000001Z";
  if (bad === "readiness") (data.store_daily[0].readiness as Record<string, unknown>).spend_usd = "observed_unverified";
  if (bad === "unselected_values") data.report_status.find(r => r.resource_name === "store_daily")!.state = "not_selected";
  if (bad === "missing_day") data.store_daily = [];
  if (bad === "lost_status") delete data.report_status;
  if (bad === "mixed_status_publication") data.report_status[0].publication_id = "full:other";
  if (bad === "mixed_status_freshness") data.report_status[0].is_stale = true;
  if (bad === "false_atomicity") data.report_status[0].atomic_resource_refresh = true;
  expect(validProductionWorkbookPayload(data)).toBe(false);
  expect((await productionReportGet(request(), env, async () => Response.json(data))).status).toBe(503);
});
it("leaves SQL050's default contract and bearer unchanged and refuses opt-in/auth mistakes", async () => {
  const narrow = { store_daily: [], product_daily: [] };
  expect(validProductionReportPayload(narrow)).toBe(true);
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    expect(String(url)).toMatch(/\/lean_production_reports_read$/); expect(init?.body).toBe("{}");
    return Response.json(narrow);
  });
  const ordinary = { ...env }; delete (ordinary as Partial<typeof env>).LEAN_PRODUCTION_REPORTS_MODE;
  expect((await productionReportGet(request(env.LEAN_PRODUCTION_REPORTS_SECRET), ordinary, transport)).status).toBe(200);
  for (const change of [
    { LEAN_PRODUCTION_WORKBOOK_REPORTS_ENABLED: "false" }, { VERCEL_ENV: "preview" },
    { LEAN_PRODUCTION_REPORTS_MODE: "fallback" },
    { LEAN_PRODUCTION_WORKBOOK_REPORTS_SECRET: env.LEAN_PRODUCTION_REPORTS_SECRET },
  ]) {
    const noCall = vi.fn();
    expect((await productionReportGet(request(), { ...env, ...change }, noCall)).status).not.toBe(200);
    expect(noCall).not.toHaveBeenCalled();
  }
  const noCall = vi.fn();
  expect((await productionReportGet(request(env.LEAN_PRODUCTION_REPORTS_SECRET), env, noCall)).status).toBe(401);
  expect((await productionReportGet(request(undefined, "?scope=all"), env, noCall)).status).toBe(400);
  expect(noCall).not.toHaveBeenCalled();
});
it("imports all five operational status rows without relying on discarded envelope metadata", async () => {
  await build(); await select(["store_daily"]);
  const data = await read();
  const manifest = JSON.parse(readFileSync("docs/analytics/production-workbook-posthog-manifest.json", "utf8"));
  const selector = manifest.resources.find((r: { name: string }) => r.name === "report_status").endpoint.data_selector;
  const imported = data[selector];
  expect(imported).toHaveLength(5);
  for (const row of imported) expect(row).toMatchObject({
    publication_id: "full:fixture", as_of_at: f.policy.asOf, report_from_date: f.fromDate,
    report_through_date: f.throughDate, atomic_resource_refresh: false,
  });
  expect(imported.filter(r => r.state === "not_selected")).toHaveLength(4);
  expect(imported.find(r => r.resource_name === "store_daily")).toMatchObject({ row_count: "1", state: "selected" });
  expect(validProductionWorkbookPayload(data)).toBe(true);
});

async function freshSetup(complete = true, injectBases = false, expiryMillis = 7200000) {
  const now = Date.now(), at = (delta: number) => new Date(now + delta).toISOString();
  const prepared = prepareFreshGoogleSpend({ version: 1, projectRef: project, accountId: "1234567890",
    loginCustomerId: null, approvalRef: "fixture:spend", actorRef: "fixture:operator",
    revisionRef: "fixture:revision", credentialBindingRef: "fixture:credential", coverage: "whole_account_campaign_day",
    sourceCurrency: "USD", sourceTimezone: "America/New_York", preparedAt: at(-7200000), expiresAt: at(expiryMillis),
    freshnessCutoffAt: at(-3600000), maxPages: 1, maxRequestsPerDay: 3, deadlineSeconds: 60,
    days: [{ date: f.fromDate, dueAt: at(-1800000) }] });
  const scope = prepared.registration.args.p_scope, run = scope.days[0].runId;
  await rpc("lean_spend_pilot_register", { p_scope: scope });
  await db.exec("update lean_private.spend_pilots set enabled=true;update lean_private.spend_jobs set enabled=true");
  const base = { provider: "google_ads", accountId: prepared.manifest.accountId, date: f.fromDate,
    baseReportId: run, sourceCurrency: "USD", sourceTimezone: "America/New_York", completedAt: at(-600000),
    paginationComplete: true, verifiedEmpty: false, evidenceRef: `lean_private.spend_jobs/${run}`,
    rows: [{ campaignId: "7", costMicros: "5000000" }] };
  if (complete) await db.query("update lean_private.spend_jobs set base=$1 where run_id=$2", [JSON.stringify(base), run]);
  // Re-register fixture base before it is used, never mutate immutable scope.
  await db.exec("delete from lean_private.full_builds;delete from lean_private.report_builds");
  await db.query(`insert into lean_private.report_builds
    (run_id,project_ref,shop,history_runs,spend_runs,from_date,through_date,policy,approval_ref,actor_ref,enabled,completed_at,result_hash)
    values('base',$1,$2,array['fixture-history'],$3,'2026-01-01','2026-01-01','{}','fixture:approval','fixture:actor',true,$4,$5)`,
  [project, fullShop, [run], complete ? new Date().toISOString() : null, complete ? "fixture" : null]);
  const packet = { manifest: prepared.manifest, controls: [], marketingInventory: {},
    ...(injectBases ? { bases: [] } : {}) };
  await registerFull({ freshGoogleSpend: packet });
  return { base, prepared };
}
it("derives fresh spend bases from registered storage and binds them into the existing input hash", async () => {
  const { base } = await freshSetup();
  const input = await rpc("lean_full_inputs", { p_run: "fixture", p_project_ref: project }) as Record<string, unknown>;
  expect(input).toMatchObject({ state: "ready", freshGoogleSpend: { bases: [base], controls: [] } });
  expect(input.inputHash).not.toBe((await rpc("lean_full_inputs_021",
    { p_run: "fixture", p_project_ref: project }) as Record<string, unknown>).inputHash);
  await db.exec("update lean_private.spend_jobs set enabled=false");
  expect(await rpc("lean_full_inputs", { p_run: "fixture", p_project_ref: project })).toEqual({ state: "blocked" });
});
it("rejects caller-supplied bases and blocks a disabled pilot", async () => {
  await freshSetup(true, true);
  await expect(rpc("lean_full_inputs", { p_run: "fixture", p_project_ref: project })).rejects.toThrow("invalid registered fresh spend policy");
});
it("enriches the existing spend dispatch with the exact v2 manifest, not another collector", async () => {
  const { prepared } = await freshSetup(false);
  await db.query(`insert into lean_private.history_jobs
    (run_id,project_ref,shop,from_time,until_time,page_size,max_pages,approval_ref,actor_ref,enabled,complete)
    values('fixture-history',$1,$2,'2026-01-01T00:00:00Z','2026-01-02T00:00:00Z',1,1,'fixture:a','fixture:b',true,true)`,
  [project, fullShop]);
  expect(await rpc("lean_full_next", { p_run: "fixture", p_project_ref: project }))
    .toMatchObject({ state: "ready", stage: "spend", freshGoogleSpendManifest: prepared.manifest });
  await db.exec("update lean_private.spend_pilots set enabled=false");
  expect(await rpc("lean_full_next", { p_run: "fixture", p_project_ref: project })).toEqual({ state: "blocked" });
});
it("rechecks source enablement at finish and persists no publication after changed inputs", async () => {
  await freshSetup();
  const args = { p_run: "fixture", p_project_ref: project };
  const input = await rpc("lean_full_inputs", args) as Record<string, unknown>;
  const token = randomUUID(); expect(await rpc("lean_full_claim", { ...args, p_token: token })).toBe(true);
  const result = buildFullReports(f);
  await db.exec("update lean_private.spend_pilots set enabled=false");
  expect(await rpc("lean_full_finish", { ...args, p_token: token, p_input_hash: input.inputHash,
    p_facts: result.facts, p_reports: result.reports, p_manifest: result.manifest })).toBe(false);
  expect((await db.query("select publication_id from lean_private.publications where publication_id='full:fixture'")).rows).toEqual([]);
});
it("blocks an expired pilot at the existing finish boundary", async () => {
  const { prepared } = await freshSetup(true, false, 1500);
  const args = { p_run: "fixture", p_project_ref: project };
  const input = await rpc("lean_full_inputs", args) as Record<string, unknown>;
  expect(input.state).toBe("ready");
  const token = randomUUID(); expect(await rpc("lean_full_claim", { ...args, p_token: token })).toBe(true);
  const result = buildFullReports(f);
  await new Promise(resolve => setTimeout(resolve, Math.max(0, Date.parse(prepared.manifest.expiresAt) - Date.now()) + 50));
  expect(await rpc("lean_full_inputs", args)).toEqual({ state: "blocked" });
  expect(await rpc("lean_full_finish", { ...args, p_token: token, p_input_hash: input.inputHash,
    p_facts: result.facts, p_reports: result.reports, p_manifest: result.manifest })).toBe(false);
  expect((await db.query("select publication_id from lean_private.publications where publication_id='full:fixture'")).rows).toEqual([]);
});
it("keeps controls/source bases immutable and rejects a mismatched saved input hash", async () => {
  await freshSetup();
  await expect(db.exec(`update lean_private.full_builds set policy=jsonb_set(policy,'{freshGoogleSpend,controls}','[{}]')`))
    .rejects.toThrow("full scope/result immutable");
  await expect(db.exec(`update lean_private.spend_jobs set base=jsonb_set(base,'{rows}','[]')`))
    .rejects.toThrow("spend base immutable");
  const args = { p_run: "fixture", p_project_ref: project }, token = randomUUID();
  expect(await rpc("lean_full_claim", { ...args, p_token: token })).toBe(true);
  const result = buildFullReports(f);
  expect(await rpc("lean_full_finish", { ...args, p_token: token, p_input_hash: "changed",
    p_facts: result.facts, p_reports: result.reports, p_manifest: result.manifest })).toBe(false);
});
it("does not let missing policy downgrade completed fresh-google bases into legacy inputs", async () => {
  await freshSetup();
  await registerFull();
  expect(await rpc("lean_full_inputs", { p_run: "fixture", p_project_ref: project })).toEqual({ state: "blocked" });
});
it("does not dispatch an ordinary collector from a full build configured for fresh spend", async () => {
  const { prepared } = await freshSetup(false);
  await db.query(`insert into lean_private.history_jobs
    (run_id,project_ref,shop,from_time,until_time,page_size,max_pages,approval_ref,actor_ref,enabled,complete)
    values('fixture-history',$1,$2,'2026-01-01T00:00:00Z','2026-01-02T00:00:00Z',1,1,'fixture:a','fixture:b',true,true)`,
  [project, fullShop]);
  await db.query(`insert into lean_private.spend_jobs
    (run_id,project_ref,account_id,report_date,max_pages,approval_ref,actor_ref,enabled)
    values('fixture-legacy',$1,'1234567890','2026-01-01',1,'fixture:a','fixture:b',true)`, [project]);
  await db.query(`insert into lean_private.report_builds
    (run_id,project_ref,shop,history_runs,spend_runs,from_date,through_date,policy,approval_ref,actor_ref,enabled)
    values('mixed-base',$1,$2,array['fixture-history'],array['fixture-legacy'],'2026-01-01','2026-01-01','{}','fixture:a','fixture:b',true)`,
  [project, fullShop]);
  await db.query(`insert into lean_private.full_builds
    (run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,enabled)
    values('mixed',$1,'mixed-base',$2,$3,$4,'fixture:a','fixture:b',true)`,
  [project, JSON.stringify({ ...f.policy, freshGoogleSpend: { manifest: prepared.manifest, controls: [], marketingInventory: {} } }),
    JSON.stringify(f.evidence), JSON.stringify(f.behavior)]);
  expect(await rpc("lean_full_next", { p_run: "mixed", p_project_ref: project })).toEqual({ state: "blocked" });
});
