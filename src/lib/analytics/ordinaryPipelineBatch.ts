import type { AnalyticsRpcClient } from "./rpcStore";
import { boundedPipelineClient, pipelineRpc, runShopifyPipeline } from "./shopifyPipeline";
import { sourceObject, SHOPIFY_FINANCIAL_ORDER_QUERY, SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY } from "./shopifySource";
import { PILOT_FINANCIAL_QUERY, PILOT_REFUND_QUERY } from "./shopifyPilotSource";
import { parsePipelineHealth } from "../../../scripts/analytics/dispatch-pipeline.mjs";

const project = "xnfjdbpjuaezxjgargto", shop = "mullybox-store.myshopify.com";
const scope = "799209cbd0913f5257afaabefc478ec7e402640b4ac5c30e5f9ee81eeee30689";
const common = { p_project_ref: project, p_shop: shop };
const queries = new Set([SHOPIFY_FINANCIAL_ORDER_QUERY, SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY,
  PILOT_FINANCIAL_QUERY, PILOT_REFUND_QUERY]);
type Ready = {
  state: "ready"; revision: number; scopeSha256: string;
  maxClaims: 20; maxNativeRequests: 160; deadlineSeconds: 80; minRemainingSeconds: 65;
};
type Admission = Ready | { state: "off" | "scope_disabled" | "scope_changed" };
function admission(value: unknown): Admission {
  const v = sourceObject(value);
  if (["off", "scope_disabled", "scope_changed"].includes(String(v.state)))
    return { state: v.state as "off" | "scope_disabled" | "scope_changed" };
  if (v.state !== "ready" || !Number.isSafeInteger(v.revision) || (v.revision as number) < 1 ||
      (v.revision as number) > 2147483647 || v.scopeSha256 !== scope || v.maxClaims !== 20 ||
      v.maxNativeRequests !== 160 || v.deadlineSeconds !== 80 || v.minRemainingSeconds !== 65)
    throw new Error("ordinary_batch_invalid_admission");
  return Object.freeze({ state: "ready", revision: v.revision as number, scopeSha256: scope,
    maxClaims: 20, maxNativeRequests: 160, deadlineSeconds: 80, minRemainingSeconds: 65 });
}
/** Read-only. Only the exact missing additive RPC is default off. Any other
 * error is unavailable, never permission to run a second/default lane. */
export async function readOrdinaryBatchAdmission(client: AnalyticsRpcClient, signal: AbortSignal): Promise<Admission> {
  const response = await boundedPipelineClient(client, signal).rpc("lean_pipeline_ordinary_batch_admission", common);
  if (response.error) {
    const error = sourceObject(response.error);
    if (error.code === "PGRST202" && error.message ===
        "Could not find the function public.lean_pipeline_ordinary_batch_admission(p_project_ref, p_shop) in the schema cache")
      return { state: "off" };
    throw new Error("ordinary_batch_admission_unavailable");
  }
  return admission(response.data);
}

/** Counts actual fetch starts, not reserved permits or provider receipts.
 * Separate per-record eight-request limits share ONE invocation ceiling. */
export function ordinarySourceBudget(native: typeof fetch = fetch) {
  let started = 0, hydrations = 0;
  return {
    get started() { return started; },
    get hydrations() { return hydrations; },
    forReceipt(signal: AbortSignal): typeof fetch {
      let recordStarted = 0;
      return async (url, init) => {
        signal.throwIfAborted();
        const body = sourceObject(JSON.parse(String(init?.body)));
        if (String(url) !== `https://${shop}/admin/api/2026-07/graphql.json` ||
            init?.method !== "POST" || init.redirect !== "error" || !queries.has(String(body.query)) ||
            recordStarted >= 8 || started >= 160) throw new Error("ordinary_batch_source_budget");
        const active = AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]);
        active.throwIfAborted();
        if (recordStarted++ === 0) hydrations++;
        started++;
        return native(url, { ...init, signal: active });
      };
    },
  };
}

/** Same ordinary processor, sequentially bounded inside the existing cron
 * route. No new scheduler, EXTRA grant, inline replay or source inventory. */
