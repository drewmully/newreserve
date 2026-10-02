/** Synthetic retained inputs only. Actual SQL, mapper and local Supabase transport. */
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectPilotRetention } from "@/lib/analytics/shopifyRetention";
import { sourceObject } from "@/lib/analytics/shopifySource";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import type { PipelinePolicy } from "@/lib/analytics/shopifyPipeline";
import { runtimeSource, runtimeMoney as money } from "../fixtures/analyticsRetainedRuntime";
import { readOrdinaryBatchAdmission, runOrdinaryPipelineBatch, ordinarySourceBudget } from "@/lib/analytics/ordinaryPipelineBatch";
import { PILOT_FINANCIAL_QUERY } from "@/lib/analytics/shopifyPilotSource";
import { NextRequest } from "next/server";

const shop="mullybox-store.myshopify.com",project="xnfjdbpjuaezxjgargto",url=`https://${project}.supabase.co`;
const sourcePin="7df76771b2de58f8ae485e1bbbe17997a225609c09e8cc4941efa2f1598c4358";
const metadataPin="da013d66811726982d6099d1df5fc6d4c7b8f275d3302fe24e0ea012f5093070";
const scopePin="799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689";
const approval="Jessica Singh approved ongoing sales activation 2026-09-30T19:00:00Z; installed-baseline amendment approved 2026-09-30T19:14:00Z; session 9e554880-77db-414c-9f03-6574efa210d7";
const policy:PipelinePolicy={
  decision:{approvalRef:approval,eligibility:"eligible",commerceSource:"other",acquisitionEligible:false},
  orderSize:{policyRef:"Jessica-Singh-approved-order-size-20260930T201000Z",
    productSemantics:{"8501257044160":"requested_box_top_size"}},
  saleClock:"paid_at",refundClock:"refund_created_at",productClasses:{"8501257044160":"merchandise"},
  retainedReports:"product-v1",sourceRetention:"financial_allowlist_v1",
  sourceProjection:"financial_no_geo_order_size",financialApprovalRef:approval,
};
const file="sql/analytics/pipeline_zero_total_exception.review.sql";
const raw=readFileSync(file,"utf8");
const sql=(name:string)=>readFileSync(`sql/analytics/${name}.sql`,"utf8");
// Derive fixture pins from the ORIGINAL held-work-read72d704 record and its
// subtraction, independently of the new helper. Never substitute a hash from
// whatever projection the candidate happens to implement.
const metadata=`(select to_jsonb(snap)-array['source_bytes','source_retained'] from
  (select s.work_id,s.shop,s.publication_id,s.policy,s.from_time,s.until_time,s.order_gid,s.revision,
    s.source is not null source_retained,octet_length(s.source::text) source_bytes) snap)`;
