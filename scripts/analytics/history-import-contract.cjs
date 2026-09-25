"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- dependency-free Node build package */
const { createHash } = require("node:crypto");
const SHOP = "mullybox-store.myshopify.com";
const PROJECT = "xeqlgxvrhgwwudyqtnun";
const BRANCH = "review/analytics-initial-validation";
const APP = "gid://shopify/App/280048107521";
const INSTALLATION = "gid://shopify/AppInstallation/616186609856";
const VERSION = "2026-07";
const CUTOFF = "2026-09-25T08:04:00Z";
const SEARCH = `created_at:<'${CUTOFF}'`;
const MONEY = "{ shopMoney { amount currencyCode } }";
const QUERY = `{ orders(query: "${SEARCH}", sortKey: CREATED_AT) { edges { node {
  __typename id createdAt updatedAt processedAt cancelledAt test edited taxesIncluded currencyCode displayFinancialStatus
  totalPriceSet ${MONEY} currentTotalPriceSet ${MONEY} subtotalPriceSet ${MONEY}
  totalTaxSet ${MONEY} totalDiscountsSet ${MONEY} totalRefundedSet ${MONEY}
  refunds { id createdAt updatedAt totalRefundedSet ${MONEY} }
  lineItems { edges { node { __typename id quantity currentQuantity isGiftCard requiresShipping taxable
    product { id } variant { id } originalTotalSet ${MONEY} originalUnitPriceSet ${MONEY} totalDiscountSet ${MONEY}
  } } }
} } } }`;
const HASH = createHash("sha256").update(QUERY).digest("hex");
const IDENTITY = `shop { myshopifyDomain } currentAppInstallation { id app { id } accessScopes { handle } }`;
const CONTROL = `ordersCount(query: "${SEARCH}", limit: null) { count precision }`;
const PREFLIGHT = `query HistoryImportPreflight { ${IDENTITY} ${CONTROL}
  bulkOperations(first: 100, query: "status:created OR status:running OR status:canceling") {
    nodes { id status type } pageInfo { hasNextPage endCursor }
  }
}`;
const CHECK = `query HistoryImportCheck($id: ID!) { ${IDENTITY} ${CONTROL} node(id: $id) {
  ... on BulkOperation { id status type query rootObjectCount objectCount fileSize url partialDataUrl createdAt completedAt errorCode }
} }`;
const START = `mutation HistoryImportStart($query: String!) {
  bulkOperationRunQuery(query: $query, groupObjects: false) {
    bulkOperation { id status } userErrors { code field message }
  }
}`;
const MAX_BYTES = 256 * 1024 * 1024;
const MAX_LINE = 1024 * 1024;
const fail = code => { const e = new Error(code); e.safeCode = code; throw e; };
const hash = value => createHash("sha256").update(value).digest("hex");
const object = value => value !== null && typeof value === "object" && !Array.isArray(value);
function keys(value, fields) {
  if (!object(value) || Object.keys(value).length !== fields.length ||
    fields.some(k => !Object.hasOwn(value, k))) fail("invalid_source_shape");
}
function gid(value, kind) {
  if (typeof value !== "string" || !new RegExp(`^gid://shopify/${kind}/[1-9][0-9]*$`).test(value)) fail("invalid_source_id");
  return value;
}
function time(value, nullable = false) {
  if (nullable && value === null) return;
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d+)?Z$/.test(value) ||
    !Number.isFinite(Date.parse(value))) fail("invalid_source_time");
}
function money(value, nullable = false) {
  if (nullable && value === null) return;
  keys(value, ["shopMoney"]); keys(value.shopMoney, ["amount", "currencyCode"]);
  if (typeof value.shopMoney.amount !== "string" || !/^-?\d{1,24}(?:\.\d{1,12})?$/.test(value.shopMoney.amount) ||
    !/^[A-Z]{3}$/.test(value.shopMoney.currencyCode)) fail("invalid_source_money");
}
function bools(value, names) { if (names.some(k => typeof value[k] !== "boolean")) fail("invalid_source_flag"); }
/** Reject extra/free-text fields rather than quietly retaining them. No policy mapping. */
function row(value) {
  if (value?.__typename === "Order") {
    const monetary = ["totalPriceSet", "currentTotalPriceSet", "subtotalPriceSet", "totalTaxSet", "totalDiscountsSet", "totalRefundedSet"];
    keys(value, ["__typename", "id", "createdAt", "updatedAt", "processedAt", "cancelledAt", "test", "edited",
      "taxesIncluded", "currencyCode", "displayFinancialStatus", ...monetary, "refunds"]);
    gid(value.id, "Order"); time(value.createdAt); time(value.updatedAt); time(value.processedAt, true); time(value.cancelledAt, true);
    if (Date.parse(value.createdAt) >= Date.parse(CUTOFF) || Date.parse(value.updatedAt) < Date.parse(value.createdAt))
      fail("source_outside_scope");
    bools(value, ["test", "edited", "taxesIncluded"]);
    if (!/^[A-Z]{3}$/.test(value.currencyCode) || (value.displayFinancialStatus !== null &&
      (typeof value.displayFinancialStatus !== "string" || !/^[A-Z_]{1,40}$/.test(value.displayFinancialStatus))))
      fail("invalid_source_enum");
    for (const key of monetary) money(value[key], ["subtotalPriceSet", "totalTaxSet", "totalDiscountsSet"].includes(key));
    if (!Array.isArray(value.refunds)) fail("invalid_refunds");
    const ids = new Set();
    for (const refund of value.refunds) {
      keys(refund, ["id", "createdAt", "updatedAt", "totalRefundedSet"]);
      gid(refund.id, "Refund"); time(refund.createdAt, true); time(refund.updatedAt); money(refund.totalRefundedSet);
      if (ids.has(refund.id)) fail("duplicate_refund"); ids.add(refund.id);
    }
    return { kind: "order", source: value };
  }
  const monetary = ["originalTotalSet", "originalUnitPriceSet", "totalDiscountSet"];
  keys(value, ["__typename", "__parentId", "id", "quantity", "currentQuantity", "isGiftCard", "requiresShipping",
    "taxable", "product", "variant", ...monetary]);
  if (value.__typename !== "LineItem") fail("unknown_source_kind");
  gid(value.id, "LineItem"); gid(value.__parentId, "Order");
  for (const key of ["quantity", "currentQuantity"])
    if (!Number.isSafeInteger(value[key]) || value[key] < 0 || value[key] > 1000000000) fail("invalid_source_quantity");
  bools(value, ["isGiftCard", "requiresShipping", "taxable"]);
  for (const [key, kind] of [["product", "Product"], ["variant", "ProductVariant"]])
    if (value[key] !== null) { keys(value[key], ["id"]); gid(value[key].id, kind); }
  for (const key of monetary) money(value[key]);
  return { kind: "line", source: value };
}
/** One full pass per import attempt; persisted equal rows can be replayed.
 * No skipping parse/write failures, no acceptance of a truncated final record.
 */
