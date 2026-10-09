import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/analytics/journeyNativeFilterConfig",()=>({
  nativeEntryFilterSha256:"61504f7e32de2ff2d4197a26e25ba57f412891b9c03e6d27b3ef7568e3829819",
  nativeFilterRules:(env:NodeJS.ProcessEnv)=>env.SYNTHETIC_FILTER_VALID === "true" ?
    {hostRegex:"^synthetic_host$",negativeEmailValues:["synthetic_a","synthetic_b","synthetic_c","synthetic_d","synthetic_e"]}:null,
}));
import { SOURCE_SESSION_REPORT_PLAN as plan, sourceReportDigest as digest, sourceReportHash,
  sourceReportDay, sourceSessionWindowQuery, readSourceSessionNativeWindow, type NativeSessionWindowSnapshot } from "@/lib/analytics/sourceSessionNativeWindow";
import { prepareSourceSessionReportPacket,prepareSourceSessionReportBuild,sourceSessionReportBinding,runSourceSessionReport,
  type SourceAuthorityPopulation,type SourceSessionReportClaim } from "@/lib/analytics/sourceSessionProducer";
import { deriveEntrySessions, prepareSessionEntries } from "@/lib/analytics/sessionEntryInput";
import type { FullBuildEvidence, FullBuildPolicy } from "@/lib/analytics/fullReportBuild";
import type { JourneyRuntime } from "@/lib/analytics/journeyRuntime";

