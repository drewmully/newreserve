import { randomUUID } from "node:crypto";
import type { AnalyticsRpcClient } from "./rpcStore";
import { boundedPipelineClient, pipelineRpc, runShopifyPipeline } from "./shopifyPipeline";
import { sourceObject, SHOPIFY_FINANCIAL_ORDER_QUERY, SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY } from "./shopifySource";
import { PILOT_FINANCIAL_QUERY, PILOT_REFUND_QUERY } from "./shopifyPilotSource";

const project = "xnfjdbpjuaezxjgargto", shop = "mullybox-store.myshopify.com";
const sourceQueries = new Set([SHOPIFY_FINANCIAL_ORDER_QUERY, SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY,
  PILOT_FINANCIAL_QUERY, PILOT_REFUND_QUERY]);
type Options = {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string; shop: string;
  accessToken: string; signal: AbortSignal; deadline: number; now?: () => number; fetcher?: typeof fetch;
};
/** Safe admission is strict except for backlog/age. A pending queue is exactly
 * why this separately authorized lane exists. This is not a global source lock. */
export function catchupHealth(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const h = value as Record<string, unknown>;
  if (h.enabled !== true || !["pending", "leased", "dead", "done", "expiredLeases"]
    .every(key => Number.isSafeInteger(h[key]) && (h[key] as number) >= 0) ||
    typeof h.oldestPendingSeconds !== "number" || !Number.isFinite(h.oldestPendingSeconds) || h.oldestPendingSeconds < 0 ||
    h.leased !== 0 || h.dead !== 0 || h.expiredLeases !== 0) return null;
  return h as Record<string, number | boolean>;
}
/** Additional sequential receipts after ONE completed ordinary commerce cycle.
 * No schedule, grant, scope extension, source discovery or inline retry. */
export async function runScheduledPipelineCatchup(options: Options) {
  const now = options.now ?? Date.now;
  const counts = { extraClaims: 0, exclusions: 0, retainedSourceSteps: 0, nativeHydrations: 0, nativeRequests: 0 };
  const result = (state: string) => ({ state, ...counts });
  if (options.projectRef !== project || options.databaseUrl !== `https://${project}.supabase.co` ||
    options.shop !== shop || !options.accessToken.trim() || !Number.isFinite(options.deadline))
    throw new Error("catchup_target");
  if (options.signal.aborted || options.deadline - now() < 65000) return result("deadline");
  const token = randomUUID(), common = { p_project_ref: project, p_shop: shop, p_token: token };
  // Claim ambiguity is held even if the caller never receives a ready response.
  const initialSignal = AbortSignal.any([options.signal, AbortSignal.timeout(5000)]);
  const initial = boundedPipelineClient(options.client, initialSignal);
  let ready: Record<string, unknown>;
  try {
    const response = await initial.rpc("lean_pipeline_throughput_begin", {
      ...common, p_deadline: new Date(options.deadline).toISOString(),
    });
    // A missing additive RPC is the documented pre-install default-off state.
    // Do not interpret any other storage failure as off or retryable.
    if (response.error && sourceObject(response.error).code === "PGRST202") return result("off");
    if (response.error) return result("held");
    ready = sourceObject(response.data);
  } catch { return result("held"); }
  if (ready.state !== "ready") {
    return result(["off", "held", "deadline", "scope_changed", "blocked", "idle", "budget_exhausted"]
      .includes(String(ready.state)) ? String(ready.state) : "held");
  }
  const deadline = Date.parse(String(ready.deadline));
  const maxClaims = ready.maxClaims, maxNative = ready.maxNativeRequests;
  if (!Number.isFinite(deadline) || deadline > options.deadline || deadline <= now() ||
    !Number.isSafeInteger(maxClaims) || (maxClaims as number) < 1 || (maxClaims as number) > 19 ||
    !Number.isSafeInteger(maxNative) || (maxNative as number) < 8 || (maxNative as number) > 152) return result("held");
  const active = AbortSignal.any([options.signal, AbortSignal.timeout(Math.max(1, deadline - now()))]);
  const rpc = (name: string, args: Record<string, unknown>, signal = active) =>
    pipelineRpc(boundedPipelineClient(options.client, signal), name, args);
  const native = options.fetcher ?? fetch;
  let state = "complete";
  try {
    for (let i = 0; i < (maxClaims as number); i++) {
      if (active.aborted || deadline - now() < 65000) { state = "deadline"; break; }
      // Reserve worst-case room before a new claim. Each actual HTTP request
      // still needs its own DB permit; unused reservations are not charged.
      if ((maxNative as number) - counts.nativeRequests < 8) { state = "budget_exhausted"; break; }
      const signal = AbortSignal.any([active, AbortSignal.timeout(60000)]);
      let currentNative = 0, currentClaimed = false, ambiguous = false;
      const stepRpc = async (operation: string, args: Record<string, unknown>) => {
        signal.throwIfAborted();
        if (ambiguous) throw new Error("catchup_ambiguous");
        try {
          return await rpc("lean_pipeline_throughput_step", { ...common, p_operation: operation, p_args: args }, signal);
        } catch (error) { ambiguous = true; throw error; }
      };
      const client: AnalyticsRpcClient = { async rpc(name, args) {
        const data = await stepRpc(name, args);
        if (name === "lean_pipeline_claim") {
          const claim = sourceObject(data);
          if (claim.state === "claimed") {
            currentClaimed = true; counts.extraClaims++;
            if (claim.source !== null) counts.retainedSourceSteps++;
          }
        }
        return { data, error: null };
      } };
      const fetcher: typeof fetch = async (url, init) => {
        signal.throwIfAborted();
        const body = sourceObject(JSON.parse(String(init?.body)));
        if (String(url) !== `https://${shop}/admin/api/2026-07/graphql.json` || init?.method !== "POST" ||
          init.redirect !== "error" || !sourceQueries.has(String(body.query)) || !currentClaimed ||
          currentNative >= 8 || counts.nativeRequests >= (maxNative as number))
          throw new Error("catchup_source_budget");
        if (await stepRpc("native_request", {}) !== true) {
          ambiguous = true;
          throw new Error("catchup_source_permit");
        }
        signal.throwIfAborted();
        if (currentNative++ === 0) counts.nativeHydrations++;
        counts.nativeRequests++;
        return native(url, { ...init, signal: AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]) });
      };
      const completed = await runShopifyPipeline({ ...options, client, signal, fetcher });
      if (!["done", "excluded", "idle"].includes(completed.state)) return result("held");
      if (completed.state === "excluded") counts.exclusions++;
      // Never reuse preflight health or infer completion from an HTTP status.
      const h = catchupHealth(await rpc("lean_pipeline_health", { p_project_ref: project, p_shop: shop },
        AbortSignal.any([active, AbortSignal.timeout(5000)])));
      if (!h) { state = "blocked"; break; }
      if (completed.state === "idle" || h.pending === 0) { state = "idle"; break; }
    }
    active.throwIfAborted();
    const closed = await rpc("lean_pipeline_throughput_close", common,
      AbortSignal.any([active, AbortSignal.timeout(5000)]));
    return result(closed === true ? state : "held");
  } catch {
    // Do not close, reset work, refund consumed permits or replay anything.
    // A late database mutation may have committed; the batch stays held.
    return result("held");
  }
}
