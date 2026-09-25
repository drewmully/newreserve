import { runHistoryReportStep } from "./historyReportBridge";
const project = "xeqlgxvrhgwwudyqtnun", shop = "mullybox-store.myshopify.com";
export type HistoryOperatorConfig = { enabled: boolean; runId: string; maxSteps: number; maxProviderRequests: number };
/** A finite operator action, not a public HTTP endpoint or a schedule. The DB
 * run remains disabled until owner enablement. No raw rows/IDs/totals are returned. */
export async function runHistoryReportOperator(env: Record<string,string|undefined>, config: HistoryOperatorConfig,
  request: typeof fetch = fetch) {
  if (config.enabled !== true) return { status: "disabled" };
  if (env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== "review/analytics-initial-validation" ||
    env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== project || env.LEAN_SHOPIFY_SHOP_DOMAIN !== shop ||
    env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${project}.supabase.co` ||
    !env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY?.trim() || !env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN?.trim() ||
    !Number.isInteger(config.maxSteps) || config.maxSteps<1 || config.maxSteps>100 ||
    !Number.isInteger(config.maxProviderRequests) || config.maxProviderRequests<1 || config.maxProviderRequests>800)
    throw new Error("history_operator_scope");
  const start=Date.now(), deadline=AbortSignal.timeout(540000);
  let calls=0,sourceBytes=0,dbBytes=0,steps=0,last="not_started";
  const bounded: typeof fetch=async (url,init) => {
    const target=String(url),isSource=target===`https://${shop}/admin/api/2026-07/graphql.json`;
    if (!isSource && !target.startsWith(`https://${project}.supabase.co/rest/v1/rpc/lean_history_report_`))
      throw new Error("history_operator_destination");
    if (isSource && ++calls>config.maxProviderRequests) throw new Error("history_operator_request_budget");
    const response=await request(url,{...init,redirect:"error",signal:AbortSignal.any([
      deadline,AbortSignal.timeout(20000),...(init?.signal?[init.signal]:[]),
    ])});
    const reader=response.body?.getReader();if(!reader)throw new Error("history_operator_empty");
    const chunks:Uint8Array[]=[];let bytes=0;
    try{for(;;){const p=await reader.read();if(p.done)break;bytes+=p.value.length;
      if(isSource)sourceBytes+=p.value.length;else dbBytes+=p.value.length;
      if(bytes>20000000||sourceBytes>67108864||dbBytes>268435456){await reader.cancel();throw new Error("history_operator_byte_budget");}
      chunks.push(p.value);
    }}finally{reader.releaseLock();}
    return new Response(Buffer.concat(chunks),{status:response.status,headers:response.headers});
  };
  while(steps<config.maxSteps && Date.now()-start<480000 && calls+8<=config.maxProviderRequests &&
    sourceBytes+8388608<=67108864 && dbBytes+48000000<=268435456) {
    const result=await runHistoryReportStep({
      projectRef:project,databaseUrl:`https://${project}.supabase.co`,runId:config.runId,
      accessToken:env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN,fetcher:bounded,
      client:{async rpc(name,args){
        if(!["lean_history_report_claim","lean_history_report_retain","lean_history_report_order","lean_history_report_day"].includes(name))
          throw new Error("history_operator_rpc");
        const response=await bounded(`https://${project}.supabase.co/rest/v1/rpc/${name}`,{
          method:"POST",headers:{"Content-Type":"application/json",apikey:env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY!,
            Authorization:`Bearer ${env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY}`},body:JSON.stringify(args),
        });
        return response.ok?{data:await response.json(),error:null}:{data:null,error:"history_operator_storage"};
      }},
    });
    steps++;last=result.state;
    if(!["order_written","report_written"].includes(last))break;
  }
  return {status:last==="complete"?"complete_unverified":"bounded_step_finished",lastState:last,steps,
    providerRequests:calls,sourceBytes,databaseBytes:dbBytes,certified:false};
}
