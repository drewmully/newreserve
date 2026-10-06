/** Synthetic evidence only; actual SQL + mapper + local Supabase transport.
 * Four exact refund pins and the old zero source/metadata pins are substituted
 * explicitly for generated fixtures. Production source bytes are never read. */
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runShopifyPipeline, boundedPipelineClient, mappingPolicy, type PipelinePolicy } from "@/lib/analytics/shopifyPipeline";
import { REFUND_SUPPLEMENT, INGESTION_PRODUCTS, amendedPipelinePolicy, ingestionAdmission,
  approvedRefundDiscrepancy, type RefundSupplement } from "@/lib/analytics/pipelineIngestionAmendment";
import { composeRetainedOrderReports } from "@/lib/analytics/shopifyRetainedOrder";
import { sourceObject } from "@/lib/analytics/shopifySource";
import { projectPilotRetention } from "@/lib/analytics/shopifyRetention";
import { runtimeSource, runtimeMoney as money, runtimeConnection as connection } from "../fixtures/analyticsRetainedRuntime";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";

const project="xnfjdbpjuaezxjgargto",shop="mullybox-store.myshopify.com",url=`https://${project}.supabase.co`;
const sourcePin="7df76771b2de58f8ae485e1bbbe17997a225609c09e8cc4941efa2f1598c4358";
const metadataPin="da013d66811726982d6099d1df5fc6d4c7b8f275d3302fe24e0ea012f5093070";
const scopePin="799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689";
const originalRefund={...REFUND_SUPPLEMENT};
const approval="Jessica Singh approved ongoing sales activation 2026-09-30T19:00:00Z; installed-baseline amendment approved 2026-09-30T19:14:00Z; session 9e554880-77db-414c-9f03-6574efa210d7";
const policy:PipelinePolicy={
  decision:{approvalRef:approval,eligibility:"eligible",commerceSource:"other",acquisitionEligible:false},
  orderSize:{policyRef:"Jessica-Singh-approved-order-size-20260930T201000Z",productSemantics:{"8501257044160":"requested_box_top_size"}},
  saleClock:"paid_at",refundClock:"refund_created_at",productClasses:{"8501257044160":"merchandise"},
  retainedReports:"product-v1",sourceRetention:"financial_allowlist_v1",sourceProjection:"financial_no_geo_order_size",
  financialApprovalRef:approval,
};
const sql=(n:string)=>readFileSync(`sql/analytics/${n}.sql`,"utf8");
const raw=sql("pipeline_ingestion_amendment.review");
const hash=(v:string)=>createHash("sha256").update(v).digest("hex");
const dbhash=(v:string)=>`encode(sha256(convert_to((${v})::text,'UTF8')),'hex')`;
let db:PGlite,client:AnalyticsRpcClient,network:ReturnType<typeof vi.fn<typeof fetch>>;
let zero:string[],zeroHash:string,installed:string;
let afterClaim:(()=>Promise<void>)|undefined;
let calls:string[];
async function q<T=unknown>(text:string,args:unknown[]=[]):Promise<T>{
  return (await db.query<{r:T}>(text,args)).rows[0].r;
}
async function rpc(name:string,args:Record<string,unknown>){
  const allowed=["lean_pipeline_claim","lean_pipeline_retain","lean_pipeline_fail","lean_pipeline_finish_extended",
    "lean_pipeline_finish_amended","lean_pipeline_health"];
  if(!allowed.includes(name))throw Error("fixture_unexpected_rpc");
  const json=new Set(["p_source","p_facts","p_reports","p_product_reports","p_order_item_sizes"]);
  const pairs=Object.entries(args);
  return q(`select public.${name}(${pairs.map(([key],i)=>`${key}=>$${i+1}${json.has(key)?"::jsonb":""}`).join(",")}) r`,
    pairs.map(([key,v])=>json.has(key)&&v!==null?JSON.stringify(v):v));
}
function source(id="1",product="8501257044160",zeroTotal=false,refund=false){
  const s=runtimeSource(),o=s.commerce.order;
  s.commerce.shop=shop;s.commerce.projection="financial_no_geo_order_size";
  o.id=`gid://shopify/Order/${id}`;o.createdAt="2026-10-01T12:00:00Z";o.updatedAt="2026-10-01T17:27:27Z";
  s.financial.id=o.id;s.financial.updatedAt=o.updatedAt;
  const l=sourceObject((sourceObject(o.lineItems).nodes as unknown[])[0]);
  l.id=`gid://shopify/LineItem/${id}2`;l.product={id:`gid://shopify/Product/${product}`};
  l.orderSize={topSize:{status:"known",value:"L"},variantTitle:{status:"known",value:"XL"}};
  if(product==="10249371680960")l.sku=null;
  const tx=sourceObject((o.transactions as unknown[])[0]);
  tx.id=`gid://shopify/OrderTransaction/${id}4`;tx.createdAt="2026-10-01T12:00:00Z";tx.processedAt="2026-10-01T12:01:00Z";
  if(zeroTotal){
    o.updatedAt="2026-10-01T16:26:58Z";s.financial.updatedAt=o.updatedAt;
    o.originalTotalPriceSet=money("0");o.subtotalPriceSet=money("0");o.transactions=[];o.transactionsCount={count:0,precision:"EXACT"};
    l.discountAllocations=[{allocatedAmountSet:money("20")}];s.financial.originalTotalPriceSet=money("0");s.financial.totalTaxSet=money("0");
  }
  if(refund){
    const rt={id:`gid://shopify/OrderTransaction/${id}5`,kind:"REFUND",status:"SUCCESS",gateway:"fixture",
      test:false,createdAt:"2026-10-01T17:27:24Z",processedAt:"2026-10-01T17:27:24Z",
      amountSet:money("13.50"),parentTransaction:{id:tx.id,gateway:"fixture"}};
    (o.transactions as unknown[]).push(rt);o.transactionsCount={count:2,precision:"EXACT"};
    s.financial.refunds=[{id:`gid://shopify/Refund/${id}7`,updatedAt:"2026-10-01T17:27:26Z"}];
    s.refunds=[{id:`gid://shopify/Refund/${id}7`,createdAt:"2026-10-01T17:27:26Z",updatedAt:"2026-10-01T17:27:26Z",
      order:{id:o.id},totalRefundedSet:money("13.50"),duties:[],
      orderAdjustments:connection([{id:`gid://shopify/OrderAdjustment/${id}8`}]),
      refundLineItems:connection([]),refundShippingLines:connection([]),
      transactions:connection([{id:rt.id,kind:rt.kind,status:rt.status,processedAt:rt.processedAt,amountSet:rt.amountSet}])}];
  }
  return projectPilotRetention(s);
}
async function retain(s=source(),topic="orders/updated"){
  await db.query("select public.lean_accept_receipt('shopify',$1,$2,$3,$4,$5::jsonb)",[randomUUID(),
    JSON.stringify([shop,s.commerce.order.id]),topic,"a".repeat(64),
    JSON.stringify({admin_graphql_api_id:s.commerce.order.id,updated_at:s.commerce.order.updatedAt})]);
  const token=randomUUID(),c=sourceObject(await rpc("lean_pipeline_claim",{p_token:token,p_project_ref:project,p_shop:shop}));
  const id=String(c.workId);
  expect(await rpc("lean_pipeline_retain",{p_work_id:id,p_token:token,p_source:s})).toBe(true);
  expect(await rpc("lean_pipeline_fail",{p_work_id:id,p_token:token,p_code:"mapping_rejected"})).toBe(true);
  await db.query("update lean_private.work set available_at=clock_timestamp()+interval '1 day' where work_id=$1",[id]);
  return id;
}
async function bindings(){
  return {scope:await q<string>(`select ${dbhash("to_jsonb(c)")} r from lean_private.pipeline_scope c`),
    zeros:await q<string>(`select ${dbhash("lean_private.pipeline_ingestion_zero_inventory()")} r`)};
}
async function set(enabled=true,revision=0,b?:{scope:string;zeros:string},deadline="clock_timestamp()+interval '1 minute'"){
  const bind=b??await bindings();
  return q<number>(`select lean_private.set_pipeline_ingestion_amendment($1,$2,$3,$4,$5,'fixture:owner',${deadline}) r`,
    [enabled,revision,bind.scope,bind.zeros,`fixture:admission:${revision+1}`]);
}
const ready=(id:string)=>db.query("update lean_private.work set available_at=clock_timestamp()-interval '1 minute' where work_id=$1",[id]);
const run=()=>{const signal=new AbortController().signal;return runShopifyPipeline({client:boundedPipelineClient(client,signal),
  projectRef:project,databaseUrl:url,shop,accessToken:"fixture-only",fetcher:network,signal});};
