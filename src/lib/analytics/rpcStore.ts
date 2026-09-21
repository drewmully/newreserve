import type { Receipt } from "./receipts";
import type { Work, WorkerStore } from "./worker";

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

export function createWorkerStore(client: AnalyticsRpcClient): WorkerStore {
  async function booleanResult(name: string, args: Record<string, unknown>): Promise<boolean> {
    const data = await invoke(client, name, args);
    if (typeof data !== "boolean") throw new Error("analytics_rpc_invalid_boolean");
    return data;
  }
  return {
    async claim(token, limit, leaseSeconds) {
      const data = await invoke(client, "lean_claim_work", {
        p_token: token, p_limit: limit, p_lease_seconds: leaseSeconds,
      });
      if (!Array.isArray(data) || data.length > limit) throw new Error("analytics_rpc_invalid_claim");
      const seen = new Set<string>();
      return data.map((value: unknown): Work => {
        if (!value || typeof value !== "object") throw new Error("analytics_rpc_invalid_claim");
        const row = value as Record<string, unknown>;
        const workId = identifier(row.work_id);
        if (seen.has(workId) || typeof row.topic !== "string" || !row.topic ||
            !Object.hasOwn(row, "payload") || !Number.isInteger(row.attempts) ||
            (row.attempts as number) < 1 || (row.attempts as number) > 5)
          throw new Error("analytics_rpc_invalid_claim");
        seen.add(workId);
        return { work_id: workId, receipt_id: identifier(row.receipt_id),
          topic: row.topic, payload: row.payload, attempts: row.attempts as number };
      });
    },
    finish: (id, token, version, facts) => booleanResult("lean_finish_work", {
      p_work_id: id, p_token: token, p_version: version, p_facts: facts,
    }),
    fail: (id, token, code) => booleanResult("lean_fail_work", {
      p_work_id: id, p_token: token, p_code: code,
    }),
  };
}