async function parseStream(body, options) {
  if (!body) fail("missing_download_body");
  const reader = body.getReader(), digest = createHash("sha256");
  const orderIds = new Set(), lineIds = new Set(), parents = new Set();
  let bytes = 0, carry = Buffer.alloc(0), batch = [], batchBytes = 0;
  const signal = options.signal;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  signal?.addEventListener("abort", cancel, { once: true });
  async function flush() {
    if (!batch.length) return;
    signal?.throwIfAborted(); await options.batch(batch); signal?.throwIfAborted();
    batch = []; batchBytes = 0;
  }
  async function line(buffer) {
    if (!buffer.length) fail("empty_jsonl_line");
    if (buffer.length > MAX_LINE) fail("jsonl_line_budget");
    let parsed;
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); }
    catch { fail("invalid_jsonl"); }
    const record = row(parsed), ids = record.kind === "order" ? orderIds : lineIds;
    if (ids.has(parsed.id)) fail("duplicate_source_row");
    ids.add(parsed.id);
    if (record.kind === "line") parents.add(parsed.__parentId);
    if (orderIds.size > 70000 || lineIds.size > 1000000) fail("source_row_budget");
    const size = Buffer.byteLength(JSON.stringify(record));
    if (batch.length && (batch.length >= 250 || batchBytes + size > 1500000)) await flush();
    batch.push(record); batchBytes += size;
  }
  try {
    while (true) {
      signal?.throwIfAborted();
      const { value, done } = await reader.read(); signal?.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > MAX_BYTES || bytes > options.fileSize) fail("download_byte_budget");
      digest.update(value); carry = Buffer.concat([carry, Buffer.from(value)]);
      let index;
      while ((index = carry.indexOf(10)) !== -1) {
        await line(carry.subarray(0, index)); carry = carry.subarray(index + 1);
      }
      if (carry.length > MAX_LINE) fail("jsonl_line_budget");
    }
    if (carry.length) await line(carry);
    if (bytes !== options.fileSize) fail("download_size_mismatch");
    for (const parent of parents) if (!orderIds.has(parent)) fail("orphan_line");
    if (orderIds.size !== options.expectedOrders || orderIds.size + lineIds.size !== options.objectCount)
      fail("download_count_mismatch");
    await flush();
    return { bytes, sha256: digest.digest("hex"), orders: orderIds.size, lines: lineIds.size };
  } finally { signal?.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); }
}
module.exports = { SHOP, PROJECT, BRANCH, APP, INSTALLATION, VERSION, CUTOFF, SEARCH, QUERY, HASH,
  PREFLIGHT, CHECK, START, MAX_BYTES, MAX_LINE, fail, hash, row, parseStream };
