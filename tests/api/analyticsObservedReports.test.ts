/** Synthetic retained aggregates + real loopback PG. No provider/hosted calls. */
import { Client } from "pg";
import { readFileSync } from "node:fs";
import { beforeAll, afterAll, beforeEach, describe, it, expect, vi } from "vitest";
import { observedReportGet, observedReportPath } from "@/lib/analytics/observedReportDelivery";
import { storeDaily, acquisitionDaily, type ReportScope } from "@/lib/analytics/reporting";
import { normalizeSpendBase } from "@/lib/analytics/spend";
const project="xeqlgxvrhgwwudyqtnun",shop="mullybox-store.myshopify.com",pub="history-progress:fixture:snapshot";
const secret="fixture-report-only-secret-32-characters",date="2026-09-21";
const env={LEAN_OBSERVED_REPORTS_ENABLED:"true",LEAN_OBSERVED_REPORTS_SECRET:secret,LEAN_OBSERVED_REPORTS_SCOPE_ID:"fixture",
  VERCEL_ENV:"preview",VERCEL_GIT_COMMIT_REF:"review/analytics-initial-validation",
  LEAN_ANALYTICS_PIPELINE_PROJECT_REF:project,LEAN_ANALYTICS_SUPABASE_URL:`https://${project}.supabase.co`,
  LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY:"fixture-server-only"};
const req=(path=observedReportPath,auth=`Bearer ${secret}`,method="GET")=>
  new Request(`https://fixed.invalid${path}`,{method,headers:{authorization:auth}});
function reports() {
  const spend=normalizeSpendBase({provider:"google_ads",accountId:"123",date,baseReportId:"fixture",
    sourceTimezone:"America/New_York",sourceCurrency:"USD",completedAt:"2026-09-22T13:00:00Z",
    paginationComplete:true,verifiedEmpty:false,evidenceRef:"fixture",rows:[{campaignId:"42",costMicros:"12345678"}]},pub);
  const facts={orders:[],order_items:[],sales_ledger:[],payments:[],customers:[],sessions:[],
    order_attribution:[],marketing_spend_daily:spend};
  const scope:ReportScope={shop,publication:pub,date,definition:"history-bridge-v1",model:"commerce-only",stale:true,
    gates:{ledger:false,cash:false,orders:false,purchase:false,customers:false,spend:true,attribution:false,
      behavior:false,productAllocation:false}};
  const store=storeDaily(facts,scope),acquisition=acquisitionDaily(facts,scope,new Set([JSON.stringify(["google_ads",spend[0].campaign_key])]));
  for(const row of [store,...acquisition])row.readiness=Object.fromEntries(Object.entries(row.readiness as Record<string,string>)
    .map(([k,v])=>[k,v==="ready"?"observed_unverified":v]));
  return {store,acquisition};
}
function payload() {
  const {store,acquisition}=reports();
  for(const r of [store,...acquisition]){delete r.shop_id;delete r.publication_id;}
  return {store_daily:[store],acquisition_daily:acquisition,coverage:{
    status:"observed_unverified",scope:"selected_google_account_saved_snapshots",financial_coverage_complete:false,
    all_account_spend_coverage_complete:false,certified:false,snapshots:[{report_date:date,completed_at:"2026-09-25T15:54:36+00:00"}],
    unavailable_domains:["product_daily","customer_cohorts","funnel_daily"]}};
}
describe("fixed aggregate HTTP boundary",()=>{
  it.each([
    [{LEAN_OBSERVED_REPORTS_ENABLED:"false"},404],
    [{VERCEL_ENV:"production"},404],
    [{VERCEL_GIT_COMMIT_REF:"main"},404],
    [{LEAN_ANALYTICS_PIPELINE_PROJECT_REF:"production"},503],
    [{LEAN_ANALYTICS_SUPABASE_URL:"https://evil.invalid"},503],
  ])("default-off/environment/destination before transport %j",async(overrides,status)=>{
    const transport=vi.fn();expect((await observedReportGet(req(),{...env,...overrides},transport)).status).toBe(status);
    expect(transport).not.toHaveBeenCalled();
  });
  it("auth, method, selectors and GET-body headers are rejected without DB",async()=>{
    const transport=vi.fn();
    expect((await observedReportGet(req(observedReportPath,"wrong"),env,transport)).status).toBe(401);
    expect((await observedReportGet(req(observedReportPath,undefined,"POST"),env,transport)).status).toBe(405);
    expect((await observedReportGet(req(observedReportPath+"?scope=evil"),env,transport)).status).toBe(400);
    const r=req();r.headers.set("content-length","1");
    expect((await observedReportGet(r,env,transport)).status).toBe(400);
    expect(transport).not.toHaveBeenCalled();
  });
  it("one fixed RPC, exact decimal strings, replay and no provider/secret output",async()=>{
    const transport=vi.fn(async(url,init)=>{
      expect(url).toBe(`https://${project}.supabase.co/rest/v1/rpc/lean_observed_reports_read`);
      expect(JSON.parse(String(init?.body))).toEqual({p_scope_id:"fixture",p_project:project});
      expect(init?.redirect).toBe("error");return Response.json(payload());
    }) as unknown as typeof fetch;
    const a=await observedReportGet(req(),env,transport),b=await observedReportGet(req(),env,transport);
    expect(a.status).toBe(200);expect(a.headers.get("cache-control")).toBe("no-store");
    const text=await a.text();expect(text).toBe(await b.text());expect(text).toContain('"12.345678"');
    expect(text).not.toMatch(/fixture-server-only|fixture-report-only|account_id|customer_id|order_id|publication_id/);
  });
  it("rejects raw fields, nonspend values, byte overflow and DB errors without leakage",async()=>{
    for(const bad of [
      {...payload(),raw:{email:"private"}},
      {...payload(),store_daily:[{...payload().store_daily[0],total_sales_usd:"1.000000"}]},
      {...payload(),coverage:{...payload().coverage,cursor:"private"}},
    ])expect((await observedReportGet(req(),env,async()=>Response.json(bad))).status).toBe(503);
    expect((await observedReportGet(req(),env,async()=>new Response("x".repeat(1048577)))).status).toBe(503);
    const failure=await observedReportGet(req(),env,async()=>new Response("private SQL",{status:500}));
    expect(failure.status).toBe(503);expect(await failure.text()).toBe("");
  });
});

