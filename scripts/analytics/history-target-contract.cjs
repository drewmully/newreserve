"use strict";
/* eslint-disable @typescript-eslint/no-require-imports */
// Private, current-target contract. This compiler creates no execution authority.
const legacy = require("./history-import-contract.cjs");
const { createHash } = require("node:crypto");
const PROJECT = "xnfjdbpjuaezxjgargto";
const SHOP = legacy.SHOP, VERSION = legacy.VERSION;
const PROJECTION = "040_no_customer_v1";
const fail = legacy.fail, hash = legacy.hash;
function cutoff(value) {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/.test(value) ||
    !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value.replace("Z", ".000Z"))
    fail("invalid_target_cutoff");
  return value;
}
function compile(until) {
  cutoff(until);
  // Same exact 2026-07 field projection. Only the independently approved cutoff varies.
  const replace = text => text.replaceAll(legacy.CUTOFF, until);
  const QUERY = replace(legacy.QUERY);
  return { QUERY, HASH: hash(QUERY), PREFLIGHT: replace(legacy.PREFLIGHT), CHECK: replace(legacy.CHECK),
    START: legacy.START, SEARCH: `created_at:<'${until}'` };
}
function validateManifest(m, env, phase = "import") {
  if (!m || Object.keys(m).sort().join(",") !==
    "approvalId,inventoryRef,operatorRef,projection,report,scope" || !m.scope ||
    m.projection !== PROJECTION || typeof m.inventoryRef !== "string" || !m.inventoryRef.trim() ||
    typeof m.operatorRef !== "string" || !m.operatorRef.trim() ||
    !/^[a-zA-Z0-9_-]{1,100}$/.test(m.approvalId)) fail("invalid_target_manifest");
  const s = m.scope, c = compile(s.untilTime);
  if (s.projectRef !== PROJECT || s.shop !== SHOP || s.apiVersion !== VERSION ||
    !/^gid:\/\/shopify\/App\/[1-9]\d*$/.test(s.appId) ||
    !/^gid:\/\/shopify\/AppInstallation\/[1-9]\d*$/.test(s.installationId) ||
    s.queryText !== c.QUERY || s.queryHash !== c.HASH || s.approvalRef !== m.approvalId ||
    s.actorRef !== m.operatorRef || !Number.isSafeInteger(s.expectedOrders) ||
    s.expectedOrders < 0 || s.expectedOrders > 70000 ||
    !Number.isFinite(Date.parse(s.expiresAt)) ||
    !Number.isFinite(Date.parse(phase === "report" ? m.report?.expiresAt : s.expiresAt)) ||
    Date.parse(phase === "report" ? m.report?.expiresAt : s.expiresAt) <= Date.now() ||
    !Number.isFinite(Date.parse(s.purgeAfter)) || Date.parse(s.purgeAfter) < Date.parse(s.expiresAt) ||
    Date.parse(s.purgeAfter) > Date.parse(s.expiresAt) + 86400000)
    fail("target_manifest_mismatch");
  if (env && (env.LEAN_HISTORY_TARGET_OPERATOR_REF !== m.operatorRef ||
    env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== PROJECT ||
    env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${PROJECT}.supabase.co` ||
    env.LEAN_SHOPIFY_SHOP_DOMAIN !== SHOP)) fail("wrong_destination");
  return c;
}
function identity(data, m, includeCustomerId = false) {
  if (data?.shop?.myshopifyDomain !== SHOP || data?.currentAppInstallation?.id !== m.scope.installationId ||
    data.currentAppInstallation.app?.id !== m.scope.appId || !Array.isArray(data.currentAppInstallation.accessScopes))
    fail("source_identity_mismatch");
  const scopes = new Set(data.currentAppInstallation.accessScopes.map(s => s.handle));
  if (["read_orders", "read_all_orders", "read_products", ...(includeCustomerId ? ["read_customers"] : [])]
    .some(s => !scopes.has(s))) fail("source_scope_missing");
}
function keys(value, fields) {
  if (!value || typeof value !== "object" || Array.isArray(value) ||
    Object.keys(value).length !== fields.length || fields.some(k => !Object.hasOwn(value, k)))
    fail("invalid_source_shape");
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
// The old row validator's order arm, with an explicit cutoff. Never rewrite source fields.
function row(value, until) {
  cutoff(until);
  if (value?.__typename !== "Order") return legacy.row(value);
  const monetary = ["totalPriceSet", "currentTotalPriceSet", "subtotalPriceSet", "totalTaxSet", "totalDiscountsSet", "totalRefundedSet"];
  keys(value, ["__typename", "id", "createdAt", "updatedAt", "processedAt", "cancelledAt", "test", "edited",
    "taxesIncluded", "currencyCode", "displayFinancialStatus", ...monetary, "refunds"]);
  if (!/^gid:\/\/shopify\/Order\/[1-9]\d*$/.test(value.id)) fail("invalid_source_id");
  time(value.createdAt); time(value.updatedAt); time(value.processedAt, true); time(value.cancelledAt, true);
  if (Date.parse(value.createdAt) >= Date.parse(until) || Date.parse(value.updatedAt) < Date.parse(value.createdAt))
    fail("source_outside_scope");
  if (["test", "edited", "taxesIncluded"].some(k => typeof value[k] !== "boolean")) fail("invalid_source_flag");
  if (!/^[A-Z]{3}$/.test(value.currencyCode) || value.displayFinancialStatus !== null &&
    (typeof value.displayFinancialStatus !== "string" || !/^[A-Z_]{1,40}$/.test(value.displayFinancialStatus)))
    fail("invalid_source_enum");
  for (const k of monetary) money(value[k], ["subtotalPriceSet", "totalTaxSet", "totalDiscountsSet"].includes(k));
  if (!Array.isArray(value.refunds)) fail("invalid_refunds");
  const ids = new Set();
  for (const r of value.refunds) {
    keys(r, ["id", "createdAt", "updatedAt", "totalRefundedSet"]);
    if (!/^gid:\/\/shopify\/Refund\/[1-9]\d*$/.test(r.id)) fail("invalid_source_id");
    time(r.createdAt, true); time(r.updatedAt); money(r.totalRefundedSet);
    if (ids.has(r.id)) fail("duplicate_refund"); ids.add(r.id);
  }
  return { kind: "order", source: value };
}
// Same finite streaming budgets as 040. A separate entry avoids changing the old contract.
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
    if (buffer.length > legacy.MAX_LINE) fail("jsonl_line_budget");
    let parsed;
    try { parsed = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(buffer)); }
    catch { fail("invalid_jsonl"); }
    const record = row(parsed, options.untilTime), ids = record.kind === "order" ? orderIds : lineIds;
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
      signal?.throwIfAborted(); const { value, done } = await reader.read(); signal?.throwIfAborted();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > legacy.MAX_BYTES || bytes > options.fileSize) fail("download_byte_budget");
      digest.update(value); carry = Buffer.concat([carry, Buffer.from(value)]);
      let index;
      while ((index = carry.indexOf(10)) !== -1) { await line(carry.subarray(0, index)); carry = carry.subarray(index + 1); }
      if (carry.length > legacy.MAX_LINE) fail("jsonl_line_budget");
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
module.exports = { PROJECT, SHOP, VERSION, PROJECTION, MAX_BYTES: legacy.MAX_BYTES, compile,
  validateManifest, identity, row, parseStream, fail, hash };
