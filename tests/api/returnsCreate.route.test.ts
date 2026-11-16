import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { daysAgo, fulfillment, jsonRes, line, order } from "../fixtures/returnsOrder";

const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  checkRateLimit: vi.fn(),
  sendPlainText: vi.fn(),
  verifyIdToken: vi.fn(),
  userDoc: vi.fn(),
}));

vi.mock("@/lib/rateLimit", () => ({ checkRateLimit: mocks.checkRateLimit }));
vi.mock("@/lib/email/resend", () => ({ sendPlainText: mocks.sendPlainText }));
vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: { verifyIdToken: mocks.verifyIdToken },
  adminDb: { collection: () => ({ doc: (uid: string) => ({ get: () => mocks.userDoc(uid) }) }) },
}));

const CRON = "cron-secret-at-least-16";

async function load() {
  vi.resetModules();
  const route = await import("@/app/api/returns/create/route");
  const token = await import("@/lib/returns/token");
  return { POST: route.POST, ...token };
}

function req(body: unknown, headers: Record<string, string> = {}) {
  return new NextRequest("http://localhost/api/returns/create", {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-forwarded-for": "203.0.113.5", ...headers },
    body: JSON.stringify(body),
  });
}

const baseOrder = () =>
  order({
    lineItems: [
      line({ id: 91, title: "Club Polo", quantity: 2, price: "50.00" }),
      line({ id: 92, title: "Final Cap", attrs: [{ key: "Final Sale", value: "yes" }] }),
    ],
    fulfillments: [fulfillment(1, [{ fli: 501, lineItem: 91, quantity: 2 }, { fli: 502, lineItem: 92 }])],
  });

function mockShopify(o: unknown, mutation: unknown = { returnRequest: { return: { id: "gid://shopify/Return/77", status: "REQUESTED" }, userErrors: [] } }) {
  mocks.fetch.mockImplementation(async (_url: string, init: { body: string }) => {
    const { query } = JSON.parse(init.body);
    if (query.includes("ReturnOrderSnapshot")) return jsonRes({ data: { order: o } });
    if (query.includes("returnRequest")) return jsonRes({ data: mutation });
    throw new Error("unexpected query");
  });
}

const returnRequestCalls = () =>
  mocks.fetch.mock.calls
    .map((c) => JSON.parse(c[1].body))
    .filter((b) => b.query.includes("returnRequest"));