const url=process.env.OBSERVED_REPORT_TEST_URL??process.env.LOCAL_POSTGRES_TEST_URL;
describe.skipIf(!url)("043 real PostgreSQL delivery gate",()=>{
  let control:Client,admin:Client,runtime:Client,scope:Record<string,unknown>,fingerprint:unknown;
  beforeAll(async()=>{
    const u=new URL(url!);
    if(!["127.0.0.1","localhost"].includes(u.hostname) ||
      !["fixture_owner","fixture_shopify_install"].includes(u.username))throw new Error("loopback fixture only");
    control=new Client({connectionString:u.href});await control.connect();
    await control.query("drop database if exists analytics_test_observed_delivery");
    await control.query("create database analytics_test_observed_delivery");u.pathname="/analytics_test_observed_delivery";
    admin=new Client({connectionString:u.href});runtime=new Client({connectionString:u.href});
    await admin.connect();await runtime.connect();
    await admin.query(`do $$ begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
    end $$;alter default privileges in schema public grant execute on functions to anon,authenticated,service_role`);
    for(const file of ["001_staging","013_release","014_reporting_views","019_spend_jobs","038_google_spend_pilot",
      "040_shopify_history_import","041_history_report_bridge","042_history_inventory_normalization"])
      await admin.query(readFileSync(`sql/analytics/${file}.sql`,"utf8"));
    fingerprint=(await admin.query("select oid::regprocedure::text n,pg_get_functiondef(oid) d from pg_proc where proname like 'lean_%' order by 1")).rows;
    await admin.query(readFileSync("sql/analytics/043_observed_report_delivery.sql","utf8"));
    await runtime.query("set role service_role;set statement_timeout='5s'");
  },30000);
  afterAll(async()=>{
    if(admin && fingerprint)expect((await admin.query("select oid::regprocedure::text n,pg_get_functiondef(oid) d from pg_proc where proname like 'lean_%' and proname not like 'lean_observed_%' order by 1")).rows).toEqual(fingerprint);
    await runtime?.end();await admin?.end();if(control){await control.query("drop database if exists analytics_test_observed_delivery");await control.end();}
  });
  beforeEach(async()=>{
    await admin.query("truncate lean_private.observed_report_delivery,lean_private.history_import_jobs,lean_private.publications cascade");
    await admin.query(`insert into lean_private.history_import_jobs(job_id,scope,expires_at) values('source','{}',now()-interval '1 day');
      insert into lean_private.history_report_jobs(run_id,scope,source_job,source_hash,expires_at,report_date)
      values('fixture','{}','source','fixture',now()-interval '1 day','2026-09-21')`);
    const input={shop,publication:pub,coverage:{financialCoverageComplete:false,allAccountSpendCoverageComplete:false}};
    const inputHash=(await admin.query("select encode(sha256(convert_to($1::jsonb::text,'UTF8')),'hex') h",[JSON.stringify(input)])).rows[0].h;
    await admin.query(`insert into lean_private.history_report_progress(run_id,snapshot_id,report_date,input,input_hash,token,lease_until,completed_at,result_hash)
      values('fixture','snapshot',$1,$2,$3,gen_random_uuid(),now()-interval '1 day',now(),$4)`,
      [date,JSON.stringify({...input,inputHash}),inputHash,"b".repeat(64)]);
    await admin.query("insert into lean_private.publications(publication_id,contract_version) values($1,'lean-v1-draft.1')",[pub]);
    const r=reports();
    for(const [table,rows] of [["report_store_daily",[r.store]],["report_acquisition_daily",r.acquisition]] as const)
      await admin.query(`insert into lean_private.${table} select * from jsonb_populate_recordset(null::lean_private.${table},$1)`,[JSON.stringify(rows)]);
    scope={scopeId:"fixture",projectRef:project,shop,expiresAt:new Date(Date.now()+3600000).toISOString(),
      approvalRef:"fixture:observed-only",actorRef:"fixture:owner",snapshots:[{runId:"fixture",snapshotId:"snapshot",date,
        inputHash,resultHash:"b".repeat(64)}]};
  });
  const register=()=>admin.query("select public.lean_observed_reports_register($1)",[JSON.stringify(scope)]);
  const read=async()=> (await runtime.query("select public.lean_observed_reports_read('fixture',$1) r",[project])).rows[0].r;
  const enable=()=>admin.query("update lean_private.observed_report_delivery set enabled=true");
  it("owner registers disabled; runtime read-only privileges, replay and unchanged source jobs",async()=>{
    await register();await register();
    await expect(read()).rejects.toThrow("unavailable");
    await expect(runtime.query("select public.lean_observed_reports_register('{}')")).rejects.toThrow("permission denied");
    await expect(runtime.query("select * from lean_private.observed_report_delivery")).rejects.toThrow("permission denied");
    await expect(runtime.query("select lean_private.observed_report_projection('{}')")).rejects.toThrow("permission denied");
    const grants=(await admin.query(`select has_function_privilege('anon','public.lean_observed_reports_read(text,text)','execute') a,
      has_function_privilege('authenticated','public.lean_observed_reports_read(text,text)','execute') b`)).rows[0];
    expect(grants).toEqual({a:false,b:false});await enable();
    const first=await read();expect(first.store_daily[0].spend_usd).toBe("12.345678");
    expect(first.store_daily[0].total_sales_usd).toBeNull();expect(await read()).toEqual(first);
    await runtime.query("set timezone='America/Los_Angeles'");expect(await read()).toEqual(first);
    expect((await admin.query("select enabled from lean_private.history_report_jobs")).rows).toEqual([{enabled:false}]);
  });
  it("fixed hash/report revision, null and readiness gates fail closed",async()=>{
    await register();await enable();
    await admin.query("update lean_private.report_store_daily set spend_usd=99");
    await expect(read()).rejects.toThrow("projection changed");
    await admin.query("update lean_private.report_store_daily set spend_usd=12.345678,total_sales_usd=0");
    await expect(read()).rejects.toThrow("nonspend boundary");
    await admin.query("update lean_private.report_store_daily set total_sales_usd=null,readiness=jsonb_set(readiness,'{spend_usd}','\"ready\"')");
    await expect(read()).rejects.toThrow("metric boundary");
  });
  it("snapshot changes, wrong project, kill and expiry cannot serve",async()=>{
    await register();await enable();
    await expect(runtime.query("select public.lean_observed_reports_read('fixture','wrong')")).rejects.toThrow("unavailable");
    await admin.query("update lean_private.observed_report_delivery set enabled=false");await expect(read()).rejects.toThrow("unavailable");
    await enable();await admin.query("update lean_private.history_report_progress set result_hash='changed'");
    await expect(read()).rejects.toThrow("snapshot changed");
    await admin.query("update lean_private.history_report_progress set result_hash=$1",["b".repeat(64)]);
    await admin.query("update lean_private.history_report_progress set input=input||'{\"mutated\":true}'::jsonb");
    await expect(read()).rejects.toThrow("snapshot changed");
    await admin.query("update lean_private.history_report_progress set input=input-'mutated'");
    await admin.query("update lean_private.observed_report_delivery set expires_at=now()-interval '1 second'");
    await expect(read()).rejects.toThrow("unavailable");
  });
  it("rejects bad registration before read, scopes never select latest",async()=>{
    scope.expiresAt=new Date(Date.now()+25*3600000).toISOString();await expect(register()).rejects.toThrow("expiry");
    scope.expiresAt=new Date(Date.now()+3600000).toISOString();scope.snapshots=[];
    await expect(register()).rejects.toThrow("scope");
  });
});
