import { nativeEntryFilterSha256 } from "./journeyNativeFilterConfig";
import { nativeSourceSessionId, sourceSessionVersion } from "./journeySourceSessionContract";
import { admitSourceSessionReceipt, type SourceSessionReceipt } from "./journeySourceSessionEvidence";
import type { SourceSessionPolicy } from "./journeySourceSessionRuntime";
import type { JourneyRuntime } from "./journeyRuntime";
import { prepareSessionEntries, type SessionEntryPolicy, type SourceSessionEntryInput } from "./sessionEntryInput";
import type { IdentityEvidence } from "./identity";
import type { FullBuildEvidence, FullBuildPolicy } from "./fullReportBuild";
import type { ObservedEvent } from "./sessions";
import { key, nyDate, type Row } from "./primitives";
import { SOURCE_SESSION_REPORT_PLAN, readSourceSessionNativeWindow, validateNativeSessionWindow,
  sourceReportCanonical, sourceReportDigest, sourceReportInstant as instant, sourceReportDay,
  type NativeSessionWindowSnapshot } from "./sourceSessionNativeWindow";
export { SOURCE_SESSION_REPORT_PLAN } from "./sourceSessionNativeWindow";

export type SourceReportAuthority = { grantId: string; grantRevision: string; claimId: string };
export type SourceReportTarget = { mode: "paired_financial" | "entry_cohort";
  projectRef: string; shop: string; posthogProject: string; runId: string; baseRunId: string;
  fromDate: string; throughDate: string; asOf: string; definition: string; mappingVersion: string;
  sessionVersion: string; funnelVersion: string };
export type SourceFinancialBinding = { cycleId: string; salesEventSourceDigest: string;
  nativeSpendDigest: string; registrationScopeDigest: string };
export type SourceBaseBinding = { baseRunId: string; publicationId: string; resultHash: string;
  fromDate: string; throughDate: string };
export type SourceAuthorityGrant = { subjectId: string; validFrom: string; expiresAt: string;
  revokedAt: string | null; removed: boolean; permissionEvidenceRef: string; approvalRef: string };
export type SourceAuthorityPopulation = { from: string; until: string; capturedAt: string;
  authorityHistoryFrom: string; configToken: string; grants: SourceAuthorityGrant[];
  receipts: SourceSessionReceipt[]; serverDigest: string; digest: string };
export type SourceEntryAccounting = { native: number; included: number; excluded: number; unknown: number };
export type SourceSessionReportInputV1 = {
  version: 1; kind: "source-session-report-v1"; digest: string;
  reportAuthority: SourceReportAuthority; target: SourceReportTarget;
  financialBinding: SourceFinancialBinding | null; baseBinding: SourceBaseBinding | null;
  sourcePolicy: SourceSessionPolicy; entryPolicy: SessionEntryPolicy; capturedAt: string;
  sourcePlan: typeof SOURCE_SESSION_REPORT_PLAN;
  entries: { native: NativeSessionWindowSnapshot; authorityBefore: SourceAuthorityPopulation;
    authorityAfter: SourceAuthorityPopulation };
  actions: { state: "unavailable"; reason: "no_admitted_action_namespace" };
  paid: { state: "unavailable"; reason: "no_independent_paid_population" };
  derived: { sessionEntries: SourceSessionEntryInput; identity: IdentityEvidence[]; accounting: SourceEntryAccounting };
};
export type SourceSessionReportBinding = { version: 1; digest: string; mode: SourceReportTarget["mode"];
  projectRef: string; shop: string; posthogProject: string; runId: string; baseRunId: string;
  fromDate: string; throughDate: string; asOf: string; sourceConfigToken: string;
  reportAuthority: SourceReportAuthority; financialBinding: SourceFinancialBinding | null;
  baseBinding: SourceBaseBinding | null };
export type SourceEntryAdmission = { dates: string[]; ref: string; digest: string;
  accounting: SourceEntryAccounting; count(date: string): number | null; assertFinalSessions(rows: Row[]): void };