const saved=()=>q(`select jsonb_build_object(
  'scope',(select to_jsonb(c) from lean_private.pipeline_scope c),
  'snapshots',(select jsonb_agg(to_jsonb(s) order by work_id) from lean_private.pipeline_snapshots s),
  'work',(select jsonb_agg(to_jsonb(w) order by work_id) from lean_private.work w),
  'receipts',(select jsonb_agg(to_jsonb(r) order by receipt_id) from lean_private.receipts r)) r`);
async function pinRefund(id:string,s=source("9","8501257044160",false,true)){
  Object.assign(REFUND_SUPPLEMENT,{sourceSha256:await q<string>(`select ${dbhash("source")} r from lean_private.pipeline_snapshots where work_id=$1`,[id]),
    orderSha256:hash(String(s.commerce.order.id)),refundSha256:hash(String(s.refunds[0].id)),
    adjustmentSha256:hash(String(sourceObject((sourceObject(s.refunds[0].orderAdjustments).nodes as unknown[])[0]).id))});
}
beforeEach(async()=>{
  db=new PGlite();calls=[];afterClaim=undefined;
  network=vi.fn<typeof fetch>(async()=>{throw Error("native_source_forbidden");});
  await db.exec("set timezone='UTC';create role service_role;create role anon;create role authenticated;create role lean_posthog_reader;");
  for(const n of ["001_staging","003_receipts","004_worker","013_release","014_reporting_views","017_shopify_pipeline",
    "046_order_item_sizes","047_pipeline_extended","052_pipeline_before_window_exclusion","pipeline_throughput.review",
    "pipeline_annual_access_exclusion.review"])await db.exec(sql(n));
  await db.query(`insert into lean_private.pipeline_scope(shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
    values($1,$2,true,'2026-09-30T19:19:02.220236Z','9999-12-31T00:00:00Z',$3::jsonb,'fixture:scope','fixture:owner')`,
    [shop,project,JSON.stringify(policy)]);
  expect(await q("select lean_private.pipeline_throughput_scope_hash() r")).toBe(scopePin);
  zero=[await retain(source("1","8501257044160",true)),await retain(source("1","8501257044160",true),"orders/paid"),
    await retain(source("1","8501257044160",true))];
  zeroHash=await q<string>(`select ${dbhash("source")} r from lean_private.pipeline_snapshots where work_id=$1`,[zero[0]]);
  const metadata=await q<string>(`select ${dbhash("to_jsonb(s)-'source'")} r from lean_private.pipeline_snapshots s where work_id=$1`,[zero[0]]);
  const bytes=await q<number>("select octet_length(source::text) r from lean_private.pipeline_snapshots where work_id=$1",[zero[0]]);
  await db.exec(sql("pipeline_zero_total_exception.review").replaceAll(sourcePin,zeroHash).replaceAll(metadataPin,metadata)
    .replace("octet_length(s.source::text)<>1958",`octet_length(s.source::text)<>${bytes}`));
  const old=await q<{scope:string;work:string;receipt:string}>(`select jsonb_build_object('scope',${dbhash("to_jsonb(c)")},
    'work',${dbhash("to_jsonb(w)")},'receipt',${dbhash("to_jsonb(r)")}) r from lean_private.work w
    join lean_private.receipts r using(receipt_id) cross join lean_private.pipeline_scope c where w.work_id=$1`,[zero[0]]);
  await db.query("select lean_private.register_pipeline_zero_total_exception('fixture:old','fixture:owner',$1,$2,$3,clock_timestamp()+interval '1 minute')",
    [old.scope,old.work,old.receipt]);
  installed=raw.replaceAll(sourcePin,zeroHash);
  await db.exec(installed);
  client=createClient(url,"fixture",{auth:{persistSession:false},global:{fetch:async(input,init)=>{
    const name=new URL(String(input)).pathname.split("/").pop()!;
    expect(init?.signal).toBeInstanceOf(AbortSignal);calls.push(name);
    try{
      const value=await rpc(name,JSON.parse(String(init?.body)));
      if(name==="lean_pipeline_claim"&&afterClaim)await afterClaim();
      return Response.json(value);
    }catch{return Response.json({code:"FIXTURE",message:"safe_sql_refusal"},{status:400});}
  }}});
},30000);
afterEach(async()=>{Object.assign(REFUND_SUPPLEMENT,originalRefund);expect(network).not.toHaveBeenCalled();await db.close();});

