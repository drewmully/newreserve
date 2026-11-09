import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.fn();
const adminDbCollectionMock = vi.fn();
const resolveCustomerByEmailMock = vi.fn();
const getLoopRawSubscriptionsMock = vi.fn();
const pauseLoopSubscriptionMock = vi.fn();

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
  getLoopRawSubscriptions: getLoopRawSubscriptionsMock,
  pauseLoopSubscription: pauseLoopSubscriptionMock,
  resumeLoopSubscription: vi.fn(),
  cancelLoopSubscription: vi.fn(),
  changeLoopSubscriptionPlan: vi.fn(),
  reactivateLoopSubscription: vi.fn(),
}));

function makeUserRef(data: Record<string, unknown>) {
  return {
    get: vi.fn().mockResolvedValue({
      exists: true,
      data: () => data,
    }),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

function makeRequest(url: string, method: "GET" | "POST", body?: Record<string, unknown>) {
  return new NextRequest(url, {
    method,
    headers: {
      Authorization: "Bearer token-123",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function loadSubscriptionRoute() {
  vi.resetModules();
  return import("@/app/api/loop/subscription/route");
}

async function loadActionRoute() {
  vi.resetModules();
  return import("@/app/api/loop/subscription/[action]/route");
}

describe("Loop subscription routes", () => {
  beforeEach(() => {
    verifyIdTokenMock.mockReset().mockResolvedValue({ uid: "uid_123" });
    adminDbCollectionMock.mockReset();
    resolveCustomerByEmailMock.mockReset();
    getLoopRawSubscriptionsMock.mockReset();
    pauseLoopSubscriptionMock.mockReset().mockResolvedValue(undefined);
  });

  it("uses the canonical Shopify customer id when fetching subscriptions", async () => {
    const userRef = makeUserRef({
      email: "member@example.com",
      shopify_customer_id: "shopify-customer-123",
    });

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name !== "users") throw new Error(`Unexpected collection ${name}`);
      return { doc: vi.fn(() => userRef) };
    });

    getLoopRawSubscriptionsMock.mockResolvedValue([
      { id: "sub_1", status: "ACTIVE" },
      { id: "sub_2", status: "PAUSED" },
    ]);

    const { GET } = await loadSubscriptionRoute();
    const res = await GET(makeRequest("http://localhost/api/loop/subscription", "GET"));
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(getLoopRawSubscriptionsMock).toHaveBeenCalledWith("shopify-customer-123");
    expect(resolveCustomerByEmailMock).not.toHaveBeenCalled();
    expect(json).toEqual({
      subscription: { id: "sub_1", status: "ACTIVE" },
      subscriptions: [
        { id: "sub_1", status: "ACTIVE" },
        { id: "sub_2", status: "PAUSED" },
      ],
      source: "loop",
    });
  });

  it("requires an explicit subscriptionId when multiple matching subscriptions exist", async () => {
    const userRef = makeUserRef({
      email: "member@example.com",
      shopify_customer_id: "shopify-customer-123",
    });

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name !== "users") throw new Error(`Unexpected collection ${name}`);
      return { doc: vi.fn(() => userRef) };
    });

    getLoopRawSubscriptionsMock.mockResolvedValue([
      { id: "sub_1", status: "ACTIVE" },
      { id: "sub_2", status: "PAUSED" },
    ]);

    const { POST } = await loadActionRoute();
    const res = await POST(
      makeRequest("http://localhost/api/loop/subscription/pause", "POST"),
      { params: Promise.resolve({ action: "pause" }) }
    );
    const json = await res.json();

    expect(res.status).toBe(409);
    expect(json).toEqual({
      error: "Multiple matching subscriptions found",
      subscriptionIds: ["sub_1", "sub_2"],
    });
    expect(pauseLoopSubscriptionMock).not.toHaveBeenCalled();
  });

  it("mutates the requested subscription when subscriptionId is provided", async () => {
    const userRef = makeUserRef({
      email: "member@example.com",
      shopify_customer_id: "shopify-customer-123",
    });

    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name !== "users") throw new Error(`Unexpected collection ${name}`);
      return { doc: vi.fn(() => userRef) };
    });

    getLoopRawSubscriptionsMock.mockResolvedValue([
      { id: "sub_1", status: "ACTIVE" },
      { id: "sub_2", status: "PAUSED" },
    ]);

    const { POST } = await loadActionRoute();
    const res = await POST(
      makeRequest("http://localhost/api/loop/subscription/pause", "POST", {
        subscriptionId: "sub_2",
      }),
      { params: Promise.resolve({ action: "pause" }) }
    );
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json).toEqual({ ok: true });
    expect(getLoopRawSubscriptionsMock).toHaveBeenCalledWith("shopify-customer-123");
    expect(pauseLoopSubscriptionMock).toHaveBeenCalledWith("sub_2");
  });
});

describe("Loop cancel fallback", () => {
  it("returns the Mully Loop portal URL when a cancel fails", async () => {
    vi.resetModules();
    vi.doMock("@/app/api/_lib/loopUserContext", () => ({
      verifyFirebaseBearer: vi.fn().mockResolvedValue("uid_1"),
      getLoopUserContext: vi.fn().mockResolvedValue({
        loopCustomerIdentifier: "123",
        shopifyCustomerId: "123",
        userRef: {},
        userData: {},
        email: "m@example.com",
      }),
    }));
    vi.doMock("@/app/api/_lib/loopAdmin", () => ({
      LOOP_CUSTOMER_PORTAL_URL: "https://checkout.mymully.com/a/loop_subscriptions/customer",
      getLoopRawSubscriptions: vi.fn().mockResolvedValue([{ id: "9", status: "ACTIVE", isPrepaid: true }]),
      cancelLoopSubscription: vi.fn().mockRejectedValue(new Error("Loop cancel error 422")),
      pauseLoopSubscription: vi.fn(),
      resumeLoopSubscription: vi.fn(),
      changeLoopSubscriptionPlan: vi.fn(),
      reactivateLoopSubscription: vi.fn(),
      swapLoopSubscriptionProduct: vi.fn(),
    }));
    const { POST } = await import("@/app/api/loop/subscription/[action]/route");
    const res = await POST(
      makeRequest("http://localhost/api/loop/subscription/cancel", "POST", { reason: "x" }),
      { params: Promise.resolve({ action: "cancel" }) }
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.fallbackUrl).toBe("https://checkout.mymully.com/a/loop_subscriptions/customer");
    vi.doUnmock("@/app/api/_lib/loopUserContext");
    vi.doUnmock("@/app/api/_lib/loopAdmin");
  });
});
