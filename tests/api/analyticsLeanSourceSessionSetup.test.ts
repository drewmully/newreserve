import { PGlite } from "@electric-sql/pglite";
import { readFileSync } from "node:fs";
import { createHash,randomUUID } from "node:crypto";
import { afterAll,afterEach,beforeAll,beforeEach,expect,it,vi } from "vitest";
import { NextRequest } from "next/server";
import type { JourneyRuntime } from "@/lib/analytics/journeyRuntime";
const ports=vi.hoisted(()=>({rules:vi.fn()}));
vi.mock("@/lib/analytics/journeyNativeFilterConfig",async original=>({
  ...await original<typeof import("@/lib/analytics/journeyNativeFilterConfig")>(),nativeFilterRules:()=>ports.rules(),
}));
vi.mock("@/lib/rateLimit",()=>({checkRateLimit:()=>({allowed:true})}));
import { runSourceSessionSetup } from "@/lib/analytics/journeySourceSessionSetup";
import { readNativeSessionForBinding } from "@/lib/analytics/journeyNativeSessionRead";
import { nativeEntryFilterSha256 } from "@/lib/analytics/journeyNativeFilterConfig";
import { reserveRuntime as target } from "@/lib/analytics/journeyPolicyRuntime";
import { POST } from "@/app/api/analytics/source-session/setup-check/route";
const native="10000000-0000-4000-8000-000000000001",entry="20000000-0000-4000-8000-000000000001";
const bearer="f".repeat(64),key="synthetic-source-key",sha=(v:string)=>createHash("sha256").update(v).digest("hex");
let db:PGlite;
const rpc:JourneyRuntime["rpc"]=async(name,args)=>{
  if(!["lean_source_session_setup_begin","lean_source_session_setup_finish","lean_source_session_setup_copy"].includes(name))throw Error("unexpected_nonsetup_rpc");
  const pairs=Object.entries(args);
  try{await db.exec("set role service_role");
    const result=await db.query<{value:unknown}>(`select public.${name}(${pairs.map(([k],i)=>`${k}=>$${i+1}`).join(",")}) value`,pairs.map(([,v])=>v));
    return {data:JSON.parse(JSON.stringify(result.rows[0].value)),error:null};
  }catch(error){return {data:null,error};}finally{await db.exec("reset role");}
};
function runtime(claim:string):JourneyRuntime{return {env:{NODE_ENV:"test",VERCEL_ENV:"production",VERCEL_GIT_COMMIT_REF:"main",
  LEAN_ANALYTICS_PIPELINE_PROJECT_REF:target.project,LEAN_ANALYTICS_SUPABASE_URL:`https://${target.project}.supabase.co`,
  LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY:"synthetic-db-key",LEAN_SOURCE_SESSION_SETUP_ENABLED:"true",
  LEAN_SOURCE_SESSION_SETUP_CLAIM_ID:claim,POSTHOG_PROJECT_ID:target.posthog,POSTHOG_PERSONAL_API_KEY:key},
  now:Date.now,rpc,request:vi.fn(async()=>Response.json({columns:["native_session_id","started_at","ended_at","entry_matches","entry_uuid","filter_0","filter_1","filter_2","filter_3","filter_4","filter_5"],
    results:[[native,"2026-10-01T04:00:02.000001Z","2026-10-01T04:01:00Z",1,entry,1,1,1,1,1,1]]}))};}
const req=(token=bearer)=>new Request(`${target.origin}/api/analytics/source-session/setup-check`,{headers:{authorization:`Bearer ${token}`}});
async function claim(seconds=300){const id=randomUUID();await db.query(`insert into lean_private.source_session_setup_claims
  (claim_id,auth_sha256,project_ref,posthog_project,native_session_id,source_from,source_until,filter_sha256,expires_at)
  values($1,$2,$3,$4,$5,'2026-10-01T04:00:00Z','2026-10-02T04:00:00Z',$6,clock_timestamp()+$7*interval '1 second')`,
  [id,sha(bearer),target.project,target.posthog,native,nativeEntryFilterSha256,seconds]);return id;}
const count=async(table:string)=>(await db.query<{n:number}>(`select count(*)::int n from lean_private.source_session_setup_${table}`)).rows[0].n;
beforeAll(async()=>{db=new PGlite();await db.exec("create schema lean_private;create role anon;create role authenticated;create role service_role;create role lean_posthog_reader;");
  await db.exec(readFileSync("sql/analytics/proposed_source_session_setup.sql","utf8"));},30000);