export type SourceSessionReportClaim = { reportAuthority: SourceReportAuthority;
  target: Omit<SourceReportTarget,"asOf">; financialBinding: SourceFinancialBinding | null;
  baseBinding: SourceBaseBinding | null; sourcePolicy: SourceSessionPolicy; entryPolicy: SessionEntryPolicy;
  authorityHistoryFrom: string; sourcePlan: typeof SOURCE_SESSION_REPORT_PLAN;
  startedAt: string; deadline: string; validUntil: string };
const hex = (v: unknown): v is string => typeof v === "string" && /^[a-f0-9]{64}$/.test(v);
const text = (v: unknown): v is string => typeof v === "string" && v.trim() === v && v.length > 0 && v.length <= 512;
const equal = (a: unknown,b: unknown) => sourceReportCanonical(a) === sourceReportCanonical(b);
const prefix = `explicit-browser-choice:${sourceSessionVersion}:`;
const noActions = { state: "unavailable", reason: "no_admitted_action_namespace" } as const;
const noPaid = { state: "unavailable", reason: "no_independent_paid_population" } as const;
function validAuthority(a: SourceReportAuthority) {
  if (!a || !text(a.grantId) || a.grantId.length > 128 || !nativeSourceSessionId.test(a.claimId) ||
    !/^[1-9]\d{0,18}$/.test(a.grantRevision)) throw new Error("source_report_claim_shape");
}
function validateTarget(t: SourceReportTarget, f: SourceFinancialBinding | null, b: SourceBaseBinding | null) {
  if (!t || t.projectRef !== "xnfjdbpjuaezxjgargto" || t.shop !== "mullybox-store.myshopify.com" ||
    t.posthogProject !== "353503" || t.fromDate !== t.throughDate ||
    ![t.runId,t.baseRunId,t.definition,t.mappingVersion,t.sessionVersion,t.funnelVersion].every(text))
    throw new Error("source_report_target");
  const { until } = sourceReportDay(t.fromDate);
  if (instant(t.asOf) < instant(until)) throw new Error("source_report_open_day");
  if (t.mode === "paired_financial") {
    if (b !== null || !f || !nativeSourceSessionId.test(f.cycleId) ||
      ![f.salesEventSourceDigest,f.nativeSpendDigest,f.registrationScopeDigest].every(hex))
      throw new Error("source_report_financial_binding");
  } else if (t.mode === "entry_cohort") {
    if (f !== null || !b || b.baseRunId !== t.baseRunId || b.publicationId !== `observed:${t.baseRunId}` ||
      !/^[a-f0-9]{32}$/.test(b.resultHash) || b.fromDate !== t.fromDate || b.throughDate !== t.throughDate)
      throw new Error("source_report_base_binding");
  } else throw new Error("source_report_mode");
}
function validatePolicy(p: SourceSessionPolicy, e: SessionEntryPolicy, t: SourceReportTarget) {
  if (!p || p.policyVersion !== sourceSessionVersion || !text(p.approvalRef) || !/^[a-f0-9]{32}$/.test(p.configToken) ||
    !hex(p.sourceReadKeySha256) || !hex(p.webhookKeySha256) || !Number.isSafeInteger(p.ttlSeconds) ||
    p.ttlSeconds < 60 || p.ttlSeconds > 86400 || instant(p.validUntil) <= instant(t.asOf) ||
    !e || e.sessionVersion !== t.sessionVersion || e.filterSha256 !== nativeEntryFilterSha256 || e.filterCount !== 6 ||
    ![e.sourceNamespace,e.actionNamespace,e.actionSessionVersion,e.filterVersion,e.approvalRef].every(text) ||
    !Number.isSafeInteger(e.maxReadAgeSeconds) || e.maxReadAgeSeconds < 1 || e.maxReadAgeSeconds > 3600)
    throw new Error("source_report_policy");
}
function validatePopulation(a: SourceAuthorityPopulation, t: SourceReportTarget, p: SourceSessionPolicy) {
  const { digest, ...body } = a, bounds = sourceReportDay(t.fromDate);
  if (digest !== sourceReportDigest(body) || !hex(a.serverDigest) || instant(a.from) !== instant(bounds.from) || instant(a.until) !== instant(bounds.until) ||
    a.configToken !== p.configToken || !Array.isArray(a.grants) || a.grants.length > SOURCE_SESSION_REPORT_PLAN.maxGrantRows ||
    !Array.isArray(a.receipts) || a.receipts.length > SOURCE_SESSION_REPORT_PLAN.maxReceiptRows ||
    Buffer.byteLength(JSON.stringify(a)) > SOURCE_SESSION_REPORT_PLAN.authorityBytes ||
    instant(a.capturedAt) < instant(a.until) || instant(a.capturedAt) > instant(t.asOf) ||
    instant(a.authorityHistoryFrom) > instant(a.capturedAt)) throw new Error("source_report_authority_scope");
  const subjects = new Set<string>(), natives = new Set<string>();
  for (const g of a.grants) {
    if (!hex(g.subjectId) || subjects.has(g.subjectId) || g.permissionEvidenceRef !== prefix+g.subjectId ||
      !text(g.approvalRef) || typeof g.removed !== "boolean" ||
      instant(g.expiresAt) <= instant(g.validFrom) || Date.parse(g.expiresAt)-Date.parse(g.validFrom)>86400000 ||
      instant(g.validFrom) >= instant(a.until) || instant(g.expiresAt) <= instant(a.from) ||
      (g.revokedAt !== null && (instant(g.revokedAt) < instant(g.validFrom) || instant(g.revokedAt) > instant(a.capturedAt))))
      throw new Error("source_report_grant_shape");
    subjects.add(g.subjectId);
  }
  for (const r of a.receipts) {
    if (!nativeSourceSessionId.test(r.nativeSessionId) || natives.has(r.nativeSessionId) ||
      !nativeSourceSessionId.test(r.entryUuid) || !hex(r.subjectId) || !hex(r.sourceReadSha256) ||
      !text(r.approvalRef) || typeof r.removed !== "boolean" || typeof r.conflicted !== "boolean" ||
      r.permissionEvidenceRef !== prefix+r.subjectId || r.filterSha256 !== nativeEntryFilterSha256 ||
      !Array.isArray(r.filterResults) || r.filterResults.length !== 6 || r.filterResults.some(v=>v !== null && typeof v !== "boolean") ||
      instant(r.sourceStartedAt) < instant(a.from) || instant(r.sourceStartedAt) >= instant(a.until) ||
      instant(r.capturedAt) > instant(a.capturedAt)) throw new Error("source_report_receipt_shape");
    for (const at of [r.validFrom,r.expiresAt,r.paidLinkUntil]) nyDate(at);
    const g = a.grants.find(g=>g.subjectId === r.subjectId);
    if (!g || g.permissionEvidenceRef !== r.permissionEvidenceRef || g.approvalRef !== r.approvalRef ||
      instant(g.validFrom) !== instant(r.validFrom) || instant(g.expiresAt) !== instant(r.expiresAt))
      throw new Error("source_report_receipt_grant");
    natives.add(r.nativeSessionId);
  }
}
type PacketSeed = Omit<SourceSessionReportInputV1,"version"|"kind"|"digest"|"derived"|"actions"|"paid">;
function derive(seed: PacketSeed): SourceSessionReportInputV1["derived"] {
  const t = seed.target, { native: n, authorityBefore: before, authorityAfter: after } = seed.entries;
  validateTarget(t,seed.financialBinding,seed.baseBinding); validAuthority(seed.reportAuthority);
  validatePolicy(seed.sourcePolicy,seed.entryPolicy,t);
  if (!equal(seed.sourcePlan,SOURCE_SESSION_REPORT_PLAN)) throw new Error("source_report_plan");
  validateNativeSessionWindow(n,t.fromDate,t.asOf);
  validatePopulation(before,t,seed.sourcePolicy); validatePopulation(after,t,seed.sourcePolicy);
  if (instant(before.capturedAt) > instant(n.capturedAt) || instant(n.capturedAt) > instant(after.capturedAt) ||
    seed.capturedAt !== after.capturedAt || instant(after.capturedAt) > instant(t.asOf) ||
    Date.parse(t.asOf)-Date.parse(before.capturedAt)>seed.entryPolicy.maxReadAgeSeconds*1000 ||
    Date.parse(after.capturedAt)-Date.parse(before.capturedAt)>SOURCE_SESSION_REPORT_PLAN.totalMs)
    throw new Error("source_report_capture_order");
  const stable = before.serverDigest === after.serverDigest && before.authorityHistoryFrom === after.authorityHistoryFrom &&
    equal(before.grants,after.grants) && equal(before.receipts,after.receipts);
  const epochKnown = instant(after.authorityHistoryFrom) <= instant(n.from);
  const accounting: SourceEntryAccounting = {native:n.rows.length,included:0,excluded:0,unknown:0};
  const entries: SourceSessionEntryInput["entries"] = [], relations: SourceSessionEntryInput["relations"] = [];
  const identities = new Map<string,IdentityEvidence>();
  const authorityRef = `source-authority:${after.serverDigest}`, nativeRef = `native-window:${n.responseSha256}`;
  for (const row of n.rows) {
    if (row.entryMatches !== 1) { accounting.unknown++; continue; }
    if (row.filterResults.includes(false)) { accounting.excluded++; continue; }
    if (!stable || row.filterResults.includes(null)) { accounting.unknown++; continue; }
    const receipt = after.receipts.find(r=>r.nativeSessionId === row.nativeSessionId);
    if (receipt) {
      const g = after.grants.find(g=>g.subjectId === receipt.subjectId)!;
      // A removal excludes only an independently matched entry, never a guess
      // from another visitor's removed grant.
      const exact = receipt.entryUuid === row.entryUuid && instant(receipt.sourceStartedAt) === instant(row.startedAt);
      if (exact && !receipt.conflicted && (receipt.removed || g.removed || g.revokedAt !== null)) { accounting.excluded++; continue; }
      const admitted = admitSourceSessionReceipt(receipt,row,{project:t.posthogProject,mappingVersion:t.mappingVersion,
        actionNamespace:seed.entryPolicy.actionNamespace,nativeReadRef:nativeRef,authorityReadRef:authorityRef,
        capturedAt:after.capturedAt,asOf:t.asOf,maxReadAgeSeconds:seed.entryPolicy.maxReadAgeSeconds});
      if (admitted.state === "eligible" && !g.removed && g.revokedAt === null) {
        entries.push(admitted.entry); relations.push(admitted.relation);
        identities.set(sourceReportDigest(admitted.permission),admitted.permission); accounting.included++; continue;
      }
      accounting.unknown++; continue;
    }
    const possible = after.grants.some(g=>!g.removed && g.revokedAt === null &&
      instant(g.validFrom) <= instant(row.startedAt) && instant(row.startedAt) < instant(g.expiresAt));
    if (epochKnown && !possible) accounting.excluded++; else accounting.unknown++;
  }
  const input: SourceSessionEntryInput = {project:t.posthogProject,sourceNamespace:seed.entryPolicy.sourceNamespace,
    sessionVersion:t.sessionVersion,from:n.from,until:n.until,capturedAt:after.capturedAt,
    complete:stable && accounting.unknown === 0,sourceRef:nativeRef,permissionSnapshotRef:authorityRef,
    filterVersion:seed.entryPolicy.filterVersion,filterSha256:nativeEntryFilterSha256,
    filterEvaluationRef:`entry-filters:${n.responseSha256}`,entries,relations};
  return {sessionEntries:input,identity:[...identities.values()],accounting};
}
export function prepareSourceSessionReportPacket(seed: PacketSeed): SourceSessionReportInputV1 {
  const body = {...seed,version:1 as const,kind:"source-session-report-v1" as const,actions:noActions,paid:noPaid,derived:derive(seed)};
  if (Buffer.byteLength(JSON.stringify(body))>SOURCE_SESSION_REPORT_PLAN.packetBytes) throw new Error("source_report_packet_budget");
  return {...body,digest:sourceReportDigest(body)};
}
export function sourceSessionReportBinding(packet: SourceSessionReportInputV1): SourceSessionReportBinding {
  const {target:t} = packet;
  return {version:1,digest:packet.digest,mode:t.mode,projectRef:t.projectRef,shop:t.shop,posthogProject:t.posthogProject,
    runId:t.runId,baseRunId:t.baseRunId,fromDate:t.fromDate,throughDate:t.throughDate,asOf:t.asOf,
    sourceConfigToken:packet.sourcePolicy.configToken,reportAuthority:packet.reportAuthority,
    financialBinding:packet.financialBinding,baseBinding:packet.baseBinding};
}
export function prepareSourceSessionReportBuild(packet: SourceSessionReportInputV1, context: {
  binding: SourceSessionReportBinding; publication: string; shop: string; fromDate: string; throughDate: string;
  policy: FullBuildPolicy; evidence: FullBuildEvidence; events: ObservedEvent[];
}): {policy:FullBuildPolicy & {sessionEntryPolicy:SessionEntryPolicy};
  evidence:FullBuildEvidence & {sessionEntries:SourceSessionEntryInput}; events:ObservedEvent[];
  entryAdmission:SourceEntryAdmission; paidAdmission:null} {
  if (!packet || packet.version !== 1 || packet.kind !== "source-session-report-v1" ||
    Buffer.byteLength(JSON.stringify(packet))>SOURCE_SESSION_REPORT_PLAN.packetBytes) throw new Error("source_report_packet_shape");
  const {digest,derived,actions,paid,version,kind,...seed} = packet;
  if (digest !== sourceReportDigest({...seed,derived,actions,paid,version,kind}) ||
    !equal(actions,noActions) || !equal(paid,noPaid) || !equal(context.binding,sourceSessionReportBinding(packet)))
    throw new Error("source_report_packet_binding");
  const actual = derive(seed), t = packet.target, p = context.policy, e = context.evidence;
  if (!equal(actual,derived) || context.publication !== `full:${t.runId}` || context.shop !== t.shop ||
    context.fromDate !== t.fromDate || context.throughDate !== t.throughDate || p.project !== t.posthogProject ||
    instant(p.asOf) !== instant(t.asOf) || ["definition","mappingVersion","sessionVersion","funnelVersion"].some(k=>
      p[k as keyof FullBuildPolicy] !== t[k as keyof SourceReportTarget]) ||
    context.events.length || e.identity.some(i=>i.namespace === "lean_subject") || e.checkout.length || e.campaigns.length ||
    Object.hasOwn(p,"sessionEntryPolicy") || Object.hasOwn(e,"sessionEntries")) throw new Error("source_report_consumer_scope");
  const prepared = prepareSessionEntries(actual.sessionEntries,{policy:packet.entryPolicy,project:t.posthogProject,
    sessionVersion:t.sessionVersion,mappingVersion:t.mappingVersion,publication:context.publication,asOf:t.asOf,
    identity:actual.identity,currentlyPermitted:[],removedCustomers:[]});
  if (prepared.entries.size !== actual.accounting.included) throw new Error("source_report_correspondence");
  const expected = new Map([...prepared.entries.values()].map(entry=>[key(t.posthogProject,t.sessionVersion,entry.sourceSessionId),entry]));
  const keys = new Set(expected.keys());
  const entryAdmission: SourceEntryAdmission = { dates:[t.fromDate],ref:`source-session-report:${digest}`,digest,
    accounting:actual.accounting,count:date=>date === t.fromDate && prepared.ready ? keys.size : null,
    assertFinalSessions(rows) {
      if (rows.length !== keys.size || new Set(rows.map(r=>r.session_key)).size !== keys.size || rows.some(r=>
        typeof r.session_key !== "string" || !keys.has(r.session_key) || r.publication_id !== context.publication ||
        r.sessionization_version !== t.sessionVersion || r.source_session_id !== expected.get(String(r.session_key))?.sourceSessionId ||
        r.started_at !== expected.get(String(r.session_key))?.startedAt || r.ended_at !== expected.get(String(r.session_key))?.endedAt ||
        r.report_date !== t.fromDate || r.customer_id !== null || r.analytics_eligible !== true))
        throw new Error("source_report_final_sessions");
    } };
  return {policy:{...p,behaviorMode:"required",sessionEntryPolicy:packet.entryPolicy},
    evidence:{...e,identity:[...e.identity,...actual.identity],sessionEntries:actual.sessionEntries,
      sessionCoverage:{...e.sessionCoverage,behaviorComplete:false},
      campaigns:[],checkout:[]},events:[],entryAdmission,paidAdmission:null};
}

