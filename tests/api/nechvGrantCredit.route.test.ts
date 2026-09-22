import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for POST /api/nechv/grant-credit.
 *
 * We mock firebase-admin (auth + firestore) and the Shopify helpers so
 * the route logic is exercised in isolation: auth gating, idempotency,
 * eligibility, and the success persistence path.
 */

// ── firebase-admin auth + firestore mocks ─────────────────────────────
const verifyIdToken = vi.fn();
const setFn = vi.fn();
const docGet = vi.fn();
const docRef = { get: docGet, set: setFn };
const collectionDoc = vi.fn(() => docRef);
const collection = vi.fn(() => ({ doc: collectionDoc }));

vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken },
  adminDb: { collection },
}));

// ── Shopify helper mocks ──────────────────────────────────────────────
const resolveOrCreateCustomerByEmail = vi.fn();
const creditCustomerStoreCredit = vi.fn();

vi.mock("@/app/api/_lib/shopifyAdmin", () => ({
  resolveOrCreateCustomerByEmail,
  creditCustomerStoreCredit,
}));

function makeReq(headers: Record<string, string> = {}): NextRequest {
  return new NextRequest("http://localhost/api/nechv/grant-credit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...headers,
    },
  });
}

async function loadRoute() {
  vi.resetModules();
  return import("@/app/api/nechv/grant-credit/route");
}

beforeEach(() => {
  verifyIdToken.mockReset();
  setFn.mockReset().mockResolvedValue(undefined);
  docGet.mockReset();
  collectionDoc.mockClear();
  collection.mockClear();
  resolveOrCreateCustomerByEmail.mockReset();
  creditCustomerStoreCredit.mockReset();
});

