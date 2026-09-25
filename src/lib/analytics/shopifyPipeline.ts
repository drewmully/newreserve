import { randomUUID } from "node:crypto";
import type { AnalyticsRpcClient } from "./rpcStore";
import { readPilotSource, type PilotSource } from "./shopifyPilotSource";
import { mapPilotSource, type PilotPolicy } from "./shopifyPilotMapping";
import { sourceObject, sourceArray, sourceString, shopifyId, shopifyShop } from "./shopifySource";

export const PIPELINE_VERSION = "shopify-observed-v1";
export type PipelinePolicy = Omit<PilotPolicy, "lineClasses"> & {
  productClasses: Record<string, "merchandise">;
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
/** One receipt per bounded dispatch. Shopify calls are read-only, snapshots are
 * durable, and the database fences atomic materialization + queue completion.
 * This produces observed candidate facts, NEVER a certified full-store release.
 */
export async function runShopifyPipeline(options: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string;
  shop: string; accessToken: string; fetcher?: typeof fetch;
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
  let output: ReturnType<typeof mapPilotSource>;
  let storageInFlight = false;
  let phase = "invalid_receipt";
  try {
    const orderGid = receiptOrderGid(sourceString(claim.topic), claim.payload);
    let source: PilotSource;
    phase = "source_unavailable";
    if (claim.source === null) {
      source = await readPilotSource({ shop: options.shop, accessToken: options.accessToken,
        fetcher: options.fetcher, signal: AbortSignal.timeout(60000) }, orderGid);
      verifyHydration(sourceString(claim.topic), claim.payload, source);
      storageInFlight = true;
      if (await pipelineRpc(options.client, "lean_pipeline_retain", { ...args, p_source: source }) !== true)
        return { state: "lost_lease" };
      storageInFlight = false;
    } else source = sourceObject(claim.source) as PilotSource;
    phase = "mapping_rejected";
    if (source.commerce.shop !== options.shop || source.commerce.order.id !== orderGid)
      throw new Error("pipeline_scope_mismatch");
    const created = Date.parse(sourceString(source.commerce.order.createdAt));
    if (!Number.isFinite(created) || created < Date.parse(sourceString(claim.fromTime)) ||
        created >= Date.parse(sourceString(claim.untilTime))) throw new Error("pipeline_outside_approved_window");
    verifyHydration(sourceString(claim.topic), claim.payload, source);
    output = mapPilotSource(source, mappingPolicy(source, sourceObject(claim.policy) as PipelinePolicy),
      sourceString(claim.publication), `lean_private.pipeline_snapshots/${claim.workId}`);
    output.reports = output.reports.map(row => ({ ...row, definition_version: PIPELINE_VERSION }));
  } catch {
    if (storageInFlight) throw new Error("pipeline_storage_ambiguous");
    const failed = await pipelineRpc(options.client, "lean_pipeline_fail", { ...args, p_code: phase });
    return { state: failed === true ? "failed" : "lost_lease" };
  }
  // No catch-and-fail around finish: its response may be lost AFTER commit.
  const finished = await pipelineRpc(options.client, "lean_pipeline_finish", {
    ...args, p_facts: output.facts, p_reports: output.reports,
  });
  if (typeof finished !== "boolean") throw new Error("pipeline_invalid_finish");
  return { state: finished ? "done" : "lost_lease" };
}
