import { runHistoryJob, type HistoryJobOptions } from "./historyJob";
import { pipelineRpc, validatePipelineTarget } from "./shopifyPipeline";
import { shopifyShop, sourceObject, sourceString } from "./shopifySource";

/** One approved window/page per call. A lost response never causes an inline
 * retry. Next invocation re-reads durable page state; watermark advances only
 * after all pages in that window are retained. No reporting or certification. */
export async function runHistoryFeed(options: Omit<HistoryJobOptions, "runId"> & { feedId: string }) {
  validatePipelineTarget(options.projectRef, options.databaseUrl); shopifyShop(options.shop);
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(options.feedId)) throw new Error("invalid_history_feed");
  const state = sourceObject(await pipelineRpc(options.client, "lean_history_feed_next", {
    p_feed: options.feedId, p_project_ref: options.projectRef, p_shop: options.shop,
  }));
  if (["disabled", "blocked", "complete", "budget_exhausted", "daily_budget_exhausted", "caught_up"]
    .includes(String(state.state))) return { state: String(state.state) };
  if (state.state !== "ready") throw new Error("invalid_feed_state");
  const result = await runHistoryJob({ ...options, runId: sourceString(state.runId) });
  return { state: result.state === "complete" ? "partial" : result.state };
}
