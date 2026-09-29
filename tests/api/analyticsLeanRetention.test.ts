import { createHash, createHmac } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { acceptShopifyReceipt } from "@/lib/analytics/receipts";
import { FINANCIAL_RETENTION, projectPilotRetention } from "@/lib/analytics/shopifyRetention";
import { runShopifyPipeline } from "@/lib/analytics/shopifyPipeline";
import { PILOT_FINANCIAL_QUERY, PILOT_REFUND_QUERY } from "@/lib/analytics/shopifyPilotSource";
import { SHOPIFY_FINANCIAL_ORDER_QUERY, SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY, sourceObject } from "@/lib/analytics/shopifySource";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import { runtimeSource, runtimePolicy, runtimeShop, runtimeProject, runtimeConnection, runtimeMoney } from "../fixtures/analyticsRetainedRuntime";
const route = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/analytics/serverClient", () => ({ getAnalyticsSupabase: () => ({ rpc: route.rpc }) }));
import { POST } from "@/app/api/analytics/ingest/shopify/route";
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
function envelope(payload: Record<string, unknown>, topic = "orders/updated") {
  const body = Buffer.from(JSON.stringify(payload));
  return { body, topic, secret: "synthetic", signature: createHmac("sha256", "synthetic").update(body).digest("base64"),
    deliveryId: "fixture", shop: runtimeShop, allowedShop: runtimeShop };
}
function harness(source = runtimeSource(), policy: unknown = runtimePolicy, retained: unknown = null) {
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const client: AnalyticsRpcClient = { async rpc(name, args) {
    calls.push({ name, args });
    return { error: null, data: name === "lean_pipeline_claim" ? {
      state: "claimed", workId: "1", topic: "orders/updated", payload: { id: "1" }, policy,
      publication: "shopify:1", source: retained, fromTime: "2026-01-01T00:00:00Z", untilTime: "2026-02-01T00:00:00Z",
    } : true };
  } };
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    const { query, variables } = JSON.parse(String(init?.body));
    let data;
    if ([SHOPIFY_FINANCIAL_ORDER_QUERY, SHOPIFY_FINANCIAL_ORDER_SIZE_QUERY].includes(query)) data = { order: source.commerce.order };
    else if (query === PILOT_FINANCIAL_QUERY) data = { order: source.financial };
    else if (query === PILOT_REFUND_QUERY) data = { refund: source.refunds.find(r => r.id === variables.id) };
    else throw new Error("unexpected_query");
    return new Response(JSON.stringify({ data }), { headers: { "X-Shopify-API-Version": "2026-07" } });
  });
  const run = () => runShopifyPipeline({ client, projectRef: runtimeProject,
    databaseUrl: `https://${runtimeProject}.supabase.co`, shop: runtimeShop, accessToken: "fixture", fetcher });
  return { run, calls, fetcher, client };
}
describe("explicit minimized retention and extended caller", () => {
  it("keeps only lineage after HMAC and hashes original bytes, not sanitized bytes", async () => {
    const input = envelope({ id: "1", updated_at: "2026-01-02T12:00:00Z", email: "private@example.invalid", customer: { id: "x" } });
    const store = vi.fn(async () => "1");
    await acceptShopifyReceipt({ ...input, retention: FINANCIAL_RETENTION }, store);
    expect(store.mock.calls[0]).toEqual([expect.objectContaining({
      payload: { id: "1", updated_at: "2026-01-02T12:00:00Z" },
      payloadHash: createHash("sha256").update(input.body).digest("hex"),
    })]);
    store.mockClear();
    await acceptShopifyReceipt(input, store);
    expect(store.mock.calls[0]).toEqual([expect.objectContaining({ payload: JSON.parse(input.body.toString()) })]);
    await expect(acceptShopifyReceipt({ ...input, signature: "bad", retention: FINANCIAL_RETENTION }, store)).rejects.toThrow("invalid_signature");
    expect(store).toHaveBeenCalledTimes(1);
  });
  it("retains refund/order lineage but no refunded customer/line payloads", async () => {
    const store = vi.fn(async () => "1");
    await acceptShopifyReceipt({ ...envelope({ id: "9", order_id: "1", created_at: "2026-01-02", refund_line_items: [{ email: "x" }] }, "refunds/create"),
      retention: FINANCIAL_RETENTION }, store);
    expect(store.mock.calls[0]).toEqual([expect.objectContaining({ payload: { id: "9", order_id: "1", created_at: "2026-01-02" } })]);
    await expect(acceptShopifyReceipt({ ...envelope({ id: "9" }, "refunds/create"), retention: FINANCIAL_RETENTION }, store))
      .rejects.toThrow("invalid_refund_order_id");
  });
  it("rejects nested objects in selected receipt scalar fields before storage", async () => {
    const store = vi.fn(async () => "1");
    await expect(acceptShopifyReceipt({ ...envelope({ id: "1", updated_at: { email: "x" } }), retention: FINANCIAL_RETENTION }, store))
      .rejects.toThrow("invalid_retention_shape");
    expect(store).not.toHaveBeenCalled();
  });
  it.each([
    { id: "9", order_id: 9007199254740992 },
    { id: "9", order_id: "private@example.invalid" },
    { id: "9", order_id: "1", updated_at: "private" },
    { id: "gid://shopify/Order/9", order_id: "1" },
  ])("rejects invalid minimized refund identifiers/revisions %j", async payload => {
    const store = vi.fn(async () => "1");
    await expect(acceptShopifyReceipt({ ...envelope(payload, "refunds/create"), retention: FINANCIAL_RETENTION }, store))
      .rejects.toThrow();
    expect(store).not.toHaveBeenCalled();
  });
  it("allowlists financial, refund and commerce shapes recursively without mutating source", () => {
    const source = runtimeSource();
    source.commerce.order.email = "private";
    source.financial.customer = { id: "private" };
    sourceObject(source.financial.totalTaxSet).extra = { email: "private" };
    source.refunds = [{ id: "gid://shopify/Refund/9", createdAt: "2026-01-02", updatedAt: "2026-01-02",
      order: { id: "gid://shopify/Order/1", customer: "private" }, totalRefundedSet: runtimeMoney("1"),
      duties: [{ amountSet: runtimeMoney("0"), email: "private" }], orderAdjustments: runtimeConnection([]),
      refundLineItems: runtimeConnection([{ id: "a", quantity: 1, lineItem: { id: "b", name: "private" },
        subtotalSet: runtimeMoney("1"), totalTaxSet: runtimeMoney("0"), email: "private" }]),
      refundShippingLines: runtimeConnection([]), transactions: runtimeConnection([]), email: "private" }];
    const before = JSON.stringify(source), result = projectPilotRetention(source);
    expect(JSON.stringify(result)).not.toContain("private");
    expect(result.refunds[0].id).toBe("gid://shopify/Refund/9");
    expect(JSON.stringify(source)).toBe(before);
    sourceObject(sourceObject(source.financial.totalTaxSet).shopMoney).amount = { email: "private" };
    expect(() => projectPilotRetention(source)).toThrow("invalid_retention_shape");
  });
  it("removes unknown keys at every nested object boundary", () => {
    const original = runtimeSource(), source = structuredClone(original);
    function poison(value: unknown) {
      if (!value || typeof value !== "object") return;
      Object.values(value).forEach(poison);
      if (!Array.isArray(value)) (value as Record<string, unknown>).__private = { email: "private" };
    }
    poison(source);
    expect(projectPilotRetention(source)).toEqual(original);
  });
  it("retains minimized source and finishes products in one RPC with financial values unchanged", async () => {
    const source = runtimeSource(); source.commerce.order.email = "private"; source.financial.email = "private";
    const h = harness(source);
    expect(await h.run()).toEqual({ state: "done" });
    const retained = h.calls.find(c => c.name === "lean_pipeline_retain")!.args.p_source;
    expect(JSON.stringify(retained)).not.toContain("private");
    const finish = h.calls.at(-1)!;
    expect(finish.name).toBe("lean_pipeline_finish_extended");
    expect(finish.args.p_order_item_sizes).toBeNull();
    expect(finish.args.p_reports).toEqual([expect.objectContaining({ total_sales_usd: "22.000000", is_stale: true })]);
    expect(finish.args.p_product_reports).toEqual([expect.objectContaining({ net_merchandise_sales_usd: "18.000000" })]);
  });
  it("uses unchanged legacy finish when the extended policy is absent", async () => {
    const policy = { ...runtimePolicy };
    delete policy.retainedReports;
    const h = harness(runtimeSource(), policy);
    expect(await h.run()).toEqual({ state: "done" });
    expect(h.calls.at(-1)?.name).toBe("lean_pipeline_finish");
    expect(h.calls.at(-1)?.args).not.toHaveProperty("p_product_reports");
  });
  it.each([
    { retainedReports: "unknown" }, { sourceRetention: "raw" }, { sourceProjection: "financial_customer_id" },
    { orderSize: null }, { orderSize: { policyRef: "x" } },
    { sourceProjection: "financial_no_geo_order_size" },
    { sourceProjection: "financial_no_geo_order_size", orderSize: { policyRef: "", productSemantics: { "3": "requested_box_top_size" } } },
    { sourceProjection: "financial_no_geo_order_size", orderSize: { policyRef: "x", productSemantics: { "3": "guessed" } } },
    { sourceProjection: "financial_no_geo_order_size", orderSize: { policyRef: "x", productSemantics: {} } },
    { sourceProjection: "financial_no_geo_order_size", orderSize: { policyRef: "x", productSemantics: { "3": ["requested_box_top_size"] } } },
  ])("rejects invalid saved opts before source calls %j", async change => {
    const h = harness(runtimeSource(), { ...runtimePolicy, ...change });
    expect(await h.run()).toEqual({ state: "failed" }); expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.calls.at(-1)?.name).toBe("lean_pipeline_fail");
    expect(h.calls.some(c => c.name === "lean_pipeline_retain")).toBe(false);
  });
  it("never rewrites a broader existing immutable snapshot under minimized retention", async () => {
    const source = runtimeSource(); source.financial.email = "private";
    const h = harness(source, runtimePolicy, source);
    expect(await h.run()).toEqual({ state: "failed" }); expect(h.fetcher).not.toHaveBeenCalled();
    expect(h.calls.some(c => c.name === "lean_pipeline_retain")).toBe(false);
  });
  it("passes an explicit size sidecar only with the sized source and policy", async () => {
    const source = runtimeSource();
    const line = (sourceObject(source.commerce.order.lineItems).nodes as Record<string, unknown>[])[0];
    line.customAttributes = [{ key: "Top size", value: "m" }, { key: "Private", value: "private" }];
    line.variantTitle = null;
    const h = harness(source, { ...runtimePolicy, sourceProjection: "financial_no_geo_order_size",
      orderSize: { policyRef: "fixture:size", productSemantics: { "3": "requested_box_top_size" } } });
    expect(await h.run()).toEqual({ state: "done" });
    expect(h.calls.at(-1)?.args.p_order_item_sizes).toEqual([expect.objectContaining({ size_value: "M", size_status: "known" })]);
    expect(JSON.stringify(h.calls.find(c => c.name === "lean_pipeline_retain")?.args.p_source)).not.toContain("private");
  });
  it("propagates ambiguous extended finish without failure/retry writes", async () => {
    const h = harness(), original = h.client.rpc.bind(h.client);
    h.client.rpc = async (name, args) => {
      if (name === "lean_pipeline_finish_extended") throw new Error("lost response");
      return original(name, args);
    };
    await expect(h.run()).rejects.toThrow("pipeline_storage_unavailable");
    expect(h.calls.some(c => c.name === "lean_pipeline_fail")).toBe(false);
  });
  it("uses the production ingress opt-in and refuses an incompatible pilot", async () => {
    vi.stubEnv("LEAN_ANALYTICS_RECEIPTS_ENABLED", "true");
    vi.stubEnv("LEAN_SHOPIFY_WEBHOOK_SECRET", "synthetic");
    vi.stubEnv("LEAN_SHOPIFY_SHOP_DOMAIN", runtimeShop);
    vi.stubEnv("LEAN_ANALYTICS_RECEIPT_RETENTION", FINANCIAL_RETENTION);
    route.rpc.mockReset().mockResolvedValue({ data: "1", error: null });
    const input = envelope({ id: "1", email: "private" });
    const req = () => new NextRequest("https://fixture.invalid/api/analytics/ingest/shopify", {
      method: "POST", body: input.body.toString(), headers: { "x-shopify-hmac-sha256": input.signature,
        "x-shopify-shop-domain": runtimeShop, "x-shopify-topic": input.topic, "x-shopify-webhook-id": "fixture" },
    });
    expect((await POST(req())).status).toBe(202);
    expect(route.rpc).toHaveBeenLastCalledWith("lean_accept_receipt", expect.objectContaining({ p_payload: { id: "1" } }));
    vi.stubEnv("LEAN_ANALYTICS_SHOPIFY_PILOT_ENABLED", "true"); route.rpc.mockClear();
    expect((await POST(req())).status).toBe(503); expect(route.rpc).not.toHaveBeenCalled();
  });
});
