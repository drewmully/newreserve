/** Exact already-installed order, entirely disposable. Never a hosted migration. */
import { PGlite } from "@electric-sql/pglite";
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { expect, it } from "vitest";
import { spendPilotScope, spendPilotProject } from "../fixtures/analyticsSpendPilot";

const initial = [
  "001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views",
  "015_backfill", "016_shopify_pilot", "017_shopify_pipeline", "018_history_jobs",
  "019_spend_jobs", "020_observed_report_jobs", "021_full_report_jobs", "022_full_release",
  "023_posthog_export", "024_full_orchestration",
  "038_google_spend_pilot", "039_shopify_bounded_pilot", "040_shopify_history_import",
];
const later = [
  "025_refresh_queue", "026_journey_authority", "027_history_update_scans", "028_refresh_health",
  "029_journey_decisions", "030_scoped_release", "031_draft_receipts", "032_history_feeds",
  "033_scoped_health", "034_commerce_only_refresh", "035_discovery_inventory_fence",
  "036_partitioned_refresh", "037_canonical_journey_timestamps",
];
const protectedMigrations = [
  "003_receipts", "004_worker", "017_shopify_pipeline", "019_spend_jobs",
  "038_google_spend_pilot", "039_shopify_bounded_pilot", "040_shopify_history_import",
];
const sql = (name: string) => readFileSync(`sql/analytics/${name}.sql`, "utf8");
const protectedTables = [
  "pipeline_scope", "receipts", "work", "spend_jobs", "spend_pilots", "spend_pilot_days",
  "shopify_pilots", "shopify_pilot_members", "shopify_pilot_receipts", "shopify_pilot_days",
  "history_import_jobs", "history_import_orders", "history_import_lines",
];

// Run the real-server variant in a dedicated CI step after the ordinary PG
// suite: PostgreSQL roles are cluster-wide, so its reset must not race this DB.
const connectionString = process.env.LEAN_LATE_INSTALL_POSTGRES === "true"
  ? process.env.LOCAL_POSTGRES_TEST_URL : undefined;
