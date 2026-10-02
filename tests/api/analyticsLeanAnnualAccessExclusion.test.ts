/** Synthetic retained data + actual SQL/mapper/Supabase transport. No hosted calls. */
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { beforeEach, afterEach, describe, it, expect, vi } from "vitest";
import { boundedPipelineClient, runShopifyPipeline } from "@/lib/analytics/shopifyPipeline";
import { runScheduledPipelineCatchup } from "@/lib/analytics/scheduledPipelineCatchup";
import { projectPilotRetention } from "@/lib/analytics/shopifyRetention";
import { sourceObject } from "@/lib/analytics/shopifySource";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { runtimeSource } from "../fixtures/analyticsRetainedRuntime";
import { PILOT_FINANCIAL_QUERY } from "@/lib/analytics/shopifyPilotSource";
import { parsePipelineHealth } from "../../scripts/analytics/dispatch-pipeline.mjs";

const shop="mullybox-store.myshopify.com", project="xnfjdbpjuaezxjgargto", url=`https://${project}.supabase.co`;
const scopeHash="799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689";
// Retained operating POLICY only, not customer/source data or live authorization.
const approval="Jessica Singh approved ongoing sales activation 2026-09-30T19:00:00Z; installed-baseline amendment approved 2026-09-30T19:14:00Z; session 9e554880-77db-414c-9f03-6574efa210d7";
const policy={
  decision:{approvalRef:approval,eligibility:"eligible",commerceSource:"other",acquisitionEligible:false},
  orderSize:{policyRef:"Jessica-Singh-approved-order-size-20260930T201000Z",
    productSemantics:{"8501257044160":"requested_box_top_size"}},
  saleClock:"paid_at",refundClock:"refund_created_at",productClasses:{"8501257044160":"merchandise"},
  retainedReports:"product-v1",sourceRetention:"financial_allowlist_v1",
  sourceProjection:"financial_no_geo_order_size",financialApprovalRef:approval,
};
const finalizer="lean_pipeline_exclude_annual_access";
const names=new Set(["lean_pipeline_claim","lean_pipeline_retain","lean_pipeline_fail","lean_pipeline_finish_extended",
  "lean_pipeline_health","lean_pipeline_exclude_before_window",finalizer,
  "lean_pipeline_throughput_begin","lean_pipeline_throughput_step","lean_pipeline_throughput_close"]);
const jsonArgs=new Set(["p_source","p_facts","p_reports","p_product_reports","p_order_item_sizes","p_args"]);
let db:PGlite, client:AnalyticsRpcClient, calls:string[], network:ReturnType<typeof vi.fn<typeof fetch>>;
let expectedNative:number;
let delay:((name:string,args:Record<string,unknown>,response:Response)=>Promise<Response>)|undefined;
const sql=(n:string)=>readFileSync(`sql/analytics/${n}.sql`,"utf8");
async function rpc(name:string,args:Record<string,unknown>){
  if(!names.has(name))throw Error("unexpected_fixture_rpc");
  const entries=Object.entries(args);
  return (await db.query<{r:unknown}>(`select public.${name}(${entries.map(([k],i)=>
    `${k}=>$${i+1}${jsonArgs.has(k)?"::jsonb":""}`).join(",")}) r`,
    entries.map(([k,v])=>jsonArgs.has(k)&&v!==null?JSON.stringify(v):v))).rows[0].r;
}
const options=(signal=new AbortController().signal)=>({client:boundedPipelineClient(client,signal),
  projectRef:project,databaseUrl:url,shop,accessToken:"fixture-only",fetcher:network,signal});