const uuid=(n:number)=>`10000000-0000-4000-8000-${String(n).padStart(12,"0")}`;
const hash="a".repeat(64),subject="b".repeat(64),config="c".repeat(32);
const date="2026-10-08",at="2026-10-09T04:00:01.000Z",bounds=sourceReportDay(date);
function signed<T extends object>(value:T):T & {digest:string} {return {...value,digest:digest(value)};}
function resign<T extends {digest:string}>(value:T):T {const {digest:old,...body}=value;void old;return {...body,digest:digest(body)} as T;}
function fixture() {
  const grant={subjectId:subject,validFrom:"2026-10-08T04:30:00.000Z",expiresAt:"2026-10-09T04:00:00.000Z",
    revokedAt:null as string|null,removed:false,permissionEvidenceRef:`explicit-browser-choice:source-session-runtime-v3:${subject}`,approvalRef:"synthetic:visitor"};
  const row={project:"353503",nativeSessionId:uuid(1),startedAt:"2026-10-08T05:00:00.000Z",endedAt:"2026-10-08T05:30:00.000Z",
    entryUuid:uuid(2),entryTimestamp:"2026-10-08T05:00:00.000Z",entryNativeSessionId:uuid(1),entryMatches:1,
    filterSha256:plan.filterSha256,filterResults:[true,true,true,true,true,true] as (boolean|null)[]};
  const receipt={nativeSessionId:row.nativeSessionId,capturedAt:"2026-10-08T05:00:02.000Z",conflicted:false,
    entryUuid:row.entryUuid,sourceStartedAt:row.startedAt,sourceReadSha256:hash,paidLinkUntil:"2026-10-17T05:00:00.000Z",
    filterSha256:plan.filterSha256,filterResults:[...row.filterResults],subjectId:subject,permissionEvidenceRef:grant.permissionEvidenceRef,
    approvalRef:grant.approvalRef,validFrom:grant.validFrom,expiresAt:grant.expiresAt,removed:false};
  const native:NativeSessionWindowSnapshot=signed({project:"353503" as const,...bounds,capturedAt:at,querySha256:hash,
    responseSha256:hash,responseBytes:1000,planVersion:plan.version,rows:[row]});
  const authority:SourceAuthorityPopulation=signed({...bounds,capturedAt:at,authorityHistoryFrom:"2026-10-07T04:00:00.000Z",
    configToken:config,grants:[grant],receipts:[receipt],serverDigest:hash});
  return {reportAuthority:{grantId:uuid(10),grantRevision:"1",claimId:uuid(11)},
    target:{mode:"entry_cohort" as "entry_cohort"|"paired_financial",projectRef:"xnfjdbpjuaezxjgargto",shop:"mullybox-store.myshopify.com",
      posthogProject:"353503",runId:"synthetic-full",baseRunId:"synthetic-base",fromDate:date,throughDate:date,asOf:at,
      definition:"synthetic-definition",mappingVersion:"synthetic-map",sessionVersion:"synthetic-native-session",funnelVersion:"synthetic-funnel"},
    financialBinding:null as {cycleId:string;salesEventSourceDigest:string;nativeSpendDigest:string;registrationScopeDigest:string}|null,
    baseBinding:{baseRunId:"synthetic-base",publicationId:"observed:synthetic-base",resultHash:"e".repeat(32),fromDate:date,throughDate:date} as
      {baseRunId:string;publicationId:string;resultHash:string;fromDate:string;throughDate:string}|null,
    sourcePolicy:{policyVersion:"source-session-runtime-v3",approvalRef:"synthetic:policy",ttlSeconds:86400,
      validUntil:"2026-10-20T04:00:00.000Z",configToken:config,webhookKeySha256:hash,sourceReadKeySha256:sourceReportHash("synthetic-key")},
    entryPolicy:{sourceNamespace:"posthog_native_session",actionNamespace:"native-v3",actionSessionVersion:"synthetic-v3",
      sessionVersion:"synthetic-native-session",filterVersion:`sha256:${plan.filterSha256}`,filterSha256:plan.filterSha256,
      filterCount:6,maxReadAgeSeconds:60,approvalRef:"synthetic:entry-policy"},
    capturedAt:at,sourcePlan:plan,entries:{native,authorityBefore:structuredClone(authority),authorityAfter:authority}};
}
function refresh(f:ReturnType<typeof fixture>) {
  f.entries.native=resign(f.entries.native);f.entries.authorityBefore=resign(f.entries.authorityBefore);f.entries.authorityAfter=resign(f.entries.authorityAfter);
  return f;
}
function context(packet:ReturnType<typeof prepareSourceSessionReportPacket>) {
  const t=packet.target;
  const policy:FullBuildPolicy={definition:t.definition,mappingVersion:t.mappingVersion,sessionVersion:t.sessionVersion,
    funnelVersion:t.funnelVersion,normalizationVersion:"synthetic",project:t.posthogProject,asOf:t.asOf,approvalRef:"synthetic:report",
    stages:{started:"lean_reserve_started"},attribution:{modelVersion:"synthetic",lookbackDays:7,approvalRef:"synthetic",allowObservedDirectFallback:false},
    behaviorMode:"excluded",cohorts:[]};
  const evidence:FullBuildEvidence={ref:"immutable:financial-evidence",identity:[],currentlyPermitted:[],removedCustomers:[],customerHistory:{},
    orderIdentities:[],checkout:[],campaigns:[],sessionCoverage:{behaviorComplete:false,completeThrough:t.asOf,graceSeconds:172800,approvalRef:"synthetic"},
    attributionCoverage:[],replacements:[],settlements:[],offers:[],proofs:[],externalControls:{},dateCoverage:[],comparisons:[],cohortCoverage:[]};
  return {binding:sourceSessionReportBinding(packet),publication:`full:${t.runId}`,shop:t.shop,fromDate:t.fromDate,throughDate:t.throughDate,
    policy,evidence,events:[]};
}
function calculate(f=fixture()) {const packet=prepareSourceSessionReportPacket(refresh(f));return {packet,...prepareSourceSessionReportBuild(packet,context(packet))};}
function runtime(f=fixture()) {
  let now=Date.parse(at);const calls:string[]=[];const {asOf,...target}=f.target;void asOf;
  const claim:SourceSessionReportClaim={reportAuthority:f.reportAuthority,target,financialBinding:f.financialBinding,baseBinding:f.baseBinding,
    sourcePolicy:f.sourcePolicy,entryPolicy:f.entryPolicy,authorityHistoryFrom:f.entries.authorityAfter.authorityHistoryFrom,sourcePlan:plan,
    startedAt:at,deadline:"2026-10-09T04:01:00.000Z",validUntil:"2026-10-09T05:00:00.000Z"};
  const envelope=()=>({columns:["native_session_id","started_at","ended_at","entry_matches","entry_uuid","filter_0","filter_1","filter_2","filter_3","filter_4","filter_5"],
    results:f.entries.native.rows.map(x=>[x.nativeSessionId,x.startedAt,x.endedAt,x.entryMatches,x.entryUuid,...x.filterResults])});
  const r:JourneyRuntime={env:{NODE_ENV:"test",LEAN_SOURCE_SESSION_REPORT_ENABLED:"true",LEAN_POSTHOG_PROJECT_ID:"353503",
    LEAN_POSTHOG_QUERY_READ_KEY:"synthetic-key",SYNTHETIC_FILTER_VALID:"true"},now:()=>now,
    request:vi.fn(async()=>{calls.push("native");return new Response(JSON.stringify(envelope()));}),
    rpc:vi.fn(async(name,args)=>{calls.push(name);
      if(name.endsWith("_claim"))return {data:claim,error:null};
      if(name.endsWith("_authority")){const {digest:authorityDigest,...data}=f.entries.authorityAfter;void authorityDigest;return {data,error:null};}
      if(name.endsWith("_register"))return {data:{registered:true,digest:(args.p_packet as {digest:string}).digest},error:null};
      throw Error("unexpected");})};
  return {r,calls,claim,envelope,setNow:(n:number)=>{now=n;}};
}
describe("bounded source-entry producer, synthetic source/authority only",()=>{
  it("counts an independently bound zero-action visit but never accepts actions/paid/campaign",()=>{
    const x=calculate();expect(x.entryAdmission.count(date)).toBe(1);expect(x.entryAdmission.accounting).toEqual({native:1,included:1,excluded:0,unknown:0});
    expect(x.events).toEqual([]);expect(x.paidAdmission).toBeNull();expect(x.evidence.ref).toBe("immutable:financial-evidence");
    const prepared=prepareSessionEntries(x.evidence.sessionEntries,{policy:x.policy.sessionEntryPolicy,project:x.policy.project,
      sessionVersion:x.policy.sessionVersion,mappingVersion:x.policy.mappingVersion,publication:"full:synthetic-full",asOf:at,
      identity:x.evidence.identity,currentlyPermitted:[],removedCustomers:[]});
    const rows=deriveEntrySessions([],prepared,{publication:"full:synthetic-full",now:at,funnelVersion:x.policy.funnelVersion,
      stages:new Map([["started","lean_reserve_started"]]),relationsComplete:false,coverage:x.evidence.sessionCoverage});
    expect(rows[0]).toMatchObject({started_at:"2026-10-08T05:00:00.000Z",behavior_complete:false,converted_session:null,funnel_flags:{started:null}});
    expect(()=>x.entryAdmission.assertFinalSessions(rows)).not.toThrow();
    expect(()=>x.entryAdmission.assertFinalSessions([])).toThrow("source_report_final_sessions");
    expect(()=>x.entryAdmission.assertFinalSessions([{...rows[0],started_at:"2026-10-08T06:00:00Z"}])).toThrow("source_report_final_sessions");
  });
  it("excludes non-opted native entries using complete no-overlap authority, not receipt membership",()=>{
    const f=fixture();for(const a of [f.entries.authorityBefore,f.entries.authorityAfter]){a.grants=[];a.receipts=[];}
    const x=calculate(f);expect(x.entryAdmission.count(date)).toBe(0);expect(x.entryAdmission.accounting.excluded).toBe(1);
  });
  it("does not turn opted-but-unbound overlap into exclusion or measured zero",()=>{
    const f=fixture();for(const a of [f.entries.authorityBefore,f.entries.authorityAfter])a.receipts=[];
    const x=calculate(f);expect(x.entryAdmission.count(date)).toBeNull();expect(x.entryAdmission.accounting.unknown).toBe(1);
  });
  it("uses full-day real epoch, never claims prior history from current zero grants",()=>{
    const f=fixture();for(const a of [f.entries.authorityBefore,f.entries.authorityAfter]){a.grants=[];a.receipts=[];a.authorityHistoryFrom="2026-10-08T04:00:00.000001Z";}
    expect(calculate(f).entryAdmission.count(date)).toBeNull();
  });
  it("counts a complete native-empty population even before the report authority epoch",()=>{
    const f=fixture();f.entries.native.rows=[];for(const a of [f.entries.authorityBefore,f.entries.authorityAfter]){a.grants=[];a.receipts=[];}
    expect(calculate(f).entryAdmission.count(date)).toBe(0);
    for(const a of [f.entries.authorityBefore,f.entries.authorityAfter])a.authorityHistoryFrom="2026-10-09T04:00:00.000Z";
    expect(calculate(f).entryAdmission.count(date)).toBe(0);
  });
  it("admits an independently exact positive before report epoch without inventing permission",()=>{
    const f=fixture();for(const a of [f.entries.authorityBefore,f.entries.authorityAfter])a.authorityHistoryFrom="2026-10-09T00:00:00.000Z";
    const x=calculate(f);expect(x.entryAdmission.count(date)).toBe(1);
    expect(x.entryAdmission.accounting).toEqual({native:1,included:1,excluded:0,unknown:0});
  });
  it("keeps any unmatched pre-epoch entry unknown beside a witnessed positive",()=>{
    const f=fixture();for(const a of [f.entries.authorityBefore,f.entries.authorityAfter])a.authorityHistoryFrom="2026-10-09T00:00:00.000Z";
    const row=f.entries.native.rows[0];f.entries.native.rows.push({...row,nativeSessionId:uuid(80),entryNativeSessionId:uuid(80),entryUuid:uuid(81)});
    const x=calculate(f);expect(x.entryAdmission.count(date)).toBeNull();
    expect(x.entryAdmission.accounting).toEqual({native:2,included:1,excluded:0,unknown:1});
  });
  it("excludes an exact removed/revoked entry and rejects changed authority completeness",()=>{
    const f=fixture();for(const a of [f.entries.authorityBefore,f.entries.authorityAfter])a.grants[0].revokedAt="2026-10-08T08:00:00.000Z";
    expect(calculate(f).entryAdmission.count(date)).toBe(0);
    f.entries.authorityBefore.grants[0].revokedAt=null;
    expect(calculate(f).entryAdmission.count(date)).toBeNull();
  });
  it.each(["missing","tie","unknown_filter","conflict","wrong_uuid","pre_allow"])("withholds %s",reason=>{
    const f=fixture();
    if(reason==="missing"){f.entries.native.rows[0].entryMatches=0;f.entries.native.rows[0].entryUuid="";}
    if(reason==="tie")f.entries.native.rows[0].entryMatches=2;
    if(reason==="unknown_filter")f.entries.native.rows[0].filterResults[0]=null;
    for(const a of [f.entries.authorityBefore,f.entries.authorityAfter]){
      if(reason==="conflict")a.receipts[0].conflicted=true;
      if(reason==="wrong_uuid")a.receipts[0].entryUuid=uuid(99);
      if(reason==="pre_allow"){a.grants[0].validFrom="2026-10-08T05:00:00.000001Z";a.receipts[0].validFrom=a.grants[0].validFrom;}
    }
    expect(calculate(f).entryAdmission.count(date)).toBeNull();
  });
  it("known false test filter excludes exactly once, without inventing identity",()=>{
    const f=fixture();f.entries.native.rows[0].filterResults[0]=false;
    for(const a of [f.entries.authorityBefore,f.entries.authorityAfter]){a.grants=[];a.receipts=[];}
    expect(calculate(f).entryAdmission.accounting).toEqual({native:1,included:0,excluded:1,unknown:0});
  });
  it.each(["scope","packet_digest","derived","binding","capture_future","duplicate_native","duplicate_grant","sentinel"])("rejects malformed %s",reason=>{
    const f=fixture();
    if(reason==="scope")f.target.posthogProject="other";
    if(reason==="capture_future")f.entries.native.capturedAt="2026-10-09T04:00:02.000Z";
    if(reason==="duplicate_native")f.entries.native.rows.push({...f.entries.native.rows[0]});
    if(reason==="duplicate_grant")f.entries.authorityAfter.grants.push({...f.entries.authorityAfter.grants[0]});
    if(reason==="sentinel")f.entries.native.rows=Array(1001).fill(f.entries.native.rows[0]);
    if(["packet_digest","derived","binding"].includes(reason)){
      let p=prepareSourceSessionReportPacket(refresh(f));const c=context(p);
      if(reason==="packet_digest")p.digest="0".repeat(64);
      if(reason==="derived"){p.derived.accounting.included=42;p=resign(p);c.binding=sourceSessionReportBinding(p);}
      if(reason==="binding")c.binding.reportAuthority={...c.binding.reportAuthority,claimId:uuid(888)};
      expect(()=>prepareSourceSessionReportBuild(p,c)).toThrow();
    }else expect(()=>calculate(f)).toThrow();
  });
  it("supports exact paired mode without copying expired cohort financial proof",()=>{
    const f=fixture();f.target.mode="paired_financial";f.baseBinding=null;
    f.financialBinding={cycleId:uuid(50),salesEventSourceDigest:hash,nativeSpendDigest:hash,registrationScopeDigest:hash};
    expect(calculate(f).entryAdmission.count(date)).toBe(1);
    f.target.mode="entry_cohort";expect(()=>calculate(f)).toThrow("source_report_base_binding");
  });
  it("accepts canonical six-digit authority clocks and text reportgrant IDs",()=>{
    const f=fixture();f.reportAuthority.grantId="synthetic-report-grant";
    for(const a of [f.entries.authorityBefore,f.entries.authorityAfter]){
      a.from=a.from.replace(".000Z",".000000Z");a.until=a.until.replace(".000Z",".000000Z");
    }
    expect(calculate(f).entryAdmission.count(date)).toBe(1);
  });
  it("rejects observed publication used as full publication or invalid base hash",()=>{
    const f=fixture(),p=prepareSourceSessionReportPacket(refresh(f)),c=context(p);
    c.publication="observed:synthetic-full";expect(()=>prepareSourceSessionReportBuild(p,c)).toThrow("source_report_consumer_scope");
    f.baseBinding!.resultHash=hash;expect(()=>calculate(f)).toThrow("source_report_base_binding");
  });
  it("handles both whole NY DST days",()=>{
    for(const [d,hours]of [["2026-03-08",23],["2026-11-01",25]] as const){const b=sourceReportDay(d);expect(Date.parse(b.until)-Date.parse(b.from)).toBe(hours*3600000);}
  });
  it("query is fixed, native column joined, six synthetic predicates only, sentinel 1001",()=>{
    const q=sourceSessionWindowQuery(date,runtime().r.env);
    expect(q).toContain("e.$session_id = s.session_id AND e.timestamp = s.$start_timestamp");
    expect(q).toContain("LIMIT 1001");expect(q).not.toContain("properties.$session_id");expect(q).not.toContain("distinct_id");
    expect(()=>sourceSessionWindowQuery("2026-10-08';SELECT 1",runtime().r.env)).toThrow();
  });
  it("executes claim, authority, native inventory, authority, register once, no grant fabrication",async()=>{
    const x=runtime();const result=await runSourceSessionReport({grantId:uuid(10),slot:1,cycleId:null},x.r);
    expect(x.calls).toEqual(["lean_source_session_report_claim","lean_source_session_report_authority","native","lean_source_session_report_authority","lean_source_session_report_register"]);
    expect(result.registered).toMatchObject({registered:true});expect(result.packet.derived.accounting.included).toBe(1);
  });
  it("pairs actual source capture with a single later financial seal before register",async()=>{
    const f=fixture();f.target.mode="paired_financial";f.baseBinding=null;
    f.financialBinding={cycleId:uuid(50),salesEventSourceDigest:hash,nativeSpendDigest:hash,registrationScopeDigest:hash};
    const x=runtime(f),scope={synthetic:"actual-scope"},spend={synthetic:"actual-spend"};
    const seal=vi.fn(async()=>{x.calls.push("seal");return {asOf:at,financialBinding:f.financialBinding,scope,spend};});
    await runSourceSessionReport({grantId:uuid(10),slot:1,cycleId:uuid(50),seal},x.r);
    expect(x.calls.slice(-2)).toEqual(["seal","lean_source_session_report_register"]);
    expect(x.r.rpc).toHaveBeenLastCalledWith("lean_source_session_report_register",expect.objectContaining({p_scope:scope,p_spend:spend}));
  });
  it("rejects slot zero and foreign claim before any native query",async()=>{
    const x=runtime();await expect(runSourceSessionReport({grantId:uuid(10),slot:0,cycleId:null},x.r)).rejects.toThrow("source_report_disabled");
    expect(x.calls).toEqual([]);x.claim.target.posthogProject="other";
    await expect(runSourceSessionReport({grantId:uuid(10),slot:1,cycleId:null},x.r)).rejects.toThrow("source_report_claim_scope");
    expect(x.r.request).not.toHaveBeenCalled();
  });
  it("default-off, unknown filter config and wrong dedicated key fail before native read",async()=>{
    const x=runtime();delete x.r.env.LEAN_SOURCE_SESSION_REPORT_ENABLED;
    await expect(runSourceSessionReport({grantId:uuid(10),slot:1,cycleId:null},x.r)).rejects.toThrow("source_report_disabled");expect(x.calls).toEqual([]);
    delete x.r.env.SYNTHETIC_FILTER_VALID;
    await expect(readSourceSessionNativeWindow(date,sourceReportHash("synthetic-key"),x.r)).rejects.toThrow("source_report_filter_config");
    await expect(readSourceSessionNativeWindow(date,hash,x.r)).rejects.toThrow("source_report_native_config");expect(x.r.request).not.toHaveBeenCalled();
  });
  it.each(["wrong_columns","async","overflow","bad_filter","bad_clock","bytes"])("rejects actual bounded native envelope %s",async reason=>{
    const x=runtime();const envelope:Record<string,unknown>=x.envelope();
    if(reason==="wrong_columns")envelope.columns=[];
    if(reason==="async")envelope.query_status={complete:false};
    if(reason==="overflow")envelope.results=Array(1001).fill(x.envelope().results[0]);
    if(reason==="bad_filter")x.envelope().results[0][5]="true";
    if(reason==="bad_filter")(envelope.results as unknown[][])[0][5]="true";
    if(reason==="bad_clock")(envelope.results as unknown[][])[0][1]="2026-10-07T00:00:00Z";
    x.r.request=vi.fn(async()=>new Response(reason==="bytes"?"x".repeat(plan.nativeBytes+1):JSON.stringify(envelope)));
    await expect(readSourceSessionNativeWindow(date,sourceReportHash("synthetic-key"),x.r)).rejects.toThrow();
  });
  it("spends failed/ambiguous claim once, does not query/register/retry",async()=>{
    const x=runtime();x.r.rpc=vi.fn(async()=>{throw Error("synthetic unavailable");});
    await expect(runSourceSessionReport({grantId:uuid(10),slot:1,cycleId:null},x.r)).rejects.toThrow();
    expect(x.r.rpc).toHaveBeenCalledTimes(1);expect(x.r.request).not.toHaveBeenCalled();
  });
  it("postchecks elapsed claim/config deadline and prevents registration",async()=>{
    const x=runtime();x.r.request=vi.fn(async()=>{x.setNow(Date.parse(at)+60001);return new Response(JSON.stringify(x.envelope()));});
    await expect(runSourceSessionReport({grantId:uuid(10),slot:1,cycleId:null},x.r)).rejects.toThrow();
    expect(x.calls).not.toContain("lean_source_session_report_register");
  });
  it("does not dispatch native HTTP when first authority exhausts a short claim",async()=>{
    const x=runtime();x.claim.deadline="2026-10-09T04:00:01.500Z";
    const original=x.r.rpc;x.r.rpc=vi.fn(async(name,args)=>{const reply=await original(name,args);
      if(name.endsWith("_authority"))x.setNow(Date.parse(at)+501);return reply;});
    await expect(runSourceSessionReport({grantId:uuid(10),slot:1,cycleId:null},x.r)).rejects.toThrow();
    expect(x.r.request).not.toHaveBeenCalled();expect(x.calls).not.toContain("lean_source_session_report_register");
  });
  it("also clamps source dispatch to the pinned source policy expiry",async()=>{
    const x=runtime();x.claim.sourcePolicy.validUntil="2026-10-09T04:00:01.500Z";
    const original=x.r.rpc;x.r.rpc=vi.fn(async(name,args)=>{const reply=await original(name,args);
      if(name.endsWith("_authority"))x.setNow(Date.parse(at)+501);return reply;});
    await expect(runSourceSessionReport({grantId:uuid(10),slot:1,cycleId:null},x.r)).rejects.toThrow();
    expect(x.r.request).not.toHaveBeenCalled();
  });
  it("does not dispatch native HTTP after total source budget or a flag change",async()=>{
    for(const reason of ["elapsed","flag"]){
      const x=runtime(),original=x.r.rpc;x.r.rpc=vi.fn(async(name,args)=>{const reply=await original(name,args);
        if(name.endsWith("_authority")){if(reason==="elapsed")x.setNow(Date.parse(at)+plan.totalMs);else x.r.env.LEAN_SOURCE_SESSION_REPORT_ENABLED="false";}
        return reply;});
      await expect(runSourceSessionReport({grantId:uuid(10),slot:1,cycleId:null},x.r)).rejects.toThrow();
      expect(x.r.request).not.toHaveBeenCalled();
    }
  });
});
