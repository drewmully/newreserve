import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.fn();
const adminDbCollectionMock = vi.fn();
const resolveCustomerByEmailMock = vi.fn();
const getLoopSubscriptionStatusMock = vi.fn();
const getLoopManageSubscriptionUrlMock = vi.fn();
const getLoopNextUnblockUrlMock = vi.fn();

vi.mock("firebase-admin/firestore", () => ({
  FieldValue: {
    serverTimestamp: vi.fn(() => "server-ts"),
  },
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: {
    verifyIdToken: verifyIdTokenMock,
  },
  adminDb: {
    collection: adminDbCollectionMock,
  },
}));

vi.mock("@/app/api/_lib/shopifyAdmin", () => ({
  resolveCustomerByEmail: resolveCustomerByEmailMock,
}));

vi.mock("@/app/api/_lib/loopAdmin", () => ({
  getLoopSubscriptionStatus: getLoopSubscriptionStatusMock,
  getLoopManageSubscriptionUrl: getLoopManageSubscriptionUrlMock,
  getLoopNextUnblockUrl: getLoopNextUnblockUrlMock,
}));

function makeRequest(withAuth = true): NextRequest {
  const headers = new Headers();
  if (withAuth) {
    headers.set("Authorization", "Bearer token-123");
  }

  return new NextRequest("http://localhost/api/loop/subscription-status", {
    method: "GET",
    headers,
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/loop/subscription-status/route");
}

describe("GET /api/loop/subscription-status", () => {
  beforeEach(() => {
    verifyIdTokenMock.mockReset();
    adminDbCollectionMock.mockReset();
    resolveCustomerByEmailMock.mockReset();
    getLoopSubscriptionStatusMock.mockReset();
    getLoopManageSubscriptionUrlMock.mockReset();
    getLoopNextUnblockUrlMock.mockReset();
  });

  it("returns 401 when Authorization is missing", async () => {
    const { GET } = await loadRoute();
    const res = await GET(makeRequest(false));
    const json = await res.json();

    expect(res.status).toBe(401);
    expect(json).toEqual({ error: "Unauthorized" });
  });

  it("returns cached subscriptions when Shopify customer is missing", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "uid_cache" });

    const userRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          shopify_customer_id: null,
          subscriptions: {
            mullybox_active: false,
            status: "none",
            total_subscription_count: 0,
            active_subscription_ids: [],
            manage_url: null,
            next_unblock_url: null,
          },
        }),
      }),
      update: vi.fn(),
    };

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: vi.fn(() => userRef),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    const { GET } = await loadRoute();
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      subscriptions: {
        mullybox_active: false,
        status: "none",
        total_subscription_count: 0,
        active_subscription_ids: [],
        manage_url: null,
        next_unblock_url: null,
      },
      source: "cache",
    });
  });

  it("returns live loop status and composes manage_url when loop succeeds", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "uid_loop" });
    getLoopSubscriptionStatusMock.mockResolvedValue({
      mullybox_active: true,
      status: "active",
      total_subscription_count: 1,
      active_subscription_ids: ["sub_1"],
      manage_url: null,
      next_unblock_url: null,
    });
    getLoopManageSubscriptionUrlMock.mockReturnValue(
      "https://loop/manage?customer_id=123"
    );
    getLoopNextUnblockUrlMock.mockReturnValue("https://store/unblock");

    const userRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          shopify_customer_id: "123",
          email: "member@example.com",
          subscriptions: null,
        }),
      }),
      update: vi.fn().mockResolvedValue(undefined),
    };

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: vi.fn(() => userRef),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    const { GET } = await loadRoute();
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      subscriptions: {
        mullybox_active: true,
        status: "active",
        total_subscription_count: 1,
        active_subscription_ids: ["sub_1"],
        manage_url: "https://loop/manage?customer_id=123",
        next_unblock_url: "https://store/unblock",
      },
      source: "loop",
    });
    expect(getLoopSubscriptionStatusMock).toHaveBeenCalledWith("123");
    expect(getLoopManageSubscriptionUrlMock).toHaveBeenCalledWith("123");
    expect(userRef.update).toHaveBeenCalledWith({
      subscriptions: {
        mullybox_active: true,
        status: "active",
        total_subscription_count: 1,
        active_subscription_ids: ["sub_1"],
        manage_url: "https://loop/manage?customer_id=123",
        next_unblock_url: "https://store/unblock",
        last_checked: "server-ts",
      },
    });
  });

  it("falls back to cached subscriptions when Loop fetch fails", async () => {
    verifyIdTokenMock.mockResolvedValue({ uid: "uid_fallback" });
    getLoopSubscriptionStatusMock.mockRejectedValue(new Error("loop down"));

    const userRef = {
      get: vi.fn().mockResolvedValue({
        exists: true,
        data: () => ({
          shopify_customer_id: "123",
          email: "member@example.com",
          subscriptions: {
            mullybox_active: false,
            status: "paused",
            total_subscription_count: 0,
            active_subscription_ids: [],
            manage_url: null,
            next_unblock_url: null,
          },
        }),
      }),
      update: vi.fn(),
    };

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name === "users") {
        return {
          doc: vi.fn(() => userRef),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });

    const { GET } = await loadRoute();
    const res = await GET(makeRequest());
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({
      subscriptions: {
        mullybox_active: false,
        status: "paused",
        total_subscription_count: 0,
        active_subscription_ids: [],
        manage_url: null,
        next_unblock_url: null,
      },
      source: "cache",
    });
  });
});
