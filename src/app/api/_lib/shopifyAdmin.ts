/**
 * Shopify Admin API client — server-side only.
 * Never import from client components or pages.
 *
 * Credentials (in priority order):
 *   1. SHOPIFY_ADMIN_TOKEN          — custom-app access token
 *   2. SHOPIFY_CLIENT_SECRET        — fallback (custom app secret used as token)
 *
 * Required env vars:
 *   SHOPIFY_STORE_DOMAIN            — e.g. "my-store.myshopify.com"
 *   SHOPIFY_ADMIN_API_VERSION       — defaults to "2024-10"
 */

function requireEnv(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `Missing required env var: ${name}. ` +
        "Add it to your server-side environment (never expose to the client)."
    );
  }
  return value;
}

function getStoreDomain(): string {
  return requireEnv("SHOPIFY_STORE_DOMAIN", process.env.SHOPIFY_STORE_DOMAIN);
}

function getApiVersion(): string {
  return process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";
}

function getGraphQLEndpoint(): string {
  return `https://${getStoreDomain()}/admin/api/${getApiVersion()}/graphql.json`;
}

function getAdminHeaders(): Record<string, string> {
  const token =
    process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;

  if (!token) {
    throw new Error(
      "Missing Shopify Admin credentials. Set SHOPIFY_ADMIN_TOKEN or SHOPIFY_CLIENT_SECRET."
    );
  }

  return {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token,
  };
}

async function shopifyGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(getGraphQLEndpoint(), {
    method: "POST",
    headers: getAdminHeaders(),
    body: JSON.stringify({ query, variables }),
  });

  if (!res.ok) {
    throw new Error(
      `Shopify Admin API error ${res.status}: ${await res.text()}`
    );
  }

  const json = (await res.json()) as {
    data: T;
    errors?: { message: string }[];
  };

  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }

  return json.data;
}

/**
 * Look up a Shopify customer by email.
 * Returns the numeric customer ID string (e.g. "123456789") or null if not found.
 */
export async function resolveCustomerByEmail(
  email: string
): Promise<string | null> {
  const query = `
    query ResolveCustomerByEmail($query: String!) {
      customers(first: 1, query: $query) {
        nodes {
          id
        }
      }
    }
  `;

  const data = await shopifyGraphQL<{
    customers: { nodes: Array<{ id: string }> };
  }>(query, { query: `email:${email}` });

  const gid = data.customers.nodes[0]?.id;
  if (!gid) return null;

  // "gid://shopify/Customer/12345" → "12345"
  return gid.split("/").pop() ?? null;
}

/**
 * Fetch the first name for a Shopify customer by numeric ID.
 * Returns null if the customer is not found or has no first name.
 */
export async function getCustomerFirstNameById(
  customerId: string
): Promise<string | null> {
  const numericId = customerId.startsWith("gid://")
    ? customerId.split("/").pop()!
    : customerId;

  const query = `
    query GetCustomerFirstName($id: ID!) {
      customer(id: $id) {
        firstName
      }
    }
  `;

  const data = await shopifyGraphQL<{
    customer: { firstName: string | null } | null;
  }>(query, { id: `gid://shopify/Customer/${numericId}` });

  return data.customer?.firstName ?? null;
}

export interface ShopifyOrderLineItem {
  name: string;
  quantity: number;
  price: string;
}

export interface ShopifyOrderSummary {
  order_number: number;
  name: string;
  created_at: string;
  total_price: string;
  currency: string;
  financial_status: string;
  fulfillment_status: string;
  line_items: ShopifyOrderLineItem[];
}

/**
 * Fetch the last N orders for a Shopify customer via the Admin REST API.
 */
