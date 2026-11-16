import crypto from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const dispatchAnalyticsEventMock = vi.fn();
const persistAnalyticsEventMock = vi.fn();
const aggregateKpiDailyMock = vi.fn();
const adminDbCollectionMock = vi.fn();
const createUserMock = vi.fn();
const generateSignInLinkMock = vi.fn();
const sendPlainTextMock = vi.fn();
const getUserByEmailMock = vi.fn();

vi.mock("@/lib/email/resend", () => ({ sendPlainText: sendPlainTextMock }));

vi.mock("@/app/api/_lib/analytics", () => ({
  dispatchAnalyticsEvent: dispatchAnalyticsEventMock,
}));

vi.mock("@/app/api/_lib/kpiReporting", () => ({
  persistAnalyticsEvent: persistAnalyticsEventMock,
  aggregateKpiDaily: aggregateKpiDailyMock,
}));

vi.mock("@/lib/firebase-admin", () => ({
  adminAuth: {
    createUser: createUserMock,
    getUserByEmail: getUserByEmailMock,
    generateSignInWithEmailLink: generateSignInLinkMock,
  },
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

describe("orders-paid account linking", () => {
  beforeEach(() => {
    dispatchAnalyticsEventMock.mockReset().mockResolvedValue(undefined);
    persistAnalyticsEventMock.mockReset().mockResolvedValue(undefined);
    aggregateKpiDailyMock.mockReset().mockResolvedValue(undefined);
    adminDbCollectionMock.mockReset();
    createUserMock.mockReset().mockResolvedValue({uid:"new_outfit_member"});
    generateSignInLinkMock.mockReset().mockResolvedValue("https://example.test/sign-in");
    sendPlainTextMock.mockReset().mockResolvedValue(undefined);
    process.env.SHOPIFY_WEBHOOK_SECRET = "webhook_secret";
    getUserByEmailMock.mockReset().mockRejectedValue(new Error("auth/user-not-found"));
    process.env.CHECKOUT_IDENTITY_SECRET = "test_checkout_identity_secret_123";
  });

  type FakeDoc = { id: string; data: Record<string, unknown> };

  /** In-memory users collection supporting where().limit().get() and doc(). */
  function installUsers(docs: FakeDoc[]) {
    const store = new Map(docs.map((d) => [d.id, { ...d.data }]));
    const updates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const creates: Array<{ id: string; data: Record<string, unknown> }> = [];
    const sets: Array<{ id: string; data: Record<string, unknown> }> = [];
    const whereCalls: Array<[string, unknown]> = [];
    const snapFor = (id: string) => ({
      id,
      exists: store.has(id),
      data: () => store.get(id),
      ref: {
        update: vi.fn(async (u: Record<string, unknown>) => {
          updates.push({ id, data: u });
          store.set(id, { ...store.get(id), ...u });
        }),
      },
    });
    adminDbCollectionMock.mockImplementation((name: string) => {
      if (name === "webhook_receipts") return { doc: () => ({ get: async () => ({ exists: false }), set: async () => undefined }) };
      if (name === "users") {
        return {
          where: (field: string, _op: string, value: unknown) => {
            whereCalls.push([field, value]);
            return {
              limit: () => ({
                get: async () => {
                  const hits = [...store.entries()].filter(([, d]) => d[field] === value).map(([id]) => snapFor(id));
                  return { empty: hits.length === 0, docs: hits };
                },
              }),
            };
          },
          doc: (id: string) => ({
            get: async () => snapFor(id),
            create: vi.fn(async (d: Record<string, unknown>) => {
              if (store.has(id)) throw Object.assign(new Error("exists"), { code: 6 });
              creates.push({ id, data: d });
              store.set(id, d);
            }),
            set: vi.fn(async (d: Record<string, unknown>) => {
              sets.push({ id, data: d });
              store.set(id, d);
            }),
            update: snapFor(id).ref.update,
          }),
        };
      }
      throw new Error(`Unexpected collection ${name}`);
    });
    return { store, updates, creates, sets, whereCalls };
  }

  function paidOrder(over: Record<string, unknown> = {}) {
    return JSON.stringify({
      id: 5001, order_number: 501, email: "Jane.Doe@Example.com", total_price: "299.95",
      processed_at: "2026-11-01T14:00:00Z", created_at: "2026-11-01T14:00:00Z", currency: "USD",
      customer: { id: 7001, email: "Jane.Doe@Example.com", first_name: "Jane" },
      line_items: [{ id: 1, title: "Seasonal Edit", variant_id: 50408581267648, quantity: 1, price: "299.95" }],
      ...over,
    });
  }

  const setUpProfile = {
    email: "jane.doe@example.com",
    tier: "free",
    onboarding_completed: true,
    password_set: true,
    profile: { size: "M" },
    fit_profile: { waist: 34 },
    username: "Jane",
  };

  async function post(body: string) {
    const { POST } = await loadRoute();
    return POST(buildRequest({ secret: "webhook_secret", body }));
  }

  it("matches a mixed-case checkout email to the lowercase account and only updates purchase fields", async () => {
    const users = installUsers([{ id: "uid_existing", data: setUpProfile }]);
    const res = await post(paidOrder());
    expect(res.status).toBe(200);
    expect(createUserMock).not.toHaveBeenCalled();
    expect(users.creates).toHaveLength(0);
    expect(users.sets).toHaveLength(0);
    expect(users.updates).toHaveLength(1);
    const update = users.updates[0];
    expect(update.id).toBe("uid_existing");
    expect(update.data).toMatchObject({ tier: "member", shopify_customer_id: "7001" });
    for (const key of ["onboarding_completed", "profile", "fit_profile", "password_set", "email"]) {
      expect(update.data).not.toHaveProperty(key);
    }
    expect(users.store.get("uid_existing")).toMatchObject({ onboarding_completed: true, password_set: true });
    expect(sendPlainTextMock).not.toHaveBeenCalledWith(expect.objectContaining({ category: "magic_link_unlock" }));
  });

  it("falls back to the exact (legacy mixed-case) stored email when no lowercase match exists", async () => {
    const users = installUsers([{ id: "uid_legacy", data: { ...setUpProfile, email: "Jane.Doe@Example.com" } }]);
    await post(paidOrder());
    expect(users.whereCalls).toEqual(expect.arrayContaining([
      ["email", "jane.doe@example.com"],
      ["email", "Jane.Doe@Example.com"],
    ]));
    expect(users.updates.map((u) => u.id)).toEqual(["uid_legacy"]);
    expect(createUserMock).not.toHaveBeenCalled();
  });

  it("creates brand-new accounts with a lowercased email and sends exactly one unlock email", async () => {
    createUserMock.mockResolvedValue({ uid: "uid_new" });
    const users = installUsers([]);
    await post(paidOrder());
    expect(createUserMock).toHaveBeenCalledWith({ email: "jane.doe@example.com" });
    expect(users.creates).toEqual([expect.objectContaining({ id: "uid_new", data: expect.objectContaining({ email: "jane.doe@example.com", onboarding_completed: false }) })]);
    expect(generateSignInLinkMock).toHaveBeenCalledWith("jane.doe@example.com", expect.anything());
    const unlocks = sendPlainTextMock.mock.calls.filter(([a]) => a.category === "magic_link_unlock");
    expect(unlocks).toHaveLength(1);
  });

  it("never overwrites an existing doc when the Auth user exists but the email lookup missed it", async () => {
    createUserMock.mockRejectedValue(Object.assign(new Error("exists"), { code: "auth/email-already-exists" }));
    getUserByEmailMock.mockResolvedValue({ uid: "uid_hidden" });
    // Stored email differs from the checkout email entirely (e.g. "+tag"),
    // so neither Firestore lookup finds it.
    const users = installUsers([{ id: "uid_hidden", data: { ...setUpProfile, email: "other@example.com" } }]);
    await post(paidOrder());
    expect(users.creates).toHaveLength(0);
    expect(users.sets).toHaveLength(0);
    expect(users.updates.map((u) => u.id)).toEqual(["uid_hidden"]);
    expect(users.store.get("uid_hidden")).toMatchObject({ onboarding_completed: true, profile: { size: "M" }, fit_profile: { waist: 34 }, password_set: true });
    expect(sendPlainTextMock).not.toHaveBeenCalledWith(expect.objectContaining({ category: "magic_link_unlock" }));
  });

  it("uses a valid signed uid attribute before email, even when checkout email belongs to nobody", async () => {
    const { signCheckoutUid } = await import("@/lib/checkoutIdentity");
    const token = signCheckoutUid("uid_signed_in")!;
    const users = installUsers([{ id: "uid_signed_in", data: { ...setUpProfile, email: "member@account.com" } }]);
    await post(paidOrder({ email: "typed-something-else@example.com", customer: { id: 7002, email: "typed-something-else@example.com" }, note_attributes: [{ name: "_mully_uid_token", value: token }] }));
    expect(createUserMock).not.toHaveBeenCalled();
    expect(users.whereCalls).toHaveLength(0);
    expect(users.updates.map((u) => u.id)).toEqual(["uid_signed_in"]);
    expect(dispatchAnalyticsEventMock).toHaveBeenCalledWith(expect.objectContaining({ user_id: "uid_signed_in" }));
  });

  it("ignores a forged or tampered uid attribute and falls back to email matching", async () => {
    const { signCheckoutUid } = await import("@/lib/checkoutIdentity");
    const real = signCheckoutUid("uid_victim")!;
    const forged = real.replace(/^uid_victim/, "uid_attacker");
    const users = installUsers([
      { id: "uid_attacker", data: { ...setUpProfile, email: "attacker@example.com" } },
      { id: "uid_buyer", data: setUpProfile },
    ]);
    await post(paidOrder({ note_attributes: [{ name: "_mully_uid_token", value: forged }] }));
    expect(users.updates.map((u) => u.id)).toEqual(["uid_buyer"]);
  });
});
