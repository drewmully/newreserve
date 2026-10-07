import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { PGlite as PGliteType } from "@electric-sql/pglite";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { googleDeliveryFixture } from "../fixtures/analyticsGoogleDelivery";
import { prepareMetaSpendDay, type MetaSpendDay } from "@/lib/analytics/metaSpendInput";
import { prepareMultiProviderSpendBuild, type MultiProviderSpendInput } from "@/lib/analytics/multiProviderSpendInput";
import { prepareMetaSpendRegistration, prepareMultiProviderSpendBinding } from "@/lib/analytics/multiProviderSpendRegistration";
import { prepareGoogleWorkbookRegistration } from "@/lib/analytics/googleWorkbookRegistration";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { guardFreshGoogleSpendReports } from "@/lib/analytics/googleSpendReportInput";
import { normalizeSpendBase } from "@/lib/analytics/spend";
import { key } from "@/lib/analytics/primitives";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
const { PGlite } = createRequire(import.meta.url)("@electric-sql/pglite") as typeof import("@electric-sql/pglite");

export function marketingFixture() {
  const f = googleDeliveryFixture();
  const day: MetaSpendDay = { version: 1, projectRef: f.input.projectRef, shop: f.input.shop,
    generationId: "meta-fixture-day", accountId: "act_987654321", date: f.input.fromDate,
    sourceCurrency: "USD", sourceTimezone: "America/New_York", approvalRef: "fixture:meta-source", actorRef: "fixture:owner",
    source: { evidenceRef: "fixture:meta-native", accountMetadataRef: "fixture:meta-account",
      capturedAt: f.fresh.bases[0].completedAt, complete: true, paginationComplete: true, verifiedEmpty: false,
      rows: ["100", "300"].map((cents, i) => ({ snapshot_date: f.input.fromDate, ad_account_id: "act_987654321",
        campaign_id: "9", adset_id: String(i + 1), spend_cents: cents })) },
    control: { evidenceRef: "fixture:independent-meta", approvalRef: "fixture:meta-control",
      capturedAt: f.fresh.controls[0].capturedAt, complete: true, independentlyExtracted: true,
      verifiedEmpty: false, totalCostMicros: "4000000", campaigns: [{ id: "9", costMicros: "4000000" }] } };
  const combined: MultiProviderSpendInput = { version: 1, projectRef: f.input.projectRef, shop: f.input.shop,
    runId: f.packet.runId, metaDays: [day], inventory: { ...f.fresh.marketingInventory, complete: true,
      accounts: [{ provider: "google_ads", accountId: f.binding.accountId }, { provider: "meta_ads", accountId: day.accountId }],
      salesScope: "whole_store_eligible_ledger", salesCoverageRef: "fixture:ledger",
      customerScope: "whole_store_eligible_customers", customerCoverageRef: "fixture:customers" } };
  const base = structuredClone(f.full.base);
  base.marketing_spend_daily = f.fresh.bases.flatMap(b => normalizeSpendBase(b, "observed:google-base"));
  const evidence = structuredClone(f.full.evidence);
  // Independent synthetic expected keys/amounts, not derived from normalized facts.
  evidence.proofs = evidence.proofs.filter(p => p.table !== "marketing_spend_daily");
  evidence.proofs.push({ table: "marketing_spend_daily",
    keyFields: ["provider", "account_id", "campaign_key", "report_date", "base_report_id"],
    expectedKeys: [
      ...["7", "8"].map(id => JSON.stringify(["google_ads", "1234567890", key("google_ads", "1234567890", id),
        "2026-01-01", f.fresh.bases[0].baseReportId])),
      JSON.stringify(["meta_ads", "act_987654321", key("meta_ads", "act_987654321", "9"), "2026-01-01", day.generationId]),
    ], amountChecks: [{ field: "spend_usd", expectedTotal: "16.000000" }],
    evidenceRef: "fixture:independent-combined-proof", complete: true, independentlyExtracted: true });
  f.packet.evidence = evidence;
  const input = { combined, freshGoogleSpend: f.fresh, base, evidence,
    projectRef: f.input.projectRef, publication: f.input.publication, shop: f.input.shop,
    fromDate: f.input.fromDate, throughDate: f.input.throughDate, asOf: f.input.asOf };
  return { f, day, combined, input };
}