const hash=(value:string)=>`encode(sha256(convert_to(${value}::text,'UTF8')),'hex')`;
let db:PGlite,client:AnalyticsRpcClient,network:ReturnType<typeof vi.fn<typeof fetch>>;
let target:{p_work_id:string;p_token:string},bind:{scope:string;work:string;receipt:string};
let fixtureRaw:string;
let expectedNative:number;
let afterRpc:((name:string,args:Record<string,unknown>)=>Promise<void>)|undefined;
const rows=async<T=Record<string,unknown>>(query:string,args:unknown[]=[]) => (await db.query<T>(query,args)).rows;
async function rpc(name:string,args:Record<string,unknown>){
  if(!["lean_pipeline_claim","lean_pipeline_retain","lean_pipeline_fail","lean_pipeline_finish_extended",
    "lean_pipeline_health","lean_pipeline_ordinary_batch_admission","lean_pipeline_ordinary_batch_claim"].includes(name))throw Error("unexpected_fixture_rpc");
  const entries=Object.entries(args),json=new Set(["p_source","p_facts","p_reports","p_product_reports","p_order_item_sizes"]);
  return (await rows<{r:unknown}>(`select public.${name}(${entries.map(([k],i)=>
    `${k}=>$${i+1}${json.has(k)?"::jsonb":""}`).join(",")}) r`,
    entries.map(([k,v])=>json.has(k)&&v!==null?JSON.stringify(v):v)))[0].r;
}
function source(id="1",zero=true,revision="2026-10-01T16:26:58Z"){
  const s=runtimeSource();s.commerce.shop=shop;s.commerce.projection="financial_no_geo_order_size";
  const o=s.commerce.order;o.id=`gid://shopify/Order/${id}`;
  o.createdAt="2026-10-01T12:00:00Z";o.updatedAt=revision;s.financial.id=o.id;s.financial.updatedAt=revision;
  const line=sourceObject((sourceObject(o.lineItems).nodes as unknown[])[0]);
  line.id=`gid://shopify/LineItem/${id}2`;line.product={id:"gid://shopify/Product/8501257044160"};
  line.orderSize={topSize:{status:"known",value:"L"},variantTitle:{status:"missing",value:null}};
  if(zero){
    o.originalTotalPriceSet=money("0");o.subtotalPriceSet=money("0");
    o.transactions=[];o.transactionsCount={count:0,precision:"EXACT"};
    line.discountAllocations=[{allocatedAmountSet:money("20")}];
    s.financial.originalTotalPriceSet=money("0");s.financial.totalTaxSet=money("0");
  }else{
    const tx=sourceObject((o.transactions as unknown[])[0]);tx.id=`gid://shopify/OrderTransaction/${id}4`;
    tx.createdAt="2026-10-01T12:00:00Z";tx.processedAt="2026-10-01T12:01:00Z";
  }
  return projectPilotRetention(s);
}
async function retained(s=source()){
  await db.query("select public.lean_accept_receipt('shopify',$1,$2,'orders/updated',$3,$4::jsonb)",[
    randomUUID(),JSON.stringify([shop,s.commerce.order.id]),"a".repeat(64),
    JSON.stringify({admin_graphql_api_id:s.commerce.order.id,updated_at:s.commerce.order.updatedAt})]);
  const p_token=randomUUID(),c=sourceObject(await rpc("lean_pipeline_claim",{p_token,p_project_ref:project,p_shop:shop}));
  const args={p_work_id:String(c.workId),p_token};
  expect(await rpc("lean_pipeline_retain",{...args,p_source:s})).toBe(true);
  expect(await rpc("lean_pipeline_fail",{...args,p_code:"mapping_rejected"})).toBe(true);
  return args;
}
async function hashes(){
  return (await rows<{scope:string;work:string;receipt:string}>(`select ${hash("to_jsonb(c)")} scope,
    ${hash("to_jsonb(w)")} work,${hash("to_jsonb(r)")} receipt
    from lean_private.work w join lean_private.receipts r using(receipt_id)
    cross join lean_private.pipeline_scope c where w.work_id=$1`,[target.p_work_id]))[0];
}
const register=(bindings=bind,deadline="clock_timestamp()+interval '1 minute'")=>db.query(
  `select lean_private.register_pipeline_zero_total_exception($1,$2,$3,$4,$5,${deadline})`,
  ["fixture:explicit-exact-revision","fixture:owner",bindings.scope,bindings.work,bindings.receipt]);
const ready=(id:string)=>db.query("update lean_private.work set available_at=clock_timestamp()-interval '1 second' where work_id=$1",[id]);
async function preserved(){
  return rows(`select jsonb_build_object(
    'work',(select to_jsonb(w) from lean_private.work w where work_id=$1),
    'source',(select to_jsonb(s) from lean_private.pipeline_snapshots s where work_id=$1),
    'receipt',(select to_jsonb(r) from lean_private.receipts r join lean_private.work w using(receipt_id) where w.work_id=$1),
    'scope',(select jsonb_agg(to_jsonb(c)) from lean_private.pipeline_scope c),
    'grants',(select jsonb_agg(to_jsonb(g)) from lean_private.pipeline_throughput_grants g),
    'annual',(select jsonb_agg(to_jsonb(a)) from lean_private.pipeline_annual_access_rules a),
    'selected',(select jsonb_agg(to_jsonb(p)) from lean_private.selected_publications p)) evidence`,[target.p_work_id]);
}