describe("POST /api/returns/create", () => {
  beforeEach(() => {
    process.env.SHOPIFY_STORE_DOMAIN = "store.example";
    process.env.SHOPIFY_ADMIN_TOKEN = "admin-token";
    process.env.CRON_SECRET = CRON;
    delete process.env.RETURNS_TOKEN_SECRET;
    mocks.fetch.mockReset();
    vi.stubGlobal("fetch", mocks.fetch);
    mocks.checkRateLimit.mockReset().mockReturnValue({ allowed: true, remaining: 9, retryAfterSeconds: 0 });
    mocks.sendPlainText.mockReset().mockResolvedValue("msg_1");
    mocks.verifyIdToken.mockReset();
    mocks.userDoc.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "log").mockImplementation(() => {});
  });

  const tokenFor = (sign: (i: { orderId: string; orderName: string; email: string; orderType: "pro_shop" | "subscription" }, now?: number) => string | null, over: Partial<{ orderId: string; email: string }> = {}, now?: number) =>
    sign({ orderId: "11", orderName: "#1234", email: "member@example.com", orderType: "pro_shop", ...over }, now)!;

  const items = [{ lineItemId: "91", quantity: 1, reason: "Too large" }];

  it("rejects a request with no token and never touches Shopify", async () => {
    const { POST } = await load();
    const res = await POST(req({ orderId: "11", items, customerEmail: "member@example.com" }));
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("return_token_invalid");
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects a forged token", async () => {
    const { POST, signReturnToken } = await load();
    process.env.CRON_SECRET = "attacker-guessed-secret";
    const forged = tokenFor(signReturnToken);
    process.env.CRON_SECRET = CRON;
    const res = await POST(req({ returnToken: forged, items }));
    expect(res.status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects an expired token with a look-up-again code", async () => {
    const { POST, signReturnToken } = await load();
    const old = tokenFor(signReturnToken, {}, Date.now() - 2 * 60 * 60 * 1000);
    const res = await POST(req({ returnToken: old, items }));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Your session expired. Please look up your order again.", code: "return_token_expired" });
  });

  it("fails closed with a friendly message when no secret is configured", async () => {
    delete process.env.CRON_SECRET;
    const { POST } = await load();
    const res = await POST(req({ returnToken: "abc.def", items }));
    expect(res.status).toBe(503);
    expect((await res.json()).error).toContain("info@mymully.com");
  });

  it("rejects a token for a different orderId than the body", async () => {
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: tokenFor(signReturnToken), orderId: "999", items }));
    expect(res.status).toBe(401);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects when the order email no longer matches the token", async () => {
    mockShopify(order({ ...{}, email: "someone@else.com", lineItems: [line({ id: 91 })], fulfillments: [fulfillment(1, [{ fli: 501, lineItem: 91 }])] }));
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: tokenFor(signReturnToken), items }));
    expect(res.status).toBe(403);
    expect(returnRequestCalls()).toHaveLength(0);
  });

  it("rejects quantities above the returnable quantity", async () => {
    mockShopify(baseOrder());
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: tokenFor(signReturnToken), items: [{ lineItemId: "91", quantity: 3, reason: "Other" }] }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("quantity_exceeded");
    expect(returnRequestCalls()).toHaveLength(0);
  });

  it.each([
    [0, "zero"],
    [1.5, "fractional"],
    [-1, "negative"],
  ])("rejects a %s quantity (%s)", async (quantity) => {
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: tokenFor(signReturnToken), items: [{ lineItemId: "91", quantity, reason: "Other" }] }));
    expect(res.status).toBe(400);
    expect(mocks.fetch).not.toHaveBeenCalled();
  });

  it("rejects unknown reasons", async () => {
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: tokenFor(signReturnToken), items: [{ lineItemId: "91", quantity: 1, reason: "SIZE_TOO_SMALL" }] }));
    expect(res.status).toBe(400);
  });

  it("rejects final-sale items", async () => {
    mockShopify(baseOrder());
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: tokenFor(signReturnToken), items: [{ lineItemId: "92", quantity: 1, reason: "Other" }] }));
    expect(res.status).toBe(422);
    expect((await res.json()).code).toBe("final_sale");
    expect(returnRequestCalls()).toHaveLength(0);
  });

  it("rejects items outside the 30-days-from-delivery window", async () => {
    mockShopify(order({ lineItems: [line({ id: 91 })], fulfillments: [fulfillment(1, [{ fli: 501, lineItem: 91 }], { createdAt: daysAgo(35), deliveredAt: daysAgo(31) })] }));
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: tokenFor(signReturnToken), items }));
    expect(res.status).toBe(422);
    const json = await res.json();
    expect(json.code).toBe("outside_window");
    expect(json.error).toContain("30 days from delivery");
  });

  it("rejects a lineItemId that belongs to another order", async () => {
    mockShopify(baseOrder());
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: tokenFor(signReturnToken), items: [{ lineItemId: "4242", quantity: 1, reason: "Other" }] }));
    expect(res.status).toBe(422);
    expect(returnRequestCalls()).toHaveLength(0);
  });

  it("ignores client membershipTier: guests pay the free-tier fee", async () => {
    mockShopify(baseOrder());
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: tokenFor(signReturnToken), items, membershipTier: "black", customerEmail: "x@y.com" }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ returnId: "gid://shopify/Return/77", returnStatus: "REQUESTED", itemsCreditAmount: 50, shippingCost: 9.95, estimatedCreditAmount: 40.05, status: "submitted" });
    expect(mocks.verifyIdToken).not.toHaveBeenCalled();
  });

  it("uses the Firestore tier for a signed-in user whose email matches the order", async () => {
    mockShopify(baseOrder());
    mocks.verifyIdToken.mockResolvedValue({ uid: "u1", email: "MEMBER@example.com" });
    mocks.userDoc.mockResolvedValue({ exists: true, data: () => ({ tier: "member" }) });
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: tokenFor(signReturnToken), items }, { Authorization: "Bearer id-token" }));
    expect((await res.json()).shippingCost).toBe(0);
    expect(mocks.userDoc).toHaveBeenCalledWith("u1");
  });

  it("does not apply a signed-in member's tier to someone else's order", async () => {
    mockShopify(baseOrder());
    mocks.verifyIdToken.mockResolvedValue({ uid: "u2", email: "other@example.com" });
    mocks.userDoc.mockResolvedValue({ exists: true, data: () => ({ tier: "black" }) });
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: tokenFor(signReturnToken), items }, { Authorization: "Bearer id-token" }));
    expect((await res.json()).shippingCost).toBe(9.95);
    expect(mocks.userDoc).not.toHaveBeenCalled();
  });

  it("sends the right Shopify reasons and fulfillment line items", async () => {
    mockShopify(baseOrder());
    const { POST, signReturnToken } = await load();
    await POST(req({ returnToken: tokenFor(signReturnToken), items: [{ lineItemId: "91", quantity: 2, reason: "Wrong size" }] }));
    expect(returnRequestCalls()[0].variables.input).toEqual({
      orderId: "gid://shopify/Order/11",
      returnLineItems: [{ fulfillmentLineItemId: "gid://shopify/FulfillmentLineItem/501", quantity: 2, returnReason: "OTHER", customerNote: "Wrong size" }],
    });
  });

  it("emails the customer a confirmation (transactional, order + items)", async () => {
    mockShopify(baseOrder());
    const { POST, signReturnToken } = await load();
    await POST(req({ returnToken: tokenFor(signReturnToken), items }));
    expect(mocks.sendPlainText).toHaveBeenCalledTimes(1);
    const mail = mocks.sendPlainText.mock.calls[0][0];
    expect(mail).toMatchObject({ to: "member@example.com", sendClass: "transactional", category: "returns_request_confirmation", idempotencyKey: "returns-request-77" });
    expect(mail.subject).toContain("#1234");
    expect(mail.text).toContain("Club Polo");
    expect(mail.text).toContain("under review");
    expect(mail.text).toContain("original payment method");
    expect(mail.text).toContain("info@mymully.com");
  });

  it("still succeeds when the confirmation email fails", async () => {
    mockShopify(baseOrder());
    mocks.sendPlainText.mockRejectedValue(new Error("resend down"));
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: tokenFor(signReturnToken), items }));
    expect(res.status).toBe(200);
  });

  it("returns a generic message for Shopify userErrors", async () => {
    mockShopify(baseOrder(), { returnRequest: { return: null, userErrors: [{ field: ["x"], message: "Internal: fulfillment line item gid://... invalid" }] } });
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: tokenFor(signReturnToken), items }));
    const json = await res.json();
    expect(res.status).toBe(422);
    expect(json.error).not.toContain("Internal");
    expect(json.error).toContain("info@mymully.com");
  });

  it("returns a generic 500 without Shopify text when Shopify errors", async () => {
    mocks.fetch.mockResolvedValue(jsonRes({ errors: "secret shop detail" }, false, 502));
    const { POST, signReturnToken } = await load();
    const res = await POST(req({ returnToken: tokenFor(signReturnToken), items }));
    const json = await res.json();
    expect(res.status).toBe(500);
    expect(JSON.stringify(json)).not.toContain("secret shop detail");
    expect(JSON.stringify(json)).not.toContain("502");
  });
});