it("adds Meta at campaign/day grain and uses the existing MER and nCAC formulas", () => {
  const { f, input } = marketingFixture(), original = structuredClone(input);
  const ready = prepareMultiProviderSpendBuild(input);
  expect(ready.base.marketing_spend_daily).toHaveLength(3);
  expect(ready.base.marketing_spend_daily[2]).toMatchObject({ provider: "meta_ads", spend_usd: "4.000000",
    clicks: null, impressions: null, click_definition: null });
  const report = buildFullReports({ ...f.full, base: ready.base, evidence: ready.evidence,
    policy: f.packet.fullPolicy, events: [] });
  guardFreshGoogleSpendReports(report.reports, ready.storeRatioAdmission);
  expect(report.reports.store_daily[0]).toMatchObject({ spend_usd: "16.000000", mer: "1.250000", ncac_usd: "16.000000" });
  expect(input).toEqual(original);
});
it.each(["incomplete", "additional_provider", "missing_proof", "missing_customer_scope", "missing_ledger_scope"] as const)(
  "keeps %s distinct from verified all-marketing and ratio admission", missing => {
    const { f, input } = marketingFixture();
    if (missing === "incomplete") input.combined.inventory.complete = false;
    if (missing === "additional_provider") input.combined.inventory.accounts.push({ provider: "other_ads", accountId: "unverified" });
    if (missing === "missing_proof") input.evidence.proofs = input.evidence.proofs.filter(p => p.table !== "marketing_spend_daily");
    if (missing === "missing_customer_scope") input.combined.inventory.customerScope = "unverified";
    if (missing === "missing_ledger_scope") input.combined.inventory.salesScope = "unverified";
    const ready = prepareMultiProviderSpendBuild(input);
    const report = buildFullReports({ ...f.full, base: ready.base, evidence: ready.evidence, policy: f.packet.fullPolicy, events: [] });
    guardFreshGoogleSpendReports(report.reports, ready.storeRatioAdmission);
    expect(report.reports.store_daily[0]).toMatchObject(
      missing === "missing_customer_scope" ? { spend_usd: "16.000000", mer: "1.250000", ncac_usd: null } :
        missing === "missing_ledger_scope" ? { spend_usd: "16.000000", mer: null, ncac_usd: "16.000000" } :
          { spend_usd: null, mer: null, ncac_usd: null });
  });
it.each(["newline", "packet_newline", "duplicate_row", "duplicate_day", "duplicate_inventory", "negative", "wrong_currency",
  "wrong_timezone", "stale_control", "incomplete_control", "not_independent", "different_campaign",
  "google_mismatch", "observed_generation"] as const)("refuses %s without changing source facts", bad => {
  const { input, day } = marketingFixture();
  if (bad === "newline") day.source.rows[0].ad_account_id += "\n";
  if (bad === "packet_newline") { day.accountId += "\n"; day.source.rows.forEach(row => { row.ad_account_id = day.accountId; }); }
  if (bad === "duplicate_row") day.source.rows.push(day.source.rows[0]);
  if (bad === "duplicate_day") input.combined.metaDays.push({ ...day, generationId: "conflict" });
  if (bad === "duplicate_inventory") input.combined.inventory.accounts.push(input.combined.inventory.accounts[0]);
  if (bad === "negative") day.source.rows[0].spend_cents = -1;
  if (bad === "wrong_currency") day.sourceCurrency = "CAD";
  if (bad === "wrong_timezone") day.sourceTimezone = "UTC";
  if (bad === "stale_control") day.control.capturedAt = "2026-01-02T00:00:00Z";
  if (bad === "incomplete_control") day.control.complete = false;
  if (bad === "not_independent") day.control.evidenceRef = day.source.evidenceRef;
  if (bad === "different_campaign") day.source.rows[0].campaign_id = "10";
  if (bad === "google_mismatch") input.freshGoogleSpend.controls[0].campaigns[0].costMicros = "1";
  if (bad === "observed_generation") input.base.marketing_spend_daily[0].base_report_id = "different";
  expect(() => prepareMultiProviderSpendBuild(input)).toThrow();
});
it("requires an explicit empty account-day control instead of inferring zero", () => {
  const { day, input } = marketingFixture();
  day.source.rows = []; day.control.campaigns = []; day.control.totalCostMicros = "0";
  const scope = { ...input, freshnessCutoffAt: (input.freshGoogleSpend.manifest as { freshnessCutoffAt: string }).freshnessCutoffAt };
  expect(() => prepareMetaSpendDay(day, scope)).toThrow();
  day.source.verifiedEmpty = day.control.verifiedEmpty = true;
  expect(prepareMetaSpendDay(day, scope).facts[0]).toMatchObject({ spend_usd: "0.000000", clicks: null });
});

