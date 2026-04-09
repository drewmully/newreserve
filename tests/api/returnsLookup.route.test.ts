import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const checkRateLimitMock = vi.fn();
const fetchMock = vi.fn();

vi.mock("@/lib/rateLimit", () => ({
  checkRateLimit: checkRateLimitMock,
}));

function makeRequest(body: Record<string, unknown>) {
  return new NextRequest("http://localhost/api/returns/lookup", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-forwarded-for": "203.0.113.12",
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
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({
        orders: [
          {
            id: 11,
            name: "#1234",
            email: "Member@Example.com",
            created_at: new Date().toISOString(),
            refunds: [],
            line_items: [
              {
                id: 91,
                sku: "SKU-1",
                title: "Club Cap",
                variant_title: "Black",
                quantity: 1,
                price: "38.00",
                image: { src: "https://cdn.example/cap.jpg" },
                properties: [],
              },
            ],
          },
        ],
      }),
    });

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
    expect(json).toEqual(
      expect.objectContaining({
        orderId: "11",
        orderName: "#1234",
        items: [
          expect.objectContaining({
            lineItemId: "91",
            returnableQty: 1,
            alreadyReturned: false,
          }),
        ],
      })
    );
  });
});
