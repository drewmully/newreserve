import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, afterAll, afterEach, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import type { PilotSource } from "@/lib/analytics/shopifyPilotSource";
import { runObservedReportJob } from "@/lib/analytics/observedReportJob";
import { POST } from "@/app/api/analytics/ingest/reports/route";

const port = vi.hoisted(() => ({ client: null as AnalyticsRpcClient | null }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => port.client }));
const shop = "fixture.myshopify.com", project = "a".repeat(20);
let db: PGlite;
const client: AnalyticsRpcClient = { async rpc(name, input) {
  if (!["lean_report_inputs", "lean_report_finish"].includes(name)) throw new Error("unknown_rpc");
  const pairs = Object.entries(input);
  try {
    const result = await db.query<{ result: unknown }>(
      `select public.${name}(${pairs.map(([k], i) => `${k}=>$${i + 1}`).join(",")}) result`,
      pairs.map(([, v]) => typeof v === "object" ? JSON.stringify(v) : v));
    return { data: result.rows[0].result, error: null };
  } catch (error) { return { data: null, error }; }
} };
const policy = { decision: { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: false,
  approvalRef: "fixture:eligibility" }, productClasses: { "3": "merchandise" }, financialApprovalRef: "fixture:finance",
  saleClock: "paid_at", refundClock: "refund_created_at" };
function source(): PilotSource {
  const m = (amount: string) => ({ shopMoney: { amount, currencyCode: "USD" } });
  const conn = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
  const id = "gid://shopify/Order/1", updatedAt = "2026-01-02T12:00:00Z";
  return { commerce: { shop, apiVersion: "2026-07", order: {
    id, createdAt: "2026-01-01T12:00:00Z", updatedAt, currencyCode: "USD", edited: false, taxesIncluded: false,
    test: false, cancelledAt: null, shippingAddress: null, originalTotalPriceSet: m("20"), subtotalPriceSet: m("20"),
    transactionsCount: { count: 1, precision: "EXACT" }, transactions: [{
      id: "gid://shopify/OrderTransaction/4", kind: "SALE", status: "SUCCESS", gateway: "fixture", test: false,
      createdAt: "2026-01-01T12:00:00Z", processedAt: "2026-01-01T12:01:00Z", amountSet: m("20"), parentTransaction: null }],
    lineItems: conn([{ id: "gid://shopify/LineItem/2", sku: "SKU", quantity: 2, isGiftCard: false,
      product: { id: "gid://shopify/Product/3" }, originalUnitPriceSet: m("10"), originalTotalSet: m("20"), discountAllocations: [] }]),
  } }, financial: { id, updatedAt, currencyCode: "USD", originalTotalPriceSet: m("20"), totalTaxSet: m("0"),
    originalTotalDutiesSet: null, originalTotalAdditionalFeesSet: null, totalTipReceivedSet: m("0"),
    shippingLines: conn([]), refunds: [] }, refunds: [] };
}
const args = { p_run: "report", p_project_ref: project };
const options = () => ({ client, projectRef: project, databaseUrl: `https://${project}.supabase.co`, runId: "report" });
const base = () => ({ provider: "google_ads", accountId: "1234567890", date: "2026-01-01", baseReportId: "spend",
  sourceTimezone: "America/New_York", sourceCurrency: "USD", completedAt: "2026-01-02T12:00:00Z",
  paginationComplete: true, verifiedEmpty: false, evidenceRef: "fixture:spend",
  rows: [{ campaignId: "1", costMicros: "1234567" }] });
