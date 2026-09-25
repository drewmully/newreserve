import { randomUUID } from "node:crypto";
import type { AnalyticsRpcClient } from "./rpcStore";
import { pipelineRpc, validatePipelineTarget } from "./shopifyPipeline";
import { sourceObject, sourceString } from "./shopifySource";
import { readGoogleSpend, authorizeGoogleSpend, type GoogleSpendAuth } from "./googleSpendSource";
import type { SpendBase } from "./spend";

/** A saved account/day, three maximum attempts, one fenced immutable base.
 * Nothing is written to core metrics or PostHog by this import stage.
 */
export async function runGoogleSpendJob(input: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string; runId: string;
  clientId?: string; clientSecret?: string; refreshToken?: string;
  auth?: GoogleSpendAuth; developerToken?: string;
  fetcher?: typeof fetch; now: string; signal: AbortSignal;
}) {
  validatePipelineTarget(input.projectRef, input.databaseUrl);
  if (!input.runId.trim() || input.runId.length > 128) throw new Error("spend_missing_run");
  const args = { p_run: input.runId, p_project_ref: input.projectRef, p_token: randomUUID() };
  const claim = sourceObject(await pipelineRpc(input.client, "lean_spend_claim", args));
  if (["disabled", "complete", "busy", "attempts_exhausted"].includes(String(claim.state)))
    return { state: String(claim.state) };
  if (claim.state !== "claimed") throw new Error("spend_invalid_claim");
  let base: SpendBase;
  try {
    if (!Number.isSafeInteger(claim.maxPages)) throw new Error("spend_invalid_claim");
    const auth = input.auth ?? { mode: "oauth_refresh", clientId: input.clientId ?? "",
      clientSecret: input.clientSecret ?? "", refreshToken: input.refreshToken ?? "" };
    const accessToken = await authorizeGoogleSpend({ ...input, auth });
    base = await readGoogleSpend({ ...input, accessToken, accountId: sourceString(claim.accountId),
      loginCustomerId: claim.loginCustomerId === null ? null : sourceString(claim.loginCustomerId),
      date: sourceString(claim.date), maxPages: Number(claim.maxPages), approvalRef: sourceString(claim.approvalRef),
      baseReportId: input.runId, evidenceRef: `lean_private.spend_jobs/${input.runId}` });
  } catch {
    return { state: await pipelineRpc(input.client, "lean_spend_fail", args) === true ? "failed" : "lost_lease" };
  }
  // Finish may commit before its response is lost. Never fail/replay it in catch.
  const finished = await pipelineRpc(input.client, "lean_spend_finish", { ...args, p_base: base });
  if (typeof finished !== "boolean") throw new Error("spend_invalid_finish");
  return { state: finished ? "complete" : "lost_lease", ...(finished ? { rows: base.rows.length } : {}) };
}
