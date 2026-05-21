/**
 * Shopify Admin bulk operations helpers — server-side only.
 *
 * Wraps the GraphQL bulk operations API for full-dataset extracts (customers,
 * orders, etc). Bulk ops are async on Shopify's side — we poll, then stream
 * the resulting JSONL file.
 *
 * Reuses SHOPIFY_STORE_DOMAIN / SHOPIFY_ADMIN_API_VERSION / SHOPIFY_ADMIN_TOKEN
 * env vars (same as shopifyAdmin.ts).
 */

const POLL_INTERVAL_MS = 5_000;
const POLL_TIMEOUT_MS = 30 * 60 * 1000; // 30 min hard ceiling

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

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
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

interface BulkOperationStatus {
  id: string;
  status: "CREATED" | "RUNNING" | "COMPLETED" | "CANCELED" | "FAILED" | "EXPIRED";
  errorCode: string | null;
  objectCount: string | null;
  url: string | null;
  partialDataUrl: string | null;
}

/**
 * Kick off a bulk operation. Note Shopify only allows ONE running bulk op at a
 * time per shop. We auto-cancel any in-flight op before starting (safe because
 * we only use this for our own ingestion).
 */
export async function runBulkQuery(innerQuery: string): Promise<{
  jsonlUrl: string;
  objectCount: number;
  operationId: string;
}> {
  // 1) Check current op, cancel if running
  const current = await gql<{
    currentBulkOperation: BulkOperationStatus | null;
  }>(`
    query {
      currentBulkOperation {
        id status errorCode objectCount url partialDataUrl
      }
    }
  `);

  if (current.currentBulkOperation && (current.currentBulkOperation.status === "CREATED" || current.currentBulkOperation.status === "RUNNING")) {
    await gql(`
      mutation { bulkOperationCancel(id: "${current.currentBulkOperation.id}") { bulkOperation { id status } userErrors { message } } }
    `);
    // small delay so cancellation takes effect
    await new Promise((r) => setTimeout(r, 2000));
  }

  // 2) Run bulk query
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
    { query: innerQuery }
  );

  if (start.bulkOperationRunQuery.userErrors.length > 0) {
    throw new Error(
      `bulkOperationRunQuery userErrors: ${JSON.stringify(start.bulkOperationRunQuery.userErrors)}`
    );
  }

  const operationId = start.bulkOperationRunQuery.bulkOperation?.id;
  if (!operationId) throw new Error("Bulk op started but no id returned");

  // 3) Poll
  const startedAt = Date.now();
  let last: BulkOperationStatus | null = null;
  while (Date.now() - startedAt < POLL_TIMEOUT_MS) {
    const poll = await gql<{ currentBulkOperation: BulkOperationStatus | null }>(`
      query { currentBulkOperation { id status errorCode objectCount url partialDataUrl } }
    `);
    last = poll.currentBulkOperation;
    if (!last) throw new Error("currentBulkOperation went null mid-poll");
    if (last.id !== operationId) {
      // someone else started a new op — treat as failure
      throw new Error(`Bulk op ${operationId} was superseded by ${last.id}`);
    }
    if (last.status === "COMPLETED") {
      return {
        jsonlUrl: last.url || last.partialDataUrl || "",
        objectCount: Number(last.objectCount ?? "0"),
        operationId,
      };
    }
    if (last.status === "FAILED" || last.status === "CANCELED" || last.status === "EXPIRED") {
      throw new Error(`Bulk op ${operationId} ended with status=${last.status} errorCode=${last.errorCode ?? "n/a"}`);
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  throw new Error(`Bulk op ${operationId} timed out after ${POLL_TIMEOUT_MS}ms (last status=${last?.status})`);
}

/**
 * Stream a JSONL Shopify bulk-op result, parsing one record at a time.
 * Returns count consumed. The caller's `onRecord` may be async; it's awaited.
 */
export async function streamJsonl<T = Record<string, unknown>>(
  jsonlUrl: string,
  onRecord: (record: T) => Promise<void> | void
): Promise<number> {
  if (!jsonlUrl) {
    // Empty bulk result — Shopify returns no url when objectCount=0
    return 0;
  }
  const res = await fetch(jsonlUrl);
  if (!res.ok || !res.body) {
    throw new Error(`JSONL fetch failed ${res.status}: ${jsonlUrl}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let count = 0;

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        const record = JSON.parse(line) as T;
        await onRecord(record);
        count++;
      } catch (err) {
        // skip the bad line but log
        console.error("[shopifyBulk] JSONL parse error:", line.slice(0, 200), err);
      }
    }
  }
  // Drain remaining buffer
  const tail = buffer.trim();
  if (tail) {
    try {
      const record = JSON.parse(tail) as T;
      await onRecord(record);
      count++;
    } catch (err) {
      console.error("[shopifyBulk] JSONL tail parse error:", tail.slice(0, 200), err);
    }
  }
  return count;
}