const rows=async(q:string)=>(await db.query(q)).rows;
function source(id="1",product="8501257175232"){
  const s=runtimeSource();s.commerce.shop=shop;s.commerce.projection="financial_no_geo_order_size";
  s.commerce.order.id=`gid://shopify/Order/${id}`;s.financial.id=s.commerce.order.id;
  s.commerce.order.createdAt="2026-10-01T12:00:00Z";s.commerce.order.updatedAt="2026-10-01T13:00:00Z";
  s.financial.updatedAt=s.commerce.order.updatedAt;
  const line=sourceObject((sourceObject(s.commerce.order.lineItems).nodes as unknown[])[0]);
  line.id=`gid://shopify/LineItem/${id}2`;line.product={id:`gid://shopify/Product/${product}`};
  line.orderSize={topSize:{status:"known",value:"L"},variantTitle:{status:"missing",value:null}};
  const tx=sourceObject((s.commerce.order.transactions as unknown[])[0]);
  tx.id=`gid://shopify/OrderTransaction/${id}4`;tx.createdAt="2026-10-01T12:00:00Z";tx.processedAt="2026-10-01T12:01:00Z";
  return projectPilotRetention(s);
}
async function retained(s=source(),topic="orders/updated",payload?:Record<string,unknown>){
  const p=payload??{admin_graphql_api_id:s.commerce.order.id,updated_at:s.commerce.order.updatedAt};
  await db.query("select public.lean_accept_receipt('shopify',$1,$2,$3,$4,$5::jsonb)",[
    randomUUID(),JSON.stringify([shop,String(p.admin_graphql_api_id??p.id)]),topic,"a".repeat(64),JSON.stringify(p)]);
  const token=randomUUID(),c=sourceObject(await rpc("lean_pipeline_claim",{p_token:token,p_project_ref:project,p_shop:shop}));
  const args={p_work_id:c.workId,p_token:token};
  expect(await rpc("lean_pipeline_retain",{...args,p_source:s})).toBe(true);
  return {args,source:s};
}
async function pending(s=source()){
  const r=await retained(s);
  expect(await rpc("lean_pipeline_fail",{...r.args,p_code:"mapping_rejected"})).toBe(true);
  return r;
}
// Synthetic elapsed-backoff fixture after all sources are retained. No attempt reset.
const ready=()=>db.exec("update lean_private.work set available_at=clock_timestamp() where state='pending'");
async function rule(expiry="clock_timestamp()+interval '1 hour'"){
  await db.exec(`insert into lean_private.pipeline_annual_access_rules
    (rule_id,project_ref,shop,scope_sha256,excluded_product_id,approval_ref,actor_ref,enabled,not_before,expires_at)
    values('fixture:annual','${project}','${shop}','${scopeHash}','8501257175232',
      'fixture:new-terminal-authority','fixture:owner',true,clock_timestamp()-interval '1 second',${expiry})`);
}
async function grant(){
  await db.exec(`insert into lean_private.pipeline_throughput_grants
    (grant_id,project_ref,shop,scope_sha256,approval_ref,actor_ref,enabled,not_before,expires_at,
      max_extra_claims,max_native_requests,max_batch_claims,max_batch_native_requests)
    values('fixture:catchup','${project}','${shop}','${scopeHash}','fixture:extra-authority','fixture:owner',true,
      clock_timestamp()-interval '1 second',clock_timestamp()+interval '1 hour',640,5120,19,152)`);
}
async function unchanged(){
  return rows(`select jsonb_build_object(
    'scope',(select jsonb_agg(to_jsonb(t)) from lean_private.pipeline_scope t),
    'snapshots',(select jsonb_agg(to_jsonb(t) order by work_id) from lean_private.pipeline_snapshots t),
    'heads',(select jsonb_agg(to_jsonb(t) order by order_gid) from lean_private.pipeline_heads t),
    'store',(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from lean_private.report_store_daily t),
    'product',(select jsonb_agg(to_jsonb(t) order by to_jsonb(t)::text) from lean_private.report_product_daily t),
    'selection',(select jsonb_agg(to_jsonb(t) order by domain) from lean_private.selected_publications t),
    'receipts',(select jsonb_agg(to_jsonb(t) order by receipt_id) from lean_private.receipts t)
  ) preserved`);
}
beforeEach(async()=>{
  db=new PGlite();calls=[];delay=undefined;expectedNative=0;
  network=vi.fn<typeof fetch>(async()=>{throw Error("forbidden_source_or_hosted_io");});
  await db.exec("create role service_role;create role anon;create role authenticated;create role lean_posthog_reader;");
  for(const n of ["001_staging","003_receipts","004_worker","013_release","014_reporting_views",
    "017_shopify_pipeline","046_order_item_sizes","047_pipeline_extended","052_pipeline_before_window_exclusion","pipeline_throughput.review"])
    await db.exec(sql(n));
  await db.query(`insert into lean_private.pipeline_scope
    (shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
    values($1,$2,true,'2026-09-30T19:19:02.220236Z','9999-12-31T00:00:00Z',$3::jsonb,'fixture:scope','fixture:owner')`,
    [shop,project,JSON.stringify(policy)]);
  expect((await db.query<{h:string}>("select lean_private.pipeline_throughput_scope_hash() h")).rows[0].h).toBe(scopeHash);
  const oldRpcs=await rows(`select oid,proowner,proacl::text,proconfig from pg_proc where oid in
    ('public.lean_pipeline_health(text,text)'::regprocedure,
     'public.lean_pipeline_throughput_step(text,text,uuid,text,jsonb)'::regprocedure) order by oid`);
  await db.exec(sql("pipeline_annual_access_exclusion.review"));
  expect(await rows(`select oid,proowner,proacl::text,proconfig from pg_proc where oid in
    ('public.lean_pipeline_health(text,text)'::regprocedure,
     'public.lean_pipeline_throughput_step(text,text,uuid,text,jsonb)'::regprocedure) order by oid`)).toEqual(oldRpcs);
  client=createClient(url,"fixture",{auth:{persistSession:false},global:{fetch:async(input,init)=>{
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const name=new URL(String(input)).pathname.split("/").pop()!,args=JSON.parse(String(init?.body));
    calls.push(name==="lean_pipeline_throughput_step"?String(args.p_operation):name);
    let response:Response;
    try{response=Response.json(await rpc(name,args));}
    catch{response=Response.json({code:"FIXTURE",message:"synthetic_sql_refusal"},{status:400});}
    return delay?delay(name,args,response):response;
  }}});
},30000);
afterEach(async()=>{expect(network).toHaveBeenCalledTimes(expectedNative);await db.close();});