async function retain(input = source()) {
  await db.query("select public.lean_history_commit('history',$1,$2,0,null,null,true,$3::jsonb)",
    [project, shop, JSON.stringify([{ source: input }])]);
  await db.query("update lean_private.spend_jobs set base=$1::jsonb", [JSON.stringify(base())]);
}
beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role service_role; create role anon; create role authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const name of ["001_staging", "013_release", "014_reporting_views", "018_history_jobs", "019_spend_jobs", "020_observed_report_jobs"])
    await db.exec(readFileSync(`sql/analytics/${name}.sql`, "utf8"));
}, 30000);
beforeEach(async () => {
  port.client = client;
  vi.stubGlobal("fetch", () => { throw new Error("external_network_forbidden"); });
  await db.exec(`truncate lean_private.report_builds; truncate lean_private.publications cascade;
    truncate lean_private.history_jobs cascade; truncate lean_private.spend_jobs;`);
  await db.query(`insert into lean_private.history_jobs
    (run_id,project_ref,shop,from_time,until_time,page_size,max_pages,approval_ref,actor_ref,enabled)
    values('history',$1,$2,'2026-01-01','2026-02-01',2,2,'fixture:approval','fixture:operator',true)`, [project, shop]);
  await db.query(`insert into lean_private.spend_jobs
    (run_id,project_ref,account_id,report_date,max_pages,approval_ref,actor_ref,enabled)
    values('spend',$1,'1234567890','2026-01-01',1,'fixture:approval','fixture:operator',true)`, [project]);
  await db.query(`insert into lean_private.report_builds
    (run_id,project_ref,shop,history_runs,spend_runs,from_date,through_date,policy,approval_ref,actor_ref,enabled)
    values('report',$1,$2,array['history'],array['spend'],'2026-01-01','2026-01-02',$3,'fixture:approval','fixture:operator',true)`,
  [project, shop, JSON.stringify(policy)]);
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
afterAll(async () => { await db?.close(); });
it("builds retained Shopify and Google observations into atomic private reports without a vendor call", async () => {
  await retain();
  expect(await runObservedReportJob(options())).toEqual({ state: "complete", certification: "unverified" });
  const rows = (await db.query("select * from lean_private.report_store_daily order by report_date")).rows;
  expect(rows[0]).toMatchObject({ aov_usd: "20.000000", spend_usd: "1.234567", net_merchandise_sales_usd: "20.000000",
    collected_cash_usd: null, new_customers: null, mer: null, is_stale: true });
  expect(rows[1]).toMatchObject({ spend_usd: null });
  expect((await db.query("select * from lean_private.report_acquisition_daily")).rows[0]).toMatchObject({
    spend_usd: "1.234567", first_party_roas: null, credited_orders: null });
  expect((await db.query("select * from lean_private.report_product_daily")).rows[0]).toMatchObject({ units: "2.000000" });
  expect((await db.query("select state from lean_private.publications")).rows).toEqual([{ state: "candidate" }]);
  expect((await db.query("select * from lean_analytics.store_daily")).rows).toEqual([]);
  expect((await db.query("select * from lean_private.certifications")).rows).toEqual([]);
});
it("returns complete on retry without duplicating facts", async () => {
  await retain(); await runObservedReportJob(options());
  expect(await runObservedReportJob(options())).toEqual({ state: "complete" });
  expect((await db.query("select count(*)::int n from lean_private.orders")).rows[0]).toEqual({ n: 1 });
});
it("blocks incomplete or disabled sources and denies the wrong target", async () => {
  expect(await runObservedReportJob(options())).toEqual({ state: "blocked" });
  await retain(); await db.exec("update lean_private.spend_jobs set enabled=false");
  expect(await runObservedReportJob(options())).toEqual({ state: "blocked" });
  await db.exec("update lean_private.report_builds set enabled=false");
  expect(await runObservedReportJob(options())).toEqual({ state: "disabled" });
  expect((await client.rpc("lean_report_inputs", { ...args, p_project_ref: "b".repeat(20) })).error).toBeTruthy();
});
it("rejects policy drift and stops instead of omitting unsupported orders", async () => {
  await expect(db.exec("update lean_private.report_builds set through_date='2026-01-03'")).rejects.toThrow("immutable");
  const edited = source(); edited.commerce.order.edited = true; await retain(edited);
  await expect(runObservedReportJob(options())).rejects.toThrow("original_purchase_snapshot");
  expect((await db.query("select * from lean_private.publications")).rows).toHaveLength(0);
});
it("allows only an explicit original-purchase handoff and withholds partial commerce totals", async () => {
  const edited = source(); edited.commerce.order.edited = true;
  await db.exec("delete from lean_private.report_builds");
  await db.query(`insert into lean_private.report_builds
    (run_id,project_ref,shop,history_runs,spend_runs,from_date,through_date,policy,approval_ref,actor_ref,enabled)
    values('report',$1,$2,array['history'],array['spend'],'2026-01-01','2026-01-02',$3,'fixture:approval','fixture:actor',true)`,
  [project, shop, JSON.stringify({ ...policy, deferredOrders: [{
    orderGid: edited.commerce.order.id, sourceUpdatedAt: edited.commerce.order.updatedAt, evidenceRef: "fixture:original",
  }] })]);
  await retain(edited); await runObservedReportJob(options());
  expect((await db.query("select * from lean_private.orders")).rows).toEqual([]);
  expect((await db.query("select * from lean_private.report_store_daily order by report_date")).rows[0]).toMatchObject({
    eligible_orders: null, net_merchandise_sales_usd: null, spend_usd: "1.234567",
    readiness: expect.objectContaining({ eligible_orders: "withheld", net_merchandise_sales_usd: "withheld" }),
  });
});
it("does not convert foreign currency observations into USD", async () => {
  await db.query("update lean_private.spend_jobs set base=$1::jsonb",
    [JSON.stringify({ ...base(), sourceCurrency: "CAD" })]);
  await db.query("select public.lean_history_commit('history',$1,$2,0,null,null,true,'[]')", [project, shop]);
  await runObservedReportJob(options());
  expect((await db.query("select spend_usd from lean_private.report_acquisition_daily")).rows).toEqual([{ spend_usd: null }]);
});
it("rolls back facts and reports if any report attempts certification", async () => {
  await retain();
  const wrapped: AnalyticsRpcClient = { async rpc(name, input) {
    if (name === "lean_report_finish") {
      const changed = structuredClone(input) as typeof input & { p_reports: { store_daily: { readiness: unknown }[] } };
      changed.p_reports.store_daily[0].readiness = { eligible_orders: "ready" };
      return client.rpc(name, changed);
    }
    return client.rpc(name, input);
  } };
  await expect(runObservedReportJob({ ...options(), client: wrapped })).rejects.toThrow("storage_unavailable");
  expect((await db.query("select * from lean_private.publications")).rows).toHaveLength(0);
  expect((await db.query("select * from lean_private.orders")).rows).toHaveLength(0);
  expect((await client.rpc("lean_report_inputs", args)).data).toMatchObject({ state: "ready" });
});
it("rejects changed inputs rather than committing a stale build", async () => {
  await retain();
  const wrapped: AnalyticsRpcClient = { rpc: (name, input) => client.rpc(name,
    name === "lean_report_finish" ? { ...input, p_input_hash: "wrong" } : input) };
  expect(await runObservedReportJob({ ...options(), client: wrapped })).toMatchObject({ state: "changed" });
  expect((await db.query("select * from lean_private.publications")).rows).toHaveLength(0);
});
it("honors a source kill switch between read and commit", async () => {
  await retain();
  const wrapped: AnalyticsRpcClient = { async rpc(name, input) {
    if (name === "lean_report_finish") await db.exec("update lean_private.history_jobs set enabled=false");
    return client.rpc(name, input);
  } };
  expect(await runObservedReportJob({ ...options(), client: wrapped })).toMatchObject({ state: "changed" });
  expect((await db.query("select * from lean_private.publications")).rows).toHaveLength(0);
});
it("rejects duplicate sources and oversized registered source counts", async () => {
  await retain();
  await db.exec("delete from lean_private.report_builds");
  await db.query(`insert into lean_private.report_builds
    (run_id,project_ref,shop,history_runs,from_date,through_date,policy,approval_ref,actor_ref,enabled)
    values('report',$1,$2,array['history','history'],'2026-01-01','2026-01-02',$3,'fixture:approval','fixture:operator',true)`,
    [project, shop, JSON.stringify(policy)]);
  expect((await client.rpc("lean_report_inputs", args)).error).toBeTruthy();
  await db.exec("delete from lean_private.report_builds");
  await db.query(`insert into lean_private.report_builds
    (run_id,project_ref,shop,history_runs,from_date,through_date,policy,approval_ref,actor_ref,enabled)
    values('report',$1,$2,array['history'],'2026-01-01','2026-01-02',$3,'fixture:approval','fixture:operator',true)`,
    [project, shop, JSON.stringify(policy)]);
  await db.exec("update lean_private.history_jobs set row_count=101");
  expect((await client.rpc("lean_report_inputs", args)).error).toBeTruthy();
});
it("does not replay a finish whose successful response was lost", async () => {
  await retain();
  const wrapped: AnalyticsRpcClient = { async rpc(name, input) {
    const result = await client.rpc(name, input);
    if (name === "lean_report_finish") throw new Error("lost after commit");
    return result;
  } };
  await expect(runObservedReportJob({ ...options(), client: wrapped })).rejects.toThrow("storage_unavailable");
  expect(await runObservedReportJob(options())).toEqual({ state: "complete" });
});
it("removes hosted default grants and prevents runtime registration", async () => {
  const rows = (await db.query(`select r as role,
    has_function_privilege(r,'public.lean_report_inputs(text,text)','execute') as read,
    has_table_privilege(r,'lean_private.report_builds','insert') as register
    from unnest(array['anon','authenticated','service_role']) r`)).rows;
  expect(rows).toEqual([{ role: "anon", read: false, register: false },
    { role: "authenticated", read: false, register: false }, { role: "service_role", read: true, register: false }]);
});
it("keeps dispatch off and rejects unauthorized or request-supplied scope", async () => {
  const request = (suffix = "", body?: string, secret = "x".repeat(32)) =>
    new NextRequest(`https://fixture.invalid/api/analytics/ingest/reports${suffix}`, {
      method: "POST", headers: { authorization: `Bearer ${secret}` }, ...(body ? { body } : {}),
    });
  expect((await POST(request())).status).toBe(404);
  vi.stubEnv("LEAN_ANALYTICS_REPORTS_ENABLED", "true"); vi.stubEnv("LEAN_ANALYTICS_REPORTS_SECRET", "x".repeat(32));
  expect((await POST(request("", undefined, "wrong"))).status).toBe(401);
  expect((await POST(request("?from=other"))).status).toBe(400);
  expect((await POST(request("", "{}"))).status).toBe(400);
});
