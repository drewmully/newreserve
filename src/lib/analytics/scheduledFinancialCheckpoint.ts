import { randomUUID } from "node:crypto";
import type { AnalyticsRpcClient } from "./rpcStore";
import { pipelineRpc, validatePipelineTarget } from "./shopifyPipeline";
import { runHistoryJob } from "./historyJob";
import { HISTORY_ACCESS_QUERY, HISTORY_ORDERS_QUERY, type HistoryOrder } from "./shopifyHistory";
import { sourceArray, sourceObject, sourceString, SHOPIFY_FINANCIAL_ORDER_QUERY } from "./shopifySource";
import { PILOT_FINANCIAL_QUERY, PILOT_REFUND_QUERY, type PilotSource } from "./shopifyPilotSource";
import { projectPilotRetention } from "./shopifyRetention";

const project = "xnfjdbpjuaezxjgargto", shop = "mullybox-store.myshopify.com";
const inventoryKey = (order: HistoryOrder) => JSON.stringify([
  order.id, new Date(order.createdAt).toISOString(), new Date(order.updatedAt).toISOString(),
]);

/** Called only after an authenticated production commerce timer reports idle.
 * One owner-bound attempt. No retry, queue replay, report build or publication.
 */
export async function runScheduledFinancialCheckpoint(options: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string; shop: string;
  accessToken: string; signal: AbortSignal; now: string; fetcher?: typeof fetch;
}) {
  validatePipelineTarget(options.projectRef, options.databaseUrl);
  if (options.projectRef !== project || options.shop !== shop || !options.accessToken.trim())
    throw new Error("financial_checkpoint_target");
  options.signal.throwIfAborted();
  const token = randomUUID(), common = { p_project_ref: project, p_shop: shop };
  const claim = sourceObject(await pipelineRpc(options.client, "lean_financial_checkpoint_claim", {
    ...common, p_token: token,
  }));
  if (["disabled", "complete", "held", "expired"].includes(String(claim.state)))
    return { state: String(claim.state), calls: 0 };
  if (claim.state !== "claimed") throw new Error("financial_checkpoint_claim");
  const runId = sourceString(claim.runId), inventory = sourceArray(claim.inventory) as HistoryOrder[];
  if (inventory.length < 1 || inventory.length > 5 || new Set(inventory.map(inventoryKey)).size !== inventory.length)
    throw new Error("financial_checkpoint_inventory");
  const ids = new Set(inventory.map(order => order.id));
  let calls = 0, inventoryRead = false;
  const signal = AbortSignal.any([options.signal, AbortSignal.timeout(65000)]);
  const nativeFetch = options.fetcher ?? fetch;
  const fetcher: typeof fetch = async (url, init) => {
    signal.throwIfAborted();
    const body = sourceObject(JSON.parse(String(init?.body)));
    const query = sourceString(body.query), variables = sourceObject(body.variables);
    if (String(url) !== `https://${shop}/admin/api/2026-07/graphql.json` || init?.method !== "POST" ||
        init.redirect !== "error" || ++calls > 2 + 8 * inventory.length ||
        ![HISTORY_ACCESS_QUERY, HISTORY_ORDERS_QUERY, SHOPIFY_FINANCIAL_ORDER_QUERY,
          PILOT_FINANCIAL_QUERY, PILOT_REFUND_QUERY].includes(query))
      throw new Error("financial_checkpoint_request");
    if (query === HISTORY_ORDERS_QUERY) {
      if (inventoryRead || variables.cursor !== null || variables.first !== claim.pageSize ||
          variables.search !== `created_at:>='${new Date(sourceString(claim.fromTime)).toISOString().replace(".000Z", ".000000Z")}' created_at:<'${new Date(sourceString(claim.untilTime)).toISOString().replace(".000Z", ".000000Z")}'`)
        throw new Error("financial_checkpoint_inventory_request");
    } else if (query !== HISTORY_ACCESS_QUERY &&
        (!inventoryRead || query !== PILOT_REFUND_QUERY && !ids.has(String(variables.id))))
      throw new Error("financial_checkpoint_order_scope");
    const response = await nativeFetch(url, { ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]) });
    if (query === HISTORY_ORDERS_QUERY) {
      if (!response.ok || response.headers.get("X-Shopify-API-Version") !== "2026-07")
        throw new Error("financial_checkpoint_inventory_version");
      const result = sourceObject(await response.clone().json());
      if (result.errors !== undefined && (!Array.isArray(result.errors) || result.errors.length))
        throw new Error("financial_checkpoint_inventory_errors");
      const orders = sourceObject(sourceObject(result.data).orders), page = sourceObject(orders.pageInfo);
      if (page.hasNextPage !== false ||
          JSON.stringify(sourceArray(orders.nodes).map(value => inventoryKey(value as HistoryOrder))) !==
          JSON.stringify(inventory.map(inventoryKey))) throw new Error("financial_checkpoint_inventory_changed");
      inventoryRead = true;
    }
    // Return the native response, including the real version header. Never wrap connector data.
    return response;
  };
  const client: AnalyticsRpcClient = { async rpc(name, args) {
    if (name === "lean_history_read") return options.client.rpc(name, args);
    if (name !== "lean_history_commit" || args.p_run !== runId || args.p_expected_page !== 0 ||
        args.p_expected_cursor !== null || args.p_next_cursor !== null || args.p_complete !== true || !inventoryRead)
      throw new Error("financial_checkpoint_commit_scope");
    const rows = sourceArray(args.p_rows).map(value => ({
      source: projectPilotRetention(sourceObject(sourceObject(value).source) as PilotSource),
    }));
    return options.client.rpc("lean_financial_checkpoint_commit", {
      ...common, p_run: runId, p_token: token, p_rows: rows,
    });
  } };
  const result = await runHistoryJob({ ...options, client, fetcher, signal, runId, projection: "financial_no_geo" });
  return { state: result.state, calls };
}