beforeEach(async()=>{
  db=new PGlite();expectedNative=0;afterRpc=undefined;
  network=vi.fn<typeof fetch>(async()=>{throw Error("source_calls_forbidden");});
  // Match the approved metadata-read digest contract, not Node's local TZ.
  await db.exec("set timezone='UTC';create role service_role;create role anon;create role authenticated;create role lean_posthog_reader;");
  for(const n of ["001_staging","003_receipts","004_worker","013_release","014_reporting_views","017_shopify_pipeline",
    "046_order_item_sizes","047_pipeline_extended","052_pipeline_before_window_exclusion",
    "pipeline_throughput.review","pipeline_annual_access_exclusion.review"])await db.exec(sql(n));
  await db.query(`insert into lean_private.pipeline_scope
    (shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
    values($1,$2,true,'2026-09-30T19:19:02.220236Z','9999-12-31T00:00:00Z',$3::jsonb,'fixture:scope','fixture:owner')`,
    [shop,project,JSON.stringify(policy)]);
  expect((await rows<{h:string}>("select lean_private.pipeline_throughput_scope_hash() h"))[0].h).toBe(scopePin);
  target=await retained();await ready(target.p_work_id);bind=await hashes();
  const pins=(await rows<{source:string;metadata:string;bytes:number}>(`select ${hash("s.source")} source,
    ${hash(metadata)} metadata,octet_length(s.source::text) bytes from lean_private.pipeline_snapshots s where work_id=$1`,
    [target.p_work_id]))[0];
  // Only these exact production evidence pins/byte length change for synthetic data.
  fixtureRaw=raw.replaceAll(sourcePin,pins.source).replaceAll(metadataPin,pins.metadata)
    .replace("octet_length(s.source::text)<>1958",`octet_length(s.source::text)<>${pins.bytes}`);
  const before=await rows(`select oid,proowner,proacl::text,proconfig from pg_proc where oid in
    ('public.lean_pipeline_claim(uuid,text,text)'::regprocedure,'public.lean_pipeline_health(text,text)'::regprocedure) order by oid`);
  await db.exec(fixtureRaw);
  expect(await rows(`select oid,proowner,proacl::text,proconfig from pg_proc where oid in
    ('public.lean_pipeline_claim(uuid,text,text)'::regprocedure,'public.lean_pipeline_health(text,text)'::regprocedure) order by oid`)).toEqual(before);
  await db.query(`insert into lean_private.pipeline_throughput_grants
    (grant_id,project_ref,shop,scope_sha256,approval_ref,actor_ref,enabled,not_before,expires_at,
     max_extra_claims,max_native_requests,max_batch_claims,max_batch_native_requests,
     extra_claims_used,native_permits_used,batch_token,batch_deadline,batch_claims,batch_native,held,
     current_work_id,current_work_token,current_work_native)
    values('fixture:expired-held',$1,$2,$3,'fixture:old','fixture:owner',true,
      clock_timestamp()-interval '9 hours',clock_timestamp()-interval '1 hour',
      640,5120,19,152,97,389,$4,clock_timestamp()-interval '7 hours',2,8,true,$5,$6,4)`,
    [project,shop,scopePin,randomUUID(),target.p_work_id,target.p_token]);
  client=createClient(url,"fixture",{auth:{persistSession:false},global:{fetch:async(input,init)=>{
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const name=new URL(String(input)).pathname.split("/").pop()!;
    try{
      const args=JSON.parse(String(init?.body)),data=await rpc(name,args);
      if(afterRpc)await afterRpc(name,args);
      return Response.json(data);
    }
    catch{return Response.json({code:"FIXTURE",message:"synthetic_sql_refusal"},{status:400});}
  }}});
  await register();
  await db.exec(sql("pipeline_ordinary_batch.review"));
},30000);
afterEach(async()=>{
  expect(network).toHaveBeenCalledTimes(expectedNative);
  vi.doUnmock("@/lib/analytics/serverClient");
  vi.doUnmock("../../scripts/analytics/scheduled-pipeline.mjs");
  vi.unstubAllGlobals();await db.close();
});


