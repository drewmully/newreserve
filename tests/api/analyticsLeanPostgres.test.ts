/** Opt-in, loopback-only real PostgreSQL tests. Never point at customer databases.
 * CI supplies a disposable service; local default skips this suite.
 */
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { mapPilotSource, type PilotPolicy } from "@/lib/analytics/shopifyPilotMapping";
import type { PilotSource } from "@/lib/analytics/shopifyPilotSource";
import { runObservedReportJob } from "@/lib/analytics/observedReportJob";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import { fullFixture, fullProject, fullShop } from "../fixtures/analyticsFull";
import { refreshFixture } from "../fixtures/analyticsRefresh";
import { prepareRefresh } from "@/lib/analytics/refreshPlan";

const connectionString = process.env.LOCAL_POSTGRES_TEST_URL;
const shop = "concurrency-fixture.myshopify.com", project = "aaaaaaaaaaaaaaaaaaaa";
const policy: PilotPolicy = {
  decision: { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: false, approvalRef: "fixture:catalog" },
  lineClasses: { "2": "merchandise" }, financialApprovalRef: "fixture:finance", saleClock: "paid_at", refundClock: "refund_created_at",
};
function source(revision: string): PilotSource {
  const m = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
  const conn = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
  const id = "gid://shopify/Order/1";
  return {
    commerce: { shop, apiVersion: "2026-07", order: {
      id, createdAt: "2026-01-01T00:00:00Z", updatedAt: revision, currencyCode: "USD",
      edited: false, taxesIncluded: false, test: false, cancelledAt: null, shippingAddress: null,
      originalTotalPriceSet: m("10"), subtotalPriceSet: m("10"), transactionsCount: { count: 1, precision: "EXACT" },
      transactions: [{ id: "gid://shopify/OrderTransaction/4", kind: "SALE", status: "SUCCESS", gateway: "fixture",
        test: false, createdAt: "2026-01-01T00:00:00Z", processedAt: "2026-01-01T00:01:00Z", amountSet: m("10"), parentTransaction: null }],
      lineItems: conn([{ id: "gid://shopify/LineItem/2", sku: "FIXTURE", quantity: 1, isGiftCard: false,
        product: { id: "gid://shopify/Product/3" }, originalUnitPriceSet: m("10"), originalTotalSet: m("10"), discountAllocations: [] }]),
    } },
    financial: { id, updatedAt: revision, currencyCode: "USD", originalTotalPriceSet: m("10"), totalTaxSet: m("0"),
      originalTotalDutiesSet: null, originalTotalAdditionalFeesSet: null, totalTipReceivedSet: m("0"), shippingLines: conn([]), refunds: [] },
    refunds: [],
  };
}
describe.skipIf(!connectionString)("real PostgreSQL concurrent analytics workers", () => {
  let admin: Client, a: Client, b: Client;
  beforeAll(async () => {
    const url = new URL(connectionString!);
    if (!["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) || url.pathname !== "/analytics_test_pipeline" ||
        url.username !== "fixture_owner") throw new Error("local_disposable_postgres_only");
    admin = new Client({ connectionString }); a = new Client({ connectionString }); b = new Client({ connectionString });
    await admin.connect(); await a.connect(); await b.connect();
    // Only this dedicated fixture database and its fixture reader roles are reset.
    // Refuse to drop roles shared with another database: DROP ROLE will fail closed.
    await admin.query("drop schema if exists lean_export cascade; drop schema if exists lean_analytics cascade; drop schema if exists lean_private cascade");
    await admin.query(`do $$ declare f regprocedure; begin
      for f in select oid::regprocedure from pg_proc
        where pronamespace='public'::regnamespace and starts_with(proname,'lean_') loop
        execute format('drop function %s',f);
      end loop;
    end $$;
    drop role if exists lean_pilot_reader; drop role if exists lean_observed_reader; drop role if exists lean_posthog_reader;`);
    await admin.query(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    end $$`);
    // CI service is disposable; the explicit local reset also permits repeat runs.
    for (const name of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views",
      "015_backfill", "016_shopify_pilot", "017_shopify_pipeline", "018_history_jobs", "019_spend_jobs", "020_observed_report_jobs",
      "021_full_report_jobs", "022_full_release", "023_posthog_export", "024_full_orchestration", "025_refresh_queue"])
      await admin.query(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
    await admin.query(`insert into lean_private.pipeline_scope(shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
      values($1,$2,true,'2026-01-01','2026-02-01',$3,'fixture:scope','fixture:operator')`,
    [shop, project, JSON.stringify({ ...policy, productClasses: { "3": "merchandise" } })]);
    await a.query("set statement_timeout='5s'"); await b.query("set statement_timeout='5s'");
  }, 30000);
  afterAll(async () => { await a?.end(); await b?.end(); await admin?.end(); });
  beforeEach(async () => {
    await a.query("rollback"); await b.query("rollback");
    await admin.query(`truncate lean_private.refresh_queue; truncate lean_private.refresh_limits;
      truncate lean_private.full_builds cascade; truncate lean_private.receipts cascade; truncate lean_private.publications cascade;
      truncate lean_private.history_jobs cascade; truncate lean_private.spend_jobs; truncate lean_private.report_builds cascade`);
  });
  const receipt = () => admin.query(`select public.lean_accept_receipt('shopify',$1,$2,'orders/updated',$3,$4)`,
    [randomUUID(), JSON.stringify([shop, "gid://shopify/Order/1"]), "a".repeat(64), JSON.stringify({ admin_graphql_api_id: "gid://shopify/Order/1" })]);
  const claim = async (client: Client, token: string) =>
    (await client.query("select public.lean_pipeline_claim($1,$2,$3) result", [token, project, shop])).rows[0].result;
  async function retained(client: Client, token: string, revision: string) {
    const work = await claim(client, token), src = source(revision);
    expect((await client.query("select public.lean_pipeline_retain($1,$2,$3) result",
      [work.workId, token, JSON.stringify(src)])).rows[0].result).toBe(true);
    const mapped = mapPilotSource(src, policy, work.publication, "fixture:retained");
    return [work.workId, token, JSON.stringify(mapped.facts),
      JSON.stringify(mapped.reports.map(r => ({ ...r, definition_version: "shopify-observed-v1" })))];
  }
  const finish = async (client: Client, args: unknown[]) =>
    (await client.query("select public.lean_pipeline_finish($1,$2,$3,$4) result", args)).rows[0].result;
  async function refresh() {
    const bundle = prepareRefresh(refreshFixture());
    await admin.query("select public.lean_refresh_register($1)", [JSON.stringify(bundle)]);
    await admin.query(`insert into lean_private.refresh_limits
      (project_ref,enabled,max_daily_steps,approval_ref,actor_ref) values($1,true,5,'fixture','fixture')`, [fullProject]);
    await admin.query("update lean_private.refresh_queue set enabled=true where run_id=$1", [bundle.runId]);
    await admin.query("update lean_private.full_builds set enabled=true where run_id=$1", [bundle.runId]);
    return bundle;
  }
  it("serializes refresh claims across real connections and stops expired ambiguous leases", async () => {
    const bundle = await refresh(), token = randomUUID();
    const sql = "select public.lean_refresh_claim($1,$2) result";
    await a.query("begin");
    expect((await a.query(sql, [fullProject, token])).rows[0].result.state).toBe("claimed");
    const competing = b.query(sql, [fullProject, randomUUID()]);
    await a.query("commit");
    expect((await competing).rows[0].result.state).toBe("busy");
    await admin.query("update lean_private.refresh_queue set lease_until=now()-interval '1 second' where run_id=$1", [bundle.runId]);
    expect((await b.query(sql, [fullProject, randomUUID()])).rows[0].result.state).toBe("ambiguous");
    expect((await admin.query("select used_steps,status from lean_private.refresh_queue")).rows)
      .toEqual([{ used_steps: 1, status: "blocked" }]);
  });
  it("runs a registered refresh through the actual five-report builder and acknowledges completion", async () => {
    const bundle = await refresh(), f = fullFixture(), token = randomUUID();
    await admin.query("select public.lean_refresh_claim($1,$2)", [fullProject, token]);
    await admin.query(`update lean_private.report_builds set enabled=true,completed_at=now(),result_hash='fixture'
      where run_id=$1`, [bundle.base.runId]);
    const publication = `observed:${bundle.base.runId}`;
    await admin.query("insert into lean_private.publications(publication_id,contract_version) values($1,'lean-v1-draft.1')", [publication]);
    for (const [table, rows] of Object.entries(f.base))
      await admin.query(`insert into lean_private.${table} select * from jsonb_populate_recordset(null::lean_private.${table},$1)`,
        [JSON.stringify(rows.map(r => ({ ...r, publication_id: publication })))]);
    const adapter: AnalyticsRpcClient = { async rpc(name, args) {
      if (!["lean_full_inputs", "lean_full_claim", "lean_full_fail", "lean_full_finish"].includes(name)) throw new Error("unexpected_rpc");
      const entries = Object.entries(args);
      const result = await a.query(`select public.${name}(${entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) result`,
        entries.map(([, v]) => typeof v === "object" ? JSON.stringify(v) : v));
      return { data: result.rows[0].result, error: null };
    } };
    const result = await runFullReportJob({ client: adapter, projectRef: fullProject,
      databaseUrl: `https://${fullProject}.supabase.co`, runId: bundle.runId,
      posthogKey: "fixture", request: async () => Response.json(f.wire) });
    expect(result.state).toBe("complete");
    expect((await admin.query("select public.lean_refresh_finish($1,$2,$3,'complete') result",
      [fullProject, bundle.runId, token])).rows[0].result).toBe(true);
    expect((await admin.query("select status from lean_private.refresh_queue")).rows).toEqual([{ status: "complete" }]);
    expect((await admin.query("select * from lean_private.selected_publications")).rows).toEqual([]);
    expect((await admin.query("select count(*)::int n from lean_private.report_store_daily")).rows).toEqual([{ n: 1 }]);
  });
  it("fences a refresh publication after its project kill switch changes", async () => {
    const bundle = await refresh();
    await admin.query("select public.lean_refresh_claim($1,$2)", [fullProject, randomUUID()]);
    await admin.query("update lean_private.refresh_limits set enabled=false where project_ref=$1", [fullProject]);
    await expect(a.query("insert into lean_private.publications(publication_id,contract_version) values($1,'lean-v1-draft.1')",
      [`full:${bundle.runId}`])).rejects.toThrow("refresh disabled");
    expect((await admin.query("select * from lean_private.publications")).rows).toEqual([]);
  });
  it("serializes two report completions without duplicate facts or a partial publication", async () => {
    await admin.query(`insert into lean_private.history_jobs
      (run_id,project_ref,shop,from_time,until_time,page_size,max_pages,approval_ref,actor_ref,enabled)
      values('history',$1,$2,'2026-01-01','2026-02-01',2,2,'fixture:approval','fixture:actor',true)`, [project, shop]);
    await admin.query("select public.lean_history_commit('history',$1,$2,0,null,null,true,$3::jsonb)",
      [project, shop, JSON.stringify([{ source: source("2026-01-02T00:00:00Z") }])]);
    await admin.query(`insert into lean_private.report_builds
      (run_id,project_ref,shop,history_runs,from_date,through_date,policy,approval_ref,actor_ref,enabled)
      values('report',$1,$2,array['history'],'2025-12-31','2026-01-02',$3,'fixture:approval','fixture:actor',true)`,
      [project, shop, JSON.stringify({ ...policy, productClasses: { "3": "merchandise" } })]);
    // Barrier guarantees both workers read the same uncompleted input first.
    let readers = 0, unblock!: () => void;
    const bothRead = new Promise<void>(resolve => { unblock = resolve; });
    const adapter = (pg: Client): AnalyticsRpcClient => ({ async rpc(name, input) {
      if (!["lean_report_inputs", "lean_report_finish"].includes(name)) throw new Error("unknown_rpc");
      const pairs = Object.entries(input);
      const result = await pg.query(`select public.${name}(${pairs.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) result`,
        pairs.map(([, value]) => typeof value === "object" ? JSON.stringify(value) : value));
      if (name === "lean_report_inputs") {
        if (++readers === 2) unblock();
        await bothRead;
      }
      return { data: result.rows[0].result, error: null };
    } });
    const options = { projectRef: project, databaseUrl: `https://${project}.supabase.co`, runId: "report" };
    expect(await Promise.all([runObservedReportJob({ ...options, client: adapter(a) }),
      runObservedReportJob({ ...options, client: adapter(b) })])).toEqual([
      { state: "complete", certification: "unverified" }, { state: "complete", certification: "unverified" }]);
    expect((await admin.query("select count(*)::int n from lean_private.orders")).rows[0]).toEqual({ n: 1 });
    expect((await admin.query("select count(*)::int n from lean_private.report_store_daily")).rows[0]).toEqual({ n: 3 });
    expect((await admin.query("select * from lean_private.selected_publications")).rows).toHaveLength(0);
  });
  it("SKIP LOCKED gives two open transactions different receipts", async () => {
    await receipt(); await receipt(); await a.query("begin"); await b.query("begin");
    const first = await claim(a, randomUUID()), second = await claim(b, randomUUID());
    expect(first.state).toBe("claimed"); expect(second.state).toBe("claimed");
    expect(first.workId).not.toBe(second.workId);
    await a.query("commit"); await b.query("commit");
  });
  it("serializes concurrent completions and keeps the newest order revision regardless of finish order", async () => {
    await receipt(); await receipt();
    const older = await retained(a, randomUUID(), "2026-01-02T00:00:00Z");
    const newer = await retained(b, randomUUID(), "2026-01-03T00:00:00Z");
    expect(await Promise.all([finish(b, newer), finish(a, older)])).toEqual([true, true]);
    const rows = (await admin.query(`select count(*)::int n,sum(total_sales_usd)::text sales,
      max(source_revision)::text revision from lean_analytics.observed_order_daily`)).rows;
    expect(rows).toEqual([{ n: 1, sales: "10.000000", revision: "2026-01-03 00:00:00+00" }]);
  });
  it("fences an expired owner on a different connection", async () => {
    await receipt();
    const old = await retained(a, randomUUID(), "2026-01-02T00:00:00Z");
    await admin.query("update lean_private.work set lease_until=now()-interval '1 second'");
    const next = await retained(b, randomUUID(), "2026-01-02T00:00:00Z");
    expect(await finish(a, old)).toBe(false); expect(await finish(b, next)).toBe(true);
  });
  it("claim and finish use compatible lock order rather than deadlocking", async () => {
    await receipt(); await receipt();
    const ready = await retained(b, randomUUID(), "2026-01-02T00:00:00Z");
    await a.query("begin"); expect((await claim(a, randomUUID())).state).toBe("claimed");
    const finishing = finish(b, ready);
    await a.query("commit");
    expect(await finishing).toBe(true);
  });
  it("history checkpoints serialize two real connections without duplicate pages", async () => {
    await admin.query(`insert into lean_private.history_jobs
      (run_id,project_ref,shop,from_time,until_time,page_size,max_pages,approval_ref,actor_ref,enabled)
      values('history',$1,$2,'2026-01-01','2026-02-01',2,5,'fixture:scope','fixture:actor',true)`, [project, shop]);
    const sql = "select public.lean_history_commit('history',$1,$2,0,null,null,true,$3) result";
    const args = [project, shop, JSON.stringify([{ source: source("2026-01-02T00:00:00Z") }])];
    await a.query("begin");
    expect((await a.query(sql, args)).rows[0].result).toBe(true);
    const competing = b.query(sql, args);
    await a.query("commit");
    expect((await competing).rows[0].result).toBe(false);
    expect((await admin.query("select page_count,row_count,complete from lean_private.history_jobs")).rows)
      .toEqual([{ page_count: 1, row_count: 1, complete: true }]);
  });
  it("lets only one concurrent full-report worker query the vendor and commits all five reports once", async () => {
    const f = fullFixture();
    await admin.query(`insert into lean_private.report_builds
      (run_id,project_ref,shop,history_runs,from_date,through_date,policy,approval_ref,actor_ref,enabled,completed_at,result_hash)
      values('base',$1,$2,array['fixture-history'],'2026-01-01','2026-01-01','{}','fixture','fixture',true,now(),'fixture')`,
    [fullProject, fullShop]);
    await admin.query("insert into lean_private.publications(publication_id,contract_version) values('observed:base','lean-v1-draft.1')");
    for (const [table, rows] of Object.entries(f.base))
      await admin.query(`insert into lean_private.${table} select * from jsonb_populate_recordset(null::lean_private.${table},$1)`,
        [JSON.stringify(rows.map(r => ({ ...r, publication_id: "observed:base" })))]);
    await admin.query(`insert into lean_private.full_builds
      (run_id,project_ref,base_run,policy,evidence,behavior,approval_ref,actor_ref,enabled)
      values('fixture',$1,'base',$2,$3,$4,'fixture','fixture',true)`,
    [fullProject, JSON.stringify(f.policy), JSON.stringify(f.evidence), JSON.stringify(f.behavior)]);
    let reads = 0, release!: () => void, vendorCalls = 0;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const adapter = (pg: Client): AnalyticsRpcClient => ({ async rpc(name, args) {
      if (!["lean_full_inputs", "lean_full_claim", "lean_full_fail", "lean_full_finish"].includes(name)) throw new Error("unexpected_rpc");
      const entries = Object.entries(args);
      const result = await pg.query(`select public.${name}(${entries.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) result`,
        entries.map(([, v]) => typeof v === "object" ? JSON.stringify(v) : v));
      if (name === "lean_full_inputs") { if (++reads === 2) release(); await barrier; }
      return { data: result.rows[0].result, error: null };
    } });
    const opts = { projectRef: fullProject, databaseUrl: `https://${fullProject}.supabase.co`, runId: "fixture",
      posthogKey: "fixture", request: async () => { vendorCalls++; return Response.json(f.wire); } };
    const results = await Promise.all([runFullReportJob({ ...opts, client: adapter(a) }),
      runFullReportJob({ ...opts, client: adapter(b) })]);
    expect(results.map(r => r.state).sort()).toEqual(["busy_or_exhausted", "complete"]);
    expect(vendorCalls).toBe(1);
    expect((await admin.query("select count(*)::int n from lean_private.report_store_daily")).rows[0]).toEqual({ n: 1 });
    expect((await admin.query("select count(*)::int n from lean_private.report_funnel_daily")).rows[0]).toEqual({ n: 2 });
  });
});
