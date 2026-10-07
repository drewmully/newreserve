import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { prepareGoogleWorkbookRegistration } from "@/lib/analytics/googleWorkbookRegistration";
import { prepareFreshGoogleSpend } from "@/lib/analytics/googleSpendRegistration";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import { runGoogleStandingPipeline } from "@/lib/analytics/googleStandingOperation";
import { normalizeSpendBase } from "@/lib/analytics/spend";
import { key } from "@/lib/analytics/primitives";
import { googleDeliveryFixture } from "../fixtures/analyticsGoogleDelivery";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";

describe("standing Google, actual saved-generation SQL, no hosted calls", () => {
  let db: PGlite;
  const project = "xnfjdbpjuaezxjgargto";
  const token = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa";
  async function rpc(name: string, args: Record<string, unknown>) {
    const entries = Object.entries(args);
    return (await db.query<{ result: unknown }>(`select public.${name}(${
      entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) result`,
    entries.map(([, v]) => v !== null && typeof v === "object" ? JSON.stringify(v) : v))).rows[0].result;
  }
  const bound = { p_project_ref: project, p_policy: "fixture-policy", p_revision: "1" };
  const next = () => rpc("lean_google_standing_next", { ...bound, p_token: token });
  const finish = (run = "google-fixture", state = "complete") => rpc("lean_google_standing_finish",
    { ...bound, p_run: run, p_token: token, p_state: state });
  const read = () => rpc("lean_google_standing_read", { ...bound, p_account_id: "1234567890" });
  const health = () => rpc("lean_google_standing_health", bound);
  const client: AnalyticsRpcClient = { async rpc(name, args) {
    if (!["lean_full_inputs", "lean_full_claim", "lean_full_fail", "lean_google_delivery_finish"].includes(name))
      throw new Error("unexpected_rpc");
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
      "053_production_workbook_delivery", "google_workbook_registration.review", "google_delivery_output.review",
      "google_standing_operation.review"])
      await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
  }, 30000);
  beforeEach(async () => {
    await db.exec(`truncate lean_private.google_standing_policy cascade;
      truncate lean_private.full_builds cascade; truncate lean_private.report_builds cascade;
      truncate lean_private.publications cascade; truncate lean_private.history_jobs cascade;
      truncate lean_private.spend_pilots cascade; truncate lean_private.spend_jobs cascade;
      truncate lean_private.google_delivery_selection;`);
    await db.exec(`insert into lean_private.google_standing_policy(
      policy_id,revision,project_ref,shop,account_id,login_customer_id,from_date,through_date,
      not_before,expires_at,max_generations,max_steps_per_run,min_interval_seconds,step_timeout_seconds,
      selection_seconds,max_source_age_seconds,max_import_age_seconds,destination_project,destination_source,
      destination_table,approval_ref,actor_ref,selection_revision)
      values('fixture-policy',1,'${project}','mullybox-store.myshopify.com','1234567890','9876543210',
      '2026-01-01','2026-01-01',clock_timestamp()-interval '1 hour',clock_timestamp()+interval '30 minutes',
      2,3,1,80,60,3600,60,'353503','11111111-1111-4111-8111-111111111111',
      '22222222-2222-4222-8222-222222222222','fixture:approval','fixture:owner',0);
      insert into lean_private.history_jobs(run_id,project_ref,shop,from_time,until_time,
      page_size,max_pages,approval_ref,actor_ref,enabled,page_count,row_count,complete)
      values('fixture-history','${project}','mullybox-store.myshopify.com','2026-01-01','2026-01-02',
      1,1,'fixture:history','fixture:owner',true,1,1,true);
      insert into lean_private.history_pages(run_id,page_number,expected_cursor,next_cursor,complete,rows)
      values('fixture-history',0,null,null,true,'[{"source":{"fixture":true},"evidenceRef":"fixture:retained"}]');`);
  });
  afterAll(async () => db?.close());
  async function prepare(run = "google-fixture", now = Date.now() - 5000, changed = false, controlComplete = true,
    controlTimes?: { cost: number; count: number }) {
    // Synthetic evidence only; bind the fixture to this migration's fixed target.
    const f = JSON.parse(JSON.stringify(googleDeliveryFixture(now))
      .replaceAll("aaaaaaaaaaaaaaaaaaaa", project)
      .replaceAll(key("fixture.myshopify.com", "1"), key("mullybox-store.myshopify.com", "1"))
      .replaceAll(key("fixture.myshopify.com", "1", "2"), key("mullybox-store.myshopify.com", "1", "2"))
      .replaceAll(key("fixture.myshopify.com", "fixture", "4"), key("mullybox-store.myshopify.com", "fixture", "4"))
      .replaceAll("fixture.myshopify.com", "mullybox-store.myshopify.com")) as ReturnType<typeof googleDeliveryFixture>;
    const base = `${run}-base`;
    f.packet.runId = run; f.packet.baseRunId = base;
    f.fresh.bases[0].baseReportId = prepareFreshGoogleSpend(f.fresh.manifest).registration.args.p_scope.days[0].runId;
    f.fresh.bases[0].evidenceRef = `lean_private.spend_jobs/${f.fresh.bases[0].baseReportId}`;
    if (changed) {
      f.fresh.bases[0].rows[0].costMicros = "4000000";
      f.fresh.controls[0].campaigns[0].costMicros = "4000000";
      f.fresh.controls[0].totalCostMicros = "13000000";
    }
    f.packet.freshGoogleSpend.controls = f.fresh.controls;
    f.packet.googleDelivery.control.complete = controlComplete;
    if (controlTimes) {
      f.fresh.controls[0].capturedAt = new Date(now + controlTimes.cost).toISOString();
      f.packet.googleDelivery.control.capturedAt = new Date(now + controlTimes.count).toISOString();
    }
    const p = prepareGoogleWorkbookRegistration(f.packet);
    await rpc(p.registration.rpc, p.registration.args);
    await db.exec(`update lean_private.spend_pilots set enabled=true; update lean_private.spend_jobs set enabled=true;`);
    await db.query(`update lean_private.report_builds set enabled=true,completed_at=clock_timestamp(),
      result_hash='fixture-retained' where run_id=$1`, [base]);
    await db.query("update lean_private.full_builds set enabled=true where run_id=$1", [run]);
    await db.query(`insert into lean_private.publications(publication_id,contract_version) values($1,'lean-v1-draft.1')`,
      [`observed:${base}`]);
    await db.query("update lean_private.spend_jobs set base=$1 where run_id=$2",
      [JSON.stringify(f.fresh.bases[0]), f.fresh.bases[0].baseReportId]);
    const facts = { ...f.full.base, marketing_spend_daily: normalizeSpendBase(f.fresh.bases[0], `observed:${base}`) };
    for (const [name, rows] of Object.entries(facts))
      await db.query(`insert into lean_private.${name} select * from jsonb_populate_recordset(null::lean_private.${name},$1)`,
        [JSON.stringify(rows.map(row => ({ ...row, publication_id: `observed:${base}` })))]);
    return f;
  }
  const enqueue = (run = "google-fixture") => rpc("lean_google_standing_enqueue", {
    p_policy: bound.p_policy, p_revision: "1", p_run: run, p_reconciliation: "fixture:independent-controls" });
  const build = (run = "google-fixture") => runFullReportJob({ client, projectRef: project,
    databaseUrl: `https://${project}.supabase.co`, runId: run, posthogKey: "",
    request: async () => { throw new Error("hosted_network_forbidden"); } });
  const enable = () => db.exec("update lean_private.google_standing_policy set enabled=true");
  async function first() {
    await prepare(); await enqueue(); await enable();
    expect(await next()).toMatchObject({ state: "ready" });
    expect(await build()).toMatchObject({ state: "complete" });
    expect(await finish()).toEqual({ state: "complete", selectionRevision: "1" });
  }
  it("stays default off and retains owner-only registration, selector and evidence", async () => {
    await prepare(); await enqueue();
    expect(await next()).toEqual({ state: "disabled" });
    expect(await read()).toBeNull();
    const row = (await db.query(`select
      has_function_privilege('service_role','public.lean_google_standing_enqueue(text,bigint,text,text)','EXECUTE') enqueue,
      has_function_privilege('service_role','public.lean_google_standing_accept_import(text,bigint,jsonb)','EXECUTE') evidence,
      has_function_privilege('service_role','public.lean_google_delivery_select(text,text,text,text,bigint,text,text,timestamptz,timestamptz,boolean)','EXECUTE') selector,
      has_function_privilege('service_role','public.lean_google_standing_next(text,text,bigint,uuid)','EXECUTE') next,
      has_function_privilege('anon','public.lean_google_standing_read(text,text,bigint,text)','EXECUTE') anon,
      has_table_privilege('service_role','lean_private.google_standing_policy','SELECT,INSERT,UPDATE,DELETE') raw`)).rows[0];
    expect(row).toEqual({ enqueue: false, evidence: false, selector: false, next: true, anon: false, raw: false });
  });
  it("runs the unchanged full-pipeline stage and atomic standing selector together", async () => {
    await prepare(); await enqueue(); await enable();
    const calls: string[] = [];
    const transport: AnalyticsRpcClient = { rpc(name, args) {
      let signal: AbortSignal | undefined;
      const request = {
        abortSignal(s: AbortSignal) { signal = s; return request; },
        then(resolve: (v: { data: unknown; error: unknown }) => unknown, reject: (e: unknown) => unknown) {
          signal?.throwIfAborted(); calls.push(name);
          return rpc(name, args).then(data => ({ data, error: null }), error => ({ data: null, error })).then(resolve, reject);
        },
      };
      return request as ReturnType<AnalyticsRpcClient["rpc"]>;
    } };
    expect(await runGoogleStandingPipeline({ client: transport, projectRef: project,
      databaseUrl: `https://${project}.supabase.co`, runId: "", shop: "mullybox-store.myshopify.com",
      shopifyToken: "", posthogKey: "", googleClientId: "", googleClientSecret: "", googleRefreshToken: "",
      now: new Date().toISOString(), request: async () => { throw new Error("hosted_network_forbidden"); },
    }, { policy: "fixture-policy", revision: "1" })).toEqual({ state: "complete", selectionRevision: "1" });
    expect(calls).toEqual(["lean_google_standing_next", "lean_full_next", "lean_full_inputs", "lean_full_claim",
      "lean_google_delivery_finish", "lean_google_standing_finish"]);
    expect(await read()).toMatchObject({ google_account_daily: [{ spend_usd: "12.000000" }] });
  });
  it("advances distinct changed-input generations once without rewriting delivery bindings", async () => {
    await first();
    expect(await read()).toMatchObject({ google_account_daily: [{ spend_usd: "12.000000" }] });
    await expect(enqueue()).rejects.toThrow();
    await expect(finish()).rejects.toThrow("standing lease");
    await prepare("google-second", Date.now() - 500, true); await enqueue("google-second");
    await new Promise(resolve => setTimeout(resolve, 1050));
    expect(await next()).toMatchObject({ state: "ready", runId: "google-second" });
    expect(await next()).toEqual({ state: "held" });
    expect(await build("google-second")).toMatchObject({ state: "complete" });
    expect(await finish("google-second")).toEqual({ state: "complete", selectionRevision: "2" });
    expect(await read()).toMatchObject({ google_account_daily: [{ spend_usd: "13.000000", cpc_usd: "3.250000" }],
      google_delivery_status: { run_id: "google-second", selection_revision: "2" } });
    expect(await next()).toEqual({ state: "exhausted" });
    expect((await db.query("select state,steps from lean_private.google_standing_runs order by run_id")).rows)
      .toEqual([{ state: "complete", steps: 1 }, { state: "complete", steps: 1 }]);
    await expect(db.exec("delete from lean_private.google_standing_runs")).rejects.toThrow("audit immutable");
  });
  it("refuses wrong scope, policy revision, token and duplicate admission", async () => {
    await prepare(); await enqueue(); await enable();
    expect(await rpc("lean_google_standing_next", { ...bound, p_revision: null, p_token: token })).toEqual({ state: "disabled" });
    expect(await rpc("lean_google_standing_next", { ...bound, p_project_ref: "wrong", p_token: token })).toEqual({ state: "disabled" });
    await expect(enqueue()).rejects.toThrow();
    await next();
    await expect(rpc("lean_google_standing_finish", { ...bound, p_run: "google-fixture",
      p_state: "complete", p_token: "bbbbbbbb-bbbb-4bbb-bbbb-bbbbbbbbbbbb" })).rejects.toThrow("standing lease");
    expect(await rpc("lean_google_standing_read", { ...bound, p_account_id: "9999999999" })).toBeNull();
  });
  it("holds failures and rejects revocation re-enable", async () => {
    await prepare(); await enqueue(); await enable(); await next();
    expect(await finish("google-fixture", "failed")).toEqual({ state: "held" });
    expect(await next()).toEqual({ state: "held" });
    expect(await health()).toMatchObject({ issues: expect.arrayContaining(["google_succession_held"]) });
    await db.exec("update lean_private.google_standing_policy set enabled=false");
    expect(await read()).toBeNull();
    await expect(enable()).rejects.toThrow("revoked");
  });
  it("refuses a stale or tampered saved native base instead of selecting a completed result", async () => {
    await prepare(); await enqueue(); await enable(); await next(); await build();
    await expect(db.exec(`update lean_private.spend_jobs set base=jsonb_set(base,'{completedAt}',to_jsonb('2020-01-01T00:00:00Z'::text))`))
      .rejects.toThrow("spend base immutable");
    // Immutable native capture cannot be substituted. Tighten freshness only
    // in this disposable fixture to exercise the final stale-source guard.
    await db.exec(`alter table lean_private.google_standing_policy disable trigger google_standing_policy_guard;
      update lean_private.google_standing_policy set max_source_age_seconds=1;
      alter table lean_private.google_standing_policy enable trigger google_standing_policy_guard;`);
    await expect(finish()).rejects.toThrow("standing source stale");
    expect(await read()).toBeNull();
    expect(await next()).toEqual({ state: "held" });
  });
  it("refuses incomplete independent controls even after the full run completes", async () => {
    await prepare("google-fixture", Date.now() - 5000, false, false);
    await enqueue(); await enable(); await next();
    expect(await build()).toMatchObject({ state: "complete" });
    await expect(finish()).rejects.toThrow("standing independent controls incomplete");
    expect(await read()).toBeNull();
  });
  it("does not re-enable a revoked policy which has not yet run", async () => {
    await enable(); await db.exec("update lean_private.google_standing_policy set enabled=false");
    await expect(enable()).rejects.toThrow("revoked");
  });
  it("keeps missing import proof and finite selection expiry visible", async () => {
    await first();
    expect(await health()).toMatchObject({ state: "attention", googleImportAcceptanceVerified: false,
      issues: expect.arrayContaining(["google_import_unverified"]) });
    await db.exec(`update lean_private.google_delivery_selection set
      not_before=clock_timestamp()-interval '2 minutes',expires_at=clock_timestamp()-interval '1 minute'`);
    expect(await read()).toBeNull();
    expect(await health()).toMatchObject({ issues: expect.arrayContaining(["google_selection_expired"]) });
  });
  it.each(["cost", "count"] as const)("caps serving at the earlier %s control clock", async earlier => {
    // Create the fixture policy with an explicit ten-second age limit. Do not
    // mutate an active policy or disable an immutability trigger for this proof.
    const policy = (await db.query<{ p: Record<string, unknown> }>(
      "select to_jsonb(p) p from lean_private.google_standing_policy p")).rows[0].p;
    await db.exec("truncate lean_private.google_standing_policy cascade");
    await db.query(`insert into lean_private.google_standing_policy
      select * from jsonb_populate_record(null::lean_private.google_standing_policy,$1)`,
    [JSON.stringify({ ...policy, max_source_age_seconds: 10 })]);
    const asof = Date.now() - 100;
    const f = await prepare("google-fixture", asof, false, true,
      earlier === "cost" ? { cost: -7000, count: -5000 } : { cost: -5000, count: -7000 });
    await enqueue(); await enable(); await next();
    expect(await build()).toMatchObject({ state: "complete" });
    expect(await finish()).toEqual({ state: "complete", selectionRevision: "1" });
    const selection = (await db.query<{ expiry: string }>(
      "select expires_at::text expiry from lean_private.google_delivery_selection")).rows[0];
    const expected = asof - 7000 + 10000;
    expect(Date.parse(selection.expiry)).toBe(expected);
    expect(await read()).not.toBeNull();
    await new Promise(resolve => setTimeout(resolve, Math.max(1, expected - Date.now() + 25)));
    expect(Date.now()).toBeLessThan(Date.parse(f.fresh.bases[0].completedAt) + 10000);
    expect(await read()).toBeNull();
    expect(await health()).toMatchObject({ issues: expect.arrayContaining(["google_selection_expired"]) });
  });
  it("accepts only a separately observed exact dedicated-resource rowset and fresh completed job", async () => {
    await first();
    const body = await read() as { google_account_daily: unknown[] };
    const now = new Date().toISOString();
    const evidence = { runId: "google-fixture", selectionRevision: "1", projectId: "353503",
      sourceId: "11111111-1111-4111-8111-111111111111", tableId: "22222222-2222-4222-8222-222222222222",
      resource: "google_account_daily", jobId: "fixture:job", status: "completed",
      startedAt: now, completedAt: now, checkedAt: now, evidenceRef: "fixture:offline-only",
      complete: true, wholeTable: true, unfiltered: true, independentlyExtracted: true,
      nextCursor: null, rows: body.google_account_daily };
    const accept = (e: object) => rpc("lean_google_standing_accept_import",
      { p_policy: bound.p_policy, p_revision: "1", p_evidence: e });
    for (const bad of [{ rows: [] }, { sourceId: "wrong" }, { wholeTable: false },
      { nextCursor: "more" }, { selectionRevision: "0" }, { independentlyExtracted: false }])
      await expect(accept({ ...evidence, ...bad })).rejects.toThrow("independent Google import");
    expect(await accept(evidence)).toBe(true);
    expect(await health()).toEqual({ state: "healthy", issues: [], googleImportAcceptanceVerified: true,
      posthogReadbackVerified: false });
    await expect(accept(evidence)).rejects.toThrow();
    await expect(db.exec("delete from lean_private.google_standing_imports")).rejects.toThrow("audit immutable");
    await db.exec("update lean_private.google_standing_policy set enabled=false");
    expect(await read()).toBeNull();
    expect((await db.query("select enabled from lean_private.google_delivery_selection")).rows).toEqual([{ enabled: false }]);
    expect(await health()).toMatchObject({ state: "attention", googleImportAcceptanceVerified: false });
  });
});
