import type { Receipt } from "./receipts";

/** Minimal port supported by a Supabase client and by the local SQL harness.
 * Errors are deliberately sanitized; database errors may contain receipt data.
 */
export type AnalyticsRpcClient = {
  rpc(name: string, args: Record<string, unknown>): PromiseLike<{ data: unknown; error: unknown }>;
};

function identifier(value: unknown): string {
  if (typeof value === "number" && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === "string" && /^[1-9]\d*$/.test(value)) return value;
  throw new Error("analytics_rpc_invalid_identifier");
}

async function invoke(client: AnalyticsRpcClient, name: string, args: Record<string, unknown>): Promise<unknown> {
  let result;
  try { result = await client.rpc(name, args); }
  catch { throw new Error("analytics_rpc_unavailable"); }
  if (result.error) throw new Error("analytics_rpc_unavailable");
  return result.data;
}

export function createReceiptStore(client: AnalyticsRpcClient): (receipt: Receipt) => Promise<string> {
  return async r => identifier(await invoke(client, "lean_accept_receipt", {
    p_source: r.source, p_delivery_id: r.deliveryId, p_business_key: r.businessKey,
    p_topic: r.topic, p_payload_hash: r.payloadHash, p_payload: r.payload,
  }));
}