async function control(enabled=true,revision=0){
  return db.query(`select lean_private.set_pipeline_ordinary_batch($1,$2,$3,$4,'fixture:owner',
    clock_timestamp()+interval '1 minute')`,[enabled,revision,bind.scope,`fixture:batch:${revision+1}`]);
}
async function batch(options:{signal?:AbortSignal;now?:()=>number;deadline?:number}={}){
  const signal=options.signal??new AbortController().signal;
  const admitted=await readOrdinaryBatchAdmission(client,new AbortController().signal);
  if(admitted.state!=="ready")throw Error("fixture_not_ready");
  const now=options.now??Date.now;
  return runOrdinaryPipelineBatch({client,projectRef:project,databaseUrl:url,shop,accessToken:"fixture-only",
    admission:admitted,signal,now,deadline:options.deadline??now()+80000,fetcher:network});
}
async function queued(id:string){
  const s=source(id,false);
  await db.query("select public.lean_accept_receipt('shopify',$1,$2,'orders/updated',$3,$4::jsonb)",[
    randomUUID(),JSON.stringify([shop,s.commerce.order.id]),"a".repeat(64),
    JSON.stringify({admin_graphql_api_id:s.commerce.order.id,updated_at:s.commerce.order.updatedAt})]);
}
async function retainedReady(count:number){
  const ids:string[]=[];
  for(let i=2;i<count+2;i++)ids.push((await retained(source(String(i),false))).p_work_id);
  // Elapse only synthetic fixture backoffs after all sources are retained.
  for(const id of ids)await ready(id);
}
function nativeOrders(){
  network.mockImplementation(async(input,init)=>{
    expect(String(input)).toBe(`https://${shop}/admin/api/2026-07/graphql.json`);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    const body=JSON.parse(String(init?.body)),id=String(body.variables.id).split("/").pop()!;
    const s=source(id,false);
    return Response.json({data:{order:body.query===PILOT_FINANCIAL_QUERY?s.financial:s.commerce.order}},
      {headers:{"X-Shopify-API-Version":"2026-07"}});
  });
}
function responseClient(data:unknown,error=false){
  return createClient(url,"fixture",{auth:{persistSession:false},global:{fetch:async(_input,init)=>{
    expect(init?.signal).toBeInstanceOf(AbortSignal);
    return Response.json(data,{status:error?400:200});
  }}});
}

