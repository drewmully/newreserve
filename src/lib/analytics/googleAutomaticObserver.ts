import { createHash } from "node:crypto";
import { googleAutomaticDigest } from "./googleAutomaticCapture";
import { validGoogleDeliveryPayload } from "./googleDeliveryRuntime";
import { sourceObject, sourceString } from "./shopifySource";

export const googleAutomaticColumns = ["shop_id", "publication_id", "definition_version", "report_scope",
  "provider", "account_id", "report_date", "source_currency", "source_timezone", "click_definition", "as_of_at",
  "is_stale", "spend_usd", "clicks", "impressions", "ctr", "cpc_usd", "cpm_usd", "readiness"] as const;
export type GoogleObservationBinding = {
  projectId: "353503"; sourceId: string; schemaId: string; tableId: string; tableName: string;
  manifestSha256: string; contractSha256: string; maxAgeSeconds: number;
};
export type GoogleObserverTransport = {
  source(): Promise<unknown>;
  jobs(after: string, before: string): Promise<unknown>;
  query(sql: string): Promise<unknown>;
};
const canonical = (v: unknown): unknown => Array.isArray(v) ? v.map(canonical) :
  v && typeof v === "object" ? Object.fromEntries(Object.entries(v).sort(([a], [b]) => a.localeCompare(b))
    .map(([k, value]) => [k, canonical(value)])) : v;
const hash = (v: unknown) => googleAutomaticDigest(canonical(v));
const instant = (v: unknown) => {
  const n = Date.parse(sourceString(v)); if (!Number.isFinite(n)) throw new Error("google_observation_time"); return n;
};
function completeEnvelope(value: Record<string, unknown>) {
  for (const item of [value, value.structured_content_metadata, value.content_metadata, value.metadata].filter(Boolean)) {
    const row = sourceObject(item);
    if (row.error || row.isError || row.is_error ||
      Object.hasOwn(row, "success") && row.success !== true ||
      ["truncated","is_truncated","isTruncated","hasMore","has_more","limit_reached"].some(key =>
        Object.hasOwn(row, key) && row[key] !== false && row[key] !== null))
      throw new Error("google_observation_incomplete_envelope");
  }
}
export function googleAtomicTableQuery(binding: GoogleObservationBinding) {
  if (!/^[A-Za-z_][A-Za-z0-9_]{0,199}$/.test(binding.tableName)) throw new Error("google_observation_table");
  // Window count precedes LIMIT. One statement detects old/extra rows without
  // filtering to the desired date/generation. Expected population is exactly one.
  return `SELECT count() OVER () AS total_rows, toJSONString(tuple(${googleAutomaticColumns.map(c => `\`${c}\``).join(", ")})) AS row_json FROM \`${binding.tableName}\` LIMIT 2`;
}
/** Lossless adapter for the current execute-sql formatted response. No coercion
 * of money or counts, no inferred completeness from a truncated display. */
export function googleAtomicQueryResult(raw: unknown, sql: string) {
  const result = sourceObject(raw);
  completeEnvelope(result);
  if (typeof result.results !== "string") return result;
  if (sourceObject(result.query).kind !== "HogQLQuery" || sourceObject(result.query).query !== sql ||
    result.__formatted_results_override !== undefined && result.__formatted_results_override !== result.results)
    throw new Error("google_observation_query_echo");
  const lines = result.results.split("\n");
  if (lines.length !== 2 || lines[0] !== "total_rows|row_json" || !lines[1].startsWith("1|"))
    throw new Error("google_observation_query_display");
  return { ...result, columns: ["total_rows", "row_json"], results: [[1, lines[1].slice(2)]] };
}
function safeSchema(raw: unknown, b: GoogleObservationBinding) {
  const s = sourceObject(raw);
  completeEnvelope(s);
  if (s.id !== b.sourceId || s.source_type !== "Custom" || s.latest_error || !Array.isArray(s.schemas))
    throw new Error("google_observation_source");
  const schemas = s.schemas.filter(v => sourceObject(v).id === b.schemaId);
  if (schemas.length !== 1) throw new Error("google_observation_schema");
  const x = sourceObject(schemas[0]), table = sourceObject(x.table);
  if (x.name !== "google_account_daily" || x.status !== "Completed" || x.should_sync !== true ||
    x.sync_type !== "full_refresh" || x.latest_error || table.id !== b.tableId || table.name !== b.tableName ||
    x.row_filters !== null && x.row_filters !== undefined && JSON.stringify(x.row_filters) !== "[]")
    throw new Error("google_observation_schema");
  instant(x.last_synced_at);
  // Private connection fields stay in the transport's RAM. This projection
  // neither prints nor persists them; only the already approved manifest is hashed.
  const inputs = sourceObject(s.job_inputs);
  if (typeof inputs.manifest_json !== "string" ||
    createHash("sha256").update(inputs.manifest_json).digest("hex") !== b.manifestSha256)
    throw new Error("google_observation_manifest");
  return { sourceId: b.sourceId, schemaId: b.schemaId, tableId: b.tableId, tableName: b.tableName,
    status: "Completed", sync: "full_refresh", lastSyncedAt: sourceString(x.last_synced_at), manifestSha256: b.manifestSha256 };
}
function latestJob(raw: unknown, b: GoogleObservationBinding, selectedAt: number, asOf: number) {
  // Current tool returns a newest-first bare array. It is bounded sync evidence,
  // NOT a claim about exhaustive historical jobs or a native job-to-table FK.
  if (!Array.isArray(raw) || !raw.length || raw.length > 1000) throw new Error("google_observation_jobs_shape");
  const rows = raw.map(sourceObject);
  const matching = rows.filter(r => sourceObject(r.schema).id === b.schemaId);
  if (!matching.length) throw new Error("google_observation_job_missing");
  const j = matching[0], schema = sourceObject(j.schema), started = instant(j.created_at), completed = instant(j.finished_at);
  if (j.status !== "Completed" || j.latest_error || schema.name !== "google_account_daily" ||
    schema.should_sync !== true || schema.sync_type !== "full_refresh" || !sourceString(j.id).trim() ||
    started < selectedAt || completed < started || completed > asOf ||
    asOf - completed > b.maxAgeSeconds * 1000 ||
    matching.some((r, i) => i > 0 && instant(r.created_at) > started))
    throw new Error("google_observation_job_stale");
  return { jobId: sourceString(j.id), schemaId: b.schemaId, status: "Completed",
    // Creation is a conservative lower bound, not an observed worker start.
    startedAt: sourceString(j.created_at), completedAt: sourceString(j.finished_at) };
}

