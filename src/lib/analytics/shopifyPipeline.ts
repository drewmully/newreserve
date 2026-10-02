import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { AnalyticsRpcClient } from "./rpcStore";
import { readPilotSource, type PilotSource } from "./shopifyPilotSource";
import { mapPilotSource, type PilotPolicy } from "./shopifyPilotMapping";
import { sourceObject, sourceArray, sourceString, shopifyId, shopifyShop } from "./shopifySource";
import type { HistoryInventory } from "./historyInventory";
import type { PartitionInventory } from "./partitionInventory";
import { FINANCIAL_RETENTION, projectPilotRetention } from "./shopifyRetention";
import { composeRetainedOrderReports } from "./shopifyRetainedOrder";
import { nyDate } from "./primitives";

export const PIPELINE_VERSION = "shopify-observed-v1";
export type PipelinePolicy = Omit<PilotPolicy, "lineClasses"> & {
  productClasses: Record<string, "merchandise">;
  /** Operator-owned, persisted in each claimed snapshot policy. Omission keeps
   * the legacy query; this does not minimize the separately stored webhook. */
  sourceProjection?: "financial_no_geo" | "financial_no_geo_order_size";
  /** Explicit immutable retention policy; never silently sanitize old snapshots. */
  sourceRetention?: typeof FINANCIAL_RETENTION;
  /** Separate explicit sink: omission preserves the existing 017 finish RPC. */
  retainedReports?: "product-v1";
  sourceInventory?: HistoryInventory;
  partitionInventory?: PartitionInventory;
};
export function validatePipelineTarget(projectRef: string, url: string) {
  if (!/^[a-z]{20}$/.test(projectRef) || url !== `https://${projectRef}.supabase.co`)
    throw new Error("pipeline_explicit_target_required");
}
/** Refund IDs are NOT order IDs. Refuse lossy numeric JSON identifiers. */
export function receiptOrderGid(topic: string, payload: unknown): string {
  const row = sourceObject(payload);
  const value = topic === "refunds/create" ? row.order_id : row.admin_graphql_api_id ?? row.id;
  if (typeof value === "string" && value.startsWith("gid://")) {
    shopifyId(value, "Order"); return value;
  }
  const id = typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? String(value) : value;
  if (typeof id !== "string" || !/^[1-9]\d*$/.test(id)) throw new Error("pipeline_invalid_order_id");
  return `gid://shopify/Order/${id}`;
}
function verifyHydration(topic: string, payload: unknown, source: PilotSource) {
  const row = sourceObject(payload);
  if (topic === "refunds/create") {
    const rawId = row.admin_graphql_api_id ?? row.id;
    const text = typeof rawId === "number" && Number.isSafeInteger(rawId) ? String(rawId) : sourceString(rawId);
    const refundGid = text.startsWith("gid://") ? text : `gid://shopify/Refund/${text}`;
    shopifyId(refundGid, "Refund");
    const refund = source.refunds.find(r => r.id === refundGid);
    if (!refund) throw new Error("pipeline_refund_not_visible");
    const eventTime = row.updated_at ?? row.created_at;
    if (eventTime !== undefined && (!Number.isFinite(Date.parse(sourceString(eventTime))) ||
        Date.parse(sourceString(refund.updatedAt)) < Date.parse(sourceString(eventTime))))
      throw new Error("pipeline_refund_behind_event");
  } else if (row.updated_at !== undefined && (!Number.isFinite(Date.parse(sourceString(row.updated_at))) ||
      Date.parse(sourceString(source.commerce.order.updatedAt)) < Date.parse(sourceString(row.updated_at))))
    throw new Error("pipeline_source_behind_event");
}
export async function pipelineRpc(client: AnalyticsRpcClient, name: string, args: Record<string, unknown>) {
  let result;
  try { result = await client.rpc(name, args); } catch { throw new Error("pipeline_storage_unavailable"); }
  if (result.error) throw new Error("pipeline_storage_unavailable");
  return result.data;
}
/** Bound caller settlement even if an already-dispatched request ignores abort.
 * Cancellation is not proof of database rollback. Never retry a mutation here. */
