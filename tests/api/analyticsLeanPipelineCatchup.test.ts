/** Actual additive SQL + existing pipeline + native Supabase transport.
 * All orders, approvals and network responses are synthetic. */
import { PGlite } from "@electric-sql/pglite";
import { createClient } from "@supabase/supabase-js";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { runScheduledPipelineCatchup } from "@/lib/analytics/scheduledPipelineCatchup";
import { projectPilotRetention } from "@/lib/analytics/shopifyRetention";
import { sourceObject, SHOPIFY_FINANCIAL_ORDER_QUERY } from "@/lib/analytics/shopifySource";
import { PILOT_FINANCIAL_QUERY } from "@/lib/analytics/shopifyPilotSource";
import { runtimePolicy, runtimeSource } from "../fixtures/analyticsRetainedRuntime";
import { GET as scheduled } from "@/app/api/analytics/ingest/scheduled/route";
import { GET as healthGet, POST as processPost } from "@/app/api/analytics/ingest/process/route";

const port = vi.hoisted(() => ({ client: null as AnalyticsRpcClient | null, financial: vi.fn(async () => ({ state: "complete" })) }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => port.client }));
vi.mock("@/lib/analytics/scheduledFinancialCheckpoint", () => ({ runScheduledFinancialCheckpoint: port.financial }));
const shop = "mullybox-store.myshopify.com", project = "xnfjdbpjuaezxjgargto", url = `https://${project}.supabase.co`;
let db: PGlite, client: AnalyticsRpcClient, calls: string[], httpCalls: number;
let notices: string[];
let intercept: ((name: string, args: Record<string, unknown>) => Promise<Response> | undefined) | undefined;
let documents: Map<string, ReturnType<typeof runtimeSource>>;
const sql = (file: string) => readFileSync(`sql/analytics/${file}.sql`, "utf8");
const names = new Set(["lean_pipeline_throughput_begin","lean_pipeline_throughput_step","lean_pipeline_throughput_close",
  "lean_pipeline_health","lean_pipeline_claim","lean_pipeline_retain","lean_pipeline_finish_extended","lean_pipeline_fail"]);
const jsonArgs = new Set(["p_args","p_source","p_facts","p_reports","p_product_reports","p_order_item_sizes"]);
async function response(name: string, args: Record<string, unknown>) {
  expect(names.has(name)).toBe(true);
  const entries = Object.entries(args);
  try {
    const r = await db.query<{r: unknown}>(`select public.${name}(${entries.map(([key], i) =>
      `${key}=>$${i+1}${jsonArgs.has(key) ? "::jsonb" : ""}`).join(",")}) r`,
    entries.map(([key,v]) => jsonArgs.has(key) && v !== null ? JSON.stringify(v) : v),
    {onNotice:notice=>notices.push(notice.message ?? "")});
    return Response.json(r.rows[0].r);
  } catch (error) {
    return Response.json({ code: "FIXTURE", message: String(error) }, {status:400});
  }
}
const rpcFetch: typeof fetch = async (url, init) => {
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  const name = new URL(String(url)).pathname.split("/").pop()!, args = JSON.parse(String(init?.body));
  if (name === "lean_pipeline_ordinary_batch_admission") return Response.json({ state: "off" });
  calls.push(name === "lean_pipeline_throughput_step" ? String(args.p_operation) : name);
  return intercept?.(name,args) ?? response(name,args);
};
const sourceFetch: typeof fetch = async (request, init) => {
  expect(String(request)).toBe(`https://${shop}/admin/api/2026-07/graphql.json`);
  expect(init?.signal).toBeInstanceOf(AbortSignal);
  expect(init?.redirect).toBe("error");
  const { query, variables } = JSON.parse(String(init?.body));
  const doc = documents.get(variables.id)!;
  expect(doc).toBeDefined(); httpCalls++;
  expect([SHOPIFY_FINANCIAL_ORDER_QUERY,PILOT_FINANCIAL_QUERY]).toContain(query);
  return Response.json({data:{order:query===PILOT_FINANCIAL_QUERY ? doc.financial : doc.commerce.order}},
    {headers:{"X-Shopify-API-Version":"2026-07"}});
};
const options = (signal = new AbortController().signal) => ({ client, projectRef:project, databaseUrl:url,
  shop, accessToken:"fixture-only", signal, deadline:Date.now()+180000, fetcher:sourceFetch });
