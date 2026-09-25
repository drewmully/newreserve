import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, expect, it } from "vitest";
import { prepareRefresh } from "@/lib/analytics/refreshPlan";
import { refreshFixture } from "../fixtures/analyticsRefresh";
import { fullProject, fullShop } from "../fixtures/analyticsFull";
let db: PGlite;
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role service_role; create role anon; create role authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const name of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs", "019_spend_jobs",
    "020_observed_report_jobs", "021_full_report_jobs", "022_full_release", "023_posthog_export",
    "024_full_orchestration", "025_refresh_queue", "026_journey_authority", "027_history_update_scans",
    "028_refresh_health", "029_journey_decisions", "030_scoped_release", "031_draft_receipts",
    "032_history_feeds", "033_scoped_health"])
    await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
}, 30000);
beforeEach(async () => {
  await db.exec(`truncate lean_private.journey_grants cascade; truncate lean_private.refresh_monitor_targets;
    truncate lean_private.refresh_queue; truncate lean_private.full_builds cascade;
    truncate lean_private.report_builds cascade; truncate lean_private.spend_jobs;
    truncate lean_private.history_jobs cascade; truncate lean_private.history_feeds cascade;
    truncate lean_private.refresh_limits; truncate lean_private.publications cascade;
    truncate lean_export.store_daily,lean_export.product_daily,lean_export.acquisition_daily,
      lean_export.customer_cohorts,lean_export.funnel_daily`);
});
afterAll(async () => { await db?.close(); });
async function health() {
  return (await db.query<{ result: { state: string; issues: string[]; posthogReadbackVerified: boolean } }>(
    "select public.lean_refresh_health($1,$2) result", [fullProject, fullShop])).rows[0].result;
}
async function configured(domains = ["store_daily"]) {
  const bundle = prepareRefresh(refreshFixture());
  await db.query("select public.lean_refresh_register($1)", [JSON.stringify(bundle)]);
  await db.query(`insert into lean_private.refresh_limits(project_ref,enabled,max_daily_steps,approval_ref,actor_ref)
    values($1,true,10,'fixture','fixture')`, [fullProject]);
  await db.query(`insert into lean_private.refresh_monitor_targets
    (project_ref,shop,enabled,max_candidate_age_seconds,max_export_age_seconds,approval_ref,actor_ref,expected_domains)
    values($1,$2,true,3600,3600,'fixture','fixture',$3)`, [fullProject, fullShop, domains]);
  // Fresh synthetic candidate, not a production certification bypass.
  await db.query(`insert into lean_private.full_builds
    (run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,enabled,completed_at,result_hash)
    select 'health:fixture',project_ref,base_run,jsonb_set(policy,'{asOf}',to_jsonb(clock_timestamp()::text)),
      evidence,behavior,approval_ref,actor_ref,true,clock_timestamp(),'fixture'
      from lean_private.full_builds where run_id=$1`, [bundle.runId]);
  await db.exec(`insert into lean_private.publications(publication_id,contract_version)
    values('full:health:fixture','fixture')`);
  for (const domain of domains) {
    await db.query(`insert into lean_private.certifications
      (publication_id,domain,evidence_ref,source_reconciliation_ref,approved_by)
      values('full:health:fixture',$1,'fixture','fixture','fixture')`, [domain]);
  }
  await db.exec(`update lean_private.publications set state='certified',evidence_ref='fixture';
    insert into lean_private.selected_publications(domain,publication_id)
      select domain,publication_id from lean_private.certifications`);
  await db.query(`insert into lean_private.export_audit(publication_id,approval_ref,actor_ref,row_counts)
    values('full:health:fixture','fixture','fixture',$1)`,
  [JSON.stringify(Object.fromEntries(domains.map(d => [d, 0])))]);
}
it("accepts an approved one-domain release without demanding five reports or claiming PostHog sync", async () => {
  await configured();
  expect(await health()).toMatchObject({ state: "healthy", issues: [], posthogReadbackVerified: false });
});
it("requires the exact externally configured domains and rejects empty or duplicate expectations", async () => {
  await configured();
  for (const values of [[], ["store_daily", "store_daily"], ["not_a_report"]])
    await expect(db.query("update lean_private.refresh_monitor_targets set expected_domains=$1", [values])).rejects.toThrow();
  await db.exec("update lean_private.refresh_monitor_targets set expected_domains=array['store_daily','product_daily']");
  expect((await health()).issues).toEqual(["selection_missing:product_daily"]);
});
it("does not use a different domain's newer export to hide a stale or missing export", async () => {
  await configured(["store_daily", "product_daily"]);
  await db.exec("delete from lean_private.export_audit");
  await db.exec(`insert into lean_private.export_audit(publication_id,approval_ref,actor_ref,row_counts,exported_at)
    values('full:health:fixture','fixture','fixture','{"store_daily":0}',now()-interval '2 hours'),
      ('full:health:fixture','fixture','fixture','{"product_daily":0}',now())`);
  expect((await health()).issues).toEqual(["export_stale:store_daily"]);
  await db.exec(`delete from lean_private.export_audit where row_counts ? 'store_daily'`);
  expect((await health()).issues).toEqual(["selected_export_missing:store_daily"]);
});
it("compares actual export contents and vintage rather than merely a recent audit timestamp", async () => {
  await configured();
  await db.exec(`update lean_private.export_audit set row_counts='{"store_daily":1}'`);
  expect((await health()).issues).toEqual(["export_content_mismatch:store_daily"]);
  await db.exec(`update lean_private.selected_publications set is_stale=true`);
  expect((await health()).issues).toContain("selected_candidate_stale:store_daily");
});
it("accepts different certified publications for independently released domains", async () => {
  await configured(["store_daily", "product_daily"]);
  await db.exec(`insert into lean_private.full_builds
    (run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,enabled,completed_at,result_hash)
    select 'health:second',project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,
      enabled,completed_at,result_hash from lean_private.full_builds where run_id='health:fixture';
    insert into lean_private.publications(publication_id,contract_version) values('full:health:second','fixture');
    insert into lean_private.certifications(publication_id,domain,evidence_ref,source_reconciliation_ref,approved_by)
      values('full:health:second','product_daily','fixture','fixture','fixture');
    update lean_private.publications set state='certified',evidence_ref='fixture' where publication_id='full:health:second';
    update lean_private.selected_publications set publication_id='full:health:second' where domain='product_daily';
    insert into lean_private.export_audit(publication_id,approval_ref,actor_ref,row_counts)
      values('full:health:second','fixture','fixture','{"product_daily":0}')`);
  expect((await health()).state).toBe("healthy");
});
it("alerts on externally expected missing, disabled and lagging history feeds", async () => {
  await configured();
  await db.exec("update lean_private.refresh_monitor_targets set expected_history_feeds=array['fixture']");
  expect((await health()).issues).toEqual(["history_feed_missing"]);
  await db.query(`insert into lean_private.history_feeds
    (feed_id,project_ref,shop,scan_basis,start_time,watermark,window_seconds,lag_seconds,
      page_size,max_pages,max_daily_steps,approval_ref,actor_ref)
    values('fixture',$1,$2,'updated_at',now()-interval '3 days',now()-interval '3 days',3600,60,2,10,10,'fixture','fixture')`,
  [fullProject, fullShop]);
  expect((await health()).issues).toEqual(["history_feed_disabled"]);
  await db.exec("update lean_private.history_feeds set enabled=true");
  expect((await health()).issues).toEqual(["history_feed_lagging"]);
});
it("does not grant runtime roles configuration or access to the obsolete health bypass", async () => {
  expect((await db.query(`select r,
    has_function_privilege(r,'public.lean_refresh_health(text,text)','execute') current,
    has_function_privilege(r,'public.lean_refresh_health_legacy(text,text)','execute') legacy,
    has_table_privilege(r,'lean_private.refresh_monitor_targets','update') configure
    from unnest(array['service_role','anon','authenticated','lean_posthog_reader']) r`)).rows).toEqual([
    { r: "service_role", current: true, legacy: false, configure: false },
    { r: "anon", current: false, legacy: false, configure: false },
    { r: "authenticated", current: false, legacy: false, configure: false },
    { r: "lean_posthog_reader", current: false, legacy: false, configure: false },
  ]);
});
