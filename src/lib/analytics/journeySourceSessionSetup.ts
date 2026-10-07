import { createHash, randomUUID } from "node:crypto";
import { journeyDefaults, type JourneyRuntime } from "./journeyRuntime";
import { boundedJourneyRpc, productionJourneyBase, reserveRuntime as target } from "./journeyPolicyRuntime";
import { nativeSourceSessionId } from "./journeySourceSessionContract";
import { nativeFilterRules, nativeEntryFilterSha256 } from "./journeyNativeFilterConfig";
import { readNativeSessionProjection } from "./journeyNativeSessionRead";
import { nyDate } from "./primitives";
const digest=(value:string)=>createHash("sha256").update(value).digest("hex");
export type SetupPhase="source"|"copy";
export type SetupResult={state:"unavailable";phase:SetupPhase}|{state:"verified";phase:SetupPhase;project:string;
  keySha256:string;projectionSha256:string;filterResults:boolean[];capturedAt:string};
function safeResult(value:unknown,phase:SetupPhase,key:string,r:JourneyRuntime):SetupResult|null {
  if(!value || typeof value!=="object" || Array.isArray(value))return null;
  const x=value as Record<string,unknown>;
  if(Object.keys(x).sort().join(",")!=="capturedAt,expiresAt,filterResults,keySha256,phase,project,projectionSha256,state" ||
    x.state!=="verified" || x.phase!==phase || x.project!==target.posthog || x.keySha256!==key ||
    typeof x.projectionSha256!=="string" || !/^[a-f0-9]{64}$/.test(x.projectionSha256) ||
    JSON.stringify(x.filterResults)!=="[true,true,true,true,true,true]" || typeof x.capturedAt!=="string" || typeof x.expiresAt!=="string")return null;
  nyDate(x.capturedAt);nyDate(x.expiresAt);
  if(Date.parse(x.capturedAt)>r.now() || Date.parse(x.expiresAt)<=r.now())return null;
  return {state:"verified",phase,project:target.posthog,keySha256:key,projectionSha256:x.projectionSha256,
    filterResults:[true,true,true,true,true,true],capturedAt:x.capturedAt};
}
/** One-use operator diagnostic only. No visitor grant, collection, env write,
 * pipeline publication, or generic-key fallback in the visitor runtime. */
export async function runSourceSessionSetup(req:Request,phase:SetupPhase,r:JourneyRuntime=journeyDefaults()):Promise<SetupResult> {
  const unavailable:SetupResult={state:"unavailable",phase};
  if(r.env.LEAN_SOURCE_SESSION_SETUP_ENABLED!=="true" || !productionJourneyBase(r.env) ||
    new URL(req.url).origin!==target.origin || req.headers.has("origin") && req.headers.get("origin")!==target.origin)return unavailable;
  const claim=r.env.LEAN_SOURCE_SESSION_SETUP_CLAIM_ID, bearer=req.headers.get("authorization")?.match(/^Bearer ([a-f0-9]{64})$/)?.[1];
  if(!claim || !nativeSourceSessionId.test(claim) || !bearer)return unavailable;
  const auth=digest(bearer),claimArgs={p_claim:claim,p_auth:auth};
  try {
    const current=()=>{
      const key=phase==="source" ? r.env.POSTHOG_PERSONAL_API_KEY : r.env.LEAN_POSTHOG_QUERY_READ_KEY;
      const project=phase==="source" ? r.env.POSTHOG_PROJECT_ID : r.env.LEAN_POSTHOG_PROJECT_ID;
      return {key,project,valid:!!key?.trim() && key.length<=4096 && project===target.posthog && !!nativeFilterRules(r.env)};
    };
    const before=current();
    const unchanged=()=>{const after=current();return r.env.LEAN_SOURCE_SESSION_SETUP_ENABLED==="true" &&
      r.env.LEAN_SOURCE_SESSION_SETUP_CLAIM_ID===claim && productionJourneyBase(r.env) &&
      before.valid && after.valid && before.key===after.key && before.project===after.project;};
    if(phase==="copy") {
      const result=await boundedJourneyRpc(r,"lean_source_session_setup_copy",{...claimArgs,
        p_key:before.key ? digest(before.key) : null,p_project:before.project??null,
        p_filters:before.valid ? nativeEntryFilterSha256 : null});
      if(result.error || !unchanged())return unavailable;
      return safeResult(result.data,phase,digest(before.key!),r)??unavailable;
    }
    const attempt=randomUUID();
    const started=await boundedJourneyRpc(r,"lean_source_session_setup_begin",{...claimArgs,p_attempt:attempt});
    if(started.error || !started.data || !before.valid)return unavailable;
    const c=started.data as Record<string,unknown>;
    if(Object.keys(c).sort().join(",")!=="expiresAt,filterSha256,from,nativeSessionId,until" ||
      typeof c.nativeSessionId!=="string" || !nativeSourceSessionId.test(c.nativeSessionId) ||
      c.filterSha256!==nativeEntryFilterSha256 || c.from!=="2026-10-01T04:00:00.000000Z" ||
      c.until!=="2026-10-02T04:00:00.000000Z" || typeof c.expiresAt!=="string")return unavailable;
    nyDate(c.expiresAt);if(Date.parse(c.expiresAt)<=r.now() || !unchanged())return unavailable;
    const source=await readNativeSessionProjection(c.nativeSessionId,{from:c.from,until:c.until},before.key!,r);
    if(!source || JSON.stringify(source.filterResults)!=="[true,true,true,true,true,true]" ||
      !unchanged() || Date.parse(c.expiresAt)<=r.now())return unavailable;
    const finished=await boundedJourneyRpc(r,"lean_source_session_setup_finish",{...claimArgs,p_attempt:attempt,
      p_key:digest(before.key!),p_source:source.readDigest,p_filters:source.filterResults});
    if(finished.error || !unchanged() || Date.parse(c.expiresAt)<=r.now())return unavailable;
    return safeResult(finished.data,phase,digest(before.key!),r)??unavailable;
  } catch {return unavailable;}
}
