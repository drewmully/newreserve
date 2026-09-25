import { randomUUID } from "node:crypto";
import { runFullPipeline } from "./fullPipeline";
import { pipelineRpc, validatePipelineTarget } from "./shopifyPipeline";
import { sourceObject, sourceString } from "./shopifySource";

/** Scheduled entry point advances one pre-approved run one step. Registration,
 * evidence generation, activation, release and export remain operator-only.
 */
export async function runRefreshPipeline(input: Omit<Parameters<typeof runFullPipeline>[0], "runId">) {
  validatePipelineTarget(input.projectRef, input.databaseUrl);
  const token = randomUUID(), args = { p_project_ref: input.projectRef, p_token: token };
  const claim = sourceObject(await pipelineRpc(input.client, "lean_refresh_claim", args));
  if (["disabled", "idle", "busy", "budget_exhausted", "expired", "ambiguous"].includes(String(claim.state)))
    return { state: String(claim.state) };
  if (claim.state !== "claimed") throw new Error("invalid_refresh_claim");
  const runId = sourceString(claim.runId);
  let result: { state: string };
  try {
    result = await runFullPipeline({ ...input, runId });
  } catch {
    // A full completion may already have committed. Never replay the step here.
    // Hold the lease; expiry blocks the queue for operator reconciliation.
    throw new Error("refresh_step_ambiguous");
  }
  const committed = await pipelineRpc(input.client, "lean_refresh_finish",
    { ...args, p_run: runId, p_state: result.state });
  if (typeof committed !== "boolean") throw new Error("invalid_refresh_finish");
  return { state: committed ? result.state : "changed" };
}