function beforePipelineAbort<T>(signal: AbortSignal, start: () => PromiseLike<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const cleanup = () => signal.removeEventListener("abort", abort);
    const abort = () => { cleanup(); reject(new Error("pipeline_deadline")); };
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) { abort(); return; }
    Promise.resolve().then(() => {
      signal.throwIfAborted();
      return start();
    }).then(value => {
      cleanup();
      if (signal.aborted) abort(); else resolve(value);
    }, error => { cleanup(); reject(error); });
  });
}
/** Production boundary. Supabase's lazy PostgREST builder must receive the
 * actual signal before dispatch. Promise-only clients are not a safe fallback. */
export function boundedPipelineClient(client: AnalyticsRpcClient, signal: AbortSignal): AnalyticsRpcClient {
  return { rpc(name, args) {
    return beforePipelineAbort(signal, () => {
      const request = client.rpc(name, args) as ReturnType<AnalyticsRpcClient["rpc"]> & {
        abortSignal?: (value: AbortSignal) => ReturnType<AnalyticsRpcClient["rpc"]>;
      };
      if (typeof request.abortSignal !== "function") throw new Error("pipeline_rpc_transport");
      const abortable = request.abortSignal(signal);
      signal.throwIfAborted();
      return abortable;
    });
  } };
}
export function mappingPolicy(source: PilotSource, policy: PipelinePolicy): PilotPolicy {
  const classes = sourceObject(policy.productClasses);
  const lineClasses: PilotPolicy["lineClasses"] = Object.fromEntries(
    sourceArray(sourceObject(source.commerce.order.lineItems).nodes).map(value => {
      const line = sourceObject(value);
      const id = shopifyId(line.id, "LineItem");
      const product = shopifyId(sourceObject(line.product).id, "Product");
      if (!Object.hasOwn(classes, product) || classes[product] !== "merchandise")
        throw new Error("pipeline_catalog_unapproved");
      return [id, "merchandise"];
    }),
  );
  return { ...policy, lineClasses };
}
/** Only an unedited, complete annual-access-only order is a candidate for the
 * separately owner-authorized SQL exclusion. Unknown/mixed products still map
 * through the existing fail-closed catalog gate. SQL rechecks this evidence. */
function annualAccessOnly(source: PilotSource): boolean {
  const order = sourceObject(source.commerce.order);
  const connection = sourceObject(order.lineItems);
  const lines = sourceArray(connection.nodes).map(sourceObject);
  if (order.edited !== false || sourceObject(connection.pageInfo).hasNextPage !== false ||
      lines.length < 1 || lines.length > 100) return false;
  const ids = lines.map(line => shopifyId(line.id, "LineItem"));
  return new Set(ids).size === ids.length && lines.every(line =>
    shopifyId(sourceObject(line.product).id, "Product") === "8501257175232" &&
    line.isGiftCard === false && Number.isSafeInteger(line.quantity) && (line.quantity as number) > 0);
}
/** One receipt per bounded dispatch. Shopify calls are read-only, snapshots are
 * durable, and the database fences atomic materialization + queue completion.
 * This produces observed candidate facts, NEVER a certified full-store release.
 */
export async function runShopifyPipeline(options: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string;
  shop: string; accessToken: string; fetcher?: typeof fetch; signal?: AbortSignal;
}) {
  // Include claim, source, retain, mapping and finish in one budget. After
  // caller settlement, the same signal forbids every subsequent RPC initiation.
  const signal = options.signal ?? AbortSignal.timeout(60000);
  const client: AnalyticsRpcClient = { rpc(name, args) {
    return beforePipelineAbort(signal, () => options.client.rpc(name, args));
  } };
  const nativeFetch = options.fetcher ?? fetch;
  const fetcher: typeof fetch = (url, init) => beforePipelineAbort(signal, () => nativeFetch(url, {
    ...init, signal: AbortSignal.any([signal, ...(init?.signal ? [init.signal] : [])]),
  }));
  return beforePipelineAbort(signal, () => runPipeline({ ...options, client, fetcher, signal }));
}

