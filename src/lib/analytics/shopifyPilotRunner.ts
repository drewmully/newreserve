import { randomUUID } from "node:crypto";
import type { AnalyticsRpcClient } from "./rpcStore";
import { readPilotSource, type PilotSource } from "./shopifyPilotSource";
import { mapPilotSource, type PilotPolicy } from "./shopifyPilotMapping";
import { shopifyShop, shopifyId, sourceObject, sourceString } from "./shopifySource";

export const PILOT_VERSION = "shopify-pilot-v1";
export const PRODUCTION_ANALYTICS_REF = "xnfjdbpjuaezxjgargto";
export function validatePilotTarget(projectRef: string, url: string) {
  if (!/^[a-z]{20}$/.test(projectRef) || projectRef === PRODUCTION_ANALYTICS_REF ||
      url !== `https://${projectRef}.supabase.co`) throw new Error("pilot_isolated_target_required");
}
/** Single pre-approved order per run. No automatic order discovery, webhook
 * subscription, billing actions, certification, or production pointer changes.
 */
export async function runShopifyPilot(options: {
  client: AnalyticsRpcClient; runId: string; projectRef: string; databaseUrl: string;
  shop: string; accessToken: string; fetcher?: typeof fetch;
}) {
  validatePilotTarget(options.projectRef, options.databaseUrl);
  shopifyShop(options.shop);
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(options.runId) ||
      !options.accessToken.trim()) throw new Error("pilot_invalid_configuration");
  const token = randomUUID();
  const args = { p_run_id: options.runId, p_token: token };
  async function rpc(name: string, params: Record<string, unknown>) {
    let response;
    try { response = await options.client.rpc(name, params); }
    catch { throw new Error("pilot_storage_unavailable"); }
    if (response.error) throw new Error("pilot_storage_unavailable");
    return response.data;
  }
  const run = sourceObject(await rpc("lean_pilot_claim", { ...args, p_project_ref: options.projectRef }));
  if (["done", "busy", "exhausted"].includes(run.state as string)) return { state: run.state as string };
  if (run.state !== "claimed") throw new Error("pilot_invalid_claim");
  let output: ReturnType<typeof mapPilotSource>;
  // Ambiguous storage responses must not mark a potentially committed operation failed.
  let storageInFlight = false;
  try {
    if (run.shop !== options.shop || run.version !== PILOT_VERSION) throw new Error("pilot_scope_mismatch");
    const orderGid = sourceString(run.orderGid); shopifyId(orderGid, "Order");
    const publication = sourceString(run.publication);
    if (publication !== `pilot:${options.runId}`) throw new Error("pilot_publication_mismatch");
    let source: PilotSource;
    if (run.source === null) {
      source = await readPilotSource({ shop: options.shop, accessToken: options.accessToken,
        fetcher: options.fetcher, signal: AbortSignal.timeout(60000) }, orderGid);
      storageInFlight = true;
      if (await rpc("lean_pilot_retain", { ...args, p_source: source }) !== true) return { state: "lost_lease" };
      storageInFlight = false;
    } else source = sourceObject(run.source) as PilotSource;
    if (source.commerce.shop !== options.shop || source.commerce.order.id !== orderGid)
      throw new Error("pilot_source_scope_mismatch");
    output = mapPilotSource(source, sourceObject(run.policy) as PilotPolicy, publication,
      `lean_private.pilot_runs/${options.runId}/source`);
  } catch {
    if (storageInFlight) throw new Error("pilot_storage_ambiguous");
    await rpc("lean_pilot_fail", args);
    return { state: "failed" };
  }
  // Commit facts + sample report + completion together; never overwrite a lost finish response.
  const finished = await rpc("lean_pilot_finish", { ...args, p_facts: output.facts, p_reports: output.reports });
  if (typeof finished !== "boolean") throw new Error("pilot_invalid_finish");
  return { state: finished ? "done" : "lost_lease" };
}
