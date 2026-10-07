import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { prepareGoogleWorkbookRegistration } from "@/lib/analytics/googleWorkbookRegistration";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import { normalizeSpendBase } from "@/lib/analytics/spend";
import { googleDeliveryFixture } from "../fixtures/analyticsGoogleDelivery";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";

it("compiles only disabled registration into the existing job families without inventing input", () => {
  const f = googleDeliveryFixture(), before = structuredClone(f.packet);
  const p = prepareGoogleWorkbookRegistration(f.packet);
  expect(p).toMatchObject({ enabled: false, registered: false, metricAcceptance: false,
    registration: { rpc: "lean_google_workbook_register" } });
  expect(p.registration.args.p_scope.fullPolicy.googleDelivery).toEqual(f.binding);
  expect(f.packet).toEqual(before);
  expect(p.registration.args.p_scope.historyRuns).toEqual(["fixture-history"]);
});
it.each(["empty_history", "duplicate_history", "derived_customer", "extra", "wrong_day", "wrong_account", "future_as_of"] as const)(
  "refuses %s registration", bad => {
    const f = googleDeliveryFixture();
    if (bad === "empty_history") f.packet.historyRuns = [];
    if (bad === "duplicate_history") f.packet.historyRuns.push(f.packet.historyRuns[0]);
    if (bad === "derived_customer") Object.assign(f.packet.evidence, { customerGeneration: {} });
    if (bad === "extra") Object.assign(f.packet, { enabled: true });
    if (bad === "wrong_day") f.packet.googleDelivery.date = "2026-01-02";
    if (bad === "wrong_account") f.packet.googleDelivery.accountId = "9999999999";
    if (bad === "future_as_of") f.packet.fullPolicy.asOf = new Date(Date.now() + 86400000).toISOString();
    expect(() => prepareGoogleWorkbookRegistration(f.packet)).toThrow();
  });
it("preserves only an existing six-field customer binding without deriving its evidence", () => {
  const f = googleDeliveryFixture();
  f.packet.fullPolicy.customerGeneration = { runId: "fixture-customer", generationHash: "a".repeat(64),
    resultHash: "b".repeat(64), authorityId: "fixture-authority", authorityRevision: "1", authorityFingerprint: "c".repeat(64) };
  const p = prepareGoogleWorkbookRegistration(f.packet);
  expect(p.registration.args.p_scope.fullPolicy.customerGeneration).toEqual(f.packet.fullPolicy.customerGeneration);
  expect(p.registration.args.p_scope.evidence).not.toHaveProperty("customerGeneration");
});

