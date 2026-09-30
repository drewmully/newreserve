/** Default-off collection mechanics. Transport is injected; no fetch, env, credentials or writes. */
import { buildSubscriptionSnapshot, type SubscriptionPolicy } from "./subscriptions";
import { key, nyDate } from "./primitives";
import { setTimeout as delay } from "node:timers/promises";

export type SubscriptionRead = {
  method: "GET";
  path: string;
  redirect: "error";
  signal: AbortSignal;
};
export type SubscriptionTransport = (request: SubscriptionRead) => Promise<Response>;
export type SubscriptionCollectionOptions = {
  enabled?: boolean;
  shop: string;
  asOf: string;
  evidenceRef: string;
  maxPages: number;
  maxRows: number;
  maxBytes: number;
  pageSize: number;
  status: "ACTIVE" | "PAUSED" | "CANCELLED" | "EXPIRED" | null;
  signal?: AbortSignal;
  /** Server-only continuation channel; never included in the public result/evidence. */
  continueAfter?: string | null;
  onContinuation?: (cursor: string | null) => void;
};
type Row = Record<string, unknown>;
function object(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("subscription_collection_shape");
  return value as Row;
}
function select(row: Row, fields: string[]): Row {
  return Object.fromEntries(fields.filter(k => Object.hasOwn(row, k)).map(k => [k, row[k]]));
}
/** Raw responses may transiently include PII. Copy only supported fields; never retain raw rows. */
function project(value: unknown, filter: string | null): Row {
  const raw = object(value);
  if (filter !== null && raw.status !== filter) throw new Error("subscription_collection_status_filter");
  const row = select(raw, ["id", "status", "nextBillingDateEpoch", "currencyCode", "isPrepaid"]);
  if (raw.customer !== undefined)
    row.customer = raw.customer === null ? null : select(object(raw.customer), ["shopifyId"]);
  if (raw.billingPolicy !== undefined)
    row.billingPolicy = raw.billingPolicy === null ? null : select(object(raw.billingPolicy), ["interval", "intervalCount"]);
  if (raw.lines !== undefined) {
    if (raw.lines === null) row.lines = null;
    else {
      if (!Array.isArray(raw.lines) || raw.lines.length > 100) throw new Error("subscription_collection_lines");
      row.lines = raw.lines.map(v => select(object(v), ["price", "quantity"]));
    }
  }
  return row;
}
async function bounded<T>(operation: () => Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) throw new Error("subscription_collection_aborted");
  return new Promise((resolve, reject) => {
    const aborted = () => reject(new Error("subscription_collection_aborted"));
    signal.addEventListener("abort", aborted, { once: true });
    Promise.resolve().then(() => {
      if (signal.aborted) throw new Error("subscription_collection_aborted");
      return operation();
    }).then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", aborted);
    });
  });
}
async function readJson(response: Response, remaining: number, signal: AbortSignal) {
  if (!response.ok || response.redirected) throw new Error("subscription_collection_http");
  if ((response.headers.get("content-type") ?? "").toLowerCase().split(";")[0].trim() !== "application/json")
    throw new Error("subscription_collection_content_type");
  const length = response.headers.get("content-length");
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > remaining))
    throw new Error("subscription_collection_byte_budget");
  const reader = response.body?.getReader();
  if (!reader) throw new Error("subscription_collection_body");
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  try {
    for (;;) {
      const part = await bounded(() => reader.read(), signal);
      if (part.done) break;
      bytes += part.value.length;
      if (bytes > remaining) throw new Error("subscription_collection_byte_budget");
      chunks.push(part.value);
    }
    let value: unknown;
    try { value = JSON.parse(Buffer.concat(chunks).toString("utf8")); }
    catch { throw new Error("subscription_collection_json"); }
    return { value, bytes };
  } finally {
    void reader.cancel().catch(() => {}); // Do not await an untrusted cancellation implementation.
    reader.releaseLock();
  }
}