it.each(connectionString ? ["postgres"] : ["pglite"])(
  "installs 025–037 AFTER 038–040 without changing active pilot functions, ACLs, triggers or rows (%s)", async engine => {
  let control: Client | undefined, pg: Client | undefined, embedded: PGlite | undefined;
  if (engine === "postgres") {
    const url = new URL(connectionString!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        url.pathname !== "/analytics_test_pipeline" || url.username !== "fixture_owner")
      throw new Error("local_disposable_postgres_only");
    control = new Client({ connectionString }); await control.connect();
    await control.query("drop database if exists analytics_test_late_install");
    // The preceding ordinary suite leaves cluster-wide reader roles and their
    // grants in this allowlisted disposable DB. Remove only those fixture grants;
    // DROP ROLE still fails closed if any other database depends on the role.
    for (const role of ["lean_pilot_reader", "lean_observed_reader", "lean_posthog_reader"]) {
      if ((await control.query("select 1 from pg_roles where rolname=$1", [role])).rowCount) {
        await control.query(`drop owned by ${role}`);
        await control.query(`drop role ${role}`);
      }
    }
    await control.query("create database analytics_test_late_install");
    url.pathname = "/analytics_test_late_install";
    pg = new Client({ connectionString: url.toString() }); await pg.connect();
  } else embedded = new PGlite();
  const db = {
    exec: (text: string) => pg ? pg.query(text) : embedded!.exec(text),
    query: (text: string, args?: unknown[]) => pg ? pg.query(text, args) : embedded!.query(text, args),
  };
  try {
    await db.exec(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
    end $$`);
    for (const name of initial) await db.exec(sql(name));
    // The fixture uses the real registration RPCs and exercises enabled states;
    // none of these synthetic values establishes customer/source readiness.
    const spend = spendPilotScope(true), shop = "late-install-fixture.myshopify.com";
    const project = spendPilotProject, pilot = "fixture:shopify-pilot";
    const policy = {
      decision: { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: false,
        approvalRef: "fixture:catalog" },
      productClasses: { "3": "merchandise" }, financialApprovalRef: "fixture:finance",
      saleClock: "paid_at", refundClock: "refund_created_at",
    };
    await db.query("select public.lean_spend_pilot_register($1::jsonb)", [JSON.stringify(spend)]);
    await db.query("select public.lean_shopify_pilot_register($1::jsonb)", [JSON.stringify({
      pilotId: pilot, shop, projectRef: project, fromTime: "2026-01-01T00:00:00Z",
      untilTime: "2026-02-01T00:00:00Z", expiresAt: new Date(Date.now() + 86400000).toISOString(),
      policy, approvalRef: "fixture:approval", actorRef: "fixture:owner",
      maxReceipts: 10, maxAttempts: 10, maxDailyAttempts: 5,
    })]);
    await db.exec(`update lean_private.spend_pilots set enabled=true;
      update lean_private.spend_jobs set enabled=true;
      update lean_private.shopify_pilots set enabled=true;
      update lean_private.pipeline_scope set enabled=true;
      insert into lean_private.history_import_jobs(job_id,scope,expires_at,enabled,state,orders,lines,completion)
        values('fixture_history','{"fixture":"not_source_evidence"}',now()+interval '1 day',true,'complete',1,1,
          '{"fixture":"not_certified"}');
      insert into lean_private.history_import_orders values('fixture_history','gid://shopify/Order/999',
        '{"id":"gid://shopify/Order/999","fixture":true}');
      insert into lean_private.history_import_lines values('fixture_history','gid://shopify/LineItem/999',
        'gid://shopify/Order/999','{"fixture":true}');`);

    const names = new Set(protectedMigrations.flatMap(name => [
      ...sql(name).matchAll(/(?:create(?: or replace)? function|alter function)\s+(?:public|lean_private)\.([a-z0-9_]+)/gi),
    ].map(m => m[1])));
    // Include the renamed ordinary delegates: a wrapper is unsafe if its body is
    // preserved but its hidden delegate is replaced or made service-executable.
    for (const name of protectedMigrations)
      for (const match of sql(name).matchAll(/rename to ([a-z0-9_]+)/gi)) names.add(match[1]);
    const functions = async () => (await db.query(`select n.nspname,p.proname,p.oid::text,
      pg_get_functiondef(p.oid) definition,p.proacl::text,p.proowner::text,p.proconfig,p.prosecdef
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace
      where n.nspname in ('public','lean_private') and p.proname=any($1)
      order by n.nspname,p.proname,p.oid`, [[...names]])).rows;
    const tables = async () => (await db.query(`select c.relname,c.oid::text,c.relacl::text,
      c.relrowsecurity,c.relforcerowsecurity,c.relowner::text
      from pg_class c join pg_namespace n on n.oid=c.relnamespace
      where n.nspname='lean_private' and c.relname=any($1) order by c.relname`, [protectedTables])).rows;
    const triggers = async () => (await db.query(`select c.relname,t.tgname,t.tgenabled,
      pg_get_triggerdef(t.oid) definition from pg_trigger t join pg_class c on c.oid=t.tgrelid
      where c.relnamespace='lean_private'::regnamespace and c.relname=any($1)
      order by c.relname,t.tgname`, [protectedTables])).rows;
    const rows = async () => Promise.all(protectedTables.map(async name =>
      (await db.query(`select to_jsonb(t)::text row from lean_private.${name} t order by to_jsonb(t)::text`)).rows));
    const baseline = { functions: await functions(), tables: await tables(), triggers: await triggers(), rows: await rows() };
    expect(baseline.functions.length).toBeGreaterThan(30);
    // Check after EACH migration, not only the final state.
    for (const name of later) {
      await db.exec(sql(name));
      expect(await functions(), `${name}: protected functions/delegates/ACL`).toEqual(baseline.functions);
      expect(await tables(), `${name}: protected table/RLS`).toEqual(baseline.tables);
      expect(await triggers(), `${name}: protected triggers`).toEqual(baseline.triggers);
      expect(await rows(), `${name}: active scope/source rows`).toEqual(baseline.rows);
    }
    expect((await db.query(`select public.lean_shopify_pilot_status($1,$2,$3) result`,
      [pilot, project, shop])).rows[0]).toMatchObject({ result: { state: "ready", receiptsUsed: 0, attemptsUsed: 0 } });
    expect((await db.query(`select public.lean_spend_pilot_next($1,$2) result`,
      [spend.pilotId, project])).rows[0]).toMatchObject({ result: { state: "ready", runId: spend.days[0].runId } });
    await expect(db.query("select public.lean_pipeline_claim($1,$2,$3)",
      [randomUUID(), project, shop])).rejects.toThrow("bounded pilot claim required");
    await expect(db.query(`select public.lean_accept_receipt('shopify','fixture_delivery',$1,'orders/paid',$2,'{}')`,
      [JSON.stringify([shop, "gid://shopify/Order/1"]), "a".repeat(64)]))
      .rejects.toThrow("bounded pilot receipt path required");
    await db.exec("set role service_role");
    try {
      await expect(db.query("select public.lean_pipeline_claim_017($1,$2,$3)",
        [randomUUID(), project, shop])).rejects.toThrow("permission denied");
      await expect(db.query("select public.lean_spend_claim_019($1,$2,$3)",
        [spend.days[0].runId, project, randomUUID()])).rejects.toThrow("permission denied");
    } finally { await db.exec("reset role"); }
    expect((await db.query("select count(*)::int n from lean_private.refresh_limits")).rows).toEqual([{ n: 0 }]);
    expect((await db.query("select count(*)::int n from lean_private.journey_grants")).rows).toEqual([{ n: 0 }]);
    expect((await db.query("select count(*)::int n from lean_private.refresh_queue")).rows).toEqual([{ n: 0 }]);
  } finally {
    await embedded?.close(); await pg?.end();
    if (control) { await control.query("drop database if exists analytics_test_late_install"); await control.end(); }
  }
}, 30000);
