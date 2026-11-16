import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NOW, daysAgo, fulfillment, jsonRes, line, order } from "../fixtures/returnsOrder";

const { checkRateLimitMock, fetchMock, verifyIdTokenMock, userDocMock } = vi.hoisted(() => ({
  checkRateLimitMock: vi.fn(),
  fetchMock: vi.fn(),
  verifyIdTokenMock: vi.fn(),
  userDocMock: vi.fn(),
}));

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: checkRateLimitMock,
}));
vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken: verifyIdTokenMock },
  adminDb: { collection: () => ({ doc: (uid: string) => ({ get: () => userDocMock(uid) }) }) },
}));

const restOrders = { orders: [{ id: 11, name: "#1234", email: "Member@Example.com" }] };

/** REST name search, then the GraphQL snapshot. */
function mockShopify(graphqlOrder: unknown) {
  fetchMock.mockImplementation(async (url: string) => {
    if (url.includes("orders.json")) return jsonRes(restOrders);
    if (url.includes("graphql.json")) return jsonRes({ data: { order: graphqlOrder } });
    throw new Error("unexpected " + url);
  });
}

function makeRequest(body: Record<string, unknown>, extraHeaders: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/returns/lookup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.12",
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/returns/lookup/route");
}

describe("POST /api/returns/lookup", () => {
  beforeEach(() => {
    delete process.env.SHOPIFY_ADMIN_API_VERSION;
    process.env.SHOPIFY_STORE_DOMAIN = "store.example";
    process.env.SHOPIFY_ADMIN_TOKEN = "admin-token";
    process.env.CRON_SECRET = "cron-secret-at-least-16";
    delete process.env.RETURNS_TOKEN_SECRET;
    verifyIdTokenMock.mockReset();
    userDocMock.mockReset();
    checkRateLimitMock.mockReset().mockReturnValue({
      allowed: true,
      remaining: 99,
      retryAfterSeconds: 0,
    });
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("rejects malformed email and order numbers before hitting Shopify", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({
        orderNumber: "ABC-123",
        email: "not-an-email",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(400);
    expect(json).toEqual({
      error: "Order number and email are required.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns 429 when the client IP is rate limited", async () => {
    checkRateLimitMock.mockReturnValueOnce({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 30,
    });

    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({
        orderNumber: "#1234",
        email: "member@example.com",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("30");
    expect(json).toEqual({
      error: "Too many return lookups. Please try again later.",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("normalizes the lookup and returns returnable order items", async () => {
    mockShopify(
      order({
        lineItems: [line({ id: 91, title: "Club Cap", variantTitle: "Black", price: "38.00", image: "https://cdn.shopify.com/cap.jpg" })],
        fulfillments: [fulfillment(1, [{ fli: 501, lineItem: 91 }])],
      })
    );

    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest({
        orderNumber: "#1234",
        email: "member@example.com",
      })
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining(
        "https://store.example/admin/api/2024-10/orders.json?name=%231234&status=any"
      ),
      expect.objectContaining({
        headers: expect.objectContaining({
          "X-Shopify-Access-Token": "admin-token",
        }),
      })
    );
    // Exactly one GraphQL call on top of the REST search.
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("graphql.json"))).toHaveLength(1);
    expect(json).toEqual(
      expect.objectContaining({
        orderId: "11",
        orderName: "#1234",
        orderType: "pro_shop",
        policy: {
          windowDays: 30,
          resolutionSchedule: [{ throughDay: 30, resolution: "refund_original_payment" }],
          exchangeAllowed: true,
          condition: "unworn_with_tags",
        },
        returnShippingCost: 9.95,
        items: [
          expect.objectContaining({
            lineItemId: "91",
            returnableQty: 1,
            alreadyReturned: false,
            price: 38,
            image: "https://cdn.shopify.com/cap.jpg",
            resolution: "refund_original_payment",
          }),
        ],
      })
    );
  });

  it("returns a signed return token bound to the order and email", async () => {
    mockShopify(order({ lineItems: [line({ id: 91 })], fulfillments: [fulfillment(1, [{ fli: 501, lineItem: 91 }])] }));
    const { POST } = await loadRoute();
    const json = await (await POST(makeRequest({ orderNumber: "1234", email: "MEMBER@example.com" }))).json();
    const { verifyReturnToken } = await import("@/lib/returns/token");
    expect(verifyReturnToken(json.returnToken)).toEqual({
      ok: true,
      payload: expect.objectContaining({ orderId: "11", orderName: "#1234", email: "member@example.com", orderType: "pro_shop" }),
    });
  });

  it("rejects orders whose shipments were all delivered more than 30 days ago", async () => {
    mockShopify(
      order({ createdAt: daysAgo(35), lineItems: [line({ id: 91 })], fulfillments: [fulfillment(1, [{ fli: 501, lineItem: 91 }], { createdAt: daysAgo(34), deliveredAt: daysAgo(31) })] })
    );
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ orderNumber: "#1234", email: "member@example.com" }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.error).toContain("30 days from delivery");
    expect(json.returnToken).toBeUndefined();
  });

  it("allows an old order that was delivered recently (window counts from delivery)", async () => {
    mockShopify(
      order({ createdAt: daysAgo(50), lineItems: [line({ id: 91 })], fulfillments: [fulfillment(1, [{ fli: 501, lineItem: 91 }], { createdAt: daysAgo(20), deliveredAt: daysAgo(12) })] })
    );
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ orderNumber: "#1234", email: "member@example.com" }));
    expect(res.status).toBe(200);
  });

  it("returns 404 when the email doesn't match", async () => {
    mockShopify(order({ lineItems: [line({ id: 91 })] }));
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ orderNumber: "#1234", email: "other@example.com" }));
    expect(res.status).toBe(404);
    expect(fetchMock.mock.calls.filter((c) => String(c[0]).includes("graphql.json"))).toHaveLength(0);
  });

  it("fails closed with a friendly message when no token secret is configured", async () => {
    delete process.env.CRON_SECRET;
    mockShopify(order({ lineItems: [line({ id: 91 })], fulfillments: [fulfillment(1, [{ fli: 501, lineItem: 91 }])] }));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ orderNumber: "#1234", email: "member@example.com" }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("info@mymully.com");
  });

  it("prices return shipping from the signed-in member's server-side tier", async () => {
    mockShopify(order({ tags: ["Subscription Recurring Order"], lineItems: [line({ id: 91 })], fulfillments: [fulfillment(1, [{ fli: 501, lineItem: 91 }])] }));
    verifyIdTokenMock.mockResolvedValue({ uid: "u1", email: "member@example.com" });
    userDocMock.mockResolvedValue({ exists: true, data: () => ({ tier: "access" }) });
    const { POST } = await loadRoute();
    const json = await (await POST(makeRequest({ orderNumber: "#1234", email: "member@example.com" }, { Authorization: "Bearer t" }))).json();
    expect(json.returnShippingCost).toBe(5.95);
    expect(json.orderType).toBe("subscription");
    expect(json.policy.resolutionSchedule).toEqual([
      { throughDay: 14, resolution: "refund_original_payment" },
      { throughDay: 30, resolution: "store_credit" },
    ]);
    expect(json.policy).not.toHaveProperty("pendingOwnerDecision");
  });

  it("returns refund vs store credit per item for a subscription order with mixed shipments", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
    try {
    mockShopify(
      order({
        tags: ["Subscription Recurring Order"],
        lineItems: [line({ id: 91 }), line({ id: 92 }), line({ id: 93 })],
        fulfillments: [
          fulfillment(1, [{ fli: 501, lineItem: 91 }], { createdAt: daysAgo(17), deliveredAt: daysAgo(14) }),
          fulfillment(2, [{ fli: 502, lineItem: 92 }], { createdAt: daysAgo(18), deliveredAt: daysAgo(15) }),
          fulfillment(3, [{ fli: 503, lineItem: 93 }], { createdAt: daysAgo(34), deliveredAt: daysAgo(31) }),
        ],
      })
    );
    const { POST } = await loadRoute();
    const json = await (await POST(makeRequest({ orderNumber: "#1234", email: "member@example.com" }))).json();
    expect(json.items.map((i: { lineItemId: string; resolution: string | null; ineligibleReason: string | null }) => [i.lineItemId, i.resolution, i.ineligibleReason])).toEqual([
      ["91", "refund_original_payment", null],
      ["92", "store_credit", null],
      ["93", null, "outside_window"],
    ]);
    expect(json.items[0].resolutionUntil).toBe(NOW.toISOString());
    } finally {
      vi.useRealTimers();
    }
  });

  it("hides Shopify error details", async () => {
    fetchMock.mockResolvedValue(jsonRes({ errors: "shop internals" }, false, 500));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { POST } = await loadRoute();
    const res = await POST(makeRequest({ orderNumber: "#1234", email: "member@example.com" }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toContain("shop internals");
  });
});