describe("actual SQL registration and current full-input/finish boundary", () => {
  let db: PGliteType;
  let fixture: ReturnType<typeof marketingFixture>;
  const sqlFile = "sql/analytics/multi_provider_spend_input.review.sql";
  const rpc = async (name: string, args: Record<string, unknown>) => {
    const entries = Object.entries(args);
    return (await db.query<{ value: unknown }>(`select public.${name}(${
      entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) value`, entries.map(([k, v]) =>
      k === "p_generations" ? v : v !== null && typeof v === "object" ? JSON.stringify(v) : v))).rows[0].value;
  };
  const client: AnalyticsRpcClient = { async rpc(name, args) {
    try { return { data: await rpc(name, args), error: null }; } catch (error) { return { data: null, error }; }
  } };
  beforeAll(async () => {
    db = new PGlite();
    // PGlite errors retain the query/runtime. Keep a failed setup printable by
    // the test runner without serializing the entire WASM database.
    try {
    await db.exec("create role anon; create role authenticated; create role service_role;");
    for (const name of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs", "019_spend_jobs",
      "020_observed_report_jobs", "021_full_report_jobs", "022_full_release", "023_posthog_export", "024_full_orchestration",
      "026_journey_authority", "029_journey_decisions", "030_scoped_release", "038_google_spend_pilot",
      "053_production_workbook_delivery", "google_workbook_registration.review", "google_delivery_output.review"])
      await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
    let unboundError = "";
    try { await db.exec(readFileSync(sqlFile, "utf8")); }
    catch (error) { unboundError = error instanceof Error ? error.message : String(error); }
    expect(unboundError).toContain("UNBOUND");
    await db.exec("rollback");
    const pins = (await db.query<{ pins: unknown }>(`select jsonb_agg(jsonb_build_object(
      'signature',n.nspname||'.'||p.proname||'('||replace(oidvectortypes(p.proargtypes),', ',',')||')',
      'oid',p.oid::text,'ownerOid',p.proowner::text,
      'definitionSha256',encode(sha256(convert_to(pg_get_functiondef(p.oid),'UTF8')),'hex'),
      'aclSha256',encode(sha256(convert_to(coalesce(p.proacl::text,'null'),'UTF8')),'hex'))) pins
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and
      (p.proname like 'lean_full_inputs%' or p.proname like 'lean_full_finish%' or p.proname='lean_google_delivery_finish')`)).rows[0].pins;
    await db.query("select set_config('lean.marketing_install_contract',$1,false)", [JSON.stringify(pins)]);
    await db.exec(readFileSync(sqlFile, "utf8"));
    } catch (error) {
      throw new Error(error instanceof Error ? error.message : String(error));
    }
  }, 60000);
  beforeEach(async () => {
    fixture = marketingFixture();
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network forbidden"); }));
    await db.exec(`truncate lean_private.marketing_spend_bindings,lean_private.marketing_spend_days;
      truncate lean_private.full_builds cascade; truncate lean_private.report_builds cascade;
      truncate lean_private.publications cascade; truncate lean_private.history_jobs cascade;
      truncate lean_private.spend_pilots cascade; truncate lean_private.spend_jobs cascade;`);
  });
  afterEach(() => { expect(fetch).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
  afterAll(async () => { await db?.close(); });
  async function register(bound: boolean) {
    const { f, day, combined } = fixture;
    await db.query(`insert into lean_private.history_jobs(run_id,project_ref,shop,from_time,until_time,
      page_size,max_pages,approval_ref,actor_ref,enabled,page_count,row_count,complete)
      values('fixture-history',$1,$2,'2026-01-01','2026-01-02',1,1,'fixture:history','fixture:owner',true,1,1,true)`,
    [f.input.projectRef, f.input.shop]);
    await db.exec(`insert into lean_private.history_pages(run_id,page_number,expected_cursor,next_cursor,complete,rows)
      values('fixture-history',0,null,null,true,'[{"source":{"fixture":true},"evidenceRef":"fixture:retained"}]');`);
    const p = prepareGoogleWorkbookRegistration(f.packet);
    await rpc(p.registration.rpc, p.registration.args);
    if (bound) {
      const meta = prepareMetaSpendRegistration(day, { freshnessCutoffAt: f.prepared.manifest.freshnessCutoffAt, asOf: f.input.asOf });
      await rpc(meta.registration.rpc, meta.registration.args);
      const binding = prepareMultiProviderSpendBinding({ runId: f.packet.runId, projectRef: f.input.projectRef,
        generationIds: [day.generationId], inventory: combined.inventory, approvalRef: "fixture:bind", actorRef: "fixture:owner" });
      await rpc(binding.registration.rpc, binding.registration.args);
    }
    await db.exec(`update lean_private.spend_pilots set enabled=true; update lean_private.spend_jobs set enabled=true;
      update lean_private.report_builds set enabled=true,completed_at=clock_timestamp(),result_hash='fixture-retained';
      update lean_private.full_builds set enabled=true;
      insert into lean_private.publications(publication_id,contract_version) values('observed:google-base','lean-v1-draft.1');`);
    await db.query("update lean_private.spend_jobs set base=$1", [JSON.stringify(f.fresh.bases[0])]);
    for (const [name, rows] of Object.entries(fixture.input.base)) {
      await db.query(`insert into lean_private.${name} select * from jsonb_populate_recordset(null::lean_private.${name},$1)`,
        [JSON.stringify(rows.map(row => ({ ...row, publication_id: "observed:google-base" })))]);
    }
  }
  const args = () => ({ p_run: fixture.f.packet.runId, p_project_ref: fixture.f.input.projectRef });
  const build = (rpcClient = client) => runFullReportJob({ client: rpcClient, projectRef: fixture.f.input.projectRef,
    databaseUrl: `https://${fixture.f.input.projectRef}.supabase.co`, runId: fixture.f.packet.runId, posthogKey: "" });
  const enable = () => db.exec("update lean_private.marketing_spend_days set enabled=true; update lean_private.marketing_spend_bindings set enabled=true");

  it("preserves unbound input byte structure and rejects direct runtime alias calls", async () => {
    await register(false);
    expect(await rpc("lean_full_inputs", args())).toEqual(await rpc("lean_full_inputs_before_marketing", args()));
    await db.exec("set role service_role");
    try { await expect(rpc("lean_full_inputs_before_marketing", args())).rejects.toThrow("permission denied"); }
    finally { await db.exec("reset role"); }
    expect((await db.query(`select has_function_privilege('service_role','public.lean_full_inputs(text,text)','EXECUTE') allowed,
      has_function_privilege('service_role','public.lean_marketing_spend_day_register(jsonb)','EXECUTE') registrar`)).rows[0])
      .toEqual({ allowed: true, registrar: false });
  });
  it("remains disabled until both registrations are explicitly enabled; source/control/inventory cannot change", async () => {
    await register(true);
    expect(await rpc("lean_full_inputs", args())).toEqual({ state: "blocked" });
    await db.exec("update lean_private.marketing_spend_bindings set enabled=true");
    expect(await rpc("lean_full_inputs", args())).toEqual({ state: "blocked" });
    await enable();
    expect(await rpc("lean_full_inputs", args())).toMatchObject({ state: "ready", multiProviderSpend: fixture.combined });
    await expect(db.exec("update lean_private.marketing_spend_bindings set inventory='{}'")).rejects.toThrow("immutable");
    await expect(db.exec("delete from lean_private.marketing_spend_days")).rejects.toThrow("immutable");
    await expect(db.exec("update lean_private.marketing_spend_days set packet=packet||'{\"actorRef\":\"changed\"}'")).rejects.toThrow("immutable");
  });
  it("runs the real combined full build and atomic P3 finish without altering Google-only output", async () => {
    await register(true); await enable();
    expect(await build()).toMatchObject({ state: "complete" });
    expect((await db.query("select spend_usd::text,mer::text,ncac_usd::text from lean_private.report_store_daily")).rows[0])
      .toMatchObject({ spend_usd: "16.000000", mer: "1.250000", ncac_usd: "16.000000" });
    expect((await db.query<{ report: { spend_usd: string } }>("select report from lean_private.report_google_account_daily")).rows[0].report.spend_usd)
      .toBe("12.000000");
  });
  it("refuses a revocation committed between input and finish, without any report write", async () => {
    await register(true); await enable();
    const revoke: AnalyticsRpcClient = { async rpc(name, a) {
      if (name === "lean_google_delivery_finish") await db.exec("update lean_private.marketing_spend_days set enabled=false");
      return client.rpc(name, a);
    } };
    expect(await build(revoke)).toMatchObject({ state: "changed" });
    expect((await db.query("select * from lean_private.report_store_daily")).rows).toEqual([]);
    expect((await db.query("select completed_at from lean_private.full_builds")).rows[0]).toEqual({ completed_at: null });
  });
  it("does not accept an old unwrapped input hash and rolls back failed optional persistence", async () => {
    await register(true); await enable();
    const old = await rpc("lean_full_inputs_before_marketing", args()) as { inputHash: string };
    const changedHash: AnalyticsRpcClient = { async rpc(name, a) {
      return client.rpc(name, name === "lean_google_delivery_finish" ? { ...a, p_input_hash: old.inputHash } : a);
    } };
    expect(await build(changedHash)).toMatchObject({ state: "changed" });
    await db.exec(`update lean_private.full_builds set lease_token=null,lease_until=null;
      create function public.fixture_marketing_failure() returns trigger language plpgsql as
        $$ begin raise exception 'fixture optional failure'; end $$;
      create trigger fixture_marketing_failure before insert on lean_private.report_google_account_daily
        for each row execute function public.fixture_marketing_failure();`);
    try {
      await expect(build()).rejects.toThrow();
      expect((await db.query("select * from lean_private.report_store_daily")).rows).toEqual([]);
      expect((await db.query("select * from lean_private.marketing_spend_daily where publication_id='full:google-fixture'")).rows).toEqual([]);
    } finally {
      await db.exec("drop trigger fixture_marketing_failure on lean_private.report_google_account_daily; drop function public.fixture_marketing_failure()");
    }
  });
});
