/** Synthetic local 016 -> existing formulas -> 044 -> actual HTTP contract. No providers. */
import { Client } from "pg";
import { PGlite } from "@electric-sql/pglite";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { mapPilotSource, type PilotPolicy } from "@/lib/analytics/shopifyPilotMapping";
import type { PilotSource } from "@/lib/analytics/shopifyPilotSource";
import { projectSelectedOrder, type SelectedOrderInput } from "@/lib/analytics/selectedOrderProjection";
import { selectedOrderGet, selectedOrderPath, validSelectedOrderPayload } from "@/lib/analytics/selectedOrderDelivery";

const shop="mullybox-store.myshopify.com",project="xeqlgxvrhgwwudyqtnun";
const run="aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",pub=`pilot:${run}`,token="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const bag=(amount:string)=>({shopMoney:{amount,currencyCode:"USD"}});
const connection=(nodes:unknown[])=>({nodes,pageInfo:{hasNextPage:false,endCursor:null}});
const policy:PilotPolicy={decision:{eligibility:"eligible",commerceSource:"storefront",acquisitionEligible:false,
  approvalRef:"fixture:prior-test-only"},lineClasses:{"2":"merchandise"},financialApprovalRef:"fixture:test-not-live-policy",
  saleClock:"paid_at",refundClock:"refund_created_at"};
function source():PilotSource {
  const order={id:"gid://shopify/Order/1",createdAt:"2026-09-21T12:21:08Z",updatedAt:"2026-09-24T14:49:10Z",
    currencyCode:"USD",test:false,cancelledAt:null,edited:false,taxesIncluded:false,shippingAddress:null,
    originalTotalPriceSet:bag("250"),subtotalPriceSet:bag("250"),transactionsCount:{count:1,precision:"EXACT"},
    transactions:[{id:"gid://shopify/OrderTransaction/4",kind:"SALE",status:"SUCCESS",gateway:"fixture",test:false,
      createdAt:"2026-09-21T12:21:04Z",processedAt:"2026-09-21T12:21:04Z",amountSet:bag("250"),parentTransaction:null}],
    lineItems:connection([{id:"gid://shopify/LineItem/2",sku:"FIXTURE-RES",quantity:1,isGiftCard:false,
      product:{id:"gid://shopify/Product/3"},originalUnitPriceSet:bag("250"),originalTotalSet:bag("250"),discountAllocations:[]}])};
  return {commerce:{shop,apiVersion:"2026-07",order},financial:{id:order.id,updatedAt:order.updatedAt,currencyCode:"USD",
    originalTotalPriceSet:bag("250"),totalTaxSet:bag("0"),originalTotalDutiesSet:null,originalTotalAdditionalFeesSet:null,
    totalTipReceivedSet:bag("0"),shippingLines:connection([]),refunds:[]},refunds:[]};
}
const secret="fixture-selected-only-32-character-secret";
const env={LEAN_SELECTED_ORDER_ENABLED:"true",LEAN_SELECTED_ORDER_SECRET:secret,LEAN_SELECTED_ORDER_SCOPE_ID:"fixture",
  VERCEL_ENV:"preview",VERCEL_GIT_COMMIT_REF:"review/analytics-initial-validation",
  LEAN_ANALYTICS_PIPELINE_PROJECT_REF:project,LEAN_ANALYTICS_SUPABASE_URL:`https://${project}.supabase.co`,
  LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY:"fixture-server-key"};
const req=(path=selectedOrderPath,auth=`Bearer ${secret}`,method="GET")=>
  new Request(`https://fixed.invalid${path}`,{method,headers:{authorization:auth}});
