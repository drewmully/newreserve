/**
 * Non-blocking variants of the Shopify bulk operation helpers for use with
 * resumable cron jobs that can't fit the full extract+process loop into a
 * single Vercel invocation.
 *
 * `startBulkQuery` kicks off a bulk op and returns its id immediately without
 * polling for completion. Pair with `pollBulkOperation` (or read the operation
 * directly via `currentBulkOperation`) on subsequent invocations.
 *
 * Reuses SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_API_VERSION / SHOPIFY_ADMIN_TOKEN.
 */

function getEndpoint(): string {
  const domain =
    process.env.SHOPIFY_STORE_DOMAIN ??
    (() => {
      throw new Error("SHOPIFY_STORE_DOMAIN missing");
    })();
  const version = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";
  return `https://${domain}/admin/api/${version}/graphql.json`;
}

function getHeaders(): Record<string, string> {
  const token =
    process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;
  if (!token) throw new Error("SHOPIFY_ADMIN_TOKEN missing");
  return {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token,
  };
}

async function gql<T>(
  query: string,
  variables?: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(getEndpoint(), {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) throw new Error(`Shopify ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as {
    data: T;
    errors?: { message: string }[];
  };
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

export interface BulkOperationStatus {
  id: string;
  status:
    | "CREATED"
    | "RUNNING"
    | "COMPLETED"
    | "CANCELED"
    | "FAILED"
    | "EXPIRED";
  errorCode: string | null;
  objectCount: string | null;
  url: string | null;
  partialDataUrl: string | null;
}

/**
 * Start a Shopify bulk operation and return immediately with the op id.
 * Auto-cancels any in-flight op for the shop (Shopify allows only one at a
 * time). Does NOT poll for completion.
 */
export async function startBulkQuery(innerQuery: string): Promise<{
  operationId: string;
  status: BulkOperationStatus["status"];
}> {
  const current = await gql<{ currentBulkOperation: BulkOperationStatus | null }>(`
    query { currentBulkOperation { id status errorCode objectCount url partialDataUrl } }
  `);
  if (
    current.currentBulkOperation &&
    (current.currentBulkOperation.status === "CREATED" ||
      current.currentBulkOperation.status === "RUNNING")
  ) {
    await gql(`
      mutation { bulkOperationCancel(id: "${current.currentBulkOperation.id}") { bulkOperation { id status } userErrors { message } } }
    `);
    await new Promise((r) => setTimeout(r, 1500));
  }

  const start = await gql<{
    bulkOperationRunQuery: {
      bulkOperation: BulkOperationStatus | null;
      userErrors: { field: string[] | null; message: string }[];
    };
  }>(
    `mutation BulkRun($query: String!) {
      bulkOperationRunQuery(query: $query) {
        bulkOperation { id status }
        userErrors { field message }
      }
    }`,
    { query: innerQuery },
  );
  if (start.bulkOperationRunQuery.userErrors.length > 0) {
    throw new Error(
      `bulkOperationRunQuery userErrors: ${JSON.stringify(start.bulkOperationRunQuery.userErrors)}`,
    );
  }
  const op = start.bulkOperationRunQuery.bulkOperation;
  if (!op?.id) throw new Error("Bulk op started but no id returned");
  return { operationId: op.id, status: op.status };
}

/**
 * Fetch the current bulk operation status. We rely on Shopify's
 * `currentBulkOperation` (one-at-a-time per shop), but verify the id matches
 * what the caller expects so we don't accidentally pick up someone else's op.
 */
export async function pollBulkOperation(
  expectedOperationId: string,
): Promise<BulkOperationStatus> {
  const poll = await gql<{ currentBulkOperation: BulkOperationStatus | null }>(`
    query { currentBulkOperation { id status errorCode objectCount url partialDataUrl } }
  `);
  if (!poll.currentBulkOperation) {
    throw new Error("currentBulkOperation returned null");
  }
  if (poll.currentBulkOperation.id !== expectedOperationId) {
    throw new Error(
      `Bulk op ${expectedOperationId} was superseded by ${poll.currentBulkOperation.id}`,
    );
  }
  return poll.currentBulkOperation;
}
