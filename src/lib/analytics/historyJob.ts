import type { AnalyticsRpcClient } from "./rpcStore";
import { pipelineRpc, validatePipelineTarget } from "./shopifyPipeline";
import { sourceObject, sourceString, shopifyShop } from "./shopifySource";
import { runShopifyHistory } from "./shopifyHistory";

export type HistoryJobOptions = {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string; shop: string;
  runId: string; accessToken: string; fetcher?: typeof fetch; signal: AbortSignal; now: string;
};
/** One source page per invocation. Scope, budget and cursor come only from the
 * operator-owned registry. Competing invocations cannot both commit a page.
 * An ambiguous response is retried by re-reading state, never replaying writes.
 */
export async function runHistoryJob(options: HistoryJobOptions) {
  validatePipelineTarget(options.projectRef, options.databaseUrl); shopifyShop(options.shop);
  if (!options.runId.trim() || options.runId.length > 128) throw new Error("history_missing_run");
  const args = { p_run: options.runId, p_project_ref: options.projectRef, p_shop: options.shop };
  const state = sourceObject(await pipelineRpc(options.client, "lean_history_read", args));
  if (["disabled", "complete", "budget_exhausted"].includes(String(state.state)))
    return { state: String(state.state) };
  if (state.state !== "ready" || state.shop !== options.shop ||
      !Number.isSafeInteger(state.pageCount) || Number(state.pageCount) < 0 ||
      !Number.isSafeInteger(state.pageSize) || Number(state.pageSize) < 1 || Number(state.pageSize) > 5 ||
      state.scanBasis !== undefined && !["created_at", "updated_at"].includes(String(state.scanBasis)) ||
      (state.cursor !== null && typeof state.cursor !== "string")) throw new Error("history_invalid_registry");
  const result = await runShopifyHistory({
    ...options, fromTime: sourceString(state.fromTime), untilTime: sourceString(state.untilTime),
    scanBasis: (state.scanBasis ?? "created_at") as "created_at" | "updated_at",
    approvalRef: sourceString(state.approvalRef), pageSize: Number(state.pageSize),
    cursor: state.cursor as string | null, maxPages: 1,
    store: { async commitPage(expected, page) {
      const committed = await pipelineRpc(options.client, "lean_history_commit", {
        ...args, p_expected_page: state.pageCount, p_expected_cursor: expected,
        p_next_cursor: page.nextCursor, p_complete: page.complete, p_rows: page.rows,
      });
      if (typeof committed !== "boolean") throw new Error("history_invalid_commit_response");
      return committed;
    } },
  });
  // Do not expose source records, cursor, policy or credentials in HTTP responses.
  return { state: result.complete ? "complete" : "partial", written: result.written };
}