function input():SelectedOrderInput {
  const mapped=mapPilotSource(source(),policy,pub,"fixture:retained");
  return {runId:run,publication:pub,shop,inputHash:"a".repeat(64),sourceUpdatedAt:String(source().commerce.order.updatedAt),
    savedStore:mapped.reports,
    facts:{orders:mapped.facts.orders,order_items:mapped.facts.order_items,sales_ledger:mapped.facts.sales_ledger,
      payments:[],customers:[],sessions:[],marketing_spend_daily:[],order_attribution:[]}};
}
describe("selected order formula and HTTP boundary",()=>{
  it("uses existing formulas and real purchase date, not creation/run date; keeps prior test policy explicit",()=>{
    const rows=projectSelectedOrder(input());expect(validSelectedOrderPayload(rows)).toBe(true);
    expect(rows.store_daily[0]).toMatchObject({report_date:"2026-09-21",total_sales_usd:"250.000000",
      aov_usd:"250.000000",eligible_orders:1,refunds_usd:"0.000000",spend_usd:null,collected_cash_usd:null,
      policy_scope:"prior_single_order_test",complete_window:false,certified:false});
    expect(rows.product_daily[0]).toMatchObject({sku_bucket:"FIXTURE-RES",units:"1.000000",
      net_merchandise_sales_usd:"250.000000",policy_scope:"prior_single_order_test"});
    expect(JSON.stringify(rows)).not.toMatch(/order_id|publication_id|customer_id|shipping_country|fixture:retained/);
  });
  it("withholds unallocated product money without withholding the actual store ledger",()=>{
    const i=input();i.facts.sales_ledger[0].product_allocation_status="unresolved";i.facts.sales_ledger[0].order_item_id=null;
    const out=projectSelectedOrder(i);expect(out.store_daily[0].gross_merchandise_sales_usd).toBe("250.000000");
    expect(out.product_daily[0].gross_merchandise_sales_usd).toBeNull();
  });
  it("rejects repeated runs/facts, mixed publication and unproven domains",()=>{
    const i=input();i.facts.orders.push({...i.facts.orders[0]});expect(()=>projectSelectedOrder(i)).toThrow();
    const j=input();j.facts.order_items.push({...j.facts.order_items[0]});expect(()=>projectSelectedOrder(j)).toThrow();
    const k=input();k.facts.order_items[0].publication_id="other";expect(()=>projectSelectedOrder(k)).toThrow("mixed_publication");
    const m=input();m.facts.customers.push({});expect(()=>projectSelectedOrder(m)).toThrow();
  });
  it("auth/default-off/environment/selectors fail before transport",async()=>{
    const transport=vi.fn();
    for(const [overrides,status] of [[{LEAN_SELECTED_ORDER_ENABLED:"false"},404],[{VERCEL_ENV:"production"},404],
      [{LEAN_ANALYTICS_SUPABASE_URL:"https://wrong.invalid"},503]] as const)
      expect((await selectedOrderGet(req(),{...env,...overrides},transport)).status).toBe(status);
    expect((await selectedOrderGet(req(selectedOrderPath,"wrong"),env,transport)).status).toBe(401);
    expect((await selectedOrderGet(req(selectedOrderPath,undefined,"POST"),env,transport)).status).toBe(405);
    expect((await selectedOrderGet(req(selectedOrderPath+"?run=other"),env,transport)).status).toBe(400);
    const body=req();body.headers.set("content-length","1");
    expect((await selectedOrderGet(body,env,transport)).status).toBe(400);expect(transport).not.toHaveBeenCalled();
  });
  it("one fixed RPC returns exact aggregate decimals only, fails closed on promotion/raw fields/overflow",async()=>{
    const payload=projectSelectedOrder(input());
    const transport=vi.fn(async(url,init)=>{
      expect(url).toBe(`https://${project}.supabase.co/rest/v1/rpc/lean_selected_order_read`);
      expect(JSON.parse(String(init?.body))).toEqual({p_scope_id:"fixture",p_project:project});
      expect(init?.redirect).toBe("error");return Response.json(payload);
    }) as unknown as typeof fetch;
    const response=await selectedOrderGet(req(),env,transport);expect(response.status).toBe(200);
    expect(await response.json()).toEqual(payload);expect(transport).toHaveBeenCalledTimes(1);
    for(const change of [{certified:true},{policy_scope:"approved"},{source_order_id:"private"},{total_sales_usd:250},
      {spend_usd:"1.000000"},{report_scope:undefined}]) {
      const bad={...payload,store_daily:[{...payload.store_daily[0],...change}]};
      expect((await selectedOrderGet(req(),env,async()=>Response.json(bad))).status).toBe(503);
    }
    expect((await selectedOrderGet(req(),env,async()=>new Response("x".repeat(1048577)))).status).toBe(503);
  });
});