/** No caller proof booleans. Evidence derives from two real metadata/job reads
 * and one atomic unfiltered table query. Database commit rechecks selection. */
export async function observeGoogleAutomatic(claim: unknown, transport: GoogleObserverTransport) {
  const c = sourceObject(claim), b = sourceObject(c.destination) as unknown as GoogleObservationBinding;
  const body = sourceObject(c.body), status = sourceObject(body.google_delivery_status);
  if (c.state !== "observe" || b.projectId !== "353503" ||
    !["sourceId", "schemaId", "tableId"].every(k => /^[a-f0-9-]{36}$/.test(String(b[k as keyof GoogleObservationBinding]))) ||
    !/^[a-f0-9]{64}$/.test(b.contractSha256) || !/^[a-f0-9]{64}$/.test(b.manifestSha256) ||
    !Number.isInteger(b.maxAgeSeconds) || b.maxAgeSeconds < 1 || b.maxAgeSeconds > 3600 ||
    !Array.isArray(body.google_account_daily) || body.google_account_daily.length !== 1)
    throw new Error("google_observation_binding");
  const expected = sourceObject(body.google_account_daily[0]);
  if (!validGoogleDeliveryPayload(body, { runId: sourceString(status.run_id), resultHash: sourceString(status.result_hash),
    accountId: sourceString(expected.account_id), date: sourceString(expected.report_date) }) ||
    status.selection_revision !== c.selectionRevision) throw new Error("google_observation_selection");
  const deadline = Math.min(instant(c.deadline), instant(status.expires_at));
  const check = () => { if (Date.now() >= deadline) throw new Error("google_observation_expired"); };
  const first = new Date().toISOString(), selectedAt = instant(status.not_before);
  check();
  const beforeSchema = safeSchema(await transport.source(), b); check();
  const beforeJob = latestJob(await transport.jobs(sourceString(status.not_before), first), b, selectedAt, Date.now()); check();
  const sql = googleAtomicTableQuery(b);
  const result = googleAtomicQueryResult(await transport.query(sql), sql); check();
  if (result.error || result.hasMore === true || result.is_truncated === true || result.limit_reached === true ||
    result.query_status && sourceObject(result.query_status).complete !== true ||
    JSON.stringify(result.columns) !== JSON.stringify(["total_rows", "row_json"]) ||
    !Array.isArray(result.results) || result.results.length !== 1 || !Array.isArray(result.results[0]) ||
    result.results[0].length !== 2 || ![1, "1"].includes(result.results[0][0]) ||
    typeof result.results[0][1] !== "string" || Buffer.byteLength(result.results[0][1]) > 16384)
    throw new Error("google_observation_table_incomplete");
  const tuple = JSON.parse(result.results[0][1]);
  if (!Array.isArray(tuple) || tuple.length !== googleAutomaticColumns.length) throw new Error("google_observation_table_shape");
  const row = Object.fromEntries(googleAutomaticColumns.map((name, i) => [name, tuple[i]]));
  if (hash(row) !== hash(expected)) throw new Error("google_observation_value_mismatch");
  const afterSchema = safeSchema(await transport.source(), b); check();
  const afterJob = latestJob(await transport.jobs(sourceString(status.not_before), new Date().toISOString()),
    b, selectedAt, Date.now()); check();
  const before = hash({ schema: beforeSchema, job: beforeJob }), after = hash({ schema: afterSchema, job: afterJob });
  if (before !== after || instant(afterSchema.lastSyncedAt) > Date.now() ||
    instant(afterSchema.lastSyncedAt) < selectedAt ||
    Date.now() - instant(afterSchema.lastSyncedAt) > b.maxAgeSeconds * 1000)
    throw new Error("google_observation_refresh_changed");
  const checkedAt = new Date().toISOString();
  return { contractSha256: b.contractSha256, beforeSha256: before, afterSha256: after, tableSha256: hash([row]),
    import: { runId: status.run_id, selectionRevision: c.selectionRevision, projectId: b.projectId,
      sourceId: b.sourceId, tableId: b.tableId, resource: "google_account_daily", jobId: afterJob.jobId,
      status: "completed", startedAt: afterJob.startedAt, completedAt: afterJob.completedAt, checkedAt,
      evidenceRef: `google-auto-observer:${hash({ before, after, row, checkedAt })}`,
      complete: true, wholeTable: true, unfiltered: true, independentlyExtracted: true, nextCursor: null, rows: [row] } };
}