export async function runOrdinaryPipelineBatch(options: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string; shop: string; accessToken: string;
  admission: Ready; signal: AbortSignal; deadline: number; now?: () => number; fetcher?: typeof fetch;
}) {
  const authority = admission(options.admission);
  const now = options.now ?? Date.now;
  if (authority.state !== "ready" || options.projectRef !== project ||
      options.databaseUrl !== `https://${project}.supabase.co` || options.shop !== shop ||
      !options.accessToken.trim() || !Number.isFinite(options.deadline) || options.deadline > now() + 80000)
    throw new Error("ordinary_batch_target_or_budget");
  const counts = { claimAttempts: 0, confirmedClaims: 0, done: 0, exclusions: 0,
    retainedSourceClaims: 0, failed: 0 };
  const source = ordinarySourceBudget(options.fetcher);
  const result = (state: string, reason: string, health?: ReturnType<typeof parsePipelineHealth> & { unresolvedExceptions?: number }) => ({
    state, ordinaryBatch: { revision: authority.revision, reason, ...counts,
      nativeHydrations: source.hydrations, nativeRequestsStarted: source.started }, ...(health ? { health } : {}),
  });
  if (options.signal.aborted || options.deadline - now() < 65000) return result("deadline", "before_claim");
  const active = AbortSignal.any([options.signal, AbortSignal.timeout(Math.max(1, options.deadline - now()))]);
  let reason = "claim_cap";
  for (let i = 0; i < 20; i++) {
    if (active.aborted) return result("deadline", "ambiguous_abort");
    if (options.deadline - now() < 65000) { reason = "remaining_budget"; break; }
    if (160 - source.started < 8) { reason = "source_budget"; break; }
    const signal = AbortSignal.any([active, AbortSignal.timeout(60000)]);
    const bounded = boundedPipelineClient(options.client, signal);
    const client: AnalyticsRpcClient = { async rpc(name, args) {
      signal.throwIfAborted();
      if (name === "lean_pipeline_claim") counts.claimAttempts++;
      const response = await bounded.rpc(name === "lean_pipeline_claim" ? "lean_pipeline_ordinary_batch_claim" : name,
        name === "lean_pipeline_claim" ? { ...args, p_revision: authority.revision } : args);
      if (name === "lean_pipeline_claim" && !response.error) {
        const claim = sourceObject(response.data);
        if (claim.state === "claimed" && typeof claim.workId === "string" && /^[1-9]\d*$/.test(claim.workId)) {
          counts.confirmedClaims++;
          if (claim.source && typeof claim.source === "object" && !Array.isArray(claim.source))
            counts.retainedSourceClaims++;
        }
      }
      return response;
    } };
    let completed: Awaited<ReturnType<typeof runShopifyPipeline>>;
    try {
      completed = await runShopifyPipeline({ ...options, client, signal, fetcher: source.forReceipt(signal) });
      signal.throwIfAborted();
    } catch {
      // May follow a dispatched/committed mutation. No fail/close/retry here.
      return result(active.aborted ? "deadline" : "unavailable", "record_ambiguous");
    }
    if (completed.state === "done") counts.done++;
    else if (completed.state === "excluded") counts.exclusions++;
    else if (completed.state === "idle") { reason = "idle"; break; }
    else if (completed.state === "disabled") return result("scope_disabled", "authority_changed");
    else if (completed.state === "failed") { counts.failed++; return result("failed", "record_failed"); }
    else return result("unavailable", "lost_or_unknown_lease");
  }
  // Only a fresh final health observation can qualify a settled batch. Pending
  // exceptions stay pending and cannot become "current" through this runner.
  try {
    active.throwIfAborted();
    const h = await pipelineRpc(boundedPipelineClient(options.client,
      AbortSignal.any([active, AbortSignal.timeout(5000)])), "lean_pipeline_health", common);
    const health = parsePipelineHealth(h) as ReturnType<typeof parsePipelineHealth> & { unresolvedExceptions?: number };
    const raw = sourceObject(h);
    if (raw.unresolvedExceptions !== undefined) {
      if (!Number.isSafeInteger(raw.unresolvedExceptions) || (raw.unresolvedExceptions as number) < 0)
        throw new Error("ordinary_batch_invalid_health");
      health.unresolvedExceptions = raw.unresolvedExceptions as number;
    }
    active.throwIfAborted();
    if (!health.enabled) return result("scope_disabled", "final_scope_disabled", health);
    const healthy = health.dead === 0 && health.expiredLeases === 0 && health.leased === 0 &&
      health.oldestPendingSeconds < 900;
    return result(healthy ? reason === "idle" && health.pending === 0 ? "idle" : "complete" : "unhealthy", reason, health);
  } catch { return result(active.aborted ? "deadline" : "health_unavailable", "final_health_unproven"); }
}
