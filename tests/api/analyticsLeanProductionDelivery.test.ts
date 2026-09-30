/** Fixture-only actual SQL -> aggregate RPC -> production HTTP contract. */
import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHmac, randomUUID } from "node:crypto";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { productionReportGet, validProductionReportPayload } from "@/lib/analytics/productionReportDelivery";
import { composeRetainedOrderReports } from "@/lib/analytics/shopifyRetainedOrder";
import { runtimeSource, runtimePolicy } from "../fixtures/analyticsRetainedRuntime";
import { runShopifyPipeline } from "@/lib/analytics/shopifyPipeline";
import { acceptShopifyReceipt } from "@/lib/analytics/receipts";
import { createReceiptStore, type AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { SHOPIFY_FINANCIAL_ORDER_QUERY } from "@/lib/analytics/shopifySource";
import { PILOT_FINANCIAL_QUERY } from "@/lib/analytics/shopifyPilotSource";
import { runScheduledPipeline } from "../../scripts/analytics/scheduled-pipeline.mjs";
const shop = "mullybox-store.myshopify.com", project = "xnfjdbpjuaezxjgargto";
let db: PGlite;
let network: ReturnType<typeof vi.fn>;
const sql = (name: string) => readFileSync(`sql/analytics/${name}.sql`, "utf8");
beforeEach(async () => {
  network = vi.fn(() => { throw new Error("hosted_network_forbidden"); }); vi.stubGlobal("fetch", network);
  db = new PGlite();
  await db.exec(`create role service_role;create role anon;create role authenticated;
    alter default privileges in schema public grant execute on functions to anon,authenticated,service_role;`);
  for (const name of ["001_staging","003_receipts","004_worker","013_release","014_reporting_views",
    "017_shopify_pipeline","047_pipeline_extended","050_production_report_delivery"]) await db.exec(sql(name));
  await db.query(`insert into lean_private.pipeline_scope(shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
    values($1,$2,true,'2026-01-01','2026-02-01',$3::jsonb,'fixture:scope','fixture:operator')`,
    [shop,project,JSON.stringify(runtimePolicy)]);
}, 30000);
afterEach(async () => { await db.close(); expect(network).not.toHaveBeenCalled(); vi.unstubAllGlobals(); });
async function read() {
  await db.exec("set role service_role");
  try { return (await db.query<{r: unknown}>("select public.lean_production_reports_read() r")).rows[0].r; }
  finally { await db.exec("reset role"); }
}
async function enable() {
  await db.exec("update lean_private.production_report_delivery set enabled=true,approval_ref='fixture:export'");
}
async function materialize(orderId = "1", double = false, revision = "2026-01-02T12:00:00Z") {
  const source = runtimeSource();
  source.commerce.shop = shop;
  source.commerce.order.id = `gid://shopify/Order/${orderId}`;
  source.financial.id = source.commerce.order.id;
  source.commerce.order.updatedAt = revision; source.financial.updatedAt = revision;
  if (double) {
    const scale = (v: unknown): void => {
      if (!v || typeof v !== "object") return;
      for (const [k,value] of Object.entries(v)) {
        if (k === "amount" && typeof value === "string")
          (v as Record<string,unknown>)[k] = String(Number(value) * 2);
        else scale(value);
      }
    };
    scale(source);
  }
  await db.query("select public.lean_accept_receipt('shopify',$1,$2,'orders/paid',$3,$4::jsonb)",
    [randomUUID(),JSON.stringify([shop,orderId]),"a".repeat(64),JSON.stringify({id:orderId})]);
  const token = randomUUID();
  const claim = (await db.query<{r:{workId:string;publication:string}}>(
    "select public.lean_pipeline_claim($1::uuid,$2,$3) r",[token,project,shop])).rows[0].r;
  await db.query("select public.lean_pipeline_retain($1::bigint,$2::uuid,$3::jsonb)",
    [claim.workId,token,JSON.stringify(source)]);
  const output = composeRetainedOrderReports(source,{...runtimePolicy,lineClasses:{"2":"merchandise"}},
    claim.publication,"fixture:retained","shopify-observed-v1");
  const done = (await db.query<{ok:boolean}>(
    "select public.lean_pipeline_finish_extended($1::bigint,$2::uuid,$3::jsonb,$4::jsonb,$5::jsonb,null) ok",
    [claim.workId,token,JSON.stringify(output.facts),JSON.stringify(output.reports),
      JSON.stringify(output.productReports)])).rows[0].ok;
  expect(done).toBe(true);
}
const env = { LEAN_PRODUCTION_REPORTS_ENABLED:"true",VERCEL_ENV:"production",VERCEL_GIT_COMMIT_REF:"main",
  LEAN_PRODUCTION_REPORTS_SECRET:"fixture-only-report-secret-32-characters",
  LEAN_ANALYTICS_PIPELINE_PROJECT_REF:project,LEAN_ANALYTICS_SUPABASE_URL:`https://${project}.supabase.co`,
  LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY:"fixture-only-service-key" };
const request = (path = "", auth = true) => new Request(`https://fixture.invalid/api/analytics/reports/production${path}`,
  {headers:auth ? {authorization:`Bearer ${env.LEAN_PRODUCTION_REPORTS_SECRET}`} : {}});

it("installs inert and grants only aggregate RPC execution, not private access", async () => {
  expect(await read()).toBeNull();
  const permissions = (await db.query(`select
    has_function_privilege('anon','public.lean_production_reports_read()','EXECUTE') anon,
    has_function_privilege('authenticated','public.lean_production_reports_read()','EXECUTE') authenticated,
    has_function_privilege('service_role','public.lean_production_reports_read()','EXECUTE') service,
    has_table_privilege('service_role','lean_private.production_report_delivery','SELECT') private`)).rows[0];
  expect(permissions).toEqual({anon:false,authenticated:false,service:true,private:false});
  await enable(); expect(await read()).toEqual({store_daily:[],product_daily:[]});
});
it("produces correct daily totals and ratio-of-sums AOV without raw lineage", async () => {
  await materialize(); await materialize("10",true); await enable();
  const data = await read() as {store_daily:Record<string,unknown>[];product_daily:Record<string,unknown>[]};
  expect(validProductionReportPayload(data)).toBe(true);
  expect(data.store_daily[0]).toMatchObject({total_sales_usd:"66.000000",eligible_orders:"2",
    purchase_merchandise_net_usd:"54.000000",aov_usd:"27.000000",collected_cash_usd:null,new_customers:null});
  expect(data.product_daily[0]).toMatchObject({units:"4.000000",net_merchandise_sales_usd:"54.000000"});
  expect(JSON.stringify(data)).not.toMatch(/order_gid|publication_id|shop_id|customer_id|gid:\/\/|source_revision/);
  const transport = vi.fn<typeof fetch>(async (url, init) => {
    expect(url).toBe(`https://${project}.supabase.co/rest/v1/rpc/lean_production_reports_read`);
    expect(init).toMatchObject({method:"POST",redirect:"error",body:"{}"});
    return Response.json(data);
  });
  const response = await productionReportGet(request(),env,transport);
  expect(response.status).toBe(200); expect(await response.json()).toEqual(data);
});
it("exports latest revisions only and preserves stale flags after stopping", async () => {
  await materialize(); await materialize("1",false,"2026-01-03T12:00:00Z"); await enable();
  const data = await read() as {store_daily:Record<string,unknown>[]};
  expect(data.store_daily[0]).toMatchObject({eligible_orders:"1",total_sales_usd:"22.000000"});
  await db.exec("update lean_private.pipeline_scope set enabled=false");
  const stopped = await read() as {store_daily:Record<string,unknown>[]};
  expect(stopped.store_daily[0].is_stale).toBe(true);
  await db.exec("update lean_private.production_report_delivery set enabled=false");
  expect(await read()).toBeNull();
});
it("withholds a metric if any contributing row lacks it", async () => {
  await materialize(); await materialize("10",true); await enable();
  await db.exec(`update lean_private.report_store_daily set total_sales_usd=null
    where publication_id=(select max(publication_id) from lean_private.report_store_daily)`);
  const data = await read() as {store_daily:Record<string,unknown>[]};
  expect(data.store_daily[0].total_sales_usd).toBeNull();
  expect((data.store_daily[0].readiness as Record<string,unknown>).total_sales_usd).toBe("withheld");
});
it("blocks disabled, preview, wrong target, no-auth and caller-selected query without database calls", async () => {
  const transport = vi.fn();
  for (const [change,req,status] of [
    [{LEAN_PRODUCTION_REPORTS_ENABLED:"false"},request(),404],
    [{VERCEL_ENV:"preview"},request(),404],
    [{VERCEL_GIT_COMMIT_REF:"review/branch"},request(),404],
    [{},request("",false),401],
    [{},request("?date=2026-01-01"),400],
    [{LEAN_ANALYTICS_SUPABASE_URL:"https://wrong.invalid"},request(),503],
  ] as const) expect((await productionReportGet(req,{...env,...change},transport)).status).toBe(status);
  expect(transport).not.toHaveBeenCalled();
});
it("rejects injected fields, false certification, duplicate rows and oversized responses", async () => {
  await materialize(); await enable();
  const data = await read() as {store_daily:Record<string,unknown>[];product_daily:Record<string,unknown>[]};
  for (const bad of [
    {...data,raw_orders:[]},
    {...data,store_daily:[{...data.store_daily[0],customer_id:"not-allowed"}]},
    {...data,store_daily:[{...data.store_daily[0],certified:true}]},
    {...data,store_daily:[...data.store_daily,...data.store_daily]},
  ]) expect((await productionReportGet(request(),env,async () => Response.json(bad))).status).toBe(503);
  expect((await productionReportGet(request(),env,async () => new Response(" ".repeat(4194305)))).status).toBe(503);
});
it("rolls back installation on an unknown inherited function grant", async () => {
  await db.exec(`drop function public.lean_production_reports_read();
    drop table lean_private.production_report_delivery;
    create role unknown_fixture_reader;
    alter default privileges in schema public grant execute on functions to unknown_fixture_reader;`);
  await expect(db.exec(sql("050_production_report_delivery"))).rejects.toThrow("unexpected report function grantee");
  await db.exec("rollback");
  expect((await db.query(`select to_regclass('lean_private.production_report_delivery') gate,
    to_regprocedure('public.lean_production_reports_read()') reader`)).rows[0])
    .toEqual({gate:null,reader:null});
  expect((await db.query("select count(*)::int n from lean_private.pipeline_scope")).rows[0]).toEqual({n:1});
});
it("joins genuine implementation boundaries with fixtures: signed receipt through recurring worker to aggregate feed", async () => {
  const names = new Set(["lean_accept_receipt","lean_pipeline_claim","lean_pipeline_retain",
    "lean_pipeline_finish_extended","lean_pipeline_fail","lean_pipeline_health"]);
  const jsonKeys = new Set(["p_payload","p_facts","p_reports","p_product_reports","p_order_item_sizes"]);
  const client: AnalyticsRpcClient = { async rpc(name,args) {
    if (!names.has(name)) throw new Error("unexpected_fixture_rpc");
    const entries = Object.entries(args);
    const asJson = (key: string) => jsonKeys.has(key) || (name === "lean_pipeline_retain" && key === "p_source");
    try {
      const r = await db.query<{r:unknown}>(
        `select public.${name}(${entries.map(([key],i) => `${key}=>$${i+1}${asJson(key) ? "::jsonb" : ""}`).join(",")}) r`,
        entries.map(([key,value]) => asJson(key) && value !== null ? JSON.stringify(value) : value));
      return {data:r.rows[0].r,error:null};
    } catch { return {data:null,error:"fixture_storage_error"}; }
  }};
  const body = Buffer.from(JSON.stringify({id:"1",email:"fixture-private-not-retained"}));
  await acceptShopifyReceipt({body,topic:"orders/paid",secret:"fixture-signing",deliveryId:randomUUID(),
    allowedShop:shop,shop,retention:"financial_allowlist_v1",
    signature:createHmac("sha256","fixture-signing").update(body).digest("base64")},createReceiptStore(client));
  const source = runtimeSource(); source.commerce.shop = shop;
  const provider = vi.fn<typeof fetch>(async (_url,init) => {
    const {query} = JSON.parse(String(init?.body));
    const data = query === SHOPIFY_FINANCIAL_ORDER_QUERY ? {order:source.commerce.order} :
      query === PILOT_FINANCIAL_QUERY ? {order:source.financial} : null;
    if (!data) throw new Error("unexpected_fixture_source_query");
    return new Response(JSON.stringify({data}),{headers:{"X-Shopify-API-Version":"2026-07"}});
  });
  const dispatch = vi.fn<typeof fetch>(async (_url,init) => Response.json(init?.method === "POST" ?
    await runShopifyPipeline({client,projectRef:project,databaseUrl:`https://${project}.supabase.co`,
      shop,accessToken:"fixture-only",fetcher:provider}) :
    (await client.rpc("lean_pipeline_health",{p_project_ref:project,p_shop:shop})).data));
  const result = await runScheduledPipeline({...env,LEAN_ANALYTICS_SCHEDULE_ENABLED:"true",
    LEAN_ANALYTICS_DISPATCH_ENABLED:"true",LEAN_ANALYTICS_SCHEDULE_MODE:"continuous",
    LEAN_ANALYTICS_RUNNER_ORIGIN:"https://www.mymully.com",
    LEAN_ANALYTICS_PIPELINE_SECRET:"fixture-dispatch-secret-32-characters"}, {fetcher:dispatch});
  expect(result.state).toBe("complete"); expect(result.calls).toBe(3);
  await enable();
  const payload = await read();
  const response = await productionReportGet(request(),env,async () => Response.json(payload));
  expect(response.status).toBe(200);
  expect((await response.json()).store_daily[0]).toMatchObject({total_sales_usd:"22.000000",eligible_orders:"1"});
  const manifest = JSON.parse(readFileSync("docs/analytics/production-posthog-manifest.json","utf8"));
  expect(manifest.resources.map((r: {endpoint:{data_selector:string}}) => r.endpoint.data_selector))
    .toEqual(["store_daily","product_daily"]);
  expect(JSON.stringify(payload)).not.toContain("fixture-private");
  expect((await db.query("select count(*)::int n from lean_private.pipeline_heads")).rows[0]).toEqual({n:1});
});
