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
