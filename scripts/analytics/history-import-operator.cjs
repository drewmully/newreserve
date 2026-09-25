"use strict";
/* eslint-disable @typescript-eslint/no-require-imports -- dependency-free Node build package */
/** BUILD ONLY. No endpoint, scheduler, operational DB fallback, or automatic retry. */
const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");
const C = require("./history-import-contract.cjs");
function identity(data) {
  if (data?.shop?.myshopifyDomain !== C.SHOP || data?.currentAppInstallation?.id !== C.INSTALLATION ||
    data.currentAppInstallation.app?.id !== C.APP || !Array.isArray(data.currentAppInstallation.accessScopes))
    C.fail("source_identity_mismatch");
  const scopes = new Set(data.currentAppInstallation.accessScopes.map(s => s.handle));
  if (["read_orders", "read_all_orders", "read_products"].some(s => !scopes.has(s))) C.fail("source_scope_missing");
}
function count(data, expected) {
  if (data?.ordersCount?.precision !== "EXACT" || !Number.isSafeInteger(data.ordersCount.count) ||
    data.ordersCount.count !== expected) C.fail("independent_order_count_changed");
  return expected;
}
function numeric(value) {
  if (typeof value !== "string" || !/^(0|[1-9]\d*)$/.test(value) || !Number.isSafeInteger(Number(value)))
    C.fail("invalid_bulk_count");
  return Number(value);
}
function operation(value, id, expected) {
  if (!value || value.id !== id || value.type !== "QUERY" || typeof value.query !== "string" ||
    C.hash(value.query) !== C.HASH || !["CREATED", "RUNNING", "COMPLETED", "FAILED", "CANCELED", "EXPIRED"].includes(value.status))
    C.fail("operation_identity_mismatch");
  const meta = { id, status: value.status, queryHash: C.HASH, rootObjectCount: value.rootObjectCount,
    objectCount: value.objectCount, fileSize: value.fileSize, createdAt: value.createdAt, completedAt: value.completedAt };
  if (value.status === "COMPLETED") {
    if (value.partialDataUrl !== null || value.errorCode !== null || typeof value.completedAt !== "string" ||
      !Number.isFinite(Date.parse(value.completedAt))) C.fail("operation_not_complete");
    const roots = numeric(value.rootObjectCount), objects = numeric(value.objectCount), bytes = numeric(value.fileSize);
    if (roots !== expected || objects < roots || objects - roots > 1000000 || bytes > C.MAX_BYTES)
      C.fail("operation_count_or_size_bound");
    if (bytes === 0 && (roots !== 0 || objects !== 0)) C.fail("unexpected_empty_bulk");
  }
  return meta;
}
function downloadUrl(value) {
  let url; try { url = new URL(value); } catch { C.fail("invalid_download_destination"); }
  if (url.protocol !== "https:" || url.hostname !== "storage.googleapis.com" || url.username || url.password ||
    url.port || url.hash || !url.pathname || url.pathname === "/") C.fail("invalid_download_destination");
  return url.href;
}
async function check(env, config, fetcher = fetch) {
  const report = { status: "failed", stage: "guard", mode: config?.mode ?? null,
    jobId: config?.jobId ?? null, queryHash: C.HASH, sourceRequests: 0, rpcRequests: 0 };
  let timer;
  try {
    if (!config || Object.keys(config).sort().join(",") !== "jobId,mode" ||
      !["start", "check", "import"].includes(config.mode) || !/^[a-zA-Z0-9_-]{1,100}$/.test(config.jobId))
      C.fail("invalid_operator_config");
    if (env.VERCEL_ENV !== "preview" || env.VERCEL_GIT_COMMIT_REF !== C.BRANCH ||
      env.LEAN_ANALYTICS_PIPELINE_PROJECT_REF !== C.PROJECT ||
      env.LEAN_ANALYTICS_SUPABASE_URL !== `https://${C.PROJECT}.supabase.co` ||
      env.LEAN_SHOPIFY_SHOP_DOMAIN !== C.SHOP) C.fail("wrong_destination");
    const sourceToken = env.LEAN_SHOPIFY_ANALYTICS_READ_TOKEN, dbKey = env.LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY;
    if (typeof sourceToken !== "string" || !sourceToken.trim() || typeof dbKey !== "string" || !dbKey.trim())
      C.fail("missing_dedicated_credentials");
    const abort = new AbortController(); timer = setTimeout(() => abort.abort(), 600000);
    const signal = abort.signal;
    let metadataBytes = 0;
    async function jsonRequest(url, init, kind) {
      signal.throwIfAborted();
      if (kind === "source") { if (++report.sourceRequests > (config.mode === "start" ? 2 : config.mode === "check" ? 1 : 3)) C.fail("provider_request_budget"); }
      else if (++report.rpcRequests > 6000) C.fail("rpc_request_budget");
      const requestSignal = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
      const response = await fetcher(url, { ...init, redirect: "error", signal: requestSignal });
      if (!response.ok) C.fail(kind === "source" ? "source_http_failed" : "private_rpc_rejected");
      if (kind === "source" && response.headers.get("X-Shopify-API-Version") !== C.VERSION) C.fail("source_api_version_mismatch");
      const reader = response.body?.getReader(); if (!reader) C.fail("missing_response");
      const chunks = []; let size = 0;
      const cancel = () => { void reader.cancel().catch(() => {}); };
      requestSignal.addEventListener("abort", cancel, { once: true });
      try {
        while (true) {
          requestSignal.throwIfAborted(); const part = await reader.read(); requestSignal.throwIfAborted();
          if (part.done) break;
          size += part.value.length; metadataBytes += part.value.length;
          if (size > 2 * 1024 * 1024 || metadataBytes > 16 * 1024 * 1024) C.fail("metadata_byte_budget");
          chunks.push(Buffer.from(part.value));
        }
      } finally { requestSignal.removeEventListener("abort", cancel); await reader.cancel().catch(() => {}); }
      let body; try { body = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { C.fail("invalid_response"); }
      signal.throwIfAborted();
      return body;
    }
    async function source(query, variables = {}) {
      const result = await jsonRequest(`https://${C.SHOP}/admin/api/${C.VERSION}/graphql.json`, {
        method: "POST", headers: { "Content-Type": "application/json", "X-Shopify-Access-Token": sourceToken },
        body: JSON.stringify({ query, variables }),
      }, "source");
      if (!result || (result.errors !== undefined && (!Array.isArray(result.errors) || result.errors.length)) ||
        !result.data || typeof result.data !== "object") C.fail("source_graphql_failed");
      return result.data;
    }
    const token = randomUUID(), target = { p_job: config.jobId, p_project: C.PROJECT, p_shop: C.SHOP };
    async function rpc(name, args) {
      return jsonRequest(`${env.LEAN_ANALYTICS_SUPABASE_URL}/rest/v1/rpc/${name}`, {
        method: "POST", headers: { "Content-Type": "application/json", apikey: dbKey, Authorization: `Bearer ${dbKey}` },
        body: JSON.stringify({ ...target, ...args }),
      }, "rpc");
    }
    report.stage = "reserve_action";
    const saved = await rpc("lean_history_import_claim", { p_mode: config.mode, p_token: token });
    if (saved?.state === "complete") { report.status = "source_import_already_complete"; report.stage = "complete"; return report; }
    if (saved?.scope?.queryHash !== C.HASH || saved.scope.queryText !== C.QUERY ||
      saved.scope.appId !== C.APP || saved.scope.installationId !== C.INSTALLATION ||
      saved.scope.untilTime !== C.CUTOFF || saved.scope.apiVersion !== C.VERSION ||
      saved.scope.projectRef !== C.PROJECT || saved.scope.shop !== C.SHOP ||
      !Number.isSafeInteger(saved.scope.expectedOrders) || saved.scope.expectedOrders < 0 ||
      saved.scope.expectedOrders > 70000 || !Number.isFinite(Date.parse(saved.leaseUntil))) C.fail("private_manifest_mismatch");
    // One active deadline also covers body consumption, SQL requests and final control.
    clearTimeout(timer);
    const duration = Math.min(600000, Date.parse(saved.leaseUntil) - Date.now());
    if (duration <= 0) C.fail("private_lease_expired");
    timer = setTimeout(() => abort.abort(), duration);
    const expected = saved.scope.expectedOrders;
    if (config.mode === "start") {
      report.stage = "preflight";
      const preflight = await source(C.PREFLIGHT); identity(preflight); count(preflight, expected);
      if (!Array.isArray(preflight.bulkOperations?.nodes) || preflight.bulkOperations.pageInfo?.hasNextPage !== false ||
        preflight.bulkOperations.nodes.length > 100) C.fail("active_operation_inventory_incomplete");
      if (preflight.bulkOperations.nodes.some(op => !["QUERY", "MUTATION"].includes(op.type) ||
        !["CREATED", "RUNNING", "CANCELING"].includes(op.status))) C.fail("invalid_active_operation_inventory");
      if (preflight.bulkOperations.nodes.some(op => op.type === "QUERY")) C.fail("active_query_not_cancelled");
      report.stage = "submit_once";
      const started = await source(C.START, { query: C.QUERY });
      const payload = started.bulkOperationRunQuery;
      if (!payload || !Array.isArray(payload.userErrors) || payload.userErrors.length) C.fail("bulk_submission_rejected");
      const id = payload.bulkOperation?.id;
      if (typeof id !== "string" || !/^gid:\/\/shopify\/BulkOperation\/[1-9][0-9]*$/.test(id)) C.fail("bulk_submission_uncertain");
      report.operationId = id; // Safe rollback/reconciliation handle, never the download URL.
      report.stage = "bind_operation";
      if (await rpc("lean_history_import_bind", { p_token: token, p_operation: id }) !== true) C.fail("operation_binding_failed");
      report.status = "source_operation_submitted"; report.stage = "submitted"; return report;
    }
    report.stage = "verify_operation";
    const before = await source(C.CHECK, { id: saved.operationId }); identity(before); count(before, expected);
    const meta = operation(before.node, saved.operationId, expected);
    if (config.mode === "check") {
      if (await rpc("lean_history_import_observe", { p_token: token, p_operation: meta }) !== true) C.fail("operation_observation_failed");
      report.status = meta.status === "COMPLETED" ? "source_download_ready" :
        ["CREATED", "RUNNING"].includes(meta.status) ? "source_operation_running" : "source_operation_failed";
      report.stage = "checked"; return report;
    }
    if (meta.status !== "COMPLETED" || JSON.stringify(meta) !== JSON.stringify(saved.operation)) {
      // JSONB key ordering differs from JS; compare field values, never serialization order.
      if (meta.status !== "COMPLETED" || Object.keys(meta).some(k => meta[k] !== saved.operation?.[k]))
        C.fail("completed_operation_changed");
    }
    report.stage = "download_and_stage";
    let body;
    if (numeric(meta.fileSize) === 0) body = new ReadableStream({ start(controller) { controller.close(); } });
    else {
      const url = downloadUrl(before.node.url);
      if (++report.sourceRequests > 3) C.fail("provider_request_budget");
      const response = await fetcher(url, { redirect: "error", signal, headers: { "Accept-Encoding": "identity" } });
      signal.throwIfAborted();
      if (!response.ok) C.fail("download_http_failed");
      const length = response.headers.get("content-length");
      if (length !== null && (!/^\d+$/.test(length) || Number(length) !== numeric(meta.fileSize))) C.fail("download_header_size_mismatch");
      body = response.body;
    }
    const evidence = await C.parseStream(body, { signal, fileSize: numeric(meta.fileSize),
      expectedOrders: expected, objectCount: numeric(meta.objectCount),
      batch: async rows => {
        if (await rpc("lean_history_import_batch", { p_token: token, p_rows: rows }) !== true) C.fail("source_batch_not_committed");
      },
    });
    report.stage = "final_source_control";
    const after = await source(C.CHECK, { id: saved.operationId }); identity(after); count(after, expected);
    const finalMeta = operation(after.node, saved.operationId, expected);
    if (Object.keys(meta).some(k => meta[k] !== finalMeta[k])) C.fail("operation_changed_after_download");
    report.stage = "complete_private_inventory";
    if (await rpc("lean_history_import_finish", { p_token: token, p_evidence: {
      ...evidence, beforeCount: expected, afterCount: expected, eof: true, operationId: saved.operationId, queryHash: C.HASH,
    } }) !== true) C.fail("source_completion_not_committed");
    report.status = "source_history_imported"; report.stage = "complete";
    report.scope = "current_visible_orders_lines_refund_summaries_not_financial_certification";
    return report;
  } catch (error) {
    report.reason = error?.safeCode ?? (error?.name === "AbortError" ? "active_deadline" : "operator_failed");
    // Submitting or importing state deliberately persists for bounded/manual recovery.
    return report;
  } finally { if (timer) clearTimeout(timer); }
}
async function main() {
  const config = JSON.parse(fs.readFileSync(path.join(__dirname, "history-import-config.json"), "utf8"));
  const report = await check(process.env, config);
  const out = path.join(process.cwd(), ".vercel/output");
  fs.mkdirSync(path.join(out, "static"), { recursive: true });
  fs.writeFileSync(path.join(out, "config.json"), JSON.stringify({ version: 3 }));
  fs.writeFileSync(path.join(out, "static/history-import.json"), JSON.stringify(report));
  fs.writeFileSync(path.join(out, "static/index.html"), "<!doctype html><title>Private source operator</title>Operator finished. Inspect the sanitized status; deployment readiness is not import success.");
  console.log(JSON.stringify(report));
}
if (require.main === module) main().catch(() => { console.error("history_operator_boot_failed"); process.exitCode = 1; });
module.exports = { check, operation, identity, downloadUrl };