async function rpc(r:JourneyRuntime,name:string,args:Record<string,unknown>,bytes:number,deadlineMs=Infinity) {
  const started=r.now();
  const remaining=Math.min(SOURCE_SESSION_REPORT_PLAN.requestMs,Math.floor(deadlineMs-started));
  if(!Number.isSafeInteger(remaining)||remaining<1)throw new Error("source_report_rpc_unavailable");
  let timer:ReturnType<typeof setTimeout>|undefined;
  try {
    const result=await Promise.race([r.rpc(name,args),new Promise<never>((_,reject)=>{
      timer=setTimeout(()=>reject(new Error("source_report_rpc_timeout")),remaining);})]);
    if (result.error || result.data === null || Buffer.byteLength(JSON.stringify(result.data))>bytes ||
      r.now()-started>=remaining) throw new Error("source_report_rpc_unavailable");
    return result.data;
  } catch { throw new Error("source_report_rpc_unavailable"); }
  finally {if(timer)clearTimeout(timer);}
}
/** Real finite caller. SQL consumes claim attempts; no application retry. A
 * paired caller seals its existing financial scope only after these reads. */
export async function runSourceSessionReport(input:{grantId:string;slot:number;cycleId:string|null;
  seal?: (claim:SourceSessionReportClaim,capturedAt:string)=>Promise<{asOf:string;
    financialBinding:SourceFinancialBinding|null;scope:unknown;spend:unknown}>},r?:JourneyRuntime) {
  r ??= (await import("./journeyRuntime")).journeyDefaults();
  if (typeof window !== "undefined" || r.env.LEAN_SOURCE_SESSION_REPORT_ENABLED !== "true" ||
    !text(input.grantId) || input.grantId.length>128 || !Number.isSafeInteger(input.slot) || input.slot<1 || input.slot>1000 ||
    input.cycleId !== null && !nativeSourceSessionId.test(input.cycleId)) throw new Error("source_report_disabled");
  const claim=await rpc(r,"lean_source_session_report_claim",{p_grant:input.grantId,p_slot:input.slot,p_cycle:input.cycleId},65536) as SourceSessionReportClaim;
  validAuthority(claim.reportAuthority);
  if(claim.reportAuthority.grantId!==input.grantId || !equal(claim.sourcePlan,SOURCE_SESSION_REPORT_PLAN) ||
    !claim.target || claim.target.fromDate!==claim.target.throughDate ||
    claim.target.projectRef!=="xnfjdbpjuaezxjgargto" || claim.target.shop!=="mullybox-store.myshopify.com" ||
    claim.target.posthogProject!=="353503" || !["paired_financial","entry_cohort"].includes(claim.target.mode) ||
    ![claim.target.runId,claim.target.baseRunId,claim.target.definition,claim.target.mappingVersion,
      claim.target.sessionVersion,claim.target.funnelVersion].every(text) ||
    instant(claim.deadline)>instant(claim.validUntil) || instant(claim.deadline)<=instant(claim.startedAt) ||
    Date.parse(claim.deadline)-Date.parse(claim.startedAt)>60000 || Date.parse(claim.startedAt)>r.now() ||
    Date.parse(claim.deadline)<=r.now() ||
    claim.target.mode === "paired_financial" && (!input.cycleId || !input.seal) ||
    claim.target.mode === "entry_cohort" && (input.cycleId !== null || input.seal)) throw new Error("source_report_claim_scope");
  validatePolicy(claim.sourcePolicy,claim.entryPolicy,{...claim.target,asOf:new Date(r.now()).toISOString()});
  const {from,until}=sourceReportDay(claim.target.fromDate),started=r.now();
  const sourceDeadline=Math.min(Date.parse(claim.deadline),Date.parse(claim.validUntil),
    Date.parse(claim.sourcePolicy.validUntil),started+SOURCE_SESSION_REPORT_PLAN.totalMs);
  const assertSource=()=>{
    if(r.now()>=sourceDeadline || r.env.LEAN_SOURCE_SESSION_REPORT_ENABLED!=="true")throw new Error("source_report_source_deadline");
  };
  const readAuthority=async()=>{
    assertSource();
    const raw=await rpc(r,"lean_source_session_report_authority",{p_claim:claim.reportAuthority.claimId,p_from:from,p_until:until},
      SOURCE_SESSION_REPORT_PLAN.authorityBytes,sourceDeadline) as Omit<SourceAuthorityPopulation,"digest">;
    if(Object.hasOwn(raw,"digest") || instant(raw.authorityHistoryFrom)!==instant(claim.authorityHistoryFrom) ||
      instant(raw.capturedAt)<instant(claim.startedAt)) throw new Error("source_report_authority_claim");
    return {...raw,digest:sourceReportDigest(raw)};
  };
  const before=await readAuthority();
  assertSource();
  const native=await readSourceSessionNativeWindow(claim.target.fromDate,claim.sourcePolicy.sourceReadKeySha256,r,sourceDeadline);
  const after=await readAuthority();
  if(r.now()-started>SOURCE_SESSION_REPORT_PLAN.totalMs || instant(native.capturedAt)<instant(claim.startedAt))
    throw new Error("source_report_acquisition_budget");
  const sealed=input.seal ? await input.seal(claim,after.capturedAt) : {asOf:new Date(r.now()).toISOString(),financialBinding:null,scope:null,spend:null};
  if(instant(sealed.asOf)<instant(after.capturedAt) || Date.parse(sealed.asOf)>r.now() ||
    instant(sealed.asOf)>=instant(claim.deadline) || r.now()>=Date.parse(claim.deadline) ||
    r.env.LEAN_SOURCE_SESSION_REPORT_ENABLED!=="true") throw new Error("source_report_seal_expired");
  const packet=prepareSourceSessionReportPacket({reportAuthority:claim.reportAuthority,target:{...claim.target,asOf:sealed.asOf},
    financialBinding:sealed.financialBinding,baseBinding:claim.baseBinding,sourcePolicy:claim.sourcePolicy,
    entryPolicy:claim.entryPolicy,capturedAt:after.capturedAt,sourcePlan:claim.sourcePlan,
    entries:{native,authorityBefore:before,authorityAfter:after}});
  const registered=await rpc(r,"lean_source_session_report_register",{p_claim:claim.reportAuthority.claimId,p_packet:packet,
    p_scope:sealed.scope,p_spend:sealed.spend},65536,Date.parse(claim.deadline));
  // Caller receives the actual SQL receipt, not an inferred successful full run.
  return {packet,registered};
}