beforeEach(async()=>{await db.exec("truncate lean_private.source_session_setup_claims cascade");
  ports.rules.mockReturnValue({hostRegex:"^(localhost|127\\.0\\.0\\.1)($|:)",negativeEmailValues:["synthetic_a","synthetic_b","synthetic_c","synthetic_d","synthetic_e"]});});
afterEach(()=>vi.unstubAllEnvs());afterAll(async()=>db.close());
it("installs no authority and exposes no direct public table/function access",async()=>{
  expect(await count("claims")).toBe(0);
  const result=await db.query(`select has_function_privilege('anon','public.lean_source_session_setup_begin(uuid,text,uuid)','EXECUTE') allowed,
    to_regclass('lean_private.journey_grants') is null no_visitor_table`);
  expect(result.rows[0]).toEqual({allowed:false,no_visitor_table:true});
});
it("uses one actual-envelope projection then verifies dedicated copy metadata without another provider read",async()=>{
  const r=runtime(await claim());
  const source=await runSourceSessionSetup(req(),"source",r);
  expect(source).toMatchObject({state:"verified",phase:"source",project:target.posthog,keySha256:sha(key)});
  expect(await count("attempts")).toBe(1);expect(await count("proofs")).toBe(1);
  r.env.LEAN_POSTHOG_QUERY_READ_KEY=key;r.env.LEAN_POSTHOG_PROJECT_ID=target.posthog;
  const copied=await runSourceSessionSetup(req(),"copy",r);
  expect(copied).toMatchObject({state:"verified",phase:"copy",keySha256:sha(key)});
  expect(r.request).toHaveBeenCalledTimes(1);
  expect(await runSourceSessionSetup(req(),"source",r)).toEqual({state:"unavailable",phase:"source"});
  expect(await runSourceSessionSetup(req(),"copy",r)).toEqual({state:"unavailable",phase:"copy"});
  expect(r.request).toHaveBeenCalledTimes(1);
  for(const sensitive of [native,entry,bearer,key,r.env.LEAN_SOURCE_SESSION_SETUP_CLAIM_ID!])
    expect(JSON.stringify([source,copied])).not.toContain(sensitive);
  expect(copied).not.toHaveProperty("expiresAt");
});
it.each(["off","auth","claim","foreign"])("refuses %s without a source attempt",async failure=>{
  const r=runtime(await claim());let request=req();
  if(failure==="off")r.env.LEAN_SOURCE_SESSION_SETUP_ENABLED="false";
  if(failure==="auth")request=req("a".repeat(64));
  if(failure==="claim")r.env.LEAN_SOURCE_SESSION_SETUP_CLAIM_ID=randomUUID();
  if(failure==="foreign")request=new Request("https://foreign.invalid/api",{headers:{authorization:`Bearer ${bearer}`}});
  expect((await runSourceSessionSetup(request,"source",r)).state).toBe("unavailable");
  expect(r.request).not.toHaveBeenCalled();expect(await count("attempts")).toBe(0);
});
it.each(["transport","raw-shape","filter","generic-project","generic-key","config"])("consumes failed %s source attempt without retrying the provider",async failure=>{
  const r=runtime(await claim()),old=r.request;
  if(failure==="transport")r.request=vi.fn(async()=>{throw Error("private-response-must-not-escape");});
  if(failure==="raw-shape")r.request=vi.fn(async()=>Response.json({columns:["wrong"],results:[]}));
  if(failure==="filter")r.request=vi.fn(async()=>{const response=await old("unused");const x=await response.json();x.results[0][5]=null;return Response.json(x);});
  if(failure==="generic-project")r.env.POSTHOG_PROJECT_ID="other";
  if(failure==="generic-key")delete r.env.POSTHOG_PERSONAL_API_KEY;
  if(failure==="config")ports.rules.mockReturnValue(null);
  expect((await runSourceSessionSetup(req(),"source",r)).state).toBe("unavailable");
  const calls=vi.mocked(r.request).mock.calls.length;
  expect(await count("attempts")).toBe(1);expect(await count("proofs")).toBe(0);
  expect((await runSourceSessionSetup(req(),"source",r)).state).toBe("unavailable");
  expect(r.request).toHaveBeenCalledTimes(calls);
});
it.each(["key","project","config","claim","revoke","deadline"])("postchecks %s after provider I/O",async failure=>{
  const id=await claim(),r=runtime(id),old=r.request;
  r.request=vi.fn(async()=>{const response=await old("unused");
    if(failure==="key")r.env.POSTHOG_PERSONAL_API_KEY="changed";
    if(failure==="project")r.env.POSTHOG_PROJECT_ID="other";
    if(failure==="config")ports.rules.mockReturnValue(null);
    if(failure==="claim")r.env.LEAN_SOURCE_SESSION_SETUP_CLAIM_ID=randomUUID();
    if(failure==="revoke")await db.query("update lean_private.source_session_setup_claims set revoked_at=clock_timestamp() where claim_id=$1",[id]);
    if(failure==="deadline")r.now=()=>Date.now()+3600000;
    return response;});
  expect((await runSourceSessionSetup(req(),"source",r)).state).toBe("unavailable");
  expect(await count("attempts")).toBe(1);expect(await count("proofs")).toBe(0);
});
it("cannot extend owner pins or clear consumed evidence",async()=>{
  const id=await claim(),r=runtime(id);await runSourceSessionSetup(req(),"source",r);
  await expect(db.query("update lean_private.source_session_setup_claims set expires_at=expires_at+interval '1 second' where claim_id=$1",[id])).rejects.toThrow();
  await expect(db.exec("delete from lean_private.source_session_setup_attempts")).rejects.toThrow();
});
it("requires prior source proof and consumes a wrong dedicated-copy comparison without provider access",async()=>{
  const r=runtime(await claim());
  expect((await runSourceSessionSetup(req(),"copy",r)).state).toBe("unavailable");expect(await count("copies")).toBe(0);
  await runSourceSessionSetup(req(),"source",r);r.env.LEAN_POSTHOG_QUERY_READ_KEY="different";r.env.LEAN_POSTHOG_PROJECT_ID=target.posthog;
  expect((await runSourceSessionSetup(req(),"copy",r)).state).toBe("unavailable");expect(await count("copies")).toBe(1);
  r.env.LEAN_POSTHOG_QUERY_READ_KEY=key;
  expect((await runSourceSessionSetup(req(),"copy",r)).state).toBe("unavailable");expect(r.request).toHaveBeenCalledTimes(1);
});
it.each(["key","config","deadline"])("postchecks %s after copy RPC and does not claim ongoing env authority",async failure=>{
  const r=runtime(await claim());await runSourceSessionSetup(req(),"source",r);
  r.env.LEAN_POSTHOG_QUERY_READ_KEY=key;r.env.LEAN_POSTHOG_PROJECT_ID=target.posthog;
  r.rpc=async(name,args)=>{const out=await rpc(name,args);if(name.endsWith("_copy")){
    if(failure==="key")r.env.LEAN_POSTHOG_QUERY_READ_KEY="changed";
    if(failure==="config")ports.rules.mockReturnValue(null);
    if(failure==="deadline")r.now=()=>Date.now()+3600000;
  }return out;};
  expect((await runSourceSessionSetup(req(),"copy",r)).state).toBe("unavailable");expect(r.request).toHaveBeenCalledTimes(1);
});
it("does not reflect extra provider or database fields in setup output",async()=>{
  const r=runtime(await claim());
  r.rpc=async(name,args)=>{const out=await rpc(name,args);if(name.endsWith("_finish") && out.data)
    out.data={...out.data as object,privateValue:"synthetic-secret-must-not-escape"};return out;};
  expect(await runSourceSessionSetup(req(),"source",r)).toEqual({state:"unavailable",phase:"source"});
});
it("keeps generic setup candidate out of the visitor wrapper",async()=>{
  const r=runtime(await claim());
  const result=await readNativeSessionForBinding(native,{validFrom:"2026-10-01T04:00:00Z",expiresAt:"2026-10-02T04:00:00Z"} as Parameters<typeof readNativeSessionForBinding>[1],r);
  expect(result).toBeNull();expect(r.request).not.toHaveBeenCalled();
});
it("route stays default-off and rejects caller identifiers, SQL, query args and oversized payloads",async()=>{
  const make=(body:string,query="")=>new NextRequest(`${target.origin}/api/analytics/source-session/setup-check${query}`,{method:"POST",body});
  vi.stubEnv("LEAN_SOURCE_SESSION_SETUP_ENABLED",undefined);
  expect((await POST(make('{"phase":"source"}'))).status).toBe(404);
  vi.stubEnv("LEAN_SOURCE_SESSION_SETUP_ENABLED","true");
  for(const body of ['{"phase":"source","nativeId":"x"}','{"phase":"source","sql":"select 1"}','{"phase":"other"}'])
    expect((await POST(make(body))).status).toBe(400);
  expect((await POST(make('{"phase":"source"}',"?id=x"))).status).toBe(400);
  expect((await POST(make("x".repeat(65)))).status).toBe(413);
});
