import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Tests for the new Shopify helpers added for the NECHV landing:
 *   - createShopifyCustomer
 *   - resolveOrCreateCustomerByEmail
 *   - creditCustomerStoreCredit
 *
 * We stub global fetch and walk through the request/response cycle the
 * same way the real Admin GraphQL API would respond.
 */

async function loadShopify() {
  vi.resetModules();
  return import("@/app/api/_lib/shopifyAdmin");
}

function mockFetchSequence(responses: Array<{ ok?: boolean; status?: number; body: unknown }>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
    calls.push({ url: String(url), init });
    const next = responses.shift();
    if (!next) {
      throw new Error(`Unexpected extra fetch call to ${String(url)}`);
    }
    return {
      ok: next.ok ?? true,
      status: next.status ?? 200,
      async json() {
        return next.body;
      },
      async text() {
        return JSON.stringify(next.body);
      },
    } as unknown as Response;
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, calls };
}

beforeEach(() => {
  process.env.SHOPIFY_STORE_DOMAIN = "test-shop.myshopify.com";
  process.env.SHOPIFY_ADMIN_TOKEN = "test-admin-token";
});

describe("createShopifyCustomer", () => {
  it("returns numeric customer id on success", async () => {
    mockFetchSequence([
      {
        body: {
          data: {
            customerCreate: {
              customer: { id: "gid://shopify/Customer/9999" },
              userErrors: [],
            },
          },
        },
      },
    ]);
    const { createShopifyCustomer } = await loadShopify();
    const id = await createShopifyCustomer({
      email: "nechv-user@example.com",
      tags: ["nechv-signup"],
    });
    expect(id).toBe("9999");
  });

  it("throws when Shopify returns userErrors", async () => {
    mockFetchSequence([
      {
        body: {
          data: {
            customerCreate: {
              customer: null,
              userErrors: [{ field: ["email"], message: "Email has already been taken" }],
            },
          },
        },
      },
    ]);
    const { createShopifyCustomer } = await loadShopify();
    await expect(
      createShopifyCustomer({ email: "dupe@example.com" })
    ).rejects.toThrow(/already been taken/);
  });
});

describe("resolveOrCreateCustomerByEmail", () => {
  it("returns the existing customer without calling customerCreate", async () => {
    const { fetchMock } = mockFetchSequence([
      {
        body: {
          data: {
            customers: {
              nodes: [{ id: "gid://shopify/Customer/123" }],
            },
          },
        },
      },
    ]);
    const { resolveOrCreateCustomerByEmail } = await loadShopify();
    const result = await resolveOrCreateCustomerByEmail({ email: "existing@example.com" });
    expect(result).toEqual({ customerId: "123", created: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("creates a new customer when none exists", async () => {
    const { fetchMock } = mockFetchSequence([
      {
        body: {
          data: {
            customers: { nodes: [] },
          },
        },
      },
      {
        body: {
          data: {
            customerCreate: {
              customer: { id: "gid://shopify/Customer/777" },
              userErrors: [],
            },
          },
        },
      },
    ]);
    const { resolveOrCreateCustomerByEmail } = await loadShopify();
    const result = await resolveOrCreateCustomerByEmail({
      email: "new-nechv@example.com",
      tags: ["nechv-signup"],
    });
    expect(result).toEqual({ customerId: "777", created: true });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("recovers from a race where the customer was created between lookup and create", async () => {
    mockFetchSequence([
      // 1st: customers lookup — empty
      { body: { data: { customers: { nodes: [] } } } },
      // 2nd: customerCreate — fails with "already taken"
      {
        body: {
          data: {
            customerCreate: {
              customer: null,
              userErrors: [{ field: ["email"], message: "Email has already been taken" }],
            },
          },
        },
      },
      // 3rd: customers lookup retry — now resolves
      {
        body: {
          data: {
            customers: { nodes: [{ id: "gid://shopify/Customer/555" }] },
          },
        },
      },
    ]);
    const { resolveOrCreateCustomerByEmail } = await loadShopify();
    const result = await resolveOrCreateCustomerByEmail({
      email: "race@example.com",
    });
    expect(result).toEqual({ customerId: "555", created: false });
  });
});

describe("creditCustomerStoreCredit", () => {
  it("returns ok:true and the new balance when the mutation succeeds", async () => {
    mockFetchSequence([
      {
        body: {
          data: {
            storeCreditAccountCredit: {
              storeCreditAccountTransaction: {
                amount: { amount: "25.00", currencyCode: "USD" },
                account: {
                  id: "gid://shopify/StoreCreditAccount/42",
                  balance: { amount: "25.00", currencyCode: "USD" },
                },
              },
              userErrors: [],
            },
          },
        },
      },
    ]);
    const { creditCustomerStoreCredit } = await loadShopify();
    const result = await creditCustomerStoreCredit({
      customerId: "9999",
      amount: 25,
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.balanceAmount).toBe(25);
      expect(result.transactionAmount).toBe(25);
      expect(result.currencyCode).toBe("USD");
      expect(result.accountId).toBe("gid://shopify/StoreCreditAccount/42");
    }
  });

  it("rejects non-positive amounts before calling Shopify", async () => {
    const { fetchMock } = mockFetchSequence([]);
    const { creditCustomerStoreCredit } = await loadShopify();
    const result = await creditCustomerStoreCredit({ customerId: "1", amount: 0 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/positive/i);
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("returns ok:false with userErrors when Shopify rejects the credit", async () => {
    mockFetchSequence([
      {
        body: {
          data: {
            storeCreditAccountCredit: {
              storeCreditAccountTransaction: null,
              userErrors: [
                { field: ["creditInput"], message: "Customer is not eligible" },
              ],
            },
          },
        },
      },
    ]);
    const { creditCustomerStoreCredit } = await loadShopify();
    const result = await creditCustomerStoreCredit({ customerId: "1", amount: 25 });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/not eligible/);
      expect(result.userErrors?.[0]?.message).toMatch(/not eligible/);
    }
  });

  it("sends a properly-formed customer GID and amount string", async () => {
    const { calls } = mockFetchSequence([
      {
        body: {
          data: {
            storeCreditAccountCredit: {
              storeCreditAccountTransaction: {
                amount: { amount: "25.00", currencyCode: "USD" },
                account: {
                  id: "gid://shopify/StoreCreditAccount/1",
                  balance: { amount: "25.00", currencyCode: "USD" },
                },
              },
              userErrors: [],
            },
          },
        },
      },
    ]);
    const { creditCustomerStoreCredit } = await loadShopify();
    await creditCustomerStoreCredit({ customerId: "9999", amount: 25 });
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.variables.id).toBe("gid://shopify/Customer/9999");
    expect(body.variables.creditInput.creditAmount.amount).toBe("25.00");
    expect(body.variables.creditInput.creditAmount.currencyCode).toBe("USD");
  });
});
