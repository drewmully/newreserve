import { runBackfillBatch, type BackfillPage, type BackfillStore } from "./backfill";
import { nyDate } from "./primitives";
import { readPilotSource, type PilotSource } from "./shopifyPilotSource";
import {
  SHOPIFY_ANALYTICS_API_VERSION, shopifyId, shopifyShop,
  sourceArray, sourceObject, sourceString,
} from "./shopifySource";

export const HISTORY_ACCESS_QUERY = `query AnalyticsHistoryAccess {
  currentAppInstallation { accessScopes { handle } }
}`;
export const HISTORY_ORDERS_QUERY = `query AnalyticsHistory($cursor: String, $search: String!, $first: Int!) {
  orders(first: $first, after: $cursor, query: $search, sortKey: CREATED_AT) {
    nodes { id createdAt updatedAt }
    pageInfo { hasNextPage endCursor }
  }
}`;
export const HISTORY_UPDATED_ORDERS_QUERY = `query AnalyticsUpdatedHistory($cursor: String, $search: String!, $first: Int!) {
  orders(first: $first, after: $cursor, query: $search, sortKey: UPDATED_AT) {
    nodes { id createdAt updatedAt }
    pageInfo { hasNextPage endCursor }
  }
}`;
export type HistoryScope = {
  shop: string; fromTime: string; untilTime: string; approvalRef: string;
  scanBasis?: "created_at" | "updated_at";
};
export type HistoryRow = { source: PilotSource };
export type HistoryOptions = HistoryScope & {
  accessToken: string; fetcher?: typeof fetch; signal: AbortSignal;
  pageSize: number; now: string;
};

/** Creation inventory or update-time change scan, not a financial-date report
 * or proof of all history. Updated scans can discover refunds on older orders.
 */
export function validateHistoryScope(scope: HistoryScope) {
  shopifyShop(scope.shop); nyDate(scope.fromTime); nyDate(scope.untilTime);
  if (!scope.approvalRef.trim() || Date.parse(scope.untilTime) <= Date.parse(scope.fromTime) ||
      scope.scanBasis !== undefined && !["created_at", "updated_at"].includes(scope.scanBasis))
    throw new Error("history_invalid_scope");
}
export function historySearch(scope: HistoryScope) {
  validateHistoryScope(scope);
  const field = scope.scanBasis ?? "created_at";
  return `${field}:>='${scope.fromTime}' ${field}:<'${scope.untilTime}'`;
}
async function request(options: HistoryOptions, query: string, variables: Record<string, unknown>) {
  let response: Response;
  try {
    response = await (options.fetcher ?? fetch)(
      `https://${options.shop}/admin/api/${SHOPIFY_ANALYTICS_API_VERSION}/graphql.json`, {
        method: "POST", redirect: "error",
        signal: AbortSignal.any([options.signal, AbortSignal.timeout(15000)]),
        headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": options.accessToken },
        body: JSON.stringify({ query, variables }),
      },
    );
  } catch { throw new Error("history_transport_failed"); }
  if (!response.ok) throw new Error("history_http_failed");
  if (response.headers.get("X-Shopify-API-Version") !== SHOPIFY_ANALYTICS_API_VERSION)
    throw new Error("history_api_version_mismatch");
  let body;
  try { body = sourceObject(await response.json()); } catch { throw new Error("history_invalid_response"); }
  if (body.errors !== undefined && (!Array.isArray(body.errors) || body.errors.length))
    throw new Error("history_graphql_failed");
  return sourceObject(body.data);
}

