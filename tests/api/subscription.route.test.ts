import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.fn();
const adminDbCollectionMock = vi.fn();
const resolveCustomerByEmailMock = vi.fn();

const pauseContractMock = vi.fn();
const activateContractMock = vi.fn();
const cancelContractMock = vi.fn();
const updateContractMock = vi.fn();
const skipNextCycleMock = vi.fn();
const getContractMock = vi.fn();

vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken: verifyIdTokenMock },
  adminDb: { collection: adminDbCollectionMock },
}));

vi.mock("@/app/api/_lib/shopifyAdmin", () => ({
  resolveCustomerByEmail: resolveCustomerByEmailMock,
}));

vi.mock("@/app/api/_lib/shopifySubscriptionsApi", () => ({
  pauseContract: pauseContractMock,
  activateContract: activateContractMock,
  cancelContract: cancelContractMock,
  updateContract: updateContractMock,
  skipNextCycle: skipNextCycleMock,
  getContract: getContractMock,
  retryBilling: vi.fn(),
  unskipNextCycle: vi.fn(),
  createContractAtomic: vi.fn(),
}));

function makeUserRef(data: Record<string, unknown>) {
  return {
    get: vi.fn().mockResolvedValue({ exists: true, data: () => data }),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

function bindUser(ref: ReturnType<typeof makeUserRef>) {
  adminDbCollectionMock.mockImplementation((name: string) => {
    if (name !== "users") throw new Error(`Unexpected collection ${name}`);
    return { doc: vi.fn(() => ref) };
  });
}

function makeRequest(url: string, body?: Record<string, unknown>) {
  return new NextRequest(url, {
    method: "POST",
    headers: {
      Authorization: "Bearer token-123",
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/subscription/[action]/route");
}

describe("/api/subscription/[action]", () => {
  beforeEach(() => {
    verifyIdTokenMock.mockReset().mockResolvedValue({ uid: "uid_x" });
    adminDbCollectionMock.mockReset();
    resolveCustomerByEmailMock.mockReset();
    pauseContractMock.mockReset().mockResolvedValue(undefined);
    activateContractMock.mockReset().mockResolvedValue(undefined);
    cancelContractMock.mockReset().mockResolvedValue(undefined);
    updateContractMock.mockReset().mockResolvedValue(undefined);
    skipNextCycleMock.mockReset().mockResolvedValue(undefined);
    getContractMock.mockReset();
    delete process.env.SUBSCRIPTIONS_BACKEND;
  });

  it("returns 404 by default (SUBSCRIPTIONS_BACKEND unset, treated as 'loop')", async () => {
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest("http://localhost/api/subscription/pause"),
      { params: Promise.resolve({ action: "pause" }) }
    );
    expect(res.status).toBe(404);
    expect(pauseContractMock).not.toHaveBeenCalled();
  });

  it("returns 404 when SUBSCRIPTIONS_BACKEND=loop", async () => {
    process.env.SUBSCRIPTIONS_BACKEND = "loop";
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest("http://localhost/api/subscription/pause"),
      { params: Promise.resolve({ action: "pause" }) }
    );
    expect(res.status).toBe(404);
  });

  it("400s on unknown action even when flag is 'shopify'", async () => {
    process.env.SUBSCRIPTIONS_BACKEND = "shopify";
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest("http://localhost/api/subscription/does-not-exist"),
      { params: Promise.resolve({ action: "does-not-exist" }) }
    );
    expect(res.status).toBe(400);
  });

  it("401s without a valid Authorization header when flag is 'shopify'", async () => {
    process.env.SUBSCRIPTIONS_BACKEND = "shopify";
    verifyIdTokenMock.mockRejectedValueOnce(new Error("bad token"));
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest("http://localhost/api/subscription/pause"),
      { params: Promise.resolve({ action: "pause" }) }
    );
    expect(res.status).toBe(401);
  });

  it("pauses the only contract on the user doc", async () => {
    process.env.SUBSCRIPTIONS_BACKEND = "shopify";
    bindUser(
      makeUserRef({
        email: "m@e.co",
        shopify_customer_id: "1",
        subscription_contract_ids: ["gid://shopify/SubscriptionContract/A"],
      })
    );

    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest("http://localhost/api/subscription/pause"),
      { params: Promise.resolve({ action: "pause" }) }
    );
    expect(res.status).toBe(200);
    expect(pauseContractMock).toHaveBeenCalledWith("gid://shopify/SubscriptionContract/A");
  });

  it("409s when multiple contracts exist and no contractId is given", async () => {
    process.env.SUBSCRIPTIONS_BACKEND = "shopify";
    bindUser(
      makeUserRef({
        email: "m@e.co",
        shopify_customer_id: "1",
        subscription_contract_ids: [
          "gid://shopify/SubscriptionContract/A",
          "gid://shopify/SubscriptionContract/B",
        ],
      })
    );

    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest("http://localhost/api/subscription/pause"),
      { params: Promise.resolve({ action: "pause" }) }
    );
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.contractIds).toHaveLength(2);
    expect(pauseContractMock).not.toHaveBeenCalled();
  });

  it("routes the resume action to activateContract", async () => {
    process.env.SUBSCRIPTIONS_BACKEND = "shopify";
    bindUser(
      makeUserRef({
        shopify_customer_id: "1",
        subscription_contract_ids: ["gid://shopify/SubscriptionContract/A"],
      })
    );
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest("http://localhost/api/subscription/resume"),
      { params: Promise.resolve({ action: "resume" }) }
    );
    expect(res.status).toBe(200);
    expect(activateContractMock).toHaveBeenCalledWith(
      "gid://shopify/SubscriptionContract/A"
    );
  });

  it("skip-next calls skipNextCycle", async () => {
    process.env.SUBSCRIPTIONS_BACKEND = "shopify";
    bindUser(
      makeUserRef({
        shopify_customer_id: "1",
        subscription_contract_ids: ["gid://shopify/SubscriptionContract/A"],
      })
    );
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest("http://localhost/api/subscription/skip-next"),
      { params: Promise.resolve({ action: "skip-next" }) }
    );
    expect(res.status).toBe(200);
    expect(skipNextCycleMock).toHaveBeenCalledWith(
      "gid://shopify/SubscriptionContract/A"
    );
  });

  it("update-payment-method calls updateContract with paymentMethodId", async () => {
    process.env.SUBSCRIPTIONS_BACKEND = "shopify";
    bindUser(
      makeUserRef({
        shopify_customer_id: "1",
        subscription_contract_ids: ["gid://shopify/SubscriptionContract/A"],
      })
    );
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest("http://localhost/api/subscription/update-payment-method", {
        paymentMethodId: "gid://shopify/CustomerPaymentMethod/pm1",
      }),
      { params: Promise.resolve({ action: "update-payment-method" }) }
    );
    expect(res.status).toBe(200);
    expect(updateContractMock).toHaveBeenCalledWith(
      "gid://shopify/SubscriptionContract/A",
      { paymentMethodId: "gid://shopify/CustomerPaymentMethod/pm1" }
    );
  });

  it("update-line-attributes forwards attributes for the requested line", async () => {
    process.env.SUBSCRIPTIONS_BACKEND = "shopify";
    bindUser(
      makeUserRef({
        shopify_customer_id: "1",
        subscription_contract_ids: ["gid://shopify/SubscriptionContract/A"],
      })
    );
    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest("http://localhost/api/subscription/update-line-attributes", {
        lineId: "gid://shopify/SubscriptionLine/L1",
        attributes: [
          { key: "fit_shirt", value: "M" },
          { key: "fit_pant", value: "32x32" },
          { key: "ignored", value: 5 },
        ],
      }),
      { params: Promise.resolve({ action: "update-line-attributes" }) }
    );
    expect(res.status).toBe(200);
    expect(updateContractMock).toHaveBeenCalledWith(
      "gid://shopify/SubscriptionContract/A",
      {
        customAttributesByLineId: {
          "gid://shopify/SubscriptionLine/L1": [
            { key: "fit_shirt", value: "M" },
            { key: "fit_pant", value: "32x32" },
          ],
        },
      }
    );
  });

  it("swap-product looks up the first line when lineId isn't provided", async () => {
    process.env.SUBSCRIPTIONS_BACKEND = "shopify";
    bindUser(
      makeUserRef({
        shopify_customer_id: "1",
        subscription_contract_ids: ["gid://shopify/SubscriptionContract/A"],
      })
    );
    getContractMock.mockResolvedValue({
      id: "gid://shopify/SubscriptionContract/A",
      status: "ACTIVE",
      lines: [{ id: "gid://shopify/SubscriptionLine/L1" }],
    });

    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest("http://localhost/api/subscription/swap-product", {
        variantShopifyId: 47601025122496,
      }),
      { params: Promise.resolve({ action: "swap-product" }) }
    );
    expect(res.status).toBe(200);
    expect(updateContractMock).toHaveBeenCalledWith(
      "gid://shopify/SubscriptionContract/A",
      expect.objectContaining({
        lines: [
          expect.objectContaining({
            lineId: "gid://shopify/SubscriptionLine/L1",
            productVariantId: "gid://shopify/ProductVariant/47601025122496",
          }),
        ],
      })
    );
  });

  it("returns 502 with a detail when the Shopify client throws", async () => {
    process.env.SUBSCRIPTIONS_BACKEND = "shopify";
    bindUser(
      makeUserRef({
        shopify_customer_id: "1",
        subscription_contract_ids: ["gid://shopify/SubscriptionContract/A"],
      })
    );
    pauseContractMock.mockRejectedValueOnce(new Error("boom"));

    const { POST } = await loadRoute();
    const res = await POST(
      makeRequest("http://localhost/api/subscription/pause"),
      { params: Promise.resolve({ action: "pause" }) }
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.detail).toContain("boom");
  });
});