async function runPipeline(options: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string;
  shop: string; accessToken: string; fetcher?: typeof fetch; signal: AbortSignal;
}) {
  validatePipelineTarget(options.projectRef, options.databaseUrl);
  shopifyShop(options.shop);
  if (!options.accessToken.trim()) throw new Error("pipeline_missing_token");
  const token = randomUUID();
  const common = { p_token: token, p_project_ref: options.projectRef, p_shop: options.shop };
  const claim = sourceObject(await pipelineRpc(options.client, "lean_pipeline_claim", common));
  if (claim.state === "idle" || claim.state === "disabled") return { state: claim.state };
  if (claim.state !== "claimed" || !/^[1-9]\d*$/.test(sourceString(claim.workId)))
    throw new Error("pipeline_invalid_claim");
  const args = { p_work_id: claim.workId, p_token: token };
  let output: ReturnType<typeof mapPilotSource> | undefined;
  let productReports: ReturnType<typeof composeRetainedOrderReports>["productReports"] | undefined;
  let beforeWindow = false;
  let annualAccess = false;
  let storageInFlight = false;
  let phase = "invalid_receipt";
  try {
    const policy = sourceObject(claim.policy) as PipelinePolicy;
    if (policy.retainedReports !== undefined && policy.retainedReports !== "product-v1")
      throw new Error("pipeline_invalid_report_sink");
    if (policy.sourceProjection !== undefined &&
        !["financial_no_geo", "financial_no_geo_order_size"].includes(policy.sourceProjection))
      throw new Error("pipeline_invalid_source_projection");
    if (policy.sourceRetention !== undefined && (policy.sourceRetention !== FINANCIAL_RETENTION ||
        !["financial_no_geo", "financial_no_geo_order_size"].includes(policy.sourceProjection ?? "")))
      throw new Error("pipeline_invalid_source_retention");
    if (policy.orderSize !== undefined && (!policy.orderSize || policy.retainedReports !== "product-v1" ||
        policy.sourceProjection !== "financial_no_geo_order_size"))
      throw new Error("pipeline_invalid_size_sink");
    if (policy.sourceProjection === "financial_no_geo_order_size" && !policy.orderSize)
      throw new Error("pipeline_size_policy_required");
    if (policy.orderSize) {
      const size = sourceObject(policy.orderSize), semantics = sourceObject(size.productSemantics);
      if (typeof size.policyRef !== "string" || !size.policyRef.trim() || !Object.keys(semantics).length ||
          Object.entries(semantics).some(([id, value]) => !/^[1-9]\d*$/.test(id) ||
            typeof value !== "string" || !["requested_box_top_size", "purchased_shirt_variant"].includes(value)))
        throw new Error("pipeline_invalid_size_policy");
    }
    const orderGid = receiptOrderGid(sourceString(claim.topic), claim.payload);
    let source: PilotSource;
    phase = "source_unavailable";
    if (claim.source === null) {
      source = await readPilotSource({ shop: options.shop, accessToken: options.accessToken,
        fetcher: options.fetcher, signal: options.signal,
        ...(policy.sourceProjection ? { projection: policy.sourceProjection } : {}) }, orderGid);
      verifyHydration(sourceString(claim.topic), claim.payload, source);
      if (policy.sourceRetention) source = projectPilotRetention(source);
      storageInFlight = true;
      if (await pipelineRpc(options.client, "lean_pipeline_retain", { ...args, p_source: source }) !== true)
        return { state: "lost_lease" };
      storageInFlight = false;
    } else source = sourceObject(claim.source) as PilotSource;
    phase = "mapping_rejected";
    if (policy.sourceRetention && !isDeepStrictEqual(source, projectPilotRetention(source)))
      throw new Error("pipeline_retained_shape_mismatch");
    if (policy.sourceProjection && source.commerce.projection !== policy.sourceProjection)
      throw new Error("pipeline_retained_projection_mismatch");
    if (source.commerce.shop !== options.shop || source.commerce.order.id !== orderGid)
      throw new Error("pipeline_scope_mismatch");
    const createdAt = sourceString(source.commerce.order.createdAt);
    const updatedAt = sourceString(source.commerce.order.updatedAt);
    nyDate(createdAt); nyDate(updatedAt); // Reject malformed/calendar-overflow clocks before exclusion.
    const created = Date.parse(createdAt), updated = Date.parse(updatedAt);
    const from = Date.parse(sourceString(claim.fromTime)), until = Date.parse(sourceString(claim.untilTime));
    if (!Number.isFinite(from) || !Number.isFinite(until) || from >= until || updated < created ||
        source.commerce.apiVersion !== "2026-07" || source.financial.id !== orderGid ||
        source.financial.updatedAt !== updatedAt) throw new Error("pipeline_invalid_retained_clock_or_scope");
    verifyHydration(sourceString(claim.topic), claim.payload, source);
    beforeWindow = created < from;
    if (!beforeWindow && created >= until) throw new Error("pipeline_outside_approved_window");
    annualAccess = !beforeWindow && annualAccessOnly(source);
    // A proven old creation date rules out facts independently of catalog.
    // Financial/catalog mapping remains mandatory only for the in-window path.
    if (!beforeWindow && !annualAccess) {
      const mappedPolicy = mappingPolicy(source, policy);
      const publication = sourceString(claim.publication), evidence = `lean_private.pipeline_snapshots/${claim.workId}`;
      if (policy.retainedReports === "product-v1") {
        const composed = composeRetainedOrderReports(source, mappedPolicy, publication, evidence, PIPELINE_VERSION,
          policy.orderSize ? { orderSizeSidecar: true } : undefined);
        output = composed;
        productReports = composed.productReports;
      } else {
        output = mapPilotSource(source, mappedPolicy, publication, evidence);
        output.reports = output.reports.map(row => ({ ...row, definition_version: PIPELINE_VERSION }));
      }
    }
  } catch {
    // Do not clear a lease or schedule a retry after our caller timed out.
    // Existing database attempt/lease fencing owns any later reconciliation.
    options.signal.throwIfAborted();
    if (storageInFlight) throw new Error("pipeline_storage_ambiguous");
    const failed = await pipelineRpc(options.client, "lean_pipeline_fail", { ...args, p_code: phase });
    return { state: failed === true ? "failed" : "lost_lease" };
  }
  // Like finish, never catch-and-fail a response that may be lost AFTER commit.
  if (beforeWindow) {
    const excluded = await pipelineRpc(options.client, "lean_pipeline_exclude_before_window", args);
    if (typeof excluded !== "boolean") throw new Error("pipeline_invalid_exclusion");
    return excluded ? { state: "excluded", reason: "excluded_before_window" } : { state: "lost_lease" };
  }
  if (annualAccess) {
    // No catch-and-fail or retry: a lost finalizer response may follow commit.
    const excluded = await pipelineRpc(options.client, "lean_pipeline_exclude_annual_access", args);
    if (typeof excluded !== "boolean") throw new Error("pipeline_invalid_exclusion");
    return excluded ? { state: "excluded", reason: "excluded_annual_access" } : { state: "lost_lease" };
  }
  if (!output) throw new Error("pipeline_missing_output");
  // No catch-and-fail around finish: its response may be lost AFTER commit.
  const finished = await pipelineRpc(options.client, productReports ? "lean_pipeline_finish_extended" : "lean_pipeline_finish", {
    ...args, p_facts: output.facts, p_reports: output.reports,
    ...(productReports ? { p_product_reports: productReports, p_order_item_sizes: output.order_item_sizes ?? null } : {}),
  });
  if (typeof finished !== "boolean") throw new Error("pipeline_invalid_finish");
  return { state: finished ? "done" : "lost_lease" };
}