describe("standing ordinary capacity, not EXTRA",()=>{
  it("default empty is off; only the exact missing admission RPC may also mean off",async()=>{
    expect(await readOrdinaryBatchAdmission(client,new AbortController().signal)).toEqual({state:"off"});
    expect(await readOrdinaryBatchAdmission(responseClient({code:"PGRST202",message:
      "Could not find the function public.lean_pipeline_ordinary_batch_admission(p_project_ref, p_shop) in the schema cache"},true),
      new AbortController().signal)).toEqual({state:"off"});
    for(const error of [{code:"42501",message:"permission denied"},{code:"PGRST202",message:"different function"},
      {code:"transport",message:"unknown"}])
      await expect(readOrdinaryBatchAdmission(responseClient(error,true),new AbortController().signal)).rejects.toThrow();
    for(const invalid of [{state:"ready"},{state:"ready",revision:1,scopeSha256:scopePin,
      maxClaims:21,maxNativeRequests:160,deadlineSeconds:80,minRemainingSeconds:65},null,[]])
      await expect(readOrdinaryBatchAdmission(responseClient(invalid),new AbortController().signal)).rejects.toThrow();
  });
  it("processes 20 retained candidates, keeps the exact exception pending and leaves held history intact",async()=>{
    await retainedReady(21);
    await control();const before=await preserved();
    const result=await batch();
    expect(result).toMatchObject({state:"complete",ordinaryBatch:{claimAttempts:20,confirmedClaims:20,done:20,
      retainedSourceClaims:20,nativeRequestsStarted:0,reason:"claim_cap"},health:{pending:2,unresolvedExceptions:1}});
    expect(await preserved()).toEqual(before);
    expect(await rows("select count(*)::int n from lean_private.pipeline_heads")).toEqual([{n:20}]);
    expect(await rows("select count(*)::int n from lean_private.report_store_daily")).toEqual([{n:20}]);
    expect(await rows("select count(*)::int n from lean_private.report_product_daily")).toEqual([{n:20}]);
  },30000);
  it("counts native starts through the existing source reader and calculations",async()=>{
    for(let i=2;i<=4;i++)await queued(String(i));
    await control();nativeOrders();expectedNative=12;
    expect(await batch()).toMatchObject({ordinaryBatch:{done:3,confirmedClaims:3,
      nativeHydrations:3,nativeRequestsStarted:12,retainedSourceClaims:0,reason:"idle"}});
    expect(await rows("select count(*)::int n from lean_private.pipeline_heads")).toEqual([{n:3}]);
  });
  it("enforces 160 actual-start and eight-per-record limits with strict endpoint/query/redirect validation",async()=>{
    network.mockImplementation(async()=>Response.json({data:{}}));expectedNative=160;
    const budget=ordinarySourceBudget(network),signal=new AbortController().signal;
    const request={method:"POST",redirect:"error" as const,body:JSON.stringify({query:PILOT_FINANCIAL_QUERY,variables:{id:"fixture"}})};
    for(let i=0;i<20;i++){
      const fetcher=budget.forReceipt(signal);
      for(let j=0;j<8;j++)await fetcher(`https://${shop}/admin/api/2026-07/graphql.json`,request);
      await expect(fetcher(`https://${shop}/admin/api/2026-07/graphql.json`,request)).rejects.toThrow("source_budget");
    }
    expect(budget.started).toBe(160);expect(budget.hydrations).toBe(20);
    await expect(budget.forReceipt(signal)(`https://${shop}/admin/api/2026-07/graphql.json`,request)).rejects.toThrow("source_budget");
    const clean=ordinarySourceBudget(network).forReceipt(signal);
    for(const [endpoint,init] of [
      ["https://other.example.invalid/graphql.json",request],
      [`https://${shop}/admin/api/2026-07/graphql.json`,{...request,redirect:"follow" as const}],
      [`https://${shop}/admin/api/2026-07/graphql.json`,{...request,body:JSON.stringify({query:"mutation { unsafe }"})}],
    ] as const)await expect(clean(endpoint,init)).rejects.toThrow("source_budget");
  });
  it("checks disable and revision per claim without retracting issued work",async()=>{
    await retainedReady(2);
    await control();
    afterRpc=async name=>{if(name==="lean_pipeline_finish_extended"){afterRpc=undefined;await control(false,1);}};
    expect(await batch()).toMatchObject({state:"scope_disabled",ordinaryBatch:{
      done:1,confirmedClaims:1,claimAttempts:2,reason:"authority_changed"}});
    expect(await rows("select count(*)::int n from lean_private.pipeline_heads")).toEqual([{n:1}]);
    expect(await rows("select enabled,revision from lean_private.pipeline_ordinary_batch")).toEqual([{enabled:false,revision:2}]);
    await control(true,2);
    expect(await rpc("lean_pipeline_ordinary_batch_claim",{p_token:randomUUID(),p_project_ref:project,p_shop:shop,p_revision:1}))
      .toEqual({state:"disabled"});
  });
  it("honors scope stop, rejects stale control CAS and denies runtime access to owner controls",async()=>{
    await control();await expect(control(false,0)).rejects.toThrow("revision CAS");
    await db.exec("set role service_role");await expect(control(false,1)).rejects.toThrow(/permission denied/);
    await db.exec("reset role;update lean_private.pipeline_scope set enabled=false");
    expect(await readOrdinaryBatchAdmission(client,new AbortController().signal)).toEqual({state:"scope_disabled"});
    expect(await rpc("lean_pipeline_ordinary_batch_claim",{p_token:randomUUID(),p_project_ref:project,p_shop:shop,p_revision:1}))
      .toEqual({state:"disabled"});
  });
  it("keeps owner history immutable and rolls control plus audit back on deadline",async()=>{
    await db.exec(`create function lean_private.fixture_control_delay() returns trigger language plpgsql as $$
      begin if new.event='ordinary_batch_control' then perform pg_sleep(0.06); end if; return new; end $$;
      create trigger fixture_control_delay before insert on lean_private.pipeline_operator_audit
      for each row execute function lean_private.fixture_control_delay();`);
    await expect(db.query(`select lean_private.set_pipeline_ordinary_batch(true,0,$1,'fixture:late','fixture:owner',
      clock_timestamp()+interval '0.02 seconds')`,[bind.scope])).rejects.toThrow("control deadline");
    expect(await rows("select count(*)::int n from lean_private.pipeline_ordinary_batch")).toEqual([{n:0}]);
    expect(await rows("select count(*)::int n from lean_private.pipeline_operator_audit where event='ordinary_batch_control'"))
      .toEqual([{n:0}]);
    await control();const before=await rows("select to_jsonb(g) evidence from lean_private.pipeline_ordinary_batch g");
    for(const q of ["delete from lean_private.pipeline_ordinary_batch","truncate lean_private.pipeline_ordinary_batch",
      "update lean_private.pipeline_ordinary_batch set revision=revision-1"])
      await expect(db.exec(q)).rejects.toThrow();
    await readOrdinaryBatchAdmission(client,new AbortController().signal);
    expect(await rows("select to_jsonb(g) evidence from lean_private.pipeline_ordinary_batch g")).toEqual(before);
  });
  it("rolls claim back on a differently frozen policy rather than hydrating or resetting it",async()=>{
    const other=await retained(source("2",false));await ready(other.p_work_id);
    await db.query(`update lean_private.pipeline_snapshots set policy=jsonb_set(policy,'{decision,commerceSource}','"storefront"')
      where work_id=$1`,[other.p_work_id]);await control();
    expect(await batch()).toMatchObject({state:"unavailable",ordinaryBatch:{claimAttempts:1,confirmedClaims:0}});
    expect(await rows("select attempts,state,lease_token from lean_private.work where work_id=$1",[other.p_work_id]))
      .toEqual([{attempts:1,state:"pending",lease_token:null}]);
  });
  it("starts no new claim below the 65-second gate and obtains fresh final health",async()=>{
    await retainedReady(2);
    await control();let elapsed=0;const calls:string[]=[];
    afterRpc=async name=>{calls.push(name);if(name==="lean_pipeline_finish_extended")elapsed=16000;};
    expect(await batch({now:()=>elapsed,deadline:80000})).toMatchObject({state:"complete",
      ordinaryBatch:{done:1,confirmedClaims:1,reason:"remaining_budget"}});
    expect(calls.at(-1)).toBe("lean_pipeline_health");
    expect(await batch({now:()=>0,deadline:64999})).toMatchObject({state:"deadline",ordinaryBatch:{claimAttempts:0}});
  });
  it("advances unrelated work despite dead, leased and unresolved records",async()=>{
    await retainedReady(4);
    await db.exec(`update lean_private.work set state='dead',attempts=5 where work_id=2;
      update lean_private.work set state='leased',lease_token='00000000-0000-4000-8000-000000000001',
        lease_until=clock_timestamp()+interval '120 seconds' where work_id=3;`);
    await control();
    expect(await batch()).toMatchObject({state:"unhealthy",ordinaryBatch:{done:2,failed:0},
      health:{dead:1,leased:1,pending:1,unresolvedExceptions:1}});
    // Unhealthy is a visible observation, not a global stop or controller hold.
    expect(await batch()).toMatchObject({state:"unhealthy",ordinaryBatch:{claimAttempts:1,done:0}});
  });
  it("stops on generic settled failure without a global latch or inline replay",async()=>{
    const bad=await retained(source("2")),good=await retained(source("3",false));
    await ready(bad.p_work_id);await ready(good.p_work_id);await control();
    expect(await batch()).toMatchObject({state:"failed",ordinaryBatch:{claimAttempts:1,failed:1,done:0}});
    expect(await rows("select attempts,state,last_error_code from lean_private.work where work_id=$1",[bad.p_work_id]))
      .toEqual([{attempts:2,state:"pending",last_error_code:"mapping_rejected"}]);
    // Separate natural invocation, with the existing failed-record backoff.
    expect(await batch()).toMatchObject({ordinaryBatch:{done:1,failed:0}});
    expect(await rows("select attempts from lean_private.work where work_id=$1",[bad.p_work_id])).toEqual([{attempts:2}]);
  });
  it("does not promote success or dispatch another mutation after a committed response is lost to abort",async()=>{
    await retainedReady(2);
    await control();const stop=new AbortController(),calls:string[]=[];
    afterRpc=async name=>{
      calls.push(name);
      if(name==="lean_pipeline_finish_extended"){stop.abort();await new Promise(resolve=>setTimeout(resolve,10));}
    };
    expect(await batch({signal:stop.signal})).toMatchObject({state:"deadline",
      ordinaryBatch:{confirmedClaims:1,done:0,reason:"record_ambiguous"}});
    await new Promise(resolve=>setTimeout(resolve,20));
    expect(calls.filter(n=>n==="lean_pipeline_ordinary_batch_claim")).toHaveLength(1);
    expect(calls).not.toContain("lean_pipeline_fail");
    expect(await rows("select count(*)::int n from lean_private.pipeline_heads")).toEqual([{n:1}]);
  });
  it("withholds success on malformed final health",async()=>{
    const other=await retained(source("2",false));await ready(other.p_work_id);await control();
    await db.exec(`create or replace function public.lean_pipeline_health(p_project_ref text,p_shop text) returns jsonb
      language sql security definer as $$select '{"enabled":true,"pending":-1}'::jsonb$$;`);
    expect(await batch()).toMatchObject({state:"health_unavailable",ordinaryBatch:{done:1,reason:"final_health_unproven"}});
  });
  it("keeps route auth/config gates and default-off fallback; standing branch never runs the old supervisor",async()=>{
    Object.assign(process.env,{VERCEL_ENV:"production",LEAN_ANALYTICS_VERCEL_SCHEDULE_ENABLED:"true",
      LEAN_ANALYTICS_PIPELINE_ENABLED:"true",LEAN_ANALYTICS_DISPATCH_ENABLED:"true",LEAN_ANALYTICS_SCHEDULE_MODE:"continuous",
      CRON_SECRET:"fixture-cron-secret",LEAN_ANALYTICS_PIPELINE_SECRET:"p".repeat(32),
      LEAN_ANALYTICS_PIPELINE_PROJECT_REF:project,LEAN_ANALYTICS_SUPABASE_URL:url,
      LEAN_SHOPIFY_SHOP_DOMAIN:shop,LEAN_SHOPIFY_ANALYTICS_READ_TOKEN:"fixture-only"});
    const supervisor=vi.fn(async()=>({state:"idle",calls:1})),admissionCalls:string[]=[];
    afterRpc=async name=>{if(name==="lean_pipeline_ordinary_batch_admission")admissionCalls.push(name);};
    let routeClient:AnalyticsRpcClient=client;
    vi.doMock("@/lib/analytics/serverClient",()=>({getAnalyticsSupabase:()=>routeClient}));
    vi.doMock("../../scripts/analytics/scheduled-pipeline.mjs",async()=>({
      ...await vi.importActual("../../scripts/analytics/scheduled-pipeline.mjs"),runScheduledPipeline:supervisor}));
    const {GET}=await import("@/app/api/analytics/ingest/scheduled/route");
    const request=(authorized=true)=>new NextRequest("https://www.mymully.com/api/analytics/ingest/scheduled",{
      headers:authorized?{authorization:"Bearer fixture-cron-secret"}:{}});
    expect((await GET(request(false))).status).toBe(401);expect(supervisor).not.toHaveBeenCalled();
    expect((await GET(request())).status).toBe(200);expect(supervisor).toHaveBeenCalledTimes(1);
    await control();const r=await retained(source("2",false));await ready(r.p_work_id);
    const response=await GET(request());expect((await response.json()).ordinaryBatch.done).toBe(1);
    expect(supervisor).toHaveBeenCalledTimes(1);
    expect(admissionCalls).toHaveLength(2);
    process.env.LEAN_ANALYTICS_SUPABASE_URL="https://wrong.example.invalid";
    expect((await GET(request())).status).toBe(503);expect(supervisor).toHaveBeenCalledTimes(1);
    expect(admissionCalls).toHaveLength(2);
    process.env.LEAN_ANALYTICS_SUPABASE_URL=url;
    process.env.LEAN_ANALYTICS_SCHEDULE_START_AT="2026-10-01T00:00:00Z";
    expect((await GET(request())).status).toBe(503);expect(admissionCalls).toHaveLength(2);
    delete process.env.LEAN_ANALYTICS_SCHEDULE_START_AT;
    routeClient=responseClient({code:"42501",message:"permission denied"},true);
    expect((await GET(request())).status).toBe(503);expect(supervisor).toHaveBeenCalledTimes(1);
  });
});
