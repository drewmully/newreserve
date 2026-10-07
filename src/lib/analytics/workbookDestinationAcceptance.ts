import { createHash } from "node:crypto";
import { productionReportPath } from "./productionReportDelivery";
import { validProductionWorkbookPayload, workbookResources } from "./productionWorkbookDelivery";
import { workbookRuntimePath, workbookRuntimeSourceId } from "./productionWorkbookRuntime";

type Row = Record<string, unknown>;
export const workbookDestinationResources = [...Object.keys(workbookResources), "report_status"];
const names = workbookDestinationResources;
const limits = { hostedCalls: 0, sourceAuthenticityVerified: false, liveDeliveryVerified: false,
  metricAcceptance: false, sourceMetricAcceptance: "not_evaluated", atomicCrossResourceRefresh: false,
  currentGenerationCertified: false } as const;
const object = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
function fail(): never { throw new Error("workbook_destination_evidence_invalid"); }
function exact(v: unknown, fields: readonly string[]): asserts v is Row {
  if (!object(v) || Object.keys(v).sort().join(",") !== [...fields].sort().join(",")) fail();
}
function ref(v: unknown): asserts v is string {
  if (typeof v !== "string" || !v.trim() || v !== v.trim() || v.length > 512 ||
      /[\u0000-\u001f\u007f]/.test(v)) fail();
}
function instant(v: unknown): number {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{3})?Z$/.test(v)) return fail();
  const n = Date.parse(v);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== v.replace(/Z$/, v.includes(".") ? "Z" : ".000Z")) fail();
  return n;
}
function inventory(v: unknown): asserts v is string[] {
  if (!Array.isArray(v) || v.length > 1000) return fail();
  v.forEach(ref);
  if (new Set(v).size !== v.length) fail();
}
/** Object ordering only. Decimal spelling, nulls, arrays and readiness stay exact. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (object(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
const digest = (v: unknown) => createHash("sha256").update(canonical(v)).digest("hex");
function key(row: Row, resource: string) {
  const fields = resource === "report_status" ? ["resource_name"] :
    workbookResources[resource as keyof typeof workbookResources].key;
  return JSON.stringify(fields.map(k => row[k]));
}
function table(rows: Row[], resource: string) {
  return [...rows].sort((a, b) => key(a, resource) < key(b, resource) ? -1 : key(a, resource) > key(b, resource) ? 1 : 0);
}
const scopeFields = ["report_scope", "shop_id", "publication_id", "definition_version", "model_version",
  "funnel_version", "as_of_at", "report_from_date", "report_through_date", "atomic_resource_refresh"];

function compare(value: unknown, expectedPath: string = productionReportPath) {
  exact(value, ["version", "asOf", "binding", "rounds"]);
  if (value.version !== 1) fail();
  // The file adapter also rejects duplicate JSON members, invalid UTF-8 and depth >32.
  if (Buffer.byteLength(JSON.stringify(value)) > 16000000) fail();
  const asOf = instant(value.asOf), b = value.binding;
  exact(b, ["approvalRef", "operatorRef", "exclusionReviewRef", "origin", "projectId", "sourceId",
    "tables", "excludedSourceIds", "excludedTableIds", "maxAgeSeconds", "scopes"]);
  [b.approvalRef, b.operatorRef, b.exclusionReviewRef, b.projectId, b.sourceId].forEach(ref);
  if (b.origin !== "https://www.mymully.com") fail();
  exact(b.tables, names); exact(b.maxAgeSeconds, names);
  const tables = b.tables, budgets = b.maxAgeSeconds;
  names.forEach(n => ref(tables[n]));
  inventory(b.excludedSourceIds); inventory(b.excludedTableIds);
  if (new Set(Object.values(tables)).size !== 6 || b.excludedSourceIds.includes(String(b.sourceId)) ||
      Object.values(tables).some(t => (b.excludedTableIds as string[]).includes(String(t)))) fail();
  if (!Array.isArray(b.scopes) || !Array.isArray(value.rounds) || !value.rounds.length ||
      value.rounds.length > 2 || b.scopes.length !== value.rounds.length) return fail();
  const scopes = b.scopes;
  const refs = new Set<string>(), jobs = new Set<string>();
  const observed = (v: unknown) => { ref(v); if (refs.has(v)) fail(); refs.add(v); };
  const target = (v: Row, resource: string) => {
    if (v.projectId !== b.projectId || v.sourceId !== b.sourceId ||
        v.tableId !== tables[resource] || v.resource !== resource) fail();
  };
  let priorEnd = -Infinity, priorScope: Row | null = null, priorBody = "";
  const rounds = value.rounds.map((round: unknown, index: number) => {
    exact(round, ["source", "resources", "privacy"]);
    exact(round.resources, names);
    const scope = scopes[index];
    exact(scope, scopeFields);
    const s = round.source;
    exact(s, ["path", "httpStatus", "capturedAt", "evidenceRef", "complete", "body"]);
    observed(s.evidenceRef);
    if (s.path !== expectedPath || s.httpStatus !== 200 || s.complete !== true ||
        !validProductionWorkbookPayload(s.body) || Buffer.byteLength(JSON.stringify(s.body)) > 4194304) fail();
    const body = s.body as Record<string, Row[]>, captured = instant(s.capturedAt);
    if (body.report_status.some(status => scopeFields.some(k => status[k] !== scope[k]) ||
        status.is_stale === true) || Object.values(body).some(rows => rows.some(row => row.is_stale === true))) fail();
    const normalized = Object.fromEntries(names.map(n => [n, table(body[n], n)]));
    const bodyHash = digest(normalized);
    const p = round.privacy;
    exact(p, ["evidenceRef", "checkedAt", "publicationId", "asOfAt", "complete", "independentlyExtracted",
      "pendingRemovalCount", "newerRemovalCount", "selectionInvalidated"]);
    observed(p.evidenceRef);
    if (p.publicationId !== scope.publication_id || p.asOfAt !== scope.as_of_at ||
        p.complete !== true || p.independentlyExtracted !== true || p.pendingRemovalCount !== 0 ||
        p.newerRemovalCount !== 0 || p.selectionInvalidated !== false) fail();
    const privacyAt = instant(p.checkedAt);
    let lastRead = -Infinity;
    const resources = names.map(resource => {
      const o = (round.resources as Row)[resource];
      exact(o, ["readback", "job"]);
      const r = o.readback, j = o.job;
      exact(r, ["projectId", "sourceId", "tableId", "resource", "capturedAt", "evidenceRef", "importJobId",
        "independentlyExtracted", "wholeTable", "unfiltered", "complete", "nextCursor", "totalRows", "rows"]);
      exact(j, ["projectId", "sourceId", "tableId", "resource", "evidenceRef", "jobId", "status",
        "startedAt", "completedAt", "fullRefresh"]);
      [r, j].forEach(a => observed(a.evidenceRef));
      ref(j.jobId); if (jobs.has(j.jobId)) fail(); jobs.add(j.jobId);
      target(r, resource); target(j, resource);
      if (r.independentlyExtracted !== true || r.wholeTable !== true || r.unfiltered !== true ||
          r.complete !== true || r.nextCursor !== null || !Array.isArray(r.rows) ||
          !Number.isSafeInteger(r.totalRows) || r.totalRows !== r.rows.length || r.importJobId !== j.jobId ||
          !validProductionWorkbookPayload({ ...body, [resource]: r.rows })) fail();
      if (j.status !== "completed" || j.fullRefresh !== true) fail();
      const started = instant(j.startedAt);
      const completed = instant(j.completedAt), readAt = instant(r.capturedAt), budget = budgets[resource];
      if (typeof budget !== "number" || !Number.isSafeInteger(budget) || budget < 1 || budget > 86400 ||
          !(priorEnd < captured && captured <= started && started <= completed && completed <= readAt && readAt <= asOf) ||
          Date.parse(String(scope.as_of_at)) > captured || asOf - captured > budget * 1000) fail();
      lastRead = Math.max(lastRead, readAt);
      const rows = r.rows as Row[], expected = new Map(body[resource].map(row => [key(row, resource), canonical(row)]));
      if (new Set(rows.map(row => key(row, resource))).size !== rows.length || expected.size !== rows.length ||
          rows.some(row => expected.get(key(row, resource)) !== canonical(row))) fail();
      const status = body.report_status.find(row => row.resource_name === resource);
      return { resource, state: "offline_table_match" as const, rowCount: rows.length,
        availability: status?.state ?? "operational_metadata", readiness: status?.readiness ?? null,
        sourceCapturedAt: s.capturedAt, jobCompletedAt: j.completedAt, readbackCapturedAt: r.capturedAt,
        jobAgeSeconds: (asOf - completed) / 1000, maxAgeSeconds: budget,
        sourceBodySha256: bodyHash, tableSha256: digest(table(rows, resource)), jobEvidenceSha256: digest(j) };
    });
    if (!(lastRead <= privacyAt && privacyAt <= asOf)) fail();
    if (priorScope?.publication_id === scope.publication_id &&
        (canonical(priorScope) !== canonical(scope) || priorBody !== bodyHash)) fail();
    priorScope = scope; priorBody = bodyHash; priorEnd = privacyAt;
    return { state: "offline_resource_matches" as const, scopeSha256: digest(scope), resources,
      privacyEvidenceSha256: digest(p) };
  });
  return { version: 1, state: "offline_workbook_match" as const, asOf: value.asOf,
    bindingSha256: digest(b), inputSha256: digest(value), rounds, ...limits };
}

/** Supplied-packet equality only. Missing or invalid evidence never becomes acceptance. */
export function acceptWorkbookDestination(value: unknown) {
  try { return compare(value); }
  catch { return { version: 1, state: "not_accepted" as const,
    reason: "missing_or_invalid_retained_evidence", ...limits }; }
}

/** Separate fixed-path observer for the approved former sample source.
 * Never rewrite supplied receipt paths or infer live authenticity/import success.
 * The existing /reports/production comparator retains its original contract.
 */
export function acceptWorkbookRuntimeDestination(value: unknown) {
  try {
    if (!object(value) || !object(value.binding) ||
      value.binding.projectId !== "353503" || value.binding.sourceId !== workbookRuntimeSourceId) fail();
    return compare(value, workbookRuntimePath);
  } catch {
    return { version: 1, state: "not_accepted" as const,
      reason: "missing_or_invalid_retained_evidence", ...limits };
  }
}