describe("POST /api/nechv/grant-credit", () => {
  it("returns 401 without a bearer token", async () => {
    const { POST } = await loadRoute();
    const res = await POST(makeReq());
    expect(res.status).toBe(401);
    const json = await res.json();
    expect(json.ok).toBe(false);
  });

  it("returns 401 when token verification fails", async () => {
    verifyIdToken.mockRejectedValue(new Error("bad token"));
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ Authorization: "Bearer xyz" }));
    expect(res.status).toBe(401);
  });

  it("returns 404 when the user doc is missing", async () => {
    verifyIdToken.mockResolvedValue({ uid: "uid-1" });
    docGet.mockResolvedValue({ exists: false, data: () => undefined });
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ Authorization: "Bearer abc" }));
    expect(res.status).toBe(404);
  });

  it("returns 400 when the user has no email on file", async () => {
    verifyIdToken.mockResolvedValue({ uid: "uid-1" });
    docGet.mockResolvedValue({
      exists: true,
      data: () => ({ signup_source: "nechv" }),
    });
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ Authorization: "Bearer abc" }));
    expect(res.status).toBe(400);
  });

  it("returns 403 when signup_source is not 'nechv'", async () => {
    verifyIdToken.mockResolvedValue({ uid: "uid-1" });
    docGet.mockResolvedValue({
      exists: true,
      data: () => ({ email: "u@example.com", signup_source: "homepage_email_cta" }),
    });
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ Authorization: "Bearer abc" }));
    expect(res.status).toBe(403);
    expect(creditCustomerStoreCredit).not.toHaveBeenCalled();
    expect(resolveOrCreateCustomerByEmail).not.toHaveBeenCalled();
  });

  it("is idempotent: returns ok:true with already_granted when the flag is set", async () => {
    verifyIdToken.mockResolvedValue({ uid: "uid-1" });
    docGet.mockResolvedValue({
      exists: true,
      data: () => ({
        email: "u@example.com",
        signup_source: "nechv",
        nechv_credit_granted: true,
        nechv_credit_amount: 25,
        shopify_customer_id: "999",
      }),
    });
    const { POST } = await loadRoute();
    const res = await POST(makeReq({ Authorization: "Bearer abc" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      ok: true,
      already_granted: true,
      amount: 25,
      shopify_customer_id: "999",
    });
    expect(resolveOrCreateCustomerByEmail).not.toHaveBeenCalled();
    expect(creditCustomerStoreCredit).not.toHaveBeenCalled();
    expect(setFn).not.toHaveBeenCalled();
  });

  it("happy path: creates Shopify customer, credits $25, persists state", async () => {
    verifyIdToken.mockResolvedValue({ uid: "uid-1" });
    docGet.mockResolvedValue({
      exists: true,
      data: () => ({ email: "new@example.com", signup_source: "nechv" }),
    });
    resolveOrCreateCustomerByEmail.mockResolvedValue({
      customerId: "12345",
      created: true,
    });
    creditCustomerStoreCredit.mockResolvedValue({
      ok: true,
      accountId: "gid://shopify/StoreCreditAccount/42",
      balanceAmount: 25,
      currencyCode: "USD",
      transactionAmount: 25,
    });

    const { POST, NECHV_CREDIT_AMOUNT } = await loadRoute();
    const res = await POST(makeReq({ Authorization: "Bearer abc" }));

    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({
      ok: true,
      already_granted: false,
      amount: NECHV_CREDIT_AMOUNT,
      shopify_customer_id: "12345",
      account_id: "gid://shopify/StoreCreditAccount/42",
      balance_after: 25,
    });

    expect(resolveOrCreateCustomerByEmail).toHaveBeenCalledWith({
      email: "new@example.com",
      tags: ["nechv-signup", "newreserve"],
    });
    expect(creditCustomerStoreCredit).toHaveBeenCalledWith({
      customerId: "12345",
      amount: NECHV_CREDIT_AMOUNT,
      currencyCode: "USD",
    });

    // Persistence — last write should include the flag + amount.
    expect(setFn).toHaveBeenCalledTimes(1);
    const writtenPayload = setFn.mock.calls[0][0] as Record<string, unknown>;
    expect(writtenPayload).toMatchObject({
      shopify_customer_id: "12345",
      nechv_credit_granted: true,
      nechv_credit_amount: NECHV_CREDIT_AMOUNT,
      nechv_credit_account_id: "gid://shopify/StoreCreditAccount/42",
    });
  });

  it("reuses an existing shopify_customer_id when present", async () => {
    verifyIdToken.mockResolvedValue({ uid: "uid-1" });
    docGet.mockResolvedValue({
      exists: true,
      data: () => ({
        email: "existing@example.com",
        signup_source: "nechv",
        shopify_customer_id: "55",
      }),
    });
    creditCustomerStoreCredit.mockResolvedValue({
      ok: true,
      accountId: "gid://shopify/StoreCreditAccount/9",
      balanceAmount: 25,
      currencyCode: "USD",
      transactionAmount: 25,
    });

    const { POST } = await loadRoute();
    const res = await POST(makeReq({ Authorization: "Bearer abc" }));
    expect(res.status).toBe(200);

    expect(resolveOrCreateCustomerByEmail).not.toHaveBeenCalled();
    expect(creditCustomerStoreCredit).toHaveBeenCalledWith({
      customerId: "55",
      amount: 25,
      currencyCode: "USD",
    });
  });

  it("returns 502 and does NOT mark granted when Shopify credit fails", async () => {
    verifyIdToken.mockResolvedValue({ uid: "uid-1" });
    docGet.mockResolvedValue({
      exists: true,
      data: () => ({ email: "u@example.com", signup_source: "nechv" }),
    });
    resolveOrCreateCustomerByEmail.mockResolvedValue({
      customerId: "1",
      created: true,
    });
    creditCustomerStoreCredit.mockResolvedValue({
      ok: false,
      error: "Customer is not eligible",
    });

    const { POST } = await loadRoute();
    const res = await POST(makeReq({ Authorization: "Bearer abc" }));
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.ok).toBe(false);

    // We should persist the shopify_customer_id even on credit failure, but
    // we must NOT have written nechv_credit_granted: true.
    expect(setFn).toHaveBeenCalledTimes(1);
    const writtenPayload = setFn.mock.calls[0][0] as Record<string, unknown>;
    expect(writtenPayload.shopify_customer_id).toBe("1");
    expect(writtenPayload.nechv_credit_granted).toBeUndefined();
  });

  it("returns 502 when resolveOrCreateCustomerByEmail throws", async () => {
    verifyIdToken.mockResolvedValue({ uid: "uid-1" });
    docGet.mockResolvedValue({
      exists: true,
      data: () => ({ email: "u@example.com", signup_source: "nechv" }),
    });
    resolveOrCreateCustomerByEmail.mockRejectedValue(new Error("shopify down"));

    const { POST } = await loadRoute();
    const res = await POST(makeReq({ Authorization: "Bearer abc" }));
    expect(res.status).toBe(502);
    expect(creditCustomerStoreCredit).not.toHaveBeenCalled();
    expect(setFn).not.toHaveBeenCalled();
  });
});