describe("explicit annual-only terminal exclusion",()=>{
  it("default empty, disabled or expired authority never terminally excludes",async()=>{
    const {args}=await retained(),before=await unchanged();
    expect(await rpc(finalizer,args)).toBe(false);await rule("clock_timestamp()-interval '0.5 seconds'");
    expect(await rpc(finalizer,args)).toBe(false);
    await db.exec("update lean_private.pipeline_annual_access_rules set enabled=false");
    expect(await rpc(finalizer,args)).toBe(false);
    expect(await unchanged()).toEqual(before);
    expect(await rows("select state,attempts from lean_private.work")).toEqual([{state:"leased",attempts:1}]);
    expect(await rows("select count(*)::int n from lean_private.pipeline_operator_audit")).toEqual([{n:0}]);
  });
  it("nine pending synthetic receipts for three orders reuse retained source and preserve attempts/scope/reports",async()=>{
    await rule();
    for(let i=0;i<9;i++)await pending(source(String(1+i%3)));
    await ready();
    const before=await unchanged();
    for(let i=0;i<9;i++)expect(await runShopifyPipeline(options())).toEqual({state:"excluded",reason:"excluded_annual_access"});
    expect(await unchanged()).toEqual(before);
    expect(await rows("select count(*)::int n from lean_private.pipeline_operator_audit where event='excluded_annual_access'")).toEqual([{n:9}]);
    expect(await rows("select distinct state,attempts,last_error_code from lean_private.work"))
      .toEqual([{state:"done",attempts:2,last_error_code:"excluded_annual_access"}]);
    expect(await rpc("lean_pipeline_health",{p_project_ref:project,p_shop:shop}))
      .toMatchObject({done:9,excluded:9,excludedBeforeWindow:0,excludedAnnualAccess:9,pending:0});
    expect(await runShopifyPipeline(options())).toEqual({state:"idle"});
    expect(calls.filter(n=>n==="lean_pipeline_fail")).toHaveLength(0);
  });
  it("preserves 25 merchandise heads and two selected pointers, refusing an annual correction to a prior head",async()=>{
    await rule();
    for(let i=1;i<=25;i++){
      await pending(source(String(i),"8501257044160"));await ready();
      expect(await runShopifyPipeline(options())).toEqual({state:"done"});
    }
    await db.exec(`insert into lean_private.publications(publication_id,contract_version,evidence_ref)
      values('fixture:g1-full','fixture','fixture');
      insert into lean_private.certifications(publication_id,domain,evidence_ref,source_reconciliation_ref,approved_by)
      values('fixture:g1-full','store_daily','fixture','fixture','fixture'),
        ('fixture:g1-full','product_daily','fixture','fixture','fixture');
      insert into lean_private.selected_publications(domain,publication_id)
      values('store_daily','fixture:g1-full'),('product_daily','fixture:g1-full')`);
    const annual=await retained(source("100")),preserved=await unchanged();
    expect(await rpc(finalizer,annual.args)).toBe(true);expect(await unchanged()).toEqual(preserved);
    expect(await rows("select count(*)::int n from lean_private.pipeline_heads")).toEqual([{n:25}]);
    const {args}=await retained(source("1")),before=await unchanged();
    await expect(rpc(finalizer,args)).rejects.toThrow("existing order head");
    expect(await unchanged()).toEqual(before);
    expect(await rows("select count(*)::int n from lean_private.pipeline_operator_audit")).toEqual([{n:1}]);
  });
  it("future annual receipt follows the unchanged actual read/retain path before explicit exclusion",async()=>{
    await rule();const s=source();
    expectedNative=4;
    network.mockImplementation(async(input,init)=>{
      expect(String(input)).toBe(`https://${shop}/admin/api/2026-07/graphql.json`);
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      const body=JSON.parse(String(init?.body));
      return Response.json({data:{order:body.query===PILOT_FINANCIAL_QUERY?s.financial:s.commerce.order}},
        {headers:{"X-Shopify-API-Version":"2026-07"}});
    });
    await db.query("select public.lean_accept_receipt('shopify',$1,$2,'orders/paid',$3,$4::jsonb)",
      [randomUUID(),JSON.stringify([shop,s.commerce.order.id]),"a".repeat(64),
        JSON.stringify({admin_graphql_api_id:s.commerce.order.id,updated_at:s.commerce.order.updatedAt})]);
    expect(await runShopifyPipeline(options())).toEqual({state:"excluded",reason:"excluded_annual_access"});
    expect(calls).toContain("lean_pipeline_retain");expect(calls).not.toContain("lean_pipeline_finish_extended");
    expect(await rows("select count(*)::int n from lean_private.pipeline_heads")).toEqual([{n:0}]);
  });
  it("direct RPC denies unknown/mixed/edited/partial/empty/duplicate/malformed lines without dropping records",async()=>{
    await rule();const base=source(),{args}=await retained(base);
    const mutations=[
      (s:typeof base)=>{sourceObject((sourceObject(s.commerce.order.lineItems).nodes as unknown[])[0]).product={id:"gid://shopify/Product/99"};},
      (s:typeof base)=>{const c=sourceObject(s.commerce.order.lineItems),line=structuredClone(sourceObject((c.nodes as unknown[])[0]));
        line.id="gid://shopify/LineItem/99";line.product={id:"gid://shopify/Product/8501257044160"};(c.nodes as unknown[]).push(line);},
      (s:typeof base)=>{s.commerce.order.edited=true;},
      (s:typeof base)=>{sourceObject(sourceObject(s.commerce.order.lineItems).pageInfo).hasNextPage=true;},
      (s:typeof base)=>{sourceObject(s.commerce.order.lineItems).nodes=[];},
      (s:typeof base)=>{const c=sourceObject(s.commerce.order.lineItems);(c.nodes as unknown[]).push(structuredClone((c.nodes as unknown[])[0]));},
      (s:typeof base)=>{sourceObject((sourceObject(s.commerce.order.lineItems).nodes as unknown[])[0]).quantity=1.5;},
    ];
    for(const change of mutations){
      const s=structuredClone(base);change(s);
      await db.query("update lean_private.pipeline_snapshots set source=$2::jsonb where work_id=$1",[args.p_work_id,JSON.stringify(s)]);
      await expect(rpc(finalizer,args)).rejects.toThrow("annual exclusion");
    }
    expect(await rows("select state,attempts from lean_private.work")).toEqual([{state:"leased",attempts:1}]);
    expect(await rows("select count(*)::int n from lean_private.pipeline_operator_audit")).toEqual([{n:0}]);
  });
  it("unknown or mixed products still follow the unchanged mapper failure path",async()=>{
    await rule();await pending(source("1","99"));await ready();
    expect(await runShopifyPipeline(options())).toEqual({state:"failed"});
    expect(calls).not.toContain(finalizer);
    expect(await rows("select state,last_error_code,attempts from lean_private.work"))
      .toEqual([{state:"pending",last_error_code:"mapping_rejected",attempts:2}]);
  });
  it("valid refund event lineage may exclude only the same retained annual order",async()=>{
    await rule();const s=source();
    s.refunds=[{id:"gid://shopify/Refund/9",order:{id:s.commerce.order.id},updatedAt:s.commerce.order.updatedAt}];
    const {args}=await retained(s,"refunds/create",{admin_graphql_api_id:"gid://shopify/Refund/9",order_id:"1",
      updated_at:s.commerce.order.updatedAt});
    expect(await rpc(finalizer,args)).toBe(true);
    expect(await rpc(finalizer,args)).toBe(false);
    expect(await rows("select count(*)::int n from lean_private.pipeline_operator_audit")).toEqual([{n:1}]);
  });
  it("wrong token, expired lease, frozen policy and receipt revision drift cannot exclude",async()=>{
    await rule();const {args}=await retained();
    expect(await rpc(finalizer,{...args,p_token:randomUUID()})).toBe(false);
    await db.exec("update lean_private.work set lease_until=clock_timestamp()-interval '1 second'");
    expect(await rpc(finalizer,args)).toBe(false);
    await db.exec("update lean_private.work set lease_until=clock_timestamp()+interval '120 seconds'");
    await db.exec("update lean_private.pipeline_snapshots set policy=policy||'{\"unexpected\":true}'::jsonb");
    await expect(rpc(finalizer,args)).rejects.toThrow("frozen authority");
    await db.query("update lean_private.pipeline_snapshots set policy=$1::jsonb",[JSON.stringify(policy)]);
    await db.exec(`update lean_private.receipts set payload=payload||'{"updated_at":"2026-10-02T00:00:00Z"}'::jsonb`);
    await expect(rpc(finalizer,args)).rejects.toThrow("source behind event");
    expect(await rows("select count(*)::int n from lean_private.pipeline_operator_audit")).toEqual([{n:0}]);
    await db.exec("begin isolation level repeatable read");
    await expect(rpc(finalizer,args)).rejects.toThrow("current statement snapshots");
    await db.exec("rollback");
  });
  for(const budget of ["rule","lease"])it(`rolls back terminal work AND audit when ${budget} expires during real audit insertion`,async()=>{
    await rule(budget==="rule"?"clock_timestamp()+interval '0.3 seconds'":"clock_timestamp()+interval '1 hour'");
    const {args}=await retained();
    if(budget==="lease")await db.exec("update lean_private.work set lease_until=clock_timestamp()+interval '0.15 seconds'");
    await db.exec(`create function lean_private.fixture_slow_audit() returns trigger language plpgsql as $$
      begin perform pg_sleep(0.4);return new;end $$;
      create trigger fixture_slow_audit before insert on lean_private.pipeline_operator_audit
      for each row execute function lean_private.fixture_slow_audit()`);
    await expect(rpc(finalizer,args)).rejects.toThrow("deadline after audit");
    expect(await rows("select state,last_error_code from lean_private.work")).toEqual([{state:"leased",last_error_code:null}]);
    expect(await rows("select count(*)::int n from lean_private.pipeline_operator_audit")).toEqual([{n:0}]);
  });
  it("existing actual extra controller delegates this terminal reason with no native permits and unchanged budgets",async()=>{
    await rule();await grant();await pending();await pending(source("2"));await ready();
    const before=await unchanged();
    const out=await runScheduledPipelineCatchup({...options(),client,deadline:Date.now()+180000});
    expect(out).toMatchObject({state:"idle",extraClaims:2,exclusions:2,retainedSourceSteps:2,nativeRequests:0,nativeHydrations:0});
    expect(await unchanged()).toEqual(before);
    expect(await rows("select extra_claims_used,native_permits_used,held,batch_token from lean_private.pipeline_throughput_grants"))
      .toEqual([{extra_claims_used:2,native_permits_used:0,held:false,batch_token:null}]);
  });
  it("lost extra finalizer response is ambiguous: no fail/close/replay, even after actual SQL committed",async()=>{
    await rule();await grant();await pending();await ready();
    const abort=new AbortController();let reached!:()=>void,release!:()=>void;
    const entered=new Promise<void>(r=>{reached=r;});
    delay=async(name,args,response)=>{
      if(name!=="lean_pipeline_throughput_step"||args.p_operation!==finalizer)return response;
      reached();await new Promise<void>(r=>{release=r;});return response;
    };
    const running=runScheduledPipelineCatchup({...options(abort.signal),client,deadline:Date.now()+180000});
    await entered;abort.abort();
    expect((await running).state).toBe("held");release();delay=undefined;
    expect(calls).not.toContain("lean_pipeline_fail");expect(calls).not.toContain("lean_pipeline_throughput_close");
    expect(await rows("select state,last_error_code from lean_private.work")).toEqual([{state:"done",last_error_code:"excluded_annual_access"}]);
    expect(await rpc("lean_pipeline_throughput_begin",{p_project_ref:project,p_shop:shop,p_token:randomUUID(),
      p_deadline:new Date(Date.now()+180000).toISOString()})).toEqual({state:"held"});
    expect(await rows("select count(*)::int n from lean_private.pipeline_operator_audit")).toEqual([{n:1}]);
  });
  it("finite rule cannot renew/re-enable/delete; service has only finalizer execution; old health parser accepts additive counters",async()=>{
    await rule();
    for(const command of ["update lean_private.pipeline_annual_access_rules set expires_at=expires_at+interval '1 second'",
      "delete from lean_private.pipeline_annual_access_rules"])
      await expect(db.exec(command)).rejects.toThrow("authority immutable");
    await db.exec("update lean_private.pipeline_annual_access_rules set enabled=false");
    await expect(db.exec("update lean_private.pipeline_annual_access_rules set enabled=true")).rejects.toThrow("authority immutable");
    expect(await rows(`select has_function_privilege('service_role','public.${finalizer}(bigint,uuid)','EXECUTE') can_call,
      has_function_privilege('anon','public.${finalizer}(bigint,uuid)','EXECUTE') anon_call,
      has_any_column_privilege('service_role','lean_private.pipeline_annual_access_rules','SELECT,INSERT,UPDATE,REFERENCES') columns`))
      .toEqual([{can_call:true,anon_call:false,columns:false}]);
    const health=await rpc("lean_pipeline_health",{p_project_ref:project,p_shop:shop});
    expect(parsePipelineHealth(health)).toMatchObject({enabled:true,pending:0,leased:0,done:0,dead:0,expiredLeases:0});
  });
});