describe("actual disposable SQL registration, atomic full finish and selected output", () => {
  let db: PGlite;
  let f: ReturnType<typeof googleDeliveryFixture>;
  const calls: string[] = [];
  async function rpc(name: string, args: Record<string, unknown>) {
    const entries = Object.entries(args);
    return (await db.query<{ result: unknown }>(`select public.${name}(${
      entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) result`,
    entries.map(([, v]) => v !== null && typeof v === "object" ? JSON.stringify(v) : v))).rows[0].result;
  }
  const client: AnalyticsRpcClient = { async rpc(name, args) {
    if (!["lean_full_inputs", "lean_full_claim", "lean_full_fail", "lean_google_delivery_finish"].includes(name))
      throw new Error("unexpected_rpc");
    calls.push(name);
    try { return { data: await rpc(name, args), error: null }; }
    catch (error) { return { data: null, error }; }
  } };
  beforeAll(async () => {
    db = new PGlite();
    await db.exec(`create role service_role; create role anon; create role authenticated;
      alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
    for (const name of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs", "019_spend_jobs",
      "020_observed_report_jobs", "021_full_report_jobs", "022_full_release", "023_posthog_export", "024_full_orchestration",
      "026_journey_authority", "029_journey_decisions", "030_scoped_release", "038_google_spend_pilot",
      "053_production_workbook_delivery", "google_workbook_registration.review", "google_delivery_output.review"])
      await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
  }, 30000);
  beforeEach(async () => {
    calls.length = 0; f = googleDeliveryFixture();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("hosted_network_forbidden"); }));
    await db.exec(`truncate lean_private.full_builds cascade; truncate lean_private.report_builds cascade;
      truncate lean_private.publications cascade; truncate lean_private.history_jobs cascade;
      truncate lean_private.spend_pilots cascade; truncate lean_private.spend_jobs cascade;`);
  });
  afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
  afterAll(async () => { await db?.close(); });
  async function register() {
    await db.query(`insert into lean_private.history_jobs(run_id,project_ref,shop,from_time,until_time,
      page_size,max_pages,approval_ref,actor_ref,enabled,page_count,row_count,complete)
      values('fixture-history',$1,$2,'2026-01-01','2026-01-02',1,1,'fixture:history','fixture:owner',true,1,1,true)`,
    [f.input.projectRef, f.input.shop]);
    await db.exec(`insert into lean_private.history_pages(run_id,page_number,expected_cursor,next_cursor,complete,rows)
      values('fixture-history',0,null,null,true,'[{"source":{"fixture":true},"evidenceRef":"fixture:retained"}]');`);
    const p = prepareGoogleWorkbookRegistration(f.packet);
    expect(await rpc(p.registration.rpc, p.registration.args)).toBe(true);
  }
  async function retainedBase() {
    await register();
    await db.exec(`update lean_private.spend_pilots set enabled=true; update lean_private.spend_jobs set enabled=true;
      update lean_private.report_builds set enabled=true,completed_at=clock_timestamp(),result_hash='fixture-retained';
      update lean_private.full_builds set enabled=true;
      insert into lean_private.publications(publication_id,contract_version) values('observed:google-base','lean-v1-draft.1');`);
    await db.query("update lean_private.spend_jobs set base=$1", [JSON.stringify(f.fresh.bases[0])]);
    const facts = { ...f.full.base, marketing_spend_daily: normalizeSpendBase(f.fresh.bases[0], "observed:google-base") };
    for (const [name, rows] of Object.entries(facts)) {
      await db.query(`insert into lean_private.${name} select * from jsonb_populate_recordset(null::lean_private.${name},$1)`,
        [JSON.stringify(rows.map(row => ({ ...row, publication_id: "observed:google-base" })))]);
    }
  }
  const build = () => runFullReportJob({ client, projectRef: f.input.projectRef,
    databaseUrl: `https://${f.input.projectRef}.supabase.co`, runId: "google-fixture", posthogKey: "" });
  const read = (hash: string) => rpc("lean_google_delivery_read", { p_project_ref: f.input.projectRef,
    p_run: "google-fixture", p_result_hash: hash, p_account_id: f.binding.accountId, p_date: f.binding.date });
  it("refuses missing retained history and registers all new dependencies disabled with owner-only control", async () => {
    const p = prepareGoogleWorkbookRegistration(f.packet);
    await expect(rpc(p.registration.rpc, p.registration.args)).rejects.toThrow("retained commerce");
    expect((await db.query("select * from lean_private.spend_jobs")).rows).toEqual([]);
    await register();
    expect((await db.query(`select enabled from lean_private.full_builds union all
      select enabled from lean_private.report_builds union all select enabled from lean_private.spend_pilots union all
      select enabled from lean_private.spend_jobs`)).rows).toEqual(Array.from({ length: 4 }, () => ({ enabled: false })));
    const acl = (await db.query(`select
      has_function_privilege('service_role','public.lean_google_workbook_register(jsonb)','EXECUTE') registration,
      has_function_privilege('service_role','public.lean_google_delivery_read(text,text,text,text,text)','EXECUTE') reader,
      has_function_privilege('anon','public.lean_google_delivery_read(text,text,text,text,text)','EXECUTE') anon_reader,
      has_table_privilege('service_role','lean_private.report_google_account_daily','SELECT,INSERT,UPDATE,DELETE') raw`)).rows[0];
    expect(acl).toEqual({ registration: false, reader: true, anon_reader: false, raw: false });
    await expect(rpc(p.registration.rpc, p.registration.args)).rejects.toThrow();
  });
  it("commits full and optional results atomically, then reads only an explicitly enabled matching selection", async () => {
    await retainedBase();
    expect(await build()).toMatchObject({ state: "complete" });
    expect(calls).toEqual(["lean_full_inputs", "lean_full_claim", "lean_google_delivery_finish"]);
    const saved = (await db.query<{ full_result_hash: string; row_hash: string; report: Record<string, unknown> }>(
      "select * from lean_private.report_google_account_daily")).rows[0];
    expect(saved.report).toMatchObject({ spend_usd: "12.000000", ctr: "0.200000", cpc_usd: "3.000000" });
    expect(await read(saved.full_result_hash)).toBeNull();
    expect(await rpc("lean_google_delivery_select", { p_run: "google-fixture", p_project_ref: f.input.projectRef,
      p_result_hash: saved.full_result_hash, p_row_hash: saved.row_hash, p_expected_revision: 0,
      p_approval: "fixture:output", p_reconciliation: "fixture:independent-controls",
      p_not_before: new Date(Date.now() - 1000).toISOString(),
      p_expires_at: new Date(Date.now() + 60000).toISOString(), p_is_stale: false })).toBe(1);
    expect(await read(saved.full_result_hash)).toBeNull();
    await db.exec("update lean_private.google_delivery_selection set enabled=true");
    expect(await read(saved.full_result_hash)).toMatchObject({
      google_account_daily: [{ spend_usd: "12.000000", readiness: { ctr: "ready" }, is_stale: false }],
      google_delivery_status: { report_scope: "single_google_account", selection_revision: "1" },
    });
    expect(await read("wrong-result")).toBeNull();
    await db.exec("update lean_private.full_builds set enabled=false");
    expect(await read(saved.full_result_hash)).toBeNull();
  });
  it("rolls back full completion and reports if optional persistence fails", async () => {
    await retainedBase();
    await db.exec(`create function public.fixture_google_reject() returns trigger language plpgsql as
      $$ begin raise exception 'fixture optional failure'; end $$;
      create trigger fixture_google_reject before insert on lean_private.report_google_account_daily
      for each row execute function public.fixture_google_reject();`);
    try {
      await expect(build()).rejects.toThrow();
      expect((await db.query("select completed_at from lean_private.full_builds")).rows[0]).toEqual({ completed_at: null });
      expect((await db.query("select * from lean_private.report_google_account_daily")).rows).toEqual([]);
      expect((await db.query("select * from lean_private.report_store_daily where publication_id='full:google-fixture'")).rows).toEqual([]);
      expect(calls).not.toContain("lean_full_fail");
    } finally {
      await db.exec("drop trigger fixture_google_reject on lean_private.report_google_account_daily; drop function public.fixture_google_reject();");
    }
  });
  it("prevents the old finish RPC from silently omitting a registered optional row", async () => {
    await retainedBase();
    const bypass: AnalyticsRpcClient = { async rpc(name, args) {
      if (name !== "lean_google_delivery_finish") return client.rpc(name, args);
      const { p_google_report, ...old } = args; void p_google_report;
      try { return { data: await rpc("lean_full_finish", old), error: null }; }
      catch (error) { return { data: null, error }; }
    } };
    await expect(runFullReportJob({ client: bypass, projectRef: f.input.projectRef,
      databaseUrl: `https://${f.input.projectRef}.supabase.co`, runId: "google-fixture", posthogKey: "" })).rejects.toThrow();
    expect((await db.query("select completed_at from lean_private.full_builds")).rows[0]).toEqual({ completed_at: null });
    expect((await db.query("select * from lean_private.report_google_account_daily")).rows).toEqual([]);
  });
});