describe("explicit immutable ingestion amendment",()=>{
  it("takes finish shared advisory admission before control/scope locks to prevent the owner-batch-finish cycle",()=>{
    const finish=raw.split("create function public.lean_pipeline_finish_amended(")[1].split("end $$;")[0];
    const statements=finish.slice(finish.indexOf("\nbegin\n")+7).replace(/--[^\n]*/g,"").trim();
    expect(statements.startsWith("perform pg_advisory_xact_lock_shared(hashtextextended('pipeline_zero_total_exception:xnfjdbpjuaezxjgargto',0));")).toBe(true);
    expect(statements.indexOf("pipeline_ingestion_amendment for share")).toBeLessThan(statements.indexOf("for update;"));
  });
  it("installs empty, preserves default rejection and exact three-product boundary",async()=>{
    expect(await q("select count(*)::int r from lean_private.pipeline_ingestion_amendment")).toBe(0);
    const id=await retain(source("2",INGESTION_PRODUCTS[0]));await ready(id);
    expect(await run()).toEqual({state:"failed"});
    expect(await q("select count(*)::int r from lean_private.pipeline_heads")).toBe(0);
    expect(()=>mappingPolicy(source("8","8501257175232"),policy)).toThrow("pipeline_catalog_unapproved");
    expect(()=>mappingPolicy(source("8","999"),amendedPipelinePolicy(source("8","999"),policy,
      {version:"ingestion-amendment-20261002",revision:1,approvalRef:"fixture",scopeSha256:scopePin,retainedSourceSha256:null}).policy))
      .toThrow("pipeline_catalog_unapproved");
    expect(raw).toContain(sourcePin);expect(originalRefund.sourceSha256).toBe("967d4d3a6027912a30137d71263421f6c4c64e9a692d49a2f605f1c837ce55c1");
  });
  it("processes each retained exact product, missing SKU and unchanged size policy without reacquisition",async()=>{
    const ids=[];for(let i=0;i<3;i++)ids.push(await retain(source(String(i+2),INGESTION_PRODUCTS[i])));
    const before=await q("select jsonb_agg(to_jsonb(s) order by work_id) r from lean_private.pipeline_snapshots s");
    await set();
    for(const id of ids){await ready(id);expect(await run()).toEqual({state:"done",mappingEvidenceRef:`lean_private.pipeline_ingestion_completions/${id}`});}
    expect(await q("select jsonb_agg(to_jsonb(s) order by work_id) r from lean_private.pipeline_snapshots s")).toEqual(before);
    expect(await q("select count(*)::int r from lean_private.pipeline_ingestion_completions")).toBe(3);
    expect(await q("select count(*)::int r from lean_private.report_product_daily where sku_bucket='unknown'")).toBe(1);
    expect(await q("select bool_and(size_status='unsupported') r from lean_private.order_item_sizes")).toBe(true);
    expect(await q("select bool_and(cash_eligible=false) r from lean_private.payments")).toBe(true);
    expect(await q("select bool_and(is_stale) r from lean_private.report_store_daily")).toBe(true);
    expect((await rpc("lean_pipeline_health",{p_project_ref:project,p_shop:shop}))).toMatchObject({pending:3,done:3,unresolvedExceptions:3});
  });
  it("maps only the exact supplemented retained refund into other adjustment, not item refunds or cash",async()=>{
    const s=source("9","8501257044160",false,true),id=await retain(s);await pinRefund(id,s);await set();await ready(id);
    const before=await q("select to_jsonb(s) r from lean_private.pipeline_snapshots s where work_id=$1",[id]);
    expect(await run()).toEqual({state:"done",mappingEvidenceRef:`lean_private.pipeline_ingestion_completions/${id}`});
    expect(await q("select to_jsonb(s) r from lean_private.pipeline_snapshots s where work_id=$1",[id])).toEqual(before);
    expect(await q("select jsonb_agg(jsonb_build_object('amount',amount_usd::text,'item',order_item_id,'allocation',product_allocation_status)) r from lean_private.sales_ledger where component='other_sales_adjustment'"))
      .toEqual([{amount:"-13.500000",item:null,allocation:"order_level"}]);
    expect(await q("select count(*)::int r from lean_private.sales_ledger where component='merchandise_refund'")).toBe(0);
    expect(await q("select bool_and(refunds_usd=0) r from lean_private.report_product_daily")).toBe(true);
    expect(await q("select bool_and(cash_eligible=false) r from lean_private.payments")).toBe(true);
    expect(await q("select count(*)::int r from lean_private.pipeline_ingestion_completions")).toBe(1);
  });
  it("allows a future instance of the same catalog product only after ordinary immutable retention",async()=>{
    await set();
    const s=source("7",INGESTION_PRODUCTS[1]);
    await db.query("select public.lean_accept_receipt('shopify',$1,$2,'orders/updated',$3,$4::jsonb)",[
      randomUUID(),JSON.stringify([shop,s.commerce.order.id]),"b".repeat(64),
      JSON.stringify({admin_graphql_api_id:s.commerce.order.id,updated_at:s.commerce.order.updatedAt})]);
    const token=randomUUID(),c=sourceObject(await rpc("lean_pipeline_claim",{p_token:token,p_project_ref:project,p_shop:shop}));
    expect(c.source).toBe(null);expect(sourceObject(c.ingestionAmendment).retainedSourceSha256).toBe(null);
    expect(await rpc("lean_pipeline_retain",{p_work_id:c.workId,p_token:token,p_source:s})).toBe(true);
    const amended=amendedPipelinePolicy(s,policy,c.ingestionAmendment);
    const out=composeRetainedOrderReports(s,mappingPolicy(s,amended.policy),String(c.publication),"fixture","shopify-observed-v1",{orderSizeSidecar:true});
    expect(await rpc("lean_pipeline_finish_amended",{p_work_id:c.workId,p_token:token,p_amendment_revision:1,
      p_facts:out.facts,p_reports:out.reports,p_product_reports:out.productReports,p_order_item_sizes:out.order_item_sizes})).toBe(true);
    expect(await q("select count(*)::int r from lean_private.pipeline_ingestion_completions")).toBe(1);
  });
  it("rejects refund identity, amount, currency, extra fields, duplicate and incomplete evidence",async()=>{
    const s=source("9","8501257044160",false,true),id=await retain(s);await pinRefund(id,s);await set();
    const cfg=await q("select lean_private.pipeline_ingestion_context(s,c) r from lean_private.pipeline_snapshots s cross join lean_private.pipeline_scope c where work_id=$1",[id]);
    const compose=(input=structuredClone(s),context=cfg)=>{
      const p=amendedPipelinePolicy(input,policy,context);
      return composeRetainedOrderReports(input,mappingPolicy(input,p.policy),"fixture","fixture","shopify-observed-v1",{orderSizeSidecar:true});
    };
    expect(compose().facts.sales_ledger.some(x=>x.component==="other_sales_adjustment")).toBe(true);
    const mutations:((x:typeof s)=>void)[]=[
      x=>{x.refunds[0].id="gid://shopify/Refund/999";},
      x=>{sourceObject((sourceObject(x.refunds[0].orderAdjustments).nodes as unknown[])[0]).id="gid://shopify/OrderAdjustment/999";},
      x=>{x.refunds[0].totalRefundedSet=money("13.51");},
      x=>{x.refunds[0].totalRefundedSet={shopMoney:{amount:"13.50",currencyCode:"EUR"}};},
      x=>{sourceObject((sourceObject(x.refunds[0].orderAdjustments).nodes as unknown[])[0]).amount="-13.50";},
      x=>{const c=sourceObject(x.refunds[0].orderAdjustments);(c.nodes as unknown[]).push((c.nodes as unknown[])[0]);},
      x=>{sourceObject(sourceObject(x.refunds[0].orderAdjustments).pageInfo).hasNextPage=true;},
      x=>{sourceObject((sourceObject(x.refunds[0].transactions).nodes as unknown[])[0]).amountSet=money("13.49");},
      x=>{x.refunds[0].createdAt="2026-09-01T12:00:00Z";},
      x=>{x.refunds[0].refundShippingLines=connection([{id:"gid://shopify/RefundShippingLine/1"}]);},
    ];
    for(const mutate of mutations){const changed=structuredClone(s);mutate(changed);expect(()=>compose(changed)).toThrow();}
    for(const changed of [{amount:"13.50"},{taxAmount:"0.01"},{currency:"EUR"},{kind:"shipping_refund"}]){
      const supplement={admission:cfg,evidence:{...REFUND_SUPPLEMENT,...changed}} as RefundSupplement;
      expect(()=>approvedRefundDiscrepancy(s,s.refunds[0],supplement)).toThrow("ingestion_refund_unapproved");
    }
    expect(()=>compose(s,{...sourceObject(cfg),retainedSourceSha256:"a".repeat(64)})).toThrow();
    expect(()=>ingestionAdmission({...sourceObject(cfg),revision:0})).toThrow("ingestion_admission_invalid");
  });
  it("defers all exact equivalent work without changing logical rows, leases, attempts, source or pending gate",async()=>{
    const before=await saved(),xmins=await q("select jsonb_agg(xmin::text order by work_id) r from lean_private.work");
    await set();expect(await saved()).toEqual(before);
    expect(await q("select jsonb_agg(xmin::text order by work_id) r from lean_private.work")).not.toEqual(xmins);
    // Old compiled RC claim transition is refused by the unchanged v3 trigger.
    await expect(db.query("update lean_private.work set state='leased',attempts=attempts+1,lease_token=$1,lease_until=clock_timestamp()+interval '2 minutes' where work_id=$2",
      [randomUUID(),zero[1]])).rejects.toThrow("zero-total registered revision cannot be leased");
    expect(await saved()).toEqual(before);
    expect(await rpc("lean_pipeline_health",{p_project_ref:project,p_shop:shop})).toMatchObject({pending:3,done:0,unresolvedExceptions:3});
    expect(await run()).toEqual({state:"idle"});
  });
  it("does not extend the exception to a changed revision, source, policy or window",async()=>{
    await set();
    const variants=[["revision","'2026-10-02T16:26:58Z'::timestamptz"],["source","jsonb_set(source,'{commerce,order,test}','true')"],
      ["policy","s.policy||'{\"extra\":true}'::jsonb"],["until_time","'2026-10-03'::timestamptz"]];
    for(const [column,value] of variants){
      const matched=await q<boolean>(`select lean_private.pipeline_ingestion_zero_equivalent(
        jsonb_populate_record(null::lean_private.pipeline_snapshots,to_jsonb(s)||jsonb_build_object('${column}',${value})),c) r
        from lean_private.pipeline_snapshots s cross join lean_private.pipeline_scope c where work_id=$1`,[zero[1]]);
      expect(matched).toBe(false);
    }
    const corrected=source("1");corrected.commerce.order.updatedAt="2026-10-02T12:00:00Z";corrected.financial.updatedAt=corrected.commerce.order.updatedAt;
    const id=await retain(corrected);await ready(id);expect(await run()).toEqual({state:"done"});
    expect(await rpc("lean_pipeline_health",{p_project_ref:project,p_shop:shop})).toMatchObject({pending:3,unresolvedExceptions:3,done:1});
  });
  it("retains two terminal zeros and defers one pending zero while eligible catalog work completes",async()=>{
    await db.query("update lean_private.work set state='dead',attempts=5 where work_id=any($1::bigint[])",[zero.slice(1)]);
    const id=await retain(source("2",INGESTION_PRODUCTS[0]));
    const before=await saved();
    const versions=()=>q("select jsonb_agg(jsonb_build_object('id',work_id,'xmin',xmin::text) order by work_id) r from lean_private.work where state='dead'");
    const terminalVersions=await versions();
    await set();
    expect(await saved()).toEqual(before);
    expect(await versions()).toEqual(terminalVersions);
    expect(await q("select previous_state r from lean_private.pipeline_operator_audit where event='ingestion_amendment_binding' order by audit_id desc limit 1"))
      .toMatchObject({zeroRecords:3,zeroPendingDeferred:1,zeroTerminalRetained:2,zeroDispositionVersion:"forward-only-20261005"});
    expect(await rpc("lean_pipeline_health",{p_project_ref:project,p_shop:shop}))
      .toMatchObject({pending:2,dead:2,done:0,unresolvedExceptions:3});
    await ready(id);
    expect(await run()).toEqual({state:"done",mappingEvidenceRef:`lean_private.pipeline_ingestion_completions/${id}`});
    expect(await versions()).toEqual(terminalVersions);
    expect(await rpc("lean_pipeline_health",{p_project_ref:project,p_shop:shop}))
      .toMatchObject({pending:1,dead:2,done:1,unresolvedExceptions:3});
    expect(await q("select bool_and(is_stale) r from lean_private.report_store_daily")).toBe(true);
  });
  it("allows an all-terminal zero population without changing logical work or its row versions",async()=>{
    await db.query("update lean_private.work set state='dead',attempts=5 where work_id=any($1::bigint[])",[zero]);
    const before=await saved(),versions=await q("select jsonb_agg(xmin::text order by work_id) r from lean_private.work");
    await set();
    expect(await saved()).toEqual(before);
    expect(await q("select jsonb_agg(xmin::text order by work_id) r from lean_private.work")).toEqual(versions);
    expect(await rpc("lean_pipeline_health",{p_project_ref:project,p_shop:shop}))
      .toMatchObject({pending:0,dead:3,done:0,unresolvedExceptions:3});
    expect(await run()).toEqual({state:"idle"});
  });
  it("binds terminal history in the full CAS and rejects terminal evidence or lifecycle drift",async()=>{
    await db.query("update lean_private.work set state='dead',attempts=5 where work_id=$1",[zero[1]]);
    const b=await bindings();
    await db.query("update lean_private.work set available_at=available_at+interval '1 second' where work_id=$1",[zero[1]]);
    const before=await saved();
    await expect(set(true,0,b)).rejects.toThrow("ingestion zero inventory CAS");
    expect(await saved()).toEqual(before);
    for(const change of ["attempts=4","attempts=6","last_error_code='attempts_exhausted'",
      "lease_token='unexpected'","completed_at=clock_timestamp()"]){
      await db.exec("begin");
      await db.query(`update lean_private.work set ${change} where work_id=$1`,[zero[1]]);
      await expect(set()).rejects.toThrow("ingestion zero work unavailable");
      await db.exec("rollback");
    }
    await db.exec("begin");
    await db.query("update lean_private.publications set state='rejected' where publication_id=(select publication_id from lean_private.pipeline_snapshots where work_id=$1)",[zero[1]]);
    await expect(set()).rejects.toThrow("ingestion zero evidence changed");
    await db.exec("rollback");
    expect(await saved()).toEqual(before);
    expect(await q("select count(*)::int r from lean_private.pipeline_ingestion_amendment")).toBe(0);
  });
  it("refuses stale scope/set CAS and leased or pending-exhausted equivalents without reviving them",async()=>{
    const b=await bindings(),before=await saved();
    await expect(set(true,0,{...b,scope:"0".repeat(64)})).rejects.toThrow("ingestion scope CAS");
    await expect(set(true,0,{...b,zeros:"0".repeat(64)})).rejects.toThrow("ingestion zero inventory CAS");
    expect(await saved()).toEqual(before);
    await db.query("update lean_private.work set attempts=5 where work_id=$1",[zero[1]]);
    await expect(set()).rejects.toThrow("ingestion zero work unavailable");
    await db.query("update lean_private.work set attempts=1,state='leased',lease_token=$1,lease_until=clock_timestamp()+interval '2 minutes' where work_id=$2",[randomUUID(),zero[1]]);
    await expect(set()).rejects.toThrow("ingestion zero work unavailable");
    expect(await q("select count(*)::int r from lean_private.pipeline_ingestion_amendment")).toBe(0);
  });
  it("rolls back the entire registration and physical row fences on a post-write deadline",async()=>{
    const before=await saved(),xmin=await q("select jsonb_agg(xmin::text order by work_id) r from lean_private.work");
    const audit=await q("select count(*)::int r from lean_private.pipeline_operator_audit");
    await db.exec(`create function lean_private.fixture_delay() returns trigger language plpgsql as $$
      begin perform pg_sleep(0.1);return new;end $$;
      create trigger fixture_delay after insert on lean_private.pipeline_ingestion_amendment
      for each row execute function lean_private.fixture_delay();`);
    await expect(set(true,0,await bindings(),"clock_timestamp()+interval '80 milliseconds'")).rejects.toThrow("ingestion operation deadline");
    expect(await saved()).toEqual(before);
    expect(await q("select jsonb_agg(xmin::text order by work_id) r from lean_private.work")).toEqual(xmin);
    expect(await q("select count(*)::int r from lean_private.pipeline_operator_audit")).toBe(audit);
    expect(await q("select count(*)::int r from lean_private.pipeline_ingestion_amendment")).toBe(0);
  });
  it("rechecks revocation at completion and does not fail/retry/clear the claimed lease",async()=>{
    const id=await retain(source("2",INGESTION_PRODUCTS[0]));await set();await ready(id);
    afterClaim=async()=>{afterClaim=undefined;await set(false,1);};
    expect(await run()).toEqual({state:"lost_lease"});
    expect(calls).toEqual(["lean_pipeline_claim","lean_pipeline_finish_amended"]);
    expect(await q("select jsonb_build_object('state',state,'attempts',attempts,'lease',lease_token is not null) r from lean_private.work where work_id=$1",[id]))
      .toEqual({state:"leased",attempts:2,lease:true});
    expect(await q("select count(*)::int r from lean_private.pipeline_heads")).toBe(0);
    expect(await q("select count(*)::int r from lean_private.pipeline_ingestion_completions")).toBe(0);
  });
  it("rolls back facts and completion when its immutable provenance cannot be written",async()=>{
    const id=await retain(source("2",INGESTION_PRODUCTS[0]));await set();await ready(id);
    await db.exec(`create function lean_private.fixture_refuse_provenance() returns trigger language plpgsql as $$
      begin raise exception 'fixture_provenance_refusal';end $$;
      create trigger fixture_refuse before insert on lean_private.pipeline_ingestion_completions
      for each row execute function lean_private.fixture_refuse_provenance();`);
    await expect(run()).rejects.toThrow("pipeline_storage_unavailable");
    expect(calls).toEqual(["lean_pipeline_claim","lean_pipeline_finish_amended"]);
    expect(await q("select count(*)::int r from lean_private.pipeline_heads")).toBe(0);
    expect(await q("select count(*)::int r from lean_private.report_store_daily")).toBe(0);
    expect(await q("select state r from lean_private.work where work_id=$1",[id])).toBe("leased");
  });
  it("requires owner-only constructor, keeps completion provenance immutable and refuses unbound deadlines",async()=>{
    const b=await bindings();
    await db.exec("set role service_role");
    await expect(set(true,0,b)).rejects.toThrow();
    await expect(q("select lean_private.pipeline_ingestion_zero_inventory() r")).rejects.toThrow();
    await db.exec("reset role");
    await expect(set(true,0,b,"null")).rejects.toThrow("ingestion operation unbound");
    await expect(set(true,0,b,"clock_timestamp()-interval '1 second'")).rejects.toThrow("ingestion operation unbound");
    await set();await expect(set(true,0)).rejects.toThrow("ingestion revision CAS");
    await expect(db.exec("truncate lean_private.pipeline_ingestion_completions")).rejects.toThrow("ingestion history immutable");
  });
});
