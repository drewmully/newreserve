import { describe, expect, it, vi } from "vitest";
import { createReceiptStore, createWorkerStore } from "@/lib/analytics/rpcStore";
import { runAnalyticsWorker } from "@/lib/analytics/worker";
import type { Receipt } from "@/lib/analytics/receipts";

const receipt: Receipt = { source: "shopify", deliveryId: "test-delivery", businessKey: "test-key",
  topic: "orders/paid", payloadHash: "a".repeat(64), payload: { id: "1" } };
const work = { work_id: 1, receipt_id: 2, topic: "orders/paid", payload: { id: "1" }, attempts: 1 };
const client = (data: unknown, error: unknown = null) => ({ rpc: vi.fn(async () => ({ data, error })) });

describe("analytics RPC adapters", () => {
  it("maps receipt fields and supports exact string identifiers", async () => {
    const db = client("9007199254740993");
    expect(await createReceiptStore(db)(receipt)).toBe("9007199254740993");
    expect(db.rpc).toHaveBeenCalledWith("lean_accept_receipt", {
      p_source: "shopify", p_delivery_id: "test-delivery", p_business_key: "test-key",
      p_topic: "orders/paid", p_payload_hash: receipt.payloadHash, p_payload: { id: "1" },
    });
  });
  it.each([null, false, {}, 0, -1, Number.MAX_SAFE_INTEGER + 1, "invalid"])(
    "rejects invalid receipt ID %j rather than acknowledging storage", async data => {
      await expect(createReceiptStore(client(data))(receipt)).rejects.toThrow("invalid_identifier");
    });
  it("does not treat RPC errors as an empty queue or expose database error text", async () => {
    const db = client([], { message: "private customer payload" });
    await expect(createWorkerStore(db).claim("token", 10, 120)).rejects.toThrow("analytics_rpc_unavailable");
  });
  it.each([null, {}, [work, work], [{ ...work, attempts: 0 }], [{ ...work, receipt_id: null }]])(
    "rejects malformed claim response %j", async data => {
      await expect(createWorkerStore(client(data)).claim("token", 10, 120)).rejects.toThrow();
    });
  it("accepts a genuinely empty claim", async () => {
    expect(await createWorkerStore(client([])).claim("token", 10, 120)).toEqual([]);
  });
  it("maps work and distinguishes an expired lease from completion", async () => {
    const db = client([work]);
    expect(await createWorkerStore(db).claim("token", 10, 120)).toEqual([
      { ...work, work_id: "1", receipt_id: "2" },
    ]);
    expect(db.rpc).toHaveBeenCalledWith("lean_claim_work", { p_token: "token", p_limit: 10, p_lease_seconds: 120 });
    expect(await createWorkerStore(client(false)).finish("1", "token", "v1", {})).toBe(false);
  });
  it.each([null, "true", 1, {}])("rejects non-boolean completion %j", async data => {
    await expect(createWorkerStore(client(data)).finish("1", "token", "v1", {})).rejects.toThrow("invalid_boolean");
  });
  it("does not mark failed or repeat a transformation after an ambiguous completion response", async () => {
    const rpc = vi.fn(async (name: string) => {
      if (name === "lean_claim_work") return { data: [work], error: null };
      throw new Error("lost response including sensitive data");
    });
    const transform = vi.fn(() => ({ orders: [] }));
    await expect(runAnalyticsWorker(createWorkerStore({ rpc }), transform, "v1"))
      .rejects.toThrow("analytics_rpc_unavailable");
    expect(transform).toHaveBeenCalledTimes(1);
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["lean_claim_work", "lean_finish_work"]);
  });
  it("persists a safe failure code when the transformer rejects a receipt", async () => {
    const rpc = vi.fn(async (name: string) => ({ data: name === "lean_claim_work" ? [work] : true, error: null }));
    expect(await runAnalyticsWorker(createWorkerStore({ rpc }), () => { throw new Error("private"); }, "v1"))
      .toEqual({ claimed: 1, completed: 0, failed: 1, lostLease: 0 });
    expect(rpc).toHaveBeenLastCalledWith("lean_fail_work", expect.objectContaining({ p_work_id: "1", p_code: "transform_failed" }));
  });
});
