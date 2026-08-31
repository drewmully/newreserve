import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OK_ENV = {
  SHOPIFY_STORE_DOMAIN: "mullybox-store.myshopify.com",
  SHOPIFY_ADMIN_API_VERSION: "2024-10",
  SHOPIFY_SUBSCRIPTIONS_TOKEN: "shpat_test_subscriptions",
};

function setEnv(env: Record<string, string>) {
  for (const [k, v] of Object.entries(env)) {
    process.env[k] = v;
  }
}

function mockFetchOnce(data: unknown, opts: { ok?: boolean; status?: number } = {}) {
  const spy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
    ok: opts.ok ?? true,
    status: opts.status ?? 200,
    text: async () => JSON.stringify({ data }),
    json: async () => ({ data }),
  } as unknown as Response);
  return spy;
}

async function loadApi() {
  vi.resetModules();
  return import("@/app/api/_lib/shopifySubscriptionsApi");
}

describe("shopifySubscriptionsApi", () => {
  beforeEach(() => {
    setEnv(OK_ENV);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("throws when SHOPIFY_SUBSCRIPTIONS_TOKEN is missing", async () => {
    delete process.env.SHOPIFY_SUBSCRIPTIONS_TOKEN;
    const api = await loadApi();
    await expect(api.pauseContract("gid://shopify/SubscriptionContract/1")).rejects.toThrow(
      /SHOPIFY_SUBSCRIPTIONS_TOKEN/
    );
  });

  it("pauseContract sends the correct mutation and returns the contract", async () => {
    const spy = mockFetchOnce({
      subscriptionContractPause: {
        contract: { id: "gid://shopify/SubscriptionContract/1", status: "PAUSED" },
        userErrors: [],
      },
    });
    const api = await loadApi();
    const contract = await api.pauseContract("gid://shopify/SubscriptionContract/1");
    expect(contract).toEqual({
      id: "gid://shopify/SubscriptionContract/1",
      status: "PAUSED",
    });

    const [, init] = spy.mock.calls[0]!;
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.query).toContain("subscriptionContractPause");
    expect(body.variables).toEqual({ id: "gid://shopify/SubscriptionContract/1" });
  });

  it("propagates userErrors as thrown errors", async () => {
    mockFetchOnce({
      subscriptionContractPause: {
        contract: null,
        userErrors: [{ field: ["id"], message: "Contract not found" }],
      },
    });
    const api = await loadApi();
    await expect(
      api.pauseContract("gid://shopify/SubscriptionContract/999")
    ).rejects.toThrow(/Contract not found/);
  });

  it("activateContract targets subscriptionContractActivate", async () => {
    const spy = mockFetchOnce({
      subscriptionContractActivate: {
        contract: { id: "gid://shopify/SubscriptionContract/2", status: "ACTIVE" },
        userErrors: [],
      },
    });
    const api = await loadApi();
    await api.activateContract("gid://shopify/SubscriptionContract/2");
    const body = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.query).toContain("subscriptionContractActivate");
  });

  it("cancelContract targets subscriptionContractCancel", async () => {
    const spy = mockFetchOnce({
      subscriptionContractCancel: {
        contract: { id: "gid://shopify/SubscriptionContract/3", status: "CANCELLED" },
        userErrors: [],
      },
    });
    const api = await loadApi();
    await api.cancelContract("gid://shopify/SubscriptionContract/3");
    const body = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.query).toContain("subscriptionContractCancel");
  });

  it("updateContract runs the full draft lifecycle: update → draftUpdate → draftLineUpdate → commit", async () => {
    const draftId = "gid://shopify/SubscriptionDraft/D1";
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockImplementation(async (_url, init) => {
        const body = JSON.parse((init as RequestInit).body as string);
        const q = body.query as string;
        if (q.includes("subscriptionContractUpdate")) {
          return new Response(
            JSON.stringify({
              data: {
                subscriptionContractUpdate: {
                  draft: { id: draftId },
                  userErrors: [],
                },
              },
            })
          );
        }
        if (q.includes("subscriptionDraftUpdate")) {
          return new Response(
            JSON.stringify({
              data: {
                subscriptionDraftUpdate: { draft: { id: draftId }, userErrors: [] },
              },
            })
          );
        }
        if (q.includes("subscriptionDraftLineUpdate")) {
          return new Response(
            JSON.stringify({
              data: {
                subscriptionDraftLineUpdate: {
                  draft: { id: draftId },
                  userErrors: [],
                },
              },
            })
          );
        }
        if (q.includes("subscriptionDraftCommit")) {
          return new Response(
            JSON.stringify({
              data: {
                subscriptionDraftCommit: {
                  contract: {
                    id: "gid://shopify/SubscriptionContract/9",
                    status: "ACTIVE",
                    lines: { edges: [] },
                  },
                  userErrors: [],
                },
              },
            })
          );
        }
        throw new Error(`Unexpected mutation: ${q}`);
      });

    const api = await loadApi();
    const result = await api.updateContract("gid://shopify/SubscriptionContract/9", {
      billingPolicy: { interval: "MONTH", intervalCount: 3 },
      deliveryPolicy: { interval: "MONTH", intervalCount: 3 },
      lines: [
        {
          lineId: "gid://shopify/SubscriptionLine/L1",
          productVariantId: "gid://shopify/ProductVariant/47601025122496",
          sellingPlanId: "gid://shopify/SellingPlan/3241476288",
        },
      ],
    });

    expect(result?.id).toBe("gid://shopify/SubscriptionContract/9");
    // Four calls: update, draftUpdate, draftLineUpdate, commit.
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("skipNextCycle sends subscriptionBillingCycleSkip with an index=1 selector", async () => {
    const spy = mockFetchOnce({
      subscriptionBillingCycleSkip: {
        billingCycle: { cycleIndex: 5, skipped: true },
        userErrors: [],
      },
    });
    const api = await loadApi();
    await api.skipNextCycle("gid://shopify/SubscriptionContract/4");
    const body = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.query).toContain("subscriptionBillingCycleSkip");
    expect(body.variables.billingCycleInput).toMatchObject({
      contractId: "gid://shopify/SubscriptionContract/4",
      selector: { index: 1 },
    });
  });

  it("createContractAtomic passes the input straight through", async () => {
    const spy = mockFetchOnce({
      subscriptionContractAtomicCreate: {
        contract: { id: "gid://shopify/SubscriptionContract/new", status: "ACTIVE" },
        userErrors: [],
      },
    });
    const api = await loadApi();
    const result = await api.createContractAtomic({
      customerId: "gid://shopify/Customer/1",
      nextBillingDate: "2026-09-15T00:00:00Z",
      currencyCode: "USD",
      billingPolicy: { interval: "MONTH", intervalCount: 3 },
      deliveryPolicy: { interval: "MONTH", intervalCount: 3 },
      paymentMethodId: "gid://shopify/CustomerPaymentMethod/pm1",
      lines: [
        {
          productVariantId: "gid://shopify/ProductVariant/47601025122496",
          sellingPlanId: "gid://shopify/SellingPlan/3241476288",
          quantity: 1,
        },
      ],
    });
    expect(result?.status).toBe("ACTIVE");
    const body = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.query).toContain("subscriptionContractAtomicCreate");
  });

  it("retryBilling uses subscriptionBillingAttemptCreate with an idempotencyKey", async () => {
    const spy = mockFetchOnce({
      subscriptionBillingAttemptCreate: {
        subscriptionBillingAttempt: { id: "gid://ba/1", ready: false, errorCode: null },
        userErrors: [],
      },
    });
    const api = await loadApi();
    await api.retryBilling("gid://shopify/SubscriptionContract/5");
    const body = JSON.parse((spy.mock.calls[0]![1] as RequestInit).body as string);
    expect(body.query).toContain("subscriptionBillingAttemptCreate");
    expect(typeof body.variables.input.idempotencyKey).toBe("string");
    expect(body.variables.input.idempotencyKey).toMatch(/^retry_/);
  });

  it("getContract computes prepaidRemaining from maxCycles - (nextCycleIndex - 1)", async () => {
    mockFetchOnce({
      subscriptionContract: {
        id: "gid://shopify/SubscriptionContract/6",
        status: "ACTIVE",
        nextBillingDate: "2026-09-15T00:00:00Z",
        customer: { id: "gid://shopify/Customer/1", email: "a@b.co" },
        billingPolicy: {
          interval: "MONTH",
          intervalCount: 3,
          minCycles: null,
          maxCycles: 4,
        },
        deliveryPolicy: { interval: "MONTH", intervalCount: 3 },
        lines: { edges: [] },
        billingCycles: {
          edges: [
            {
              node: {
                cycleIndex: 2,
                skipped: false,
                billingAttemptExpectedDate: "2026-09-15T00:00:00Z",
              },
            },
          ],
        },
      },
    });
    const api = await loadApi();
    const summary = await api.getContract("gid://shopify/SubscriptionContract/6");
    expect(summary?.prepaidRemaining).toBe(3);
  });

  it("throws on non-200 responses (after retry wrapper exhausts on 5xx)", async () => {
    // PR #129: subscriptionsGraphQL now retries 5xx / 429 via
    // `withShopifyRetry`. Mock all 3 attempts so the wrapper exhausts and
    // surfaces the ShopifyRetryableHttpError.
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: false,
      status: 500,
      text: async () => "internal server error",
      json: async () => ({}),
    } as unknown as Response);
    // Speed up backoff for this one test.
    vi.useFakeTimers();
    const api = await loadApi();
    const p = api.pauseContract("gid://shopify/SubscriptionContract/7");
    // Drain fake timers so the retry sleeps resolve.
    const drain = (async () => {
      for (let i = 0; i < 10; i++) {
        await vi.advanceTimersByTimeAsync(10_000);
        await Promise.resolve();
      }
    })();
    await expect(Promise.race([p, drain.then(() => p)])).rejects.toThrow(/500/);
    vi.useRealTimers();
  });
});
