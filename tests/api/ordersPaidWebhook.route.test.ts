import crypto from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatchAnalyticsEventMock = vi.fn();
const persistAnalyticsEventMock = vi.fn();
const aggregateKpiDailyMock = vi.fn();
const adminDbCollectionMock = vi.fn();

vi.mock("@/app/api/_lib/analytics", () => ({
  dispatchAnalyticsEvent: dispatchAnalyticsEventMock,
}));

vi.mock("@/app/api/_lib/kpiReporting", () => ({
  persistAnalyticsEvent: persistAnalyticsEventMock,
  aggregateKpiDaily: aggregateKpiDailyMock,
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminDb: {
    collection: adminDbCollectionMock,
  },
}));

function buildHmac(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

function buildRequest(input: {
  body: string;
  secret: string;
  webhookId?: string;
  hmacOverride?: string;
}): NextRequest {
  return new NextRequest("http://localhost/api/webhooks/shopify/orders-paid", {
    method: "POST",
    headers: {
      "x-shopify-hmac-sha256":
        input.hmacOverride ?? buildHmac(input.body, input.secret),
      "x-shopify-webhook-id": input.webhookId ?? "wh_1",
      "x-shopify-topic": "orders/paid",
      "content-type": "application/json",
    },
    body: input.body,
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/webhooks/shopify/orders-paid/route");
}

describe("POST /api/webhooks/shopify/orders-paid", () => {
  beforeEach(() => {
    dispatchAnalyticsEventMock.mockReset().mockResolvedValue(undefined);
    persistAnalyticsEventMock.mockReset().mockResolvedValue(undefined);
    aggregateKpiDailyMock.mockReset().mockResolvedValue(undefined);
    adminDbCollectionMock.mockReset();
    process.env.SHOPIFY_WEBHOOK_SECRET = "webhook_secret";
  });

  it("returns 401 when HMAC is invalid", async () => {
    const { POST } = await loadRoute();
    const req = buildRequest({
      body: JSON.stringify({ id: 1, line_items: [] }),
      secret: "webhook_secret",
      hmacOverride: "invalid",
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ error: "Unauthorized" });
  });

  it("returns duplicate=true when webhook receipt already exists", async () => {
    const receiptGet = vi.fn().mockResolvedValue({ exists: true });
    const receiptSet = vi.fn();

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name === "webhook_receipts") {
        return {
          doc: vi.fn(() => ({
            get: receiptGet,
            set: receiptSet,
          })),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    const { POST } = await loadRoute();
    const req = buildRequest({
      body: JSON.stringify({ id: 2, line_items: [] }),
      secret: "webhook_secret",
      webhookId: "wh_dup",
    });

    const res = await POST(req);
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true, duplicate: true });
    expect(receiptSet).not.toHaveBeenCalled();
    expect(dispatchAnalyticsEventMock).not.toHaveBeenCalled();
  });

  it("processes valid webhook and updates user tier from variant", async () => {
    const receiptGet = vi.fn().mockResolvedValue({ exists: false });
    const receiptSet = vi.fn().mockResolvedValue(undefined);
    const userUpdate = vi.fn().mockResolvedValue(undefined);
    const usersGet = vi.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: "uid_123",
          data: () => ({ shopify_customer_id: null }),
          ref: { update: userUpdate },
        },
      ],
    });

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name === "webhook_receipts") {
        return {
          doc: vi.fn(() => ({
            get: receiptGet,
            set: receiptSet,
          })),
        };
      }
      if (name === "users") {
        return {
          where: vi.fn(() => ({
            limit: vi.fn(() => ({
              get: usersGet,
            })),
          })),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    const body = JSON.stringify({
      id: 1001,
      order_number: 77,
      email: "member@example.com",
      phone: null,
      total_price: "249.00",
      currency: "USD",
      browser_ip: "198.51.100.24",
      client_details: {
        browser_ip: "198.51.100.24",
        user_agent: "Shopify Checkout Browser",
      },
      customer: { id: 999, email: "member@example.com" },
      line_items: [
        {
          id: 1,
          title: "Reserve Access Plan",
          quantity: 1,
          price: "99.00",
          sku: "ACCESS",
          variant_id: 47601025482944,
        },
      ],
    });

    const { POST } = await loadRoute();
    const res = await POST(
      buildRequest({
        body,
        secret: "webhook_secret",
        webhookId: "wh_ok",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(dispatchAnalyticsEventMock).toHaveBeenCalledTimes(1);
    expect(dispatchAnalyticsEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: "purchase",
        user_id: "uid_123",
        ip: "198.51.100.24",
        user_agent: "Shopify Checkout Browser",
        properties: expect.objectContaining({
          reserve_user_id: "uid_123",
          shopify_customer_id: "999",
        }),
      })
    );
    expect(persistAnalyticsEventMock).toHaveBeenCalledTimes(1);
    expect(aggregateKpiDailyMock).toHaveBeenCalledTimes(1);
    expect(userUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        tier: "access",
        shopify_customer_id: "999",
      })
    );
  });

  it("matches Shopify GID customer ids and uses the Firebase UID for purchases", async () => {
    const receiptGet = vi.fn().mockResolvedValue({ exists: false });
    const receiptSet = vi.fn().mockResolvedValue(undefined);
    const userUpdate = vi.fn().mockResolvedValue(undefined);
    const emptyUsersGet = vi.fn().mockResolvedValue({ empty: true, docs: [] });
    const gidUsersGet = vi.fn().mockResolvedValue({
      empty: false,
      docs: [
        {
          id: "firebase_uid_456",
          data: () => ({ shopify_customer_id: "gid://shopify/Customer/9352715862208" }),
          ref: { update: userUpdate },
        },
      ],
    });

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name === "webhook_receipts") {
        return {
          doc: vi.fn(() => ({
            get: receiptGet,
            set: receiptSet,
          })),
        };
      }
      if (name === "users") {
        return {
          where: vi.fn((_field: string, _operator: string, value: string) => ({
            limit: vi.fn(() => ({
              get: value === "gid://shopify/Customer/9352715862208"
                ? gidUsersGet
                : emptyUsersGet,
            })),
          })),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    const body = JSON.stringify({
      id: 1002,
      order_number: 78,
      email: "member@example.com",
      phone: null,
      total_price: "249.00",
      currency: "USD",
      customer: { id: 9352715862208, email: "member@example.com" },
      line_items: [
        {
          id: 1,
          title: "Reserve Access Plan",
          quantity: 1,
          price: "99.00",
          sku: "ACCESS",
          variant_id: 47601025482944,
        },
      ],
    });

    const { POST } = await loadRoute();
    const res = await POST(
      buildRequest({
        body,
        secret: "webhook_secret",
        webhookId: "wh_gid",
      })
    );

    expect(res.status).toBe(200);
    expect(dispatchAnalyticsEventMock).toHaveBeenCalledWith(
      expect.objectContaining({
        event_name: "purchase",
        user_id: "firebase_uid_456",
        properties: expect.objectContaining({
          reserve_user_id: "firebase_uid_456",
          shopify_customer_id: "9352715862208",
        }),
      })
    );
    expect(dispatchAnalyticsEventMock).not.toHaveBeenCalledWith(
      expect.objectContaining({
        user_id: "9352715862208",
      })
    );
  });
});
