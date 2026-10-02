/** Synthetic retained inputs only. Actual SQL, mapper and local Supabase transport. */
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { boundedPipelineClient, runShopifyPipeline } from "@/lib/analytics/shopifyPipeline";
import { projectPilotRetention } from "@/lib/analytics/shopifyRetention";
import { sourceObject } from "@/lib/analytics/shopifySource";
import { composeRetainedOrderReports } from "@/lib/analytics/shopifyRetainedOrder";
import { mappingPolicy } from "@/lib/analytics/shopifyPipeline";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import type { PipelinePolicy } from "@/lib/analytics/shopifyPipeline";
import { runtimeSource, runtimeMoney as money } from "../fixtures/analyticsRetainedRuntime";

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
const rows=async<T=Record<string,unknown>>(query:string,args:unknown[]=[]) => (await db.query<T>(query,args)).rows;
async function rpc(name:string,args:Record<string,unknown>){
  if(!["lean_pipeline_claim","lean_pipeline_retain","lean_pipeline_fail","lean_pipeline_finish_extended",
    "lean_pipeline_health"].includes(name))throw Error("unexpected_fixture_rpc");
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
const matching=async()=>(await rows<{m:boolean}>(`select lean_private.pipeline_zero_total_matches(w,c) m
  from lean_private.work w cross join lean_private.pipeline_scope c where w.work_id=$1`,[target.p_work_id]))[0].m;
const ready=(id:string)=>db.query("update lean_private.work set available_at=clock_timestamp()-interval '1 second' where work_id=$1",[id]);
async function run(){
  const signal=new AbortController().signal;
  return runShopifyPipeline({client:boundedPipelineClient(client,signal),projectRef:project,databaseUrl:url,
    shop,accessToken:"fixture-only",fetcher:network,signal});
}
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
  db=new PGlite();network=vi.fn<typeof fetch>(async()=>{throw Error("source_calls_forbidden");});
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
    try{return Response.json(await rpc(name,JSON.parse(String(init?.body))));}
    catch{return Response.json({code:"FIXTURE",message:"synthetic_sql_refusal"},{status:400});}
  }}});
},30000);
afterEach(async()=>{expect(network).toHaveBeenCalledTimes(0);await db.close();});

