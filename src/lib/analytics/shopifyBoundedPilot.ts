import { acceptShopifyReceipt } from "./receipts";
import type { AnalyticsRpcClient } from "./rpcStore";
import { pipelineRpc, receiptOrderGid, validatePipelineTarget } from "./shopifyPipeline";
import { sourceArray, sourceObject, sourceString, shopifyId, shopifyShop } from "./shopifySource";

function eventTimestamp(value: unknown): string | null {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
    !Number.isFinite(Date.parse(value))) return null;
  return new Date(value).toISOString();
}
function sourceId(value: unknown, kind: string): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) value = String(value);
  const text = sourceString(value);
  const gid = text.startsWith("gid://") ? text : `gid://shopify/${kind}/${text}`;
  shopifyId(gid, kind); return gid;
}
/** Called only inside acceptShopifyReceipt's verified-HMAC store callback.
 * No raw customer, address, notes, tags, line properties or body are persisted.
 */
export async function acceptBoundedShopifyReceipt(
  input: Parameters<typeof acceptShopifyReceipt>[0],
  target: { client: AnalyticsRpcClient; projectRef: string; databaseUrl: string; pilotId: string },
) {
  validatePipelineTarget(target.projectRef, target.databaseUrl);
  let result: Record<string, unknown> | undefined;
  await acceptShopifyReceipt(input, async receipt => {
    const p = receipt.payload, refund = receipt.topic === "refunds/create";
    const envelope = {
      admin_graphql_api_id: refund ? sourceId(p.admin_graphql_api_id ?? p.id, "Refund") : receiptOrderGid(receipt.topic, p),
      ...(refund ? { order_id: receiptOrderGid(receipt.topic, p) } : {}),
      created_at: eventTimestamp(p.created_at), updated_at: eventTimestamp(p.updated_at ?? p.created_at),
      // A missing/deleted product remains explicitly unapproved, never dropped.
      product_ids: refund || !Array.isArray(p.line_items) ? [] : [...new Set(sourceArray(p.line_items).map(line => {
        try { return sourceId(sourceObject(line).product_id, "Product"); } catch { return null; }
      }))],
      unsupported: !refund && (receipt.topic === "orders/cancelled" || p.test !== false ||
        !Object.hasOwn(p, "cancelled_at") || p.cancelled_at !== null),
    };
    result = sourceObject(await pipelineRpc(target.client, "lean_shopify_pilot_accept", {
      p_pilot: target.pilotId, p_project_ref: target.projectRef, p_shop: input.shop,
      p_delivery_id: receipt.deliveryId, p_topic: receipt.topic, p_payload_hash: receipt.payloadHash, p_payload: envelope,
    }));
    return "bounded-pilot"; // Real RPC result, not a fabricated receipt identifier.
  });
  if (!result || !["accepted", "ignored", "disabled", "expired", "blocked", "withheld"].includes(String(result.state)))
    throw new Error("invalid_pilot_receipt_result");
  return result;
}

/** Twenty requests, 8 MiB/response, 64 MiB/attempt, one shared active deadline.
 * The unmodified reader still supplies fixed queries, version and pagination gates.
 */
export function boundedShopifyPilotFetch(shop: string, signal: AbortSignal, fetcher: typeof fetch = fetch): typeof fetch {
  shopifyShop(shop);
  let requests = 0, bytes = 0;
  const endpoint = `https://${shop}/admin/api/2026-07/graphql.json`;
  return async (url, init) => {
    signal.throwIfAborted();
    if (String(url) !== endpoint || init?.method !== "POST" || ++requests > 20)
      throw new Error("shopify_pilot_transport_scope");
    const active = AbortSignal.any([signal, ...(init.signal ? [init.signal] : [])]);
    const response = await fetcher(url, { ...init, redirect: "error", signal: active });
    active.throwIfAborted();
    if (!response.ok) throw new Error("shopify_pilot_http_failed");
    const reader = response.body?.getReader();
    if (!reader) throw new Error("shopify_pilot_missing_body");
    const chunks: Uint8Array[] = [];
    let size = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    active.addEventListener("abort", cancel, { once: true });
    try {
      while (true) {
        active.throwIfAborted();
        const part = await reader.read();
        active.throwIfAborted();
        if (part.done) break;
        size += part.value.byteLength; bytes += part.value.byteLength;
        if (size > 8 * 1024 * 1024 || bytes > 64 * 1024 * 1024) throw new Error("shopify_pilot_byte_budget");
        chunks.push(part.value);
      }
      return new Response(Buffer.concat(chunks), { status: response.status, headers: response.headers });
    } finally { active.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); }
  };
}
export async function boundedShopifyPilotClient(input: {
  client: AnalyticsRpcClient; projectRef: string; databaseUrl: string; shop: string; pilotId: string; signal: AbortSignal;
}): Promise<{ client: AnalyticsRpcClient; signal: AbortSignal }> {
  validatePipelineTarget(input.projectRef, input.databaseUrl);
  input.signal.throwIfAborted();
  const scope = sourceObject(await pipelineRpc(input.client, "lean_shopify_pilot_status", {
    p_pilot: input.pilotId, p_project_ref: input.projectRef, p_shop: input.shop,
  }));
  if (scope.state !== "ready") throw new Error("shopify_pilot_not_ready");
  const remaining = Date.parse(sourceString(scope.expiresAt)) - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0 || remaining > 14 * 86400000)
    throw new Error("shopify_pilot_invalid_expiry");
  const signal = AbortSignal.any([input.signal, AbortSignal.timeout(Math.ceil(remaining))]);
  const client: AnalyticsRpcClient = { async rpc(name, args) {
    if (name !== "lean_pipeline_fail") signal.throwIfAborted();
    if (name === "lean_pipeline_retain" && Buffer.byteLength(JSON.stringify(args.p_source), "utf8") > 8 * 1024 * 1024)
      throw new Error("shopify_pilot_snapshot_budget");
    if (name === "lean_pipeline_claim")
      return input.client.rpc("lean_shopify_pilot_claim", { ...args, p_pilot: input.pilotId });
    return input.client.rpc(name, args);
  } };
  return { client, signal };
}
