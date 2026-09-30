import { createHash, randomUUID } from "node:crypto";
import { getAnalyticsSupabase } from "./serverClient";
import type { AnalyticsRpcClient } from "./rpcStore";
import { collectSubscriptionSnapshot } from "./subscriptionCollection";
import type { SubscriptionPolicy } from "./subscriptions";
import { createSubscriptionTransport, SUBSCRIPTION_SHOP } from "./subscriptionTransport";
import { openSubscriptionCursor, sealSubscriptionCursor } from "./subscriptionScans";

async function rpc(client: AnalyticsRpcClient, name: string, args: Record<string, unknown>) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const result = await Promise.race([Promise.resolve(client.rpc(name, args)),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error()), 5000); })]);
    if (result.error) throw new Error();
    return result.data;
  } catch { throw new Error("subscription_storage_unavailable"); }
  finally { clearTimeout(timer); }
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("subscription_registry");
  return value as Record<string, unknown>;
}

/** One owner-registered bounded capture or one page of an owner-registered finite plan.
 * No caller-selected scope or automatic failed-page replay.
 * A storage timeout may have committed: re-read claim state on a later dispatch.
 */
export async function runSubscriptionRuntime(deps: {
  client?: AnalyticsRpcClient; fetcher?: typeof fetch; signal?: AbortSignal;
} = {}) {
  if (typeof window !== "undefined") throw new Error("subscription_server_only");
  if (process.env.LEAN_ANALYTICS_SUBSCRIPTIONS_ENABLED !== "true") return { state: "disabled" };
  const project = process.env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF ?? "";
  const run = process.env.LEAN_ANALYTICS_SUBSCRIPTIONS_RUN_ID ?? "";
  const plan = process.env.LEAN_ANALYTICS_SUBSCRIPTIONS_PLAN_ID ?? "";
  const token = process.env.LEAN_ANALYTICS_SUBSCRIPTIONS_LOOP_TOKEN ?? "";
  if (!/^[a-z]{20}$/.test(project) ||
      process.env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${project}.supabase.co` ||
      process.env.LEAN_ANALYTICS_SUBSCRIPTIONS_SHOP !== SUBSCRIPTION_SHOP ||
      (plan ? !/^[A-Za-z0-9_-]{1,60}$/.test(plan) || Boolean(run) : !/^[a-zA-Z0-9_-]{1,100}$/.test(run)) || !token)
    throw new Error("subscription_runtime_configuration");
  const client = deps.client ?? getAnalyticsSupabase();
  const args = { p_run: run, p_project: project, p_token: randomUUID() };
  const claim = object(await rpc(client, plan ? "lean_subscription_scan_claim" : "lean_subscription_claim",
    plan ? { p_plan: plan, p_project: project, p_token: args.p_token } : args));
  if (["disabled", "complete", "busy", "expired", "attempts_exhausted", "waiting", "completed", "halted"].includes(String(claim.state)))
    return { state: String(claim.state) };
  if (claim.state !== "claimed") throw new Error("subscription_registry");
  let payload: unknown;
  let continuation: ReturnType<typeof sealSubscriptionCursor> = { ciphertext: null, fingerprint: null };
  let hasNext = false;
  if (plan) {
    if (claim.planId !== plan || typeof claim.runId !== "string" || !/^[a-zA-Z0-9_-]{1,100}$/.test(claim.runId))
      throw new Error("subscription_registry");
    args.p_run = claim.runId;
  }
  const callArgs = plan ? { ...args, p_plan: plan } : args;
  const prefix = plan ? "lean_subscription_scan_" : "lean_subscription_";
  try {
    if (claim.shop !== SUBSCRIPTION_SHOP || claim.apiVersion !== "2026-04" ||
        typeof claim.asOf !== "string" || typeof claim.tokenSha256 !== "string" ||
        typeof claim.bindingRef !== "string" || claim.maxPages !== 1 ||
        !Number.isSafeInteger(claim.maxRows) || Number(claim.maxRows) < 1 || Number(claim.maxRows) > 100 ||
        !Number.isSafeInteger(claim.pageSize) || Number(claim.pageSize) < 1 || Number(claim.pageSize) > 100)
      throw new Error("subscription_registry");
    const transport = createSubscriptionTransport({ enabled: true, shop: SUBSCRIPTION_SHOP,
      token, tokenSha256: claim.tokenSha256, bindingRef: claim.bindingRef }, deps.fetcher);
    const cursorContext = { projectRef: project, planId: plan, cycle: Number(claim.cycle), page: Number(claim.page) };
    const resume = plan ? openSubscriptionCursor(token, claim.cursorCiphertext, claim.cursorFingerprint, cursorContext) : null;
    const result = await collectSubscriptionSnapshot({
      enabled: true, shop: SUBSCRIPTION_SHOP, asOf: claim.asOf,
      evidenceRef: `lean_private.subscription_runs/${args.p_run}`,
      maxPages: claim.maxPages as number, maxRows: claim.maxRows as number,
      maxBytes: claim.maxBytes as number, pageSize: claim.pageSize as number,
      status: claim.statusFilter as "ACTIVE" | "PAUSED" | "CANCELLED" | "EXPIRED" | null,
      signal: deps.signal,
      ...(plan ? { continueAfter: resume, onContinuation(cursor: string | null) {
        hasNext = cursor !== null;
        continuation = sealSubscriptionCursor(token, cursor, { ...cursorContext, page: cursorContext.page + 1 });
      } } : {}),
    }, claim.policy as SubscriptionPolicy, async request => {
      // Every provider call needs the same live singleton lease and server-side budget.
      if (await rpc(client, prefix + "permit", callArgs) !== true)
        throw new Error("subscription_lease_lost");
      return transport(request);
    });
    if (result.state === "disabled") throw new Error("subscription_disabled");
    const revisions = new Map(result.collection.revisions.map(r => [r.contractKey, r.sourceUpdatedAt]));
    payload = {
      version: 1, asOf: claim.asOf, state: result.state, scopeComplete: false,
      rows: result.snapshot.rows.map(r => ({ ...r, sourceUpdatedAt: revisions.get(r.contractKey) ?? null })),
      evidence: { requests: result.collection.requests, bytes: result.collection.bytes,
        rawRows: result.collection.rawRows, duplicates: result.snapshot.duplicates,
        startedAt: result.collection.startedAt, finishedAt: result.collection.finishedAt,
        collectionHash: createHash("sha256").update(JSON.stringify(result.collection)).digest("hex") },
    };
  } catch {
    return { state: await rpc(client, prefix + "fail", callArgs) === true ? "failed" : "lost_lease" };
  }
  // Do not catch/fail a finish whose successful response may have been lost.
  const saved = await rpc(client, prefix + "finish", { ...callArgs, p_payload: payload,
    ...(plan ? { p_has_next: hasNext, p_cursor: continuation.ciphertext, p_fingerprint: continuation.fingerprint } : {}) });
  if (typeof saved !== "boolean") throw new Error("subscription_storage_unavailable");
  return { state: saved ? "observation_saved" : "lost_lease" };
}