/** Check actual token scopes on EVERY resumed invocation, not a caller's boolean. */
export async function verifyHistoryAccess(options: HistoryOptions) {
  validateHistoryScope(options); nyDate(options.now);
  if (!options.accessToken.trim() || !Number.isSafeInteger(options.pageSize) ||
      options.pageSize < 1 || options.pageSize > 20 ||
      Date.parse(options.untilTime) > Date.parse(options.now)) throw new Error("history_invalid_bounds");
  const data = await request(options, HISTORY_ACCESS_QUERY, {});
  const handles = sourceArray(sourceObject(data.currentAppInstallation).accessScopes)
    .map(value => sourceString(sourceObject(value).handle));
  if (!handles.includes("read_orders") && !handles.includes("write_orders"))
    throw new Error("history_missing_order_access");
  // Recent updates can belong to arbitrarily old purchases. Without all-order
  // access a successful query could silently omit those orders.
  if ((options.scanBasis === "updated_at" ||
      Date.parse(options.fromTime) < Date.parse(options.now) - 60 * 86400000) &&
      !handles.includes("read_all_orders")) throw new Error("history_missing_full_history_access");
}

export type HistoryOrder = { id: string; createdAt: string; updatedAt: string };
/** Fixed metadata-only inventory. Caller must verify access before paging. */
export async function readHistoryInventoryPage(options: HistoryOptions, cursor: string | null): Promise<BackfillPage<HistoryOrder>> {
  // Access verification is performed by runShopifyHistory before any page read.
  validateHistoryScope(options);
  if (!Number.isSafeInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 20 ||
      cursor !== null && (!cursor || cursor.length > 4096)) throw new Error("history_invalid_bounds");
  const data = await request(options, options.scanBasis === "updated_at" ? HISTORY_UPDATED_ORDERS_QUERY : HISTORY_ORDERS_QUERY, {
    cursor, search: historySearch(options), first: options.pageSize,
  });
  const connection = sourceObject(data.orders), page = sourceObject(connection.pageInfo);
  const nodes = sourceArray(connection.nodes).map(sourceObject);
  if (typeof page.hasNextPage !== "boolean" ||
      nodes.length > options.pageSize ||
      page.hasNextPage && (!nodes.length || typeof page.endCursor !== "string" || !page.endCursor || page.endCursor === cursor))
    throw new Error("history_invalid_page");
  const ids = new Set<string>();
  const rows: HistoryOrder[] = [];
  let previousTime = -Infinity;
  for (const node of nodes) {
    const id = sourceString(node.id); shopifyId(id, "Order");
    const created = sourceString(node.createdAt), updated = sourceString(node.updatedAt);
    nyDate(created); nyDate(updated);
    const t = Date.parse(options.scanBasis === "updated_at" ? updated : created);
    if (ids.has(id) || t < Date.parse(options.fromTime) || t >= Date.parse(options.untilTime) ||
        t < previousTime || Date.parse(updated) < Date.parse(created) ||
        Date.parse(updated) > Date.parse(options.now)) throw new Error("history_source_scope_mismatch");
    ids.add(id); previousTime = t;
    rows.push({ id, createdAt: created, updatedAt: updated });
  }
  return { rows, complete: !page.hasNextPage, nextCursor: page.hasNextPage ? sourceString(page.endCursor) : null };
}

export async function readHistoryPage(options: HistoryOptions, cursor: string | null): Promise<BackfillPage<HistoryRow>> {
  const page = await readHistoryInventoryPage(options, cursor);
  const rows: HistoryRow[] = [];
  for (const order of page.rows) {
    const source = await readPilotSource(options, order.id);
    if (source.commerce.order.createdAt !== order.createdAt || source.commerce.order.updatedAt !== order.updatedAt)
      throw new Error("history_order_changed_during_read");
    rows.push({ source });
  }
  return { ...page, rows };
}

/** Durable state must be supplied by the registered run, never an HTTP caller.
 * Each commit is an atomic CAS of retained sources plus cursor (migration 015).
 * No mapping/publication/checkpoint is claimed for a failed or skipped order.
 */
export async function runShopifyHistory(options: HistoryOptions & {
  cursor: string | null; maxPages: number; store: BackfillStore<HistoryRow>;
}) {
  if (!Number.isSafeInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 20)
    throw new Error("history_invalid_bounds");
  await verifyHistoryAccess(options);
  return runBackfillBatch({
    cursor: options.cursor, maxPages: options.maxPages, maxRowsPerPage: options.pageSize,
    approvalRef: options.approvalRef,
    fetchPage: cursor => readHistoryPage(options, cursor), store: options.store,
  });
}