async function addOrder(id: string, old = false) {
  const doc = runtimeSource();
  doc.commerce.shop=shop; doc.commerce.order.id=`gid://shopify/Order/${id}`; doc.financial.id=doc.commerce.order.id;
  sourceObject((sourceObject(doc.commerce.order.lineItems).nodes as unknown[])[0]).id=`gid://shopify/LineItem/${id}2`;
  sourceObject((doc.commerce.order.transactions as unknown[])[0]).id=`gid://shopify/OrderTransaction/${id}4`;
  if (old) doc.commerce.order.createdAt="2025-12-01T12:00:00Z";
  documents.set(doc.commerce.order.id as string,doc);
  await db.query("select public.lean_accept_receipt('shopify',$1,$2,'orders/paid',$3,$4::jsonb)",
    [randomUUID(),JSON.stringify([shop,doc.commerce.order.id]),"a".repeat(64),
      JSON.stringify({admin_graphql_api_id:doc.commerce.order.id,updated_at:doc.commerce.order.updatedAt})]);
  return doc;
}
async function grant(claims = 640, native = 5120, batch = 19) {
  await db.query(`insert into lean_private.pipeline_throughput_grants
    (grant_id,project_ref,shop,scope_sha256,approval_ref,actor_ref,enabled,not_before,expires_at,
     max_extra_claims,max_native_requests,max_batch_claims,max_batch_native_requests)
    values('fixture:grant',$1,$2,lean_private.pipeline_throughput_scope_hash(),'fixture:not-real','fixture:owner',true,
      clock_timestamp()-interval '1 second',clock_timestamp()+interval '8 hours',$3,$4,$5,152)`,
  [project,shop,claims,native,batch]);
}
const row = async () => (await db.query<Record<string,unknown>>("select * from lean_private.pipeline_throughput_grants")).rows[0];
const headCount = async () => Number((await db.query<{n:number}>("select count(*) n from lean_private.pipeline_heads")).rows[0].n);
beforeEach(async () => {
  db = new PGlite(); calls=[]; httpCalls=0; notices=[]; documents=new Map(); intercept=undefined;
  await db.exec("create role service_role;create role anon;create role authenticated;");
  for (const file of ["001_staging","003_receipts","004_worker","013_release","014_reporting_views",
    "017_shopify_pipeline","047_pipeline_extended","052_pipeline_before_window_exclusion","pipeline_throughput.review"])
    await db.exec(sql(file));
  await db.query(`insert into lean_private.pipeline_scope
    (shop,project_ref,enabled,from_time,until_time,policy,approval_ref,actor_ref)
    values($1,$2,true,'2026-01-01','2026-02-01',$3::jsonb,'fixture:scope','fixture:owner')`,
  [shop,project,JSON.stringify(runtimePolicy)]);
  client=createClient(url,"fixture-only",{auth:{persistSession:false},global:{fetch:rpcFetch}});
  port.client=client; port.financial.mockClear();
  vi.spyOn(console,"info").mockImplementation(()=>{});
  for (const [key,value] of Object.entries({
    VERCEL_ENV:"production",LEAN_ANALYTICS_VERCEL_SCHEDULE_ENABLED:"true",
    LEAN_ANALYTICS_PIPELINE_ENABLED:"true",LEAN_ANALYTICS_DISPATCH_ENABLED:"true",
    LEAN_ANALYTICS_SCHEDULE_MODE:"continuous",CRON_SECRET:"fixture-cron-secret-long",
    LEAN_ANALYTICS_PIPELINE_SECRET:"fixture-process-secret-at-least32",
    LEAN_ANALYTICS_PIPELINE_PROJECT_REF:project,LEAN_ANALYTICS_SUPABASE_URL:url,
    LEAN_SHOPIFY_SHOP_DOMAIN:shop,LEAN_SHOPIFY_ANALYTICS_READ_TOKEN:"fixture-token",
  })) vi.stubEnv(key,value);
  vi.stubGlobal("fetch",async (input: string | URL | Request, init?: RequestInit) => {
    if (String(input)==="https://www.mymully.com/api/analytics/ingest/process") {
      const req=new NextRequest(String(input),{method:init?.method,headers:init?.headers,signal:init?.signal ?? undefined});
      return init?.method==="GET" ? healthGet(req) : processPost(req);
    }
    return sourceFetch(input,init);
  });
},30000);
afterEach(async()=>{await db.close();vi.unstubAllEnvs();vi.unstubAllGlobals();vi.restoreAllMocks();});