const url=process.env.SELECTED_ORDER_TEST_URL;
describe(`044 actual ${url?"PostgreSQL":"PGlite"} saved-pilot roundtrip`,()=>{
  let pg:Client|undefined,control:Client|undefined,embedded:PGlite|undefined;
  const exec=(sql:string)=>pg?pg.query(sql):embedded!.exec(sql);
  const query=(sql:string,params?:unknown[])=>pg?pg.query(sql,params):embedded!.query(sql,params);
  let fingerprint:unknown;
  beforeAll(async()=>{
    if(url){
      const u=new URL(url);
      if(!["127.0.0.1","localhost"].includes(u.hostname) ||
        !["fixture_selected","fixture_owner","fixture_shopify_install"].includes(u.username))
        throw new Error("dedicated_loopback_fixture_only");
      control=new Client({connectionString:u.href});await control.connect();
      await control.query("drop database if exists analytics_test_selected_order");
      await control.query("create database analytics_test_selected_order");u.pathname="/analytics_test_selected_order";
      pg=new Client({connectionString:u.href});await pg.connect();
    }else embedded=new PGlite();
    await exec(`do $$begin
      if not exists(select 1 from pg_roles where rolname='anon') then create role anon;end if;
      if not exists(select 1 from pg_roles where rolname='authenticated') then create role authenticated;end if;
      if not exists(select 1 from pg_roles where rolname='service_role') then create role service_role;end if;
      end $$;alter default privileges in schema public grant execute on functions to anon,authenticated,service_role`);
    for(const name of ["001_staging","013_release","014_reporting_views","016_shopify_pilot"]){
      let sql=readFileSync(`sql/analytics/${name}.sql`,"utf8");
      // 016's cluster-wide NOLOGIN role may remain from another disposable DB.
      // Reuse it without altering any grants there or modifying production SQL.
      if(name==="016_shopify_pilot" && (await query("select 1 from pg_roles where rolname='lean_pilot_reader'")).rows.length)
        sql=sql.replace("create role lean_pilot_reader nologin noinherit;","");
      await exec(sql);
    }
    fingerprint=(await query("select oid::regprocedure::text n,pg_get_functiondef(oid) d from pg_proc where proname like 'lean_%' order by 1")).rows;
    await exec(readFileSync("sql/analytics/044_selected_order_delivery.sql","utf8"));
  },30000);
  afterAll(async()=>{
    if(fingerprint)expect((await query("select oid::regprocedure::text n,pg_get_functiondef(oid) d from pg_proc where proname like 'lean_%' and proname not like 'lean_selected_%' order by 1")).rows).toEqual(fingerprint);
    await pg?.end();await embedded?.close();
    if(control){await control.query("drop database if exists analytics_test_selected_order");await control.end();}
  });
  beforeEach(async()=>{
    await exec("truncate lean_private.publications cascade;truncate lean_private.pilot_environment cascade");
    await query("insert into lean_private.pilot_environment(project_ref,approval_ref) values($1,'fixture:test')",[project]);
    await query("select public.lean_pilot_register($1,$2,$3,$4,'fixture:test','fixture:owner')",
      [run,shop,source().commerce.order.id,JSON.stringify(policy)]);
    await query("select public.lean_pilot_claim($1,$2,$3)",[run,token,project]);
    await query("select public.lean_pilot_retain($1,$2,$3)",[run,token,JSON.stringify(source())]);
    const mapped=mapPilotSource(source(),policy,pub,"fixture:retained");
    await query("select public.lean_pilot_finish($1,$2,$3,$4)",[run,token,JSON.stringify(mapped.facts),JSON.stringify(mapped.reports)]);
  });
  const extract=async()=>(await query("select public.lean_selected_order_input($1) input",[run])).rows[0].input as SelectedOrderInput;
  const register=async(i:SelectedOrderInput,payload=projectSelectedOrder(i),expires=new Date(Date.now()+60000))=>{
    await query("select public.lean_selected_order_register('fixture',$1,$2,$3,'fixture:sample-delivery',$4)",
      [run,i.inputHash,JSON.stringify(payload),expires]);
  };
  const enable=()=>exec("update lean_private.selected_order_delivery set enabled=true");
  const read=async()=>(await query("select public.lean_selected_order_read('fixture',$1) payload",[project])).rows[0].payload;
  it("actual saved facts -> existing formulas -> durable disabled snapshot -> GET equals exactly",async()=>{
    const i=await extract();expect(i.facts.order_items[0].quantity).toBe("1.000000");
    expect(JSON.stringify(i)).not.toMatch(/shipping_country|shipping_region|customer_id|source_transaction_id/);
    const payload=projectSelectedOrder(i);await register(i,payload);await expect(read()).rejects.toThrow();
    await enable();expect(await read()).toEqual(payload);expect(await read()).toEqual(payload);
    await exec("set role service_role");
    const response=await selectedOrderGet(req(),env,async()=>Response.json(await read()));
    expect(response.status).toBe(200);expect(await response.json()).toEqual(payload);
    await exec("reset role");expect((await query("select state from lean_private.publications")).rows).toEqual([{state:"candidate"}]);
    const temp=mkdtempSync(join(tmpdir(),"selected-verify-"));
    try {
      writeFileSync(join(temp,"input.json"),JSON.stringify(i));writeFileSync(join(temp,"get.json"),JSON.stringify(payload));
      const result=JSON.parse(execFileSync(process.execPath,["scripts/analytics/selected-order-project.mjs",
        join(temp,"input.json"),join(temp,"output.json"),join(temp,"get.json")],{encoding:"utf8"}));
      expect(result).toMatchObject({savedStoreMatches:true,getMatches:true,storeRows:1,productRows:1});
      expect(JSON.parse(readFileSync(join(temp,"output.json"),"utf8"))).toEqual(payload);
    }finally{rmSync(temp,{recursive:true,force:true});}
  });
  it("hash binds raw source/policy/full canonical facts and saved store; all drift fails",async()=>{
    const i=await extract();await register(i);await enable();
    for(const sql of [
      "update lean_private.pilot_runs set policy=policy||'{\"financialApprovalRef\":\"changed\"}'",
      "update lean_private.pilot_runs set source=jsonb_set(source,'{commerce,order,updatedAt}','\"2026-09-25T00:00:00Z\"')",
      "update lean_private.order_items set quantity=2",
      "update lean_private.payments set source_amount=249",
      "update lean_analytics.pilot_store_daily set total_sales_usd=249",
    ]) {
      await exec("begin");await exec(sql);await expect(read()).rejects.toThrow();await exec("rollback");
    }
    expect(await read()).toEqual(projectSelectedOrder(i));
  });
  it("owner-only extraction/registration, immutable snapshot, wrong hash/raw output/test-policy stripping rejected",async()=>{
    const i=await extract();
    await exec("set role service_role");
    await expect(extract()).rejects.toThrow();await expect(register(i)).rejects.toThrow();
    await expect(query("select * from lean_private.selected_order_delivery")).rejects.toThrow();
    await exec("reset role");
    await expect(register({...i,inputHash:"b".repeat(64)})).rejects.toThrow("input changed");
    const bad=projectSelectedOrder(i);Object.assign(bad.store_daily[0],{policy_scope:"approved",order_id:"private"});
    await expect(register(i,bad)).rejects.toThrow("row boundary");
    await register(i);await expect(exec("update lean_private.selected_order_delivery set payload='{}'")).rejects.toThrow("immutable");
    await expect(exec("update lean_private.selected_order_delivery set expires_at=expires_at+interval '1 day'")).rejects.toThrow("immutable");
  });
  it("expiry and kill stop reads without changing source or certification",async()=>{
    const i=await extract();await expect(register(i,undefined,new Date(Date.now()-1))).rejects.toThrow("registration boundary");
    await register(i,undefined,new Date(Date.now()+150));await enable();await exec("select pg_sleep(0.2)");
    await expect(read()).rejects.toThrow("expired");expect(await extract()).toEqual(i);
  });
});