describe("exact nonterminal zero-total exception",()=>{
  it("matches the actual prior eight-field held-read digest, not the ten-field observation record",async()=>{
    const record=(await rows<{prior:string;candidate:string;wrong:string;keys:number}>(`select
      ${hash(metadata)} prior,
      ${hash("lean_private.pipeline_zero_total_metadata(s)")} candidate,
      ${hash(`(select to_jsonb(snap) from (select s.work_id,s.shop,s.publication_id,s.policy,s.from_time,
        s.until_time,s.order_gid,s.revision,s.source is not null source_retained,
        octet_length(s.source::text) source_bytes) snap)`)} wrong,
      (select count(*)::int from jsonb_object_keys(lean_private.pipeline_zero_total_metadata(s))) keys
      from lean_private.pipeline_snapshots s where work_id=$1`,[target.p_work_id]))[0];
    expect(record.candidate).toBe(record.prior);expect(record.candidate).not.toBe(record.wrong);expect(record.keys).toBe(8);
    expect(raw).toContain(metadataPin);expect(raw).toContain(sourcePin);
  });
  it("default empty leaves the ordinary missing-paid rejection and retry state unchanged",async()=>{
    const s=source();
    expect(()=>composeRetainedOrderReports(s,mappingPolicy(s,policy),"fixture","fixture","shopify-observed-v1",
      {orderSizeSidecar:true})).toThrow("missing_paid_evidence");
    expect(await matching()).toBe(false);expect(await run()).toEqual({state:"failed"});
    expect(await rows("select state,attempts,last_error_code from lean_private.work"))
      .toEqual([{state:"pending",attempts:2,last_error_code:"mapping_rejected"}]);
    expect(await rpc("lean_pipeline_health",{p_project_ref:project,p_shop:shop}))
      .toMatchObject({pending:1,done:0,unresolvedExceptions:0});
  });
  it("skips only the exact revision, preserves old held authority and processes another real composed fixture",async()=>{
    const before=await preserved();await register();expect(await matching()).toBe(true);
    const other=await retained(source("2",false));await ready(other.p_work_id);
    expect(await run()).toEqual({state:"done"});expect(await preserved()).toEqual(before);
    expect(await rows("select work_id::text from lean_private.pipeline_heads")).toEqual([{work_id:other.p_work_id}]);
    expect(await rows("select count(*)::int n from lean_private.report_store_daily")).toEqual([{n:1}]);
    expect(await rows("select count(*)::int n from lean_private.report_product_daily")).toEqual([{n:1}]);
    expect(await rpc("lean_pipeline_health",{p_project_ref:project,p_shop:shop}))
      .toMatchObject({pending:1,done:1,excluded:0,unresolvedExceptions:1});
    expect(await run()).toEqual({state:"idle"});
  });
  it("allows a genuine newer receipt for the same order without auto-resolving the old exception",async()=>{
    await register();const before=await preserved();
    const newer=await retained(source("1",false,"2026-10-02T12:00:00Z"));await ready(newer.p_work_id);
    expect(await run()).toEqual({state:"done"});expect(await preserved()).toEqual(before);
    expect(await rows("select work_id::text from lean_private.pipeline_heads")).toEqual([{work_id:newer.p_work_id}]);
    expect(await rows("select is_stale from lean_private.report_store_daily")).toEqual([{is_stale:true}]);
    expect(await rpc("lean_pipeline_health",{p_project_ref:project,p_shop:shop}))
      .toMatchObject({pending:1,unresolvedExceptions:1});
  });
  it("does not skip another delivery even when its retained source is byte-identical",async()=>{
    await register();const other=await retained(source());await ready(other.p_work_id);
    expect(await run()).toEqual({state:"failed"});
    expect(await rows("select state,attempts from lean_private.work where work_id=$1",[other.p_work_id]))
      .toEqual([{state:"pending",attempts:2}]);
    expect(await rows("select state,attempts from lean_private.work where work_id=$1",[target.p_work_id]))
      .toEqual([{state:"pending",attempts:1}]);
  });
  it("refuses unbound/stale owner CAS, an active claim and expired operation deadlines",async()=>{
    await expect(register({...bind,work:"0".repeat(64)})).rejects.toThrow("work or receipt CAS");
    await expect(register({...bind,scope:"0".repeat(64)})).rejects.toThrow("scope CAS");
    await expect(register({...bind,receipt:"0".repeat(64)})).rejects.toThrow("work or receipt CAS");
    await expect(register(bind,"clock_timestamp()-interval '1 second'")).rejects.toThrow("operation unbound");
    await expect(db.query("select lean_private.register_pipeline_zero_total_exception(null,null,null,null,null,null)"))
      .rejects.toThrow("operation unbound");
    const claimed=sourceObject(await rpc("lean_pipeline_claim",{p_token:randomUUID(),p_project_ref:project,p_shop:shop}));
    expect(claimed.workId).toBe(target.p_work_id);
    await expect(register()).rejects.toThrow("work or receipt CAS");
    expect(await rows("select count(*)::int n from lean_private.pipeline_zero_total_exception")).toEqual([{n:0}]);
  });
  it("keeps the evidence immutable, refuses replay and denies service-role owner operations",async()=>{
    await register();
    await expect(register()).rejects.toThrow("already registered");
    for(const statement of ["update lean_private.pipeline_zero_total_exception set reason=reason",
      "delete from lean_private.pipeline_zero_total_exception","truncate lean_private.pipeline_zero_total_exception"])
      await expect(db.exec(statement)).rejects.toThrow("evidence immutable");
    await db.exec("set role service_role");
    await expect(register()).rejects.toThrow(/permission denied/);
    await expect(db.exec("select * from lean_private.pipeline_zero_total_exception")).rejects.toThrow(/permission denied/);
    await db.exec("reset role");
    expect(await rows("select event from lean_private.pipeline_operator_audit where event='deferred_zero_total_revision'"))
      .toEqual([{event:"deferred_zero_total_revision"}]);
  });
  it("does not inherit exceptions after work, receipt, source, frozen-policy or scope drift",async()=>{
    await register();
    const changes=[
      "update lean_private.work set attempts=attempts+1",
      "update lean_private.receipts set payload_hash=repeat('b',64)",
      "update lean_private.pipeline_snapshots set source=jsonb_set(source,'{commerce,order,edited}','true')",
      "update lean_private.pipeline_snapshots set policy=jsonb_set(policy,'{decision,commerceSource}','\"storefront\"')",
      "update lean_private.pipeline_scope set approval_ref='fixture:new',policy=jsonb_set(policy,'{decision,commerceSource}','\"storefront\"')",
    ];
    for(const change of changes){
      await db.exec("begin");await db.exec(change);expect(await matching()).toBe(false);await db.exec("rollback");
      expect(await matching()).toBe(true);
    }
    await db.exec("set timezone='America/Los_Angeles'");expect(await matching()).toBe(true);
  });
  it("fences old work tokens and leaves attempts, source, counters and holds untouched",async()=>{
    await register();const before=await preserved();
    expect(await rpc("lean_pipeline_retain",{...target,p_source:source()})).toBe(false);
    expect(await rpc("lean_pipeline_fail",{...target,p_code:"mapping_rejected"})).toBe(false);
    expect(await rpc("lean_pipeline_finish_extended",{...target,p_facts:{},p_reports:[],p_product_reports:[],p_order_item_sizes:null})).toBe(false);
    expect(await preserved()).toEqual(before);
    expect(await run()).toEqual({state:"idle"});
  });
  it("advances only the MVCC row version and rejects the unchanged legacy claim body",async()=>{
    const before=await preserved();
    const xminBefore=await rows("select xmin::text from lean_private.work where work_id=$1",[target.p_work_id]);
    await register();expect(await preserved()).toEqual(before);
    expect(await rows("select xmin::text from lean_private.work where work_id=$1",[target.p_work_id])).not.toEqual(xminBefore);
    const old=sql("017_shopify_pipeline").split("create function public.lean_pipeline_claim")[1]
      .split("create function public.lean_pipeline_retain")[0].trim();
    await db.exec(`create or replace function public.lean_pipeline_claim${old}`);
    await expect(rpc("lean_pipeline_claim",{p_token:randomUUID(),p_project_ref:project,p_shop:shop}))
      .rejects.toThrow("registered revision cannot be leased");
    expect(await preserved()).toEqual(before);
  });
  it("refuses an unexpected work hook before performing the no-op row-version update",async()=>{
    const before=await preserved();
    await db.exec(`create function lean_private.fixture_work_hook() returns trigger language plpgsql as $$
      begin new.last_error_code:='unexpected_change'; return new; end $$;
      create trigger fixture_work_hook before update on lean_private.work
      for each row execute function lean_private.fixture_work_hook();`);
    await expect(register()).rejects.toThrow("work fence footprint changed");
    expect(await preserved()).toEqual(before);
    expect(await rows("select count(*)::int n from lean_private.pipeline_zero_total_exception")).toEqual([{n:0}]);
  });
  it("rolls back exception and audit atomically when the final deadline fails",async()=>{
    await db.exec(`create function lean_private.fixture_delay() returns trigger language plpgsql as $$
      begin perform pg_sleep(0.06); return new; end $$;
      create trigger fixture_delay before insert on lean_private.pipeline_operator_audit
      for each row execute function lean_private.fixture_delay();`);
    const before=await preserved(),xminBefore=await rows("select xmin::text from lean_private.work where work_id=$1",[target.p_work_id]);
    await expect(register(bind,"clock_timestamp()+interval '0.02 seconds'")).rejects.toThrow("operation deadline");
    expect(await rows("select count(*)::int n from lean_private.pipeline_zero_total_exception")).toEqual([{n:0}]);
    expect(await rows("select count(*)::int n from lean_private.pipeline_operator_audit")).toEqual([{n:0}]);
    expect(await preserved()).toEqual(before);
    expect(await rows("select xmin::text from lean_private.work where work_id=$1",[target.p_work_id])).toEqual(xminBefore);
  });
  it("rejects changed retained evidence and unexpected materialization instead of repairing either",async()=>{
    await db.exec("begin");
    await db.exec("update lean_private.pipeline_snapshots set source=jsonb_set(source,'{commerce,order,edited}','true')");
    await expect(register()).rejects.toThrow();await db.exec("rollback");
    await db.exec(`insert into lean_private.projections(receipt_id,transform_version,facts)
      select receipt_id,'fixture','{}' from lean_private.work`);
    await expect(register()).rejects.toThrow("unexpected materialization");
    expect(await rows("select count(*)::int n from lean_private.pipeline_zero_total_exception")).toEqual([{n:0}]);
  });
  it("keeps disabled scope admission unchanged and uses symmetric owner/claim advisory fencing",async()=>{
    await register();await db.exec("update lean_private.pipeline_scope set enabled=false");
    expect(await run()).toEqual({state:"disabled"});
    expect(await rows("select state,attempts from lean_private.work")).toEqual([{state:"pending",attempts:1}]);
    const key="'pipeline_zero_total_exception:xnfjdbpjuaezxjgargto'";
    expect(raw).toContain(`pg_advisory_xact_lock(hashtextextended(${key},0))`);
    expect(raw).toContain(`pg_advisory_xact_lock_shared(hashtextextended(${key},0))`);
    // PGlite has one session. The tests exercise both serialized orders, not
    // independent PostgreSQL backends contending on advisory locks.
  });
  it("preserves old claim and health bodies except explicit admission fencing/filter and additive unresolved count",()=>{
    const originalClaim=sql("017_shopify_pipeline").split("create function public.lean_pipeline_claim")[1]
      .split("create function public.lean_pipeline_retain")[0].trim();
    let updatedClaim=raw.split("create or replace function public.lean_pipeline_claim")[1]
      .split("create or replace function public.lean_pipeline_health")[0].trim();
    updatedClaim=updatedClaim.replace(`  -- Shared admission lock does not serialize ordinary claimants. Registration\n  -- takes its exclusive counterpart before checking pending/no-lease + CAS.\n  perform pg_advisory_xact_lock_shared(hashtextextended('pipeline_zero_total_exception:xnfjdbpjuaezxjgargto',0));\n`,"").replace("      and not lean_private.pipeline_zero_total_matches(x,cfg)\n","");
    expect(updatedClaim).toBe(originalClaim);
    const originalHealth=sql("pipeline_annual_access_exclusion.review").split("create or replace function public.lean_pipeline_health")[1]
      .split("create or replace function public.lean_pipeline_throughput_step")[0].trim();
    const updatedHealth=raw.split("create or replace function public.lean_pipeline_health")[1].split("do $acl$")[0].trim()
      .replace(`  return result || jsonb_build_object('unresolvedExceptions',\n    (select count(*) from lean_private.pipeline_zero_total_exception\n      where p_project_ref='xnfjdbpjuaezxjgargto' and p_shop='mullybox-store.myshopify.com'));`,"  return result;");
    expect(updatedHealth).toBe(originalHealth);
  });
});