export async function getCustomerOrders(
  customerId: string,
  limit = 10
): Promise<ShopifyOrderSummary[]> {
  const token =
    process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;
  if (!token) {
    throw new Error(
      "Missing Shopify Admin credentials. Set SHOPIFY_ADMIN_TOKEN or SHOPIFY_CLIENT_SECRET."
    );
  }

  // Strip GID prefix if present
  const numericId = customerId.startsWith("gid://")
    ? customerId.split("/").pop()!
    : customerId;

  const url = `https://${getStoreDomain()}/admin/api/${getApiVersion()}/customers/${numericId}/orders.json?limit=${limit}&status=any`;

  const res = await fetch(url, {
    headers: {
      "Content-Type": "application/json",
      "X-Shopify-Access-Token": token,
    },
  });

  if (!res.ok) {
    throw new Error(
      `Shopify Admin REST error ${res.status}: ${await res.text()}`
    );
  }

  const json = (await res.json()) as {
    orders: Array<{
      order_number: number;
      name: string;
      created_at: string;
      total_price: string;
      currency: string;
      financial_status: string;
      fulfillment_status: string | null;
      line_items: Array<{ title: string; quantity: number; price: string }>;
    }>;
  };

  return (json.orders ?? []).map((o) => ({
    order_number: o.order_number,
    name: o.name,
    created_at: o.created_at,
    total_price: o.total_price,
    currency: o.currency,
    financial_status: o.financial_status,
    fulfillment_status: o.fulfillment_status ?? "unfulfilled",
    line_items: o.line_items.map((li) => ({
      name: li.title,
      quantity: li.quantity,
      price: li.price,
    })),
  }));
}

export interface StoreCreditBalance {
  balance_cents: number;
  currency: string;
}

export type ShopifyUserError = {
  field: string[] | null;
  message: string;
};

/**
 * Create a Shopify customer with just an email. Used by signup flows
 * that need a Shopify customer to attach store credit to. Returns the
 * numeric customer id (without the gid:// prefix). Throws on Shopify
 * userErrors so callers can surface them.
 *
 * Idempotency: the caller should resolveCustomerByEmail() first. This
 * helper does NOT itself dedupe — if you call it with an email that
 * already exists Shopify will return a userErrors payload.
 */
export async function createShopifyCustomer(input: {
  email: string;
  firstName?: string;
  lastName?: string;
  tags?: string[];
}): Promise<string> {
  const mutation = `
    mutation CreateCustomer($input: CustomerInput!) {
      customerCreate(input: $input) {
        customer { id }
        userErrors { field message }
      }
    }
  `;

  const variables: Record<string, unknown> = {
    input: {
      email: input.email,
      ...(input.firstName ? { firstName: input.firstName } : {}),
      ...(input.lastName ? { lastName: input.lastName } : {}),
      ...(input.tags?.length ? { tags: input.tags } : {}),
      // Do NOT send marketing consent here — that should be a separate,
      // explicit opt-in. Customers can still be emailed transactionally.
    },
  };

  const data = await shopifyGraphQL<{
    customerCreate: {
      customer: { id: string } | null;
      userErrors: ShopifyUserError[];
    };
  }>(mutation, variables);

  const payload = data.customerCreate;
  if (payload.userErrors.length > 0) {
    throw new Error(
      `Shopify customerCreate userErrors: ${payload.userErrors
        .map((e) => `${(e.field ?? []).join(".") || "(root)"}: ${e.message}`)
        .join("; ")}`
    );
  }
  if (!payload.customer) {
    throw new Error("Shopify customerCreate returned no customer");
  }

  // "gid://shopify/Customer/12345" → "12345"
  const numericId = payload.customer.id.split("/").pop();
  if (!numericId) {
    throw new Error(`Unexpected customer GID format: ${payload.customer.id}`);
  }
  return numericId;
}

/**
 * Resolve an existing Shopify customer by email, or create a new one if
 * none exists. Returns the numeric customer id. Convenience wrapper for
 * signup flows that need a customer guaranteed to exist.
 */
export async function resolveOrCreateCustomerByEmail(input: {
  email: string;
  firstName?: string;
  lastName?: string;
  tags?: string[];
}): Promise<{ customerId: string; created: boolean }> {
  const existing = await resolveCustomerByEmail(input.email);
  if (existing) {
    return { customerId: existing, created: false };
  }

  try {
    const customerId = await createShopifyCustomer(input);
    return { customerId, created: true };
  } catch (err) {
    // Race: another writer may have created the customer between our
    // lookup and our create. Re-resolve before giving up.
    const after = await resolveCustomerByEmail(input.email);
    if (after) {
      return { customerId: after, created: false };
    }
    throw err;
  }
}

