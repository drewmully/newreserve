import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const verifyIdTokenMock = vi.fn();
const adminDbCollectionMock = vi.fn();
const resolveCustomerByEmailMock = vi.fn();

vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken: verifyIdTokenMock },
  adminDb: { collection: adminDbCollectionMock },
}));

vi.mock("@/app/api/_lib/shopifyAdmin", () => ({
  resolveCustomerByEmail: resolveCustomerByEmailMock,
}));

function makeUserRef(data: Record<string, unknown> | null) {
  return {
    get: vi.fn().mockResolvedValue({
      exists: data !== null,
      data: () => data ?? undefined,
    }),
    update: vi.fn().mockResolvedValue(undefined),
  };
}

function bindUser(userRef: ReturnType<typeof makeUserRef>) {
  adminDbCollectionMock.mockImplementation((name: string) => {
    if (name !== "users") throw new Error(`Unexpected collection ${name}`);
    return { doc: vi.fn(() => userRef) };
  });
}

async function load() {
  vi.resetModules();
  return import("@/app/api/_lib/subscriptionUserContext");
}

describe("subscriptionUserContext", () => {
  beforeEach(() => {
    verifyIdTokenMock.mockReset().mockResolvedValue({ uid: "uid_x" });
    adminDbCollectionMock.mockReset();
    resolveCustomerByEmailMock.mockReset();
  });

  it("verifyFirebaseBearer rejects when no Authorization header", async () => {
    const { verifyFirebaseBearer } = await load();
    await expect(
      verifyFirebaseBearer(new NextRequest("http://x/"))
    ).rejects.toThrow(/Authorization/);
  });

  it("returns null when user doc does not exist", async () => {
    bindUser(makeUserRef(null));
    const { getSubscriptionUserContext } = await load();
    const ctx = await getSubscriptionUserContext("uid_x");
    expect(ctx).toBeNull();
  });

  it("reads shopify_customer_id and subscription_contract_ids off the user doc", async () => {
    const ref = makeUserRef({
      email: "member@example.com",
      shopify_customer_id: "123",
      subscription_contract_ids: [
        "gid://shopify/SubscriptionContract/A",
        "gid://shopify/SubscriptionContract/B",
      ],
    });
    bindUser(ref);
    const { getSubscriptionUserContext } = await load();
    const ctx = await getSubscriptionUserContext("uid_x");
    expect(ctx).toMatchObject({
      email: "member@example.com",
      shopifyCustomerId: "123",
      subscriptionContractIds: [
        "gid://shopify/SubscriptionContract/A",
        "gid://shopify/SubscriptionContract/B",
      ],
    });
    expect(resolveCustomerByEmailMock).not.toHaveBeenCalled();
  });

  it("resolves customer via shopifyAdmin when missing and persists it back", async () => {
    const ref = makeUserRef({ email: "member@example.com" });
    bindUser(ref);
    resolveCustomerByEmailMock.mockResolvedValue("456");

    const { getSubscriptionUserContext } = await load();
    const ctx = await getSubscriptionUserContext("uid_x");
    expect(ctx?.shopifyCustomerId).toBe("456");
    expect(ref.update).toHaveBeenCalledWith({ shopify_customer_id: "456" });
  });

  it("returns an empty subscriptionContractIds array when the field is missing", async () => {
    bindUser(makeUserRef({ email: "member@example.com", shopify_customer_id: "123" }));
    const { getSubscriptionUserContext } = await load();
    const ctx = await getSubscriptionUserContext("uid_x");
    expect(ctx?.subscriptionContractIds).toEqual([]);
  });

  it("ignores non-string entries in subscription_contract_ids", async () => {
    bindUser(
      makeUserRef({
        email: "m@e.co",
        shopify_customer_id: "1",
        subscription_contract_ids: [
          "gid://shopify/SubscriptionContract/A",
          123,
          "",
          "  gid://shopify/SubscriptionContract/B  ",
        ],
      })
    );
    const { getSubscriptionUserContext } = await load();
    const ctx = await getSubscriptionUserContext("uid_x");
    expect(ctx?.subscriptionContractIds).toEqual([
      "gid://shopify/SubscriptionContract/A",
      "gid://shopify/SubscriptionContract/B",
    ]);
  });
});