describe("separately authorized bounded extra throughput",()=>{
  it("is empty/default off, after the ordinary baseline, without changing its financial behavior",async()=>{
    await addOrder("1");await addOrder("2");
    const r=await scheduled(new NextRequest("https://www.mymully.com/api/analytics/ingest/scheduled",
      {headers:{authorization:"Bearer fixture-cron-secret-long"}}));
    expect((await r.json()).catchup.state).toBe("off");
    expect(await headCount()).toBe(1);expect(httpCalls).toBe(4);
    expect(port.financial).toHaveBeenCalledTimes(1);
  });
  it("runs the existing baseline first, then extra sequential work with no financial lane",async()=>{
    await grant();for(const id of ["1","2","3"])await addOrder(id);
    const r=await scheduled(new NextRequest("https://www.mymully.com/api/analytics/ingest/scheduled",
      {headers:{authorization:"Bearer fixture-cron-secret-long"}}));
    const out=await r.json();
    expect(out.catchup).toMatchObject({state:"idle",extraClaims:2,nativeHydrations:2,nativeRequests:8,exclusions:0});
    expect(await headCount()).toBe(3);expect(httpCalls).toBe(12);
    expect(calls.indexOf("lean_pipeline_finish_extended")).toBeLessThan(calls.indexOf("lean_pipeline_throughput_begin"));
    expect(port.financial).not.toHaveBeenCalled();
    expect(await row()).toMatchObject({extra_claims_used:2,native_permits_used:8,batch_token:null});
  });
  it("advances at most twenty total receipts despite old backlog, preserving its warning status",async()=>{
    await grant();
    for(let id=1;id<=21;id++)await addOrder(String(id));
    await db.exec("update lean_private.receipts set received_at=clock_timestamp()-interval '1 day'");
    const r=await scheduled(new NextRequest("https://www.mymully.com/api/analytics/ingest/scheduled",
      {headers:{authorization:"Bearer fixture-cron-secret-long"}}));
    expect(r.status).toBe(503);
    expect((await r.json()).catchup).toMatchObject({state:"complete",extraClaims:19,nativeHydrations:19,nativeRequests:76});
    expect(await headCount()).toBe(20);expect(httpCalls).toBe(80);
    expect(await row()).toMatchObject({extra_claims_used:19,native_permits_used:76,batch_token:null});
    expect(port.financial).not.toHaveBeenCalled();
  });
  it("counts retained-source work, native hydration and before-window exclusion separately",async()=>{
    const first=await addOrder("1");await addOrder("2",true);await addOrder("3");
    const token=randomUUID();
    const c=(await db.query<{r:{workId:string}}>("select public.lean_pipeline_claim($1,$2,$3) r",[token,project,shop])).rows[0].r;
    await db.query("select public.lean_pipeline_retain($1,$2,$3::jsonb)",
      [c.workId,token,JSON.stringify(projectPilotRetention(first))]);
    // Synthetic setup of a previously failed retained snapshot, not live reset.
    await db.exec("update lean_private.work set state='pending',lease_token=null,lease_until=null where state='leased'");
    await grant();
    expect(await runScheduledPipelineCatchup(options())).toMatchObject({state:"idle",extraClaims:3,
      retainedSourceSteps:1,nativeHydrations:2,nativeRequests:8,exclusions:1});
    expect(await headCount()).toBe(2);expect(httpCalls).toBe(8);
    expect(await row()).toMatchObject({extra_claims_used:3,native_permits_used:8,batch_token:null});
  });
  it("enforces the global claim ceiling across invocations and never extends its term",async()=>{
    await grant(2);for(const id of ["1","2","3"])await addOrder(id);
    expect((await runScheduledPipelineCatchup(options())).extraClaims).toBe(2);
    const used=httpCalls;
    expect((await runScheduledPipelineCatchup(options())).state).toBe("budget_exhausted");
    expect(httpCalls).toBe(used);
    await expect(db.exec("update lean_private.pipeline_throughput_grants set expires_at=expires_at+interval '1 minute'"))
      .rejects.toThrow("immutable");
    await expect(db.exec("update lean_private.pipeline_throughput_grants set extra_claims_used=0")).rejects.toThrow("immutable");
  });
  it("requires a fresh counted DB permit for actual HTTP and withholds on exhausted authority",async()=>{
    await grant(640,8);await addOrder("1");
    intercept=(name,args)=>{
      if(name==="lean_pipeline_throughput_step" && args.p_operation==="native_request" && httpCalls===0)
        return (async()=>{
          await db.exec("update lean_private.pipeline_throughput_grants set native_permits_used=7");
          return response(name,args);
        })();
    };
    expect((await runScheduledPipelineCatchup(options())).state).toBe("held");
    expect(httpCalls).toBe(1);
    expect(await row()).toMatchObject({native_permits_used:8});
    expect(calls).not.toContain("lean_pipeline_fail");
    expect(calls).not.toContain("lean_pipeline_throughput_close");
  });
  it("stops before any grant mutation when fewer than 65 seconds remain",async()=>{
    await grant();await addOrder("1");
    expect((await runScheduledPipelineCatchup({...options(),deadline:Date.now()+64000})).state).toBe("deadline");
    expect(calls).toEqual([]);expect(httpCalls).toBe(0);
  });
  for(const stage of ["lean_pipeline_claim","native_request","lean_pipeline_finish_extended"]){
    it(`holds ambiguous ${stage}, allows no subsequent RPC/source and never steals its batch`,async()=>{
      await grant();await addOrder("1");
      const stop=new AbortController();let entered!:()=>void,release!:()=>Promise<void>;
      const reached=new Promise<void>(resolve=>{entered=resolve;});
      intercept=(name,args)=>{
        if(name!=="lean_pipeline_throughput_step"||args.p_operation!==stage)return;
        return new Promise<Response>(resolve=>{release=async()=>{resolve(await response(name,args));};entered();});
      };
      const running=runScheduledPipelineCatchup(options(stop.signal));
      await reached;stop.abort();expect((await running).state).toBe("held");
      const before=[...calls],native=httpCalls;
      await release();await new Promise(resolve=>setTimeout(resolve,5));
      expect(calls).toEqual(before);expect(httpCalls).toBe(native);
      expect(calls).not.toContain("lean_pipeline_fail");expect(calls).not.toContain("lean_pipeline_throughput_close");
      intercept=undefined;
      expect((await runScheduledPipelineCatchup(options())).state).toBe("held");
      expect(await headCount()).toBe(stage==="lean_pipeline_finish_extended"?1:0);
      if(stage==="lean_pipeline_claim"){
        // Explicitly separate the old baseline permission from the extra hold.
        await db.exec("update lean_private.work set lease_until=clock_timestamp()-interval '1 second' where state='leased'");
        const baseline=await processPost(new NextRequest("https://www.mymully.com/api/analytics/ingest/process",
          {method:"POST",headers:{authorization:"Bearer fixture-process-secret-at-least32"}}));
        expect(await baseline.json()).toEqual({state:"done"});
        expect(httpCalls).toBe(4);
        expect(await row()).toMatchObject({extra_claims_used:1,native_permits_used:0});
        expect((await runScheduledPipelineCatchup(options())).state).toBe("held");
        expect(await headCount()).toBe(1);
      }
    });
  }
  it("keeps known unsupported input held without inline retry or invented current reports",async()=>{
    await grant();const doc=await addOrder("1");doc.commerce.order.edited=true;
    expect((await runScheduledPipelineCatchup(options())).state).toBe("held");
    expect(calls.filter(n=>n==="lean_pipeline_claim")).toHaveLength(1);
    expect(calls.filter(n=>n==="lean_pipeline_fail")).toHaveLength(1);
    expect(await row()).toMatchObject({held:true,extra_claims_used:1});
    expect(await headCount()).toBe(0);
  });
  it("does not continue after fresh final health discovers a peer lease",async()=>{
    await grant();await addOrder("1");await addOrder("2");
    intercept=(name,args)=>name==="lean_pipeline_health"?(async()=>{
      await db.exec("update lean_private.work set state='leased',lease_token='peer',lease_until=clock_timestamp()+interval '60 seconds' where state='pending'");
      return response(name,args);
    })():undefined;
    expect((await runScheduledPipelineCatchup(options())).state).toBe("blocked");
    expect(calls.filter(n=>n==="lean_pipeline_claim")).toHaveLength(1);
    expect(await row()).toMatchObject({batch_token:null});
  });
  it("rolls back a delegated finish when the batch expires during the database mutation",async()=>{
    await grant();await addOrder("1");
    await db.exec(`create function lean_private.fixture_slow_finish() returns trigger language plpgsql as $$
      begin if new.state='done' then raise notice 'fixture_delegate_entered';perform pg_sleep(0.1);end if;return new;end $$;
      create trigger fixture_slow_finish before update on lean_private.work
      for each row execute function lean_private.fixture_slow_finish()`);
    intercept=(name,args)=>name==="lean_pipeline_throughput_step"&&args.p_operation==="lean_pipeline_finish_extended"?
      (async()=>{
        await db.exec("update lean_private.pipeline_throughput_grants set batch_deadline=clock_timestamp()+interval '50 milliseconds'");
        return response(name,args);
      })():undefined;
    expect((await runScheduledPipelineCatchup(options())).state).toBe("held");
    expect(notices).toContain("fixture_delegate_entered");
    expect(await headCount()).toBe(0);
    expect((await db.query<{n:number}>("select count(*) n from lean_private.report_store_daily")).rows[0].n).toBe(0);
    expect((await row()).batch_token).not.toBeNull();
    expect(calls).not.toContain("lean_pipeline_throughput_close");
  });
  it("fences disabled scope, expired authority, wrong token, and direct new-object privileges",async()=>{
    await grant();await addOrder("1");
    await db.exec("update lean_private.pipeline_scope set enabled=false");
    expect((await runScheduledPipelineCatchup(options())).state).toBe("scope_changed");
    await db.exec("update lean_private.pipeline_scope set enabled=true");
    const token=randomUUID();
    const begun=(await db.query<{r:{state:string}}>("select public.lean_pipeline_throughput_begin($1,$2,$3,clock_timestamp()+interval '70 seconds') r",
      [project,shop,token])).rows[0].r;
    expect(begun.state).toBe("ready");
    await expect(db.query("select public.lean_pipeline_throughput_step($1,$2,$3,'native_request','{}')",[project,shop,randomUUID()]))
      .rejects.toThrow("authority");
    await db.exec("update lean_private.pipeline_throughput_grants set batch_deadline=clock_timestamp()-interval '1 second'");
    await expect(db.query("select public.lean_pipeline_throughput_step($1,$2,$3,'native_request','{}')",[project,shop,token]))
      .rejects.toThrow("authority");
    const acl=(await db.query(`select has_table_privilege('service_role','lean_private.pipeline_throughput_grants','SELECT,UPDATE') t,
      has_function_privilege('anon','public.lean_pipeline_throughput_begin(text,text,uuid,timestamptz)','EXECUTE') a,
      has_function_privilege('service_role','public.lean_pipeline_throughput_begin(text,text,uuid,timestamptz)','EXECUTE') s`)).rows[0];
    expect(acl).toEqual({t:false,a:false,s:true});
  });
});