/** Current public docs: admin/2026-04/subscription, optional status, cursor pagination.
 * End-of-pagination is NOT a stable snapshot, authorization, or complete scope.
 * There is intentionally no option to certify completeness or inject money evidence.
 */
export async function collectSubscriptionSnapshot(
  options: SubscriptionCollectionOptions, policy: SubscriptionPolicy, transport?: SubscriptionTransport,
) {
  if (options.enabled !== true) return { state: "disabled" as const };
  if (Object.keys(options).some(k => !["enabled", "shop", "asOf", "evidenceRef", "maxPages",
    "maxRows", "maxBytes", "pageSize", "status", "signal", "continueAfter", "onContinuation"].includes(k)) ||
      !Number.isSafeInteger(options.maxPages) || options.maxPages < 1 || options.maxPages > 20 ||
      !Number.isSafeInteger(options.maxRows) || options.maxRows < 1 || options.maxRows > 1000 ||
      !Number.isSafeInteger(options.maxBytes) || options.maxBytes < 1 || options.maxBytes > 4000000 ||
      !Number.isSafeInteger(options.pageSize) || options.pageSize < 1 || options.pageSize > 100 ||
      ![null, "ACTIVE", "PAUSED", "CANCELLED", "EXPIRED"].includes(options.status) ||
      typeof transport !== "function" ||
      options.continueAfter != null && (typeof options.continueAfter !== "string" || !options.continueAfter.length ||
        Buffer.byteLength(options.continueAfter) > 4096) ||
      options.onContinuation !== undefined && typeof options.onContinuation !== "function")
    throw new Error("subscription_collection_configuration");
  if (options.status !== null && JSON.stringify(policy.countedStatuses) !== JSON.stringify([options.status]) ||
      policy.recurringValue !== null)
    throw new Error("subscription_collection_policy");
  const scope = { shop: options.shop, asOf: options.asOf, evidenceRef: options.evidenceRef, scopeComplete: false };
  // Validate the full policy and target before the first transport invocation.
  buildSubscriptionSnapshot({ ...scope, pages: [{ pageNo: 1, hasNextPage: false, rows: [] }] }, policy);
  const lifetime = new AbortController();
  const signal = AbortSignal.any([lifetime.signal, AbortSignal.timeout(30000), ...(options.signal ? [options.signal] : [])]);
  const pages: { pageNo: number; hasNextPage: boolean; rows: Row[] }[] = [];
  const pageEvidence: { pageNumber: number; requestedPageSize: number; rowCount: number; hasNextPage: boolean;
    requestCursorDigest: string | null; projectedDigest: string }[] = [];
  const revisions = new Map<string, string | null>(), cursors = new Set<string>();
  let cursor: string | null = options.continueAfter ?? null;
  if (cursor !== null) cursors.add(cursor);
  const startedAt = new Date().toISOString();
  let bytes = 0, rawRows = 0, requests = 0, paginationEnded = false, rowLimit = false;
  try {
  for (let pageNo = 1; pageNo <= options.maxPages; pageNo++) {
    // Public limit is 2 requests/3 seconds. Sequential reads are spaced conservatively.
    if (pageNo > 1) {
      try { await delay(1600, undefined, { signal }); }
      catch { throw new Error("subscription_collection_aborted"); }
    }
    const requestedPageSize = Math.min(options.pageSize, options.maxRows - rawRows);
    const query = new URLSearchParams({ pageSize: String(requestedPageSize) });
    if (options.status !== null) query.set("status", options.status);
    if (cursor !== null) query.set("afterCursor", cursor);
    let response: Response;
    try {
      response = await bounded(() => {
        requests++;
        return transport({ method: "GET", path: `/admin/2026-04/subscription?${query}`, redirect: "error", signal });
      }, signal);
    } catch {
      throw new Error(signal.aborted ? "subscription_collection_aborted" : "subscription_collection_transport");
    }
    let decoded: Awaited<ReturnType<typeof readJson>>;
    try { decoded = await readJson(response, options.maxBytes - bytes, signal); }
    catch {
      // Never forward a provider/stream exception that may include raw PII or credentials.
      throw new Error(signal.aborted ? "subscription_collection_aborted" : "subscription_collection_response");
    }
    bytes += decoded.bytes;
    const envelope = object(decoded.value), pageInfo = object(envelope.pageInfo);
    if (!Array.isArray(envelope.data) || envelope.data.length > requestedPageSize ||
        envelope.success !== true || envelope.code !== "SUCCESS" ||
        typeof pageInfo.hasNextPage !== "boolean" ||
        envelope.errors !== undefined && (!Array.isArray(envelope.errors) || envelope.errors.length > 0) ||
        envelope.error !== undefined ||
        pageInfo.hasNextPage && envelope.data.length === 0) throw new Error("subscription_collection_page");
    rawRows += envelope.data.length;
    if (rawRows > options.maxRows) throw new Error("subscription_collection_row_budget");
    const projected = envelope.data.map(v => project(v, options.status));
    pages.push({ pageNo, hasNextPage: pageInfo.hasNextPage, rows: projected });
    // Validate every received page before requesting another; reject conflicts and schema drift early.
    try { buildSubscriptionSnapshot({ ...scope, pages }, policy); }
    catch { throw new Error("subscription_collection_invalid_projection"); }
    for (const raw of envelope.data.map(object)) {
      const contractKey = key("loop-contract", options.shop, String(raw.id));
      let updated: string | null = null;
      if (raw.updatedAt != null) {
        try { if (typeof raw.updatedAt !== "string") throw new Error(); nyDate(raw.updatedAt);
          updated = raw.updatedAt; } // Retain fractional precision; never collapse distinct revisions.
        catch { throw new Error("subscription_collection_revision"); }
      }
      if (revisions.has(contractKey) && revisions.get(contractKey) !== updated)
        throw new Error("subscription_collection_revision_conflict");
      revisions.set(contractKey, updated);
    }
    pageEvidence.push({ pageNumber: pageNo, requestedPageSize, rowCount: projected.length, hasNextPage: pageInfo.hasNextPage,
      requestCursorDigest: cursor === null ? null : key("loop-cursor", cursor),
      projectedDigest: key("loop-projected-page", JSON.stringify(projected)) });
    if (!pageInfo.hasNextPage) { paginationEnded = true; break; }
    if (typeof pageInfo.nextCursor !== "string" || !pageInfo.nextCursor.length ||
        Buffer.byteLength(pageInfo.nextCursor) > 4096 || cursors.has(pageInfo.nextCursor))
      throw new Error("subscription_collection_cursor");
    cursor = pageInfo.nextCursor; cursors.add(cursor);
    if (rawRows === options.maxRows) { rowLimit = true; break; }
    if (bytes >= options.maxBytes) throw new Error("subscription_collection_byte_budget");
  }
  options.onContinuation?.(paginationEnded ? null : cursor);
  return {
    state: paginationEnded ? "pagination_ended" as const : rowLimit ? "row_limit" as const : "page_limit" as const,
    collection: { requests, bytes, rawRows, startedAt, finishedAt: new Date().toISOString(), consistency: "unverified" as const,
      apiVersion: "2026-04" as const, targetBinding: "unverified" as const, statusFilter: options.status, pageSize: options.pageSize,
      rawResponseExposure: "transient_in_memory" as const, pages: pageEvidence,
      revisions: [...revisions].sort(([a], [b]) => a.localeCompare(b))
        .map(([contractKey, sourceUpdatedAt]) => ({ contractKey, sourceUpdatedAt })) },
    snapshot: buildSubscriptionSnapshot({ ...scope, pages }, policy),
  };
  } finally { lifetime.abort(); }
}