// ────────────────────────────────────────────────────────────────────────
// Store credit
// ────────────────────────────────────────────────────────────────────────

export type StoreCreditMutationResult =
  | {
      ok: true;
      accountId: string;
      balanceAmount: number;
      currencyCode: string;
      transactionAmount: number;
    }
  | { ok: false; error: string; userErrors?: ShopifyUserError[] };

/**
 * Add funds to a customer's store credit account. If the customer
 * doesn't have a USD account yet, Shopify auto-creates one. Mirrors the
 * Mully-Hub `creditCustomerStoreCredit` pattern.
 *
 * https://shopify.dev/docs/api/admin-graphql/latest/mutations/storeCreditAccountCredit
 */
export async function creditCustomerStoreCredit(input: {
  customerId: string;
  amount: number;
  currencyCode?: string;
}): Promise<StoreCreditMutationResult> {
  const currencyCode = input.currencyCode ?? "USD";
  if (!Number.isFinite(input.amount) || input.amount <= 0) {
    return { ok: false, error: "Amount must be a positive number" };
  }

  const gid = input.customerId.startsWith("gid://")
    ? input.customerId
    : `gid://shopify/Customer/${input.customerId}`;

  const mutation = `
    mutation CreditStoreCredit($id: ID!, $creditInput: StoreCreditAccountCreditInput!) {
      storeCreditAccountCredit(id: $id, creditInput: $creditInput) {
        storeCreditAccountTransaction {
          amount { amount currencyCode }
          account {
            id
            balance { amount currencyCode }
          }
        }
        userErrors { field message }
      }
    }
  `;

  try {
    const data = await shopifyGraphQL<{
      storeCreditAccountCredit: {
        storeCreditAccountTransaction: {
          amount: { amount: string; currencyCode: string };
          account: {
            id: string;
            balance: { amount: string; currencyCode: string };
          };
        } | null;
        userErrors: ShopifyUserError[];
      };
    }>(mutation, {
      id: gid,
      creditInput: {
        creditAmount: {
          amount: input.amount.toFixed(2),
          currencyCode,
        },
      },
    });

    const payload = data.storeCreditAccountCredit;
    if (payload.userErrors.length > 0) {
      return {
        ok: false,
        error: payload.userErrors.map((e) => e.message).join("; "),
        userErrors: payload.userErrors,
      };
    }
    if (!payload.storeCreditAccountTransaction) {
      return { ok: false, error: "Shopify returned no transaction payload" };
    }

    const txn = payload.storeCreditAccountTransaction;
    return {
      ok: true,
      accountId: txn.account.id,
      balanceAmount: Number(txn.account.balance.amount),
      currencyCode: txn.account.balance.currencyCode,
      transactionAmount: Number(txn.amount.amount),
    };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown Shopify error",
    };
  }
}

/**
 * Fetch the store-credit balance for a Shopify customer.
 * Accepts either a numeric ID string or a full GID.
 */
export async function getStoreCreditByCustomerId(
  customerId: string
): Promise<StoreCreditBalance> {
  const gid = customerId.startsWith("gid://")
    ? customerId
    : `gid://shopify/Customer/${customerId}`;

  const query = `
    query GetCustomerStoreCredit($id: ID!) {
      customer(id: $id) {
        storeCreditAccounts(first: 1) {
          nodes {
            balance {
              amount
              currencyCode
            }
          }
        }
      }
    }
  `;

  const data = await shopifyGraphQL<{
    customer: {
      storeCreditAccounts: {
        nodes: Array<{
          balance: { amount: string; currencyCode: string };
        }>;
      };
    } | null;
  }>(query, { id: gid });

  const account = data.customer?.storeCreditAccounts.nodes[0];
  if (!account) {
    return { balance_cents: 0, currency: "USD" };
  }

  return {
    balance_cents: Math.round(parseFloat(account.balance.amount) * 100),
    currency: account.balance.currencyCode,
  };
}
