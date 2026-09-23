/** Opt-in, loopback-only real PostgreSQL tests. Never point at customer databases.
 * CI supplies a disposable service; local default skips this suite.
 */
import { Client } from "pg";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, expect, it } from "vitest";
import { mapPilotSource, type PilotPolicy } from "@/lib/analytics/shopifyPilotMapping";
import type { PilotSource } from "@/lib/analytics/shopifyPilotSource";

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
    await admin.query("drop schema if exists lean_analytics cascade; drop schema if exists lean_private cascade");
    await admin.query(`do $$ declare f regprocedure; begin
      for f in select oid::regprocedure from pg_proc
        where pronamespace='public'::regnamespace and starts_with(proname,'lean_') loop
        execute format('drop function %s',f);
      end loop;
    end $$;
    drop role if exists lean_pilot_reader; drop role if exists lean_observed_reader;`);
    await admin.query(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role; end if;
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon; end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated; end if;
    end $$`);
    // CI service is disposable; the explicit local reset also permits repeat runs.
    for (const name of ["001_staging", "003_receipts", "004_worker", "013_release", "014_reporting_views",
      "015_backfill", "016_shopify_pilot", "017_shopify_pipeline", "018_history_jobs"])
      await admin.query(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
    await admin.query(`insert into lean_private.pipeline_scope(shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
      values($1,$2,true,'2026-01-01','2026-02-01',$3,'fixture:scope','fixture:operator')`,
    [shop, project, JSON.stringify({ ...policy, productClasses: { "3": "merchandise" } })]);
    await a.query("set statement_timeout='5s'"); await b.query("set statement_timeout='5s'");
  }, 30000);
  afterAll(async () => { await a?.end(); await b?.end(); await admin?.end(); });
  beforeEach(async () => {
    await a.query("rollback"); await b.query("rollback");
    await admin.query(`truncate lean_private.receipts cascade; truncate lean_private.publications cascade;
      truncate lean_private.history_jobs cascade`);
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
});
