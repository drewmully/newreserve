import crypto from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const insertMock = vi.fn();
const fromMock = vi.fn(() => ({ insert: insertMock }));

vi.mock("@/app/api/_lib/supabaseService", () => ({
  getSupabaseService: () => ({ from: fromMock }),
}));

const WEBHOOK_SECRET = "shhh_secret";

function signBody(body: string, secret = WEBHOOK_SECRET) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function makeRequest(
  body: string,
  headers: Record<string, string> = {},
  url = "http://localhost/api/subscription/webhook"
) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-shopify-hmac-sha256": signBody(body),
      "x-shopify-topic": "subscription_contracts/create",
      "x-shopify-webhook-id": "wh_1",
      "x-shopify-shop-domain": "mullybox-store.myshopify.com",
      ...headers,
    },
    body,
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/subscription/webhook/route");
}

describe("/api/subscription/webhook", () => {
  beforeEach(() => {
    insertMock.mockReset().mockResolvedValue({ data: null, error: null });
    fromMock.mockClear();
    process.env.SHOPIFY_SUBSCRIPTIONS_WEBHOOK_SECRET = WEBHOOK_SECRET;
  });

  it("401s when SHOPIFY_SUBSCRIPTIONS_WEBHOOK_SECRET is missing", async () => {
    delete process.env.SHOPIFY_SUBSCRIPTIONS_WEBHOOK_SECRET;
    const body = JSON.stringify({ id: 1 });
    const req = new NextRequest("http://x/", {
      method: "POST",
      headers: {
        "x-shopify-hmac-sha256": signBody(body, "anything"),
        "x-shopify-topic": "subscription_contracts/create",
      },
      body,
    });
    const { POST } = await loadRoute();
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("401s on an invalid HMAC", async () => {
    const body = JSON.stringify({ id: 1 });
    const req = new NextRequest("http://x/", {
      method: "POST",
      headers: {
        "x-shopify-hmac-sha256": "not-a-real-signature",
        "x-shopify-topic": "subscription_contracts/create",
      },
      body,
    });
    const { POST } = await loadRoute();
    const res = await POST(req);
    expect(res.status).toBe(401);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("verifies HMAC and inserts the raw payload", async () => {
    const body = JSON.stringify({ id: 12345, status: "ACTIVE" });
    const { POST } = await loadRoute();
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toEqual({ ok: true, topic: "subscription_contracts/create" });

    expect(fromMock).toHaveBeenCalledWith("subscription_events");
    expect(insertMock).toHaveBeenCalledTimes(1);
    const inserted = insertMock.mock.calls[0]![0];
    expect(inserted).toMatchObject({
      source_event_id: "wh_1",
      topic: "subscription_contracts/create",
      shop_domain: "mullybox-store.myshopify.com",
      payload: { id: 12345, status: "ACTIVE" },
    });
    expect(typeof inserted.received_at).toBe("string");
    expect(typeof inserted.raw_body_bytes).toBe("number");
  });

  it("returns duplicate:true on Postgres unique violation without a second row", async () => {
    insertMock.mockResolvedValueOnce({
      data: null,
      error: { code: "23505", message: "duplicate key" },
    });
    const body = JSON.stringify({ id: 1 });
    const { POST } = await loadRoute();
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.duplicate).toBe(true);
  });

  it("skips (200) unsupported topics rather than persisting or 4xxing", async () => {
    const body = JSON.stringify({ id: 1 });
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest(body, { "x-shopify-topic": "orders/paid" })
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.skipped).toBe(true);
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("500s on non-duplicate Supabase errors", async () => {
    insertMock.mockResolvedValueOnce({
      data: null,
      error: { code: "XXXXX", message: "boom" },
    });
    const body = JSON.stringify({ id: 1 });
    const { POST } = await loadRoute();
    const res = await POST(makeRequest(body));
    expect(res.status).toBe(500);
  });

  it("falls back to a deterministic source_event_id when X-Shopify-Webhook-Id is missing", async () => {
    const body = JSON.stringify({ id: 1 });
    const headers = {
      "x-shopify-hmac-sha256": signBody(body),
      "x-shopify-topic": "subscription_contracts/create",
    };
    const { POST } = await loadRoute();
    const res = await POST(
      new NextRequest("http://x/", { method: "POST", headers, body })
    );
    expect(res.status).toBe(200);
    const inserted = insertMock.mock.calls[0]![0];
    expect(inserted.source_event_id).toMatch(/^[a-f0-9]{64}$/);
  });
});
