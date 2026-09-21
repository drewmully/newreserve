import { createHmac } from "node:crypto";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  rpc: vi.fn(async () => ({ data: 1 as unknown, error: null as unknown })),
  create: vi.fn(),
}));
vi.mock("@supabase/supabase-js", () => ({
  createClient: (...args: unknown[]) => { mocks.create(...args); return { rpc: mocks.rpc }; },
}));
import { POST } from "@/app/api/analytics/ingest/shopify/route";
import { getAnalyticsSupabase } from "@/lib/analytics/serverClient";

const url = "https://analytics-test.supabase.co";
const body = '{"id":"123","total_price":"18.00"}';
function request(signature = createHmac("sha256", "test-secret").update(body).digest("base64"), payload = body) {
  return new NextRequest("https://fixture.invalid/api/analytics/ingest/shopify", {
    method: "POST", body: payload, headers: {
      "x-shopify-hmac-sha256": signature, "x-shopify-shop-domain": "fixture.myshopify.com",
      "x-shopify-topic": "orders/paid", "x-shopify-webhook-id": "fixture-delivery",
    },
  });
}
beforeEach(() => {
  vi.stubEnv("LEAN_ANALYTICS_RECEIPTS_ENABLED", "true");
  vi.stubEnv("LEAN_SHOPIFY_WEBHOOK_SECRET", "test-secret");
  vi.stubEnv("LEAN_SHOPIFY_SHOP_DOMAIN", "fixture.myshopify.com");
  vi.stubEnv("LEAN_ANALYTICS_SUPABASE_URL", url);
  vi.stubEnv("LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY", "test-key");
  mocks.create.mockClear(); mocks.rpc.mockReset().mockResolvedValue({ data: 1, error: null });
});
afterEach(() => { vi.unstubAllEnvs(); });

describe("analytics ingress with mocked transport only", () => {
  it("stays disabled without creating a database client", async () => {
    vi.stubEnv("LEAN_ANALYTICS_RECEIPTS_ENABLED", "false");
    expect((await POST(request())).status).toBe(404);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("does not fall back to the app's production database configuration", async () => {
    vi.stubEnv("LEAN_ANALYTICS_SUPABASE_URL", "");
    vi.stubEnv("SUPABASE_URL", "https://unintended.supabase.co");
    vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "unintended-key");
    expect((await POST(request())).status).toBe(503);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("requires a dedicated service credential", async () => {
    vi.stubEnv("LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY", "");
    expect((await POST(request())).status).toBe(503);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("verifies the signature before constructing a database client", async () => {
    expect((await POST(request("bad"))).status).toBe(400);
    expect(mocks.create).not.toHaveBeenCalled();
  });
  it("rejects oversized streamed bodies without a database write", async () => {
    expect((await POST(request("bad", "a".repeat(1024 * 1024 + 1)))).status).toBe(413);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it("acknowledges after storage through the reusable adapter", async () => {
    const response = await POST(request());
    expect(response.status).toBe(202);
    expect(await response.json()).toEqual({ accepted: true, receiptId: "1" });
    expect(mocks.create).toHaveBeenCalledWith(url, "test-key",
      { auth: { persistSession: false, autoRefreshToken: false } });
    expect(mocks.rpc).toHaveBeenCalledWith("lean_accept_receipt", expect.objectContaining({
      p_source: "shopify", p_delivery_id: "fixture-delivery", p_payload: { id: "123", total_price: "18.00" },
    }));
  });
  it("does not acknowledge a failed database write or leak its error", async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { message: "private" } });
    const response = await POST(request());
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });
  it.each(["http://example.com", "not a url", "https://user:pass@example.com", "https://example.com/rest/v1", "https://example.com?token=private"])(
    "rejects unsafe or non-base configuration %s", rawUrl => {
      vi.stubEnv("LEAN_ANALYTICS_SUPABASE_URL", rawUrl);
      expect(() => getAnalyticsSupabase()).toThrow("analytics_database_invalid_url");
      expect(mocks.create).not.toHaveBeenCalled();
    });
});
