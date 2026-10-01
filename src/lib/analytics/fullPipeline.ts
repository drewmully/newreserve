import type { AnalyticsRpcClient } from "./rpcStore";
import { pipelineRpc, validatePipelineTarget } from "./shopifyPipeline";
import { sourceObject, sourceString } from "./shopifySource";
import { runHistoryJob } from "./historyJob";
import { runGoogleSpendJob } from "./googleSpendJob";
import { runObservedReportJob } from "./observedReportJob";
import { runFullReportJob } from "./fullReportJob";
import type { GoogleSpendAuth } from "./googleSpendSource";
import { advanceFreshGoogleSpend, prepareFreshGoogleSpend } from "./googleSpendRegistration";

/** One bounded step, selected only from the owner-saved dependency inventory.
 * No recursion, catch-and-retry, dynamic account discovery, or release.
 */
export async function runFullPipeline(input: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string; runId: string;
  shop: string; shopifyToken: string; posthogKey: string;
  googleClientId: string; googleClientSecret: string; googleRefreshToken: string;
  googleAuth?: GoogleSpendAuth; googleDeveloperToken?: string;
  journeyPermissionReadKey?: string; journeyPermissionReadApproved?: boolean;
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
      if (common.runId.startsWith("fresh-google:")) {
        const prepared = prepareFreshGoogleSpend(next.freshGoogleSpendManifest);
        if (prepared.manifest.projectRef !== input.projectRef ||
            !prepared.registration.args.p_scope.days.some(day => day.runId === common.runId))
          throw new Error("full_fresh_spend_scope");
        const client: AnalyticsRpcClient = { async rpc(name, args) {
          const result = await input.client.rpc(name, args);
          if (!result.error && name === "lean_spend_pilot_next") {
            const selected = sourceObject(result.data);
            if (selected.state === "ready" && selected.runId !== common.runId)
              throw new Error("full_fresh_spend_selection_changed");
          }
          return result;
        } };
        result = await advanceFreshGoogleSpend({ client, databaseUrl: input.databaseUrl,
          manifest: next.freshGoogleSpendManifest, enabled: true,
          auth: input.googleAuth ?? { mode: "oauth_refresh", clientId: input.googleClientId,
            clientSecret: input.googleClientSecret, refreshToken: input.googleRefreshToken },
          developerToken: input.googleDeveloperToken, fetcher: input.request,
          signal: AbortSignal.timeout(65000) });
        break;
      }
      if (Object.hasOwn(next, "freshGoogleSpendManifest")) throw new Error("full_fresh_spend_scope");
      result = await runGoogleSpendJob({ ...common, clientId: input.googleClientId,
        clientSecret: input.googleClientSecret, refreshToken: input.googleRefreshToken,
        auth: input.googleAuth, developerToken: input.googleDeveloperToken,
        fetcher: input.request, signal: AbortSignal.timeout(65000), now: input.now });
      break;
    case "reports": result = await runObservedReportJob(common); break;
    case "full":
      return runFullReportJob({ ...common, posthogKey: input.posthogKey, request: input.request,
        journeyPermissionReadKey: input.journeyPermissionReadKey,
        journeyPermissionReadApproved: input.journeyPermissionReadApproved });
    default: throw new Error("invalid_full_stage");
  }
  return { state: ["complete", "partial"].includes(result.state) ? "partial" : result.state, stage: String(next.stage) };
}
