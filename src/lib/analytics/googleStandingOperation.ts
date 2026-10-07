import { randomUUID } from "node:crypto";
import { pipelineRpc, validatePipelineTarget } from "./shopifyPipeline";
import { runFullPipeline } from "./fullPipeline";
import { sourceObject, sourceString } from "./shopifySource";
import { googleStandingBinding } from "./googleStandingBinding";

/** One saved step. No registration, source/control fabrication, retry or scheduler.
 * Ambiguous execution leaves the database lease held for owner reconciliation. */
export async function runGoogleStandingPipeline(
  input: Parameters<typeof runFullPipeline>[0],
  binding: { policy: string; revision: string },
  run: typeof runFullPipeline = runFullPipeline,
  signal?: AbortSignal,
) {
  googleStandingBinding({ LEAN_GOOGLE_STANDING_POLICY_ID: binding.policy,
    LEAN_GOOGLE_STANDING_POLICY_REVISION: binding.revision });
  validatePipelineTarget(input.projectRef, input.databaseUrl);
  if (input.projectRef !== "xnfjdbpjuaezxjgargto" || input.shop !== "mullybox-store.myshopify.com")
    throw new Error("google_standing_target");
  const args = { p_project_ref: input.projectRef, p_policy: binding.policy, p_revision: binding.revision };
  const token = randomUUID();
  // A transport ambiguity never retries a claim. The held lease needs owner review.
  const outer = AbortSignal.any([AbortSignal.timeout(85000), ...(signal ? [signal] : [])]);
  const boundedClient = (s: AbortSignal): typeof input.client => ({ rpc(name, parameters) {
    s.throwIfAborted();
    const request = input.client.rpc(name, parameters) as ReturnType<typeof input.client.rpc> & {
      abortSignal?: (signal: AbortSignal) => ReturnType<typeof input.client.rpc>;
    };
    if (typeof request.abortSignal !== "function") throw new Error("google_standing_rpc_transport");
    return request.abortSignal(s);
  } });
  const beforeAbort = async <T>(work: () => PromiseLike<T>, s: AbortSignal): Promise<T> => {
    s.throwIfAborted();
    let stop: () => void = () => {};
    const aborted = new Promise<never>((_, reject) => {
      stop = () => reject(new Error("google_standing_aborted"));
      s.addEventListener("abort", stop, { once: true });
    });
    try { return await Promise.race([work(), aborted]); }
    finally { s.removeEventListener("abort", stop); }
  };
  const claimed = sourceObject(await beforeAbort(() => pipelineRpc(boundedClient(outer),
    "lean_google_standing_next", { ...args, p_token: token }), outer));
  if (["disabled", "held", "exhausted", "not_due", "idle"].includes(String(claimed.state)))
    return { state: String(claimed.state) };
  if (claimed.state !== "ready") throw new Error("google_standing_claim");
  const runId = sourceString(claimed.runId), deadline = Date.parse(sourceString(claimed.deadline));
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(runId) || !Number.isFinite(deadline) ||
    deadline <= Date.now() || deadline - Date.now() > 80000) throw new Error("google_standing_deadline");
  const cancellation = AbortSignal.any([AbortSignal.timeout(Math.max(1, deadline - Date.now())), outer]);
  const client = boundedClient(cancellation);
  const request: typeof fetch = (url, init) => {
    cancellation.throwIfAborted();
    return (input.request ?? fetch)(url, { ...init,
      signal: AbortSignal.any([cancellation, ...(init?.signal ? [init.signal] : [])]) });
  };
  // Do not catch and then write "failed": a lost source/finish response may have committed.
  const result = await beforeAbort(() => run({ ...input, runId, client, request }), cancellation);
  cancellation.throwIfAborted();
  return sourceObject(await beforeAbort(() => pipelineRpc(client, "lean_google_standing_finish", {
    ...args, p_run: runId, p_token: token, p_state: result.state,
  }), cancellation)) as { state: string };
}
