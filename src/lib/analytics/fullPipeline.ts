import type { AnalyticsRpcClient } from "./rpcStore";
import { pipelineRpc, validatePipelineTarget } from "./shopifyPipeline";
import { sourceObject, sourceString } from "./shopifySource";
import { runHistoryJob } from "./historyJob";
import { runGoogleSpendJob } from "./googleSpendJob";
import { runObservedReportJob } from "./observedReportJob";
import { runFullReportJob } from "./fullReportJob";
import type { GoogleSpendAuth } from "./googleSpendSource";

/** One bounded step, selected only from the owner-saved dependency inventory.
 * No recursion, catch-and-retry, dynamic account discovery, or release.
 */
export async function runFullPipeline(input: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string; runId: string;
  shop: string; shopifyToken: string; posthogKey: string;
  googleClientId: string; googleClientSecret: string; googleRefreshToken: string;
  googleAuth?: GoogleSpendAuth; googleDeveloperToken?: string;
  request?: typeof fetch; now: string;
}) {
  validatePipelineTarget(input.projectRef, input.databaseUrl);
  const next = sourceObject(await pipelineRpc(input.client, "lean_full_next", {
    p_run: input.runId, p_project_ref: input.projectRef,
  }));
  if (["disabled", "blocked", "complete"].includes(String(next.state))) return { state: String(next.state) };
  if (next.state !== "ready") throw new Error("invalid_full_next");
  const common = { client: input.client, projectRef: input.projectRef,
    databaseUrl: input.databaseUrl, runId: sourceString(next.runId) };
  let result: { state: string };
  switch (next.stage) {
    case "history":
      if (next.shop !== input.shop) throw new Error("pipeline_shop_mismatch");
      result = await runHistoryJob({ ...common, shop: input.shop, accessToken: input.shopifyToken,
        fetcher: input.request, signal: AbortSignal.timeout(65000), now: input.now });
      break;
    case "spend":
      result = await runGoogleSpendJob({ ...common, clientId: input.googleClientId,
        clientSecret: input.googleClientSecret, refreshToken: input.googleRefreshToken,
        auth: input.googleAuth, developerToken: input.googleDeveloperToken,
        fetcher: input.request, signal: AbortSignal.timeout(65000), now: input.now });
      break;
    case "reports": result = await runObservedReportJob(common); break;
    case "full":
      return runFullReportJob({ ...common, posthogKey: input.posthogKey, request: input.request });
    default: throw new Error("invalid_full_stage");
  }
  return { state: ["complete", "partial"].includes(result.state) ? "partial" : result.state, stage: String(next.stage) };
}
