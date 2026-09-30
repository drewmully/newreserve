import { createHash } from "node:crypto";
import { productionReportPath, validProductionReportPayload } from "./productionReportDelivery";

const resources = ["store_daily", "product_daily"] as const;
type Resource = typeof resources[number];
type Row = Record<string, unknown>;
type Payload = Record<Resource, Row[]>;
type Target = { projectId: string; sourceId: string; tableId: string; resource: Resource };
type Observation = {
  source: {
    path: string; httpStatus: number; capturedAt: string; evidenceRef: string;
    complete: boolean; body: Payload;
  };
  readback: Target & {
    capturedAt: string; evidenceRef: string; independentlyExtracted: boolean;
    wholeTable: boolean; unfiltered: boolean; complete: boolean;
    nextCursor: null; totalRows: number; rows: Row[];
  };
  job: Target & {
    evidenceRef: string; status: string; startedAt: string; completedAt: string;
    fullRefresh: boolean;
  };
};
export type ProductionDestinationInput = {
  version: 1;
  asOf: string;
  binding: {
    approvalRef: string; operatorRef: string; exclusionReviewRef: string;
    origin: string; projectId: string; sourceId: string;
    tables: Record<Resource, string>;
    excludedSourceIds: string[]; excludedTableIds: string[];
    maxAgeSeconds: Record<Resource, number>;
  };
  resources: Record<Resource, Observation>;
};
function fail(): never { throw new Error("production_destination_evidence_invalid"); }
const object = (v: unknown): v is Row => !!v && typeof v === "object" && !Array.isArray(v);
function exact(v: unknown, fields: string[]): asserts v is Row {
  if (!object(v) || JSON.stringify(Object.keys(v).sort()) !== JSON.stringify([...fields].sort())) fail();
}
function ref(v: unknown): asserts v is string {
  if (typeof v !== "string" || !v.trim() || v !== v.trim() || v.length > 512 ||
      /[\u0000-\u001f\u007f]/.test(v)) fail();
}
function instant(v: unknown): number {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/.test(v)) return fail();
  const n = Date.parse(v);
  if (!Number.isFinite(n) || new Date(n).toISOString() !== v.replace(/Z$/, v.includes(".") ? "Z" : ".000Z")) fail();
  return n;
}
function inventory(v: unknown): asserts v is string[] {
  if (!Array.isArray(v) || !v.length || v.length > 1000) fail();
  v.forEach(ref);
  if (new Set(v).size !== v.length) fail();
}
/** Canonical object ordering only. Never normalize decimal strings, nulls or flags. */
function canonical(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (object(v)) return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonical(v[k])}`).join(",")}}`;
  return JSON.stringify(v);
}
function digest(v: unknown) { return createHash("sha256").update(canonical(v)).digest("hex"); }
function recordKey(r: Row, resource: Resource) {
  return JSON.stringify([r.report_date, r.definition_version, ...(resource === "product_daily" ? [r.sku_bucket] : [])]);
}
function target(v: Target, resource: Resource, b: ProductionDestinationInput["binding"]) {
  if (v.resource !== resource || v.projectId !== b.projectId || v.sourceId !== b.sourceId ||
      v.tableId !== b.tables[resource]) fail();
}

/** Checks supplied evidence, not its authenticity. No I/O, activation or shared-generation claim.
 * Metadata belongs to the private operator packet, never to the canonical feed.
 */
export function acceptProductionDestination(value: unknown) {
  exact(value, ["version", "asOf", "binding", "resources"]);
  if (value.version !== 1) fail();
  const input = value as unknown as ProductionDestinationInput;
  const asOf = instant(input.asOf), b = input.binding;
  exact(b, ["approvalRef", "operatorRef", "exclusionReviewRef", "origin", "projectId", "sourceId",
    "tables", "excludedSourceIds", "excludedTableIds", "maxAgeSeconds"]);
  [b.approvalRef, b.operatorRef, b.exclusionReviewRef, b.projectId, b.sourceId].forEach(ref);
  if (b.origin !== "https://www.mymully.com") fail();
  exact(b.tables, [...resources]); exact(b.maxAgeSeconds, [...resources]);
  resources.forEach(r => ref(b.tables[r]));
  inventory(b.excludedSourceIds); inventory(b.excludedTableIds);
  if (b.tables.store_daily === b.tables.product_daily || b.excludedSourceIds.includes(b.sourceId) ||
      resources.some(r => b.excludedTableIds.includes(b.tables[r]))) fail();
  exact(input.resources, [...resources]);
  const evidenceRefs = new Set<string>();
  const results = resources.map(resource => {
    const o = input.resources[resource], budget = b.maxAgeSeconds[resource];
    if (!Number.isSafeInteger(budget) || budget < 1 || budget > 86400) fail();
    exact(o, ["source", "readback", "job"]);
    const s = o.source, r = o.readback, j = o.job;
    exact(s, ["path", "httpStatus", "capturedAt", "evidenceRef", "complete", "body"]);
    exact(r, ["projectId", "sourceId", "tableId", "resource", "capturedAt", "evidenceRef",
      "independentlyExtracted", "wholeTable", "unfiltered", "complete", "nextCursor", "totalRows", "rows"]);
    exact(j, ["projectId", "sourceId", "tableId", "resource", "evidenceRef", "status",
      "startedAt", "completedAt", "fullRefresh"]);
    // An independent capture/job reference cannot be reused for another artifact.
    for (const artifact of [s, r, j]) {
      ref(artifact.evidenceRef);
      if (evidenceRefs.has(artifact.evidenceRef)) fail();
      evidenceRefs.add(artifact.evidenceRef);
    }
    target(r, resource, b); target(j, resource, b);
    if (s.path !== productionReportPath || s.httpStatus !== 200 || s.complete !== true ||
        !validProductionReportPayload(s.body) ||
        Buffer.byteLength(JSON.stringify(s.body)) > 4194304) fail();
    if (r.independentlyExtracted !== true || r.wholeTable !== true || r.unfiltered !== true ||
        r.complete !== true || r.nextCursor !== null || !Array.isArray(r.rows) ||
        !Number.isSafeInteger(r.totalRows) || r.totalRows !== r.rows.length ||
        !validProductionReportPayload({ ...s.body, [resource]: r.rows })) fail();
    if (j.status !== "completed" || j.fullRefresh !== true) fail();
    const captured = instant(s.capturedAt), started = instant(j.startedAt);
    const completed = instant(j.completedAt), readAt = instant(r.capturedAt);
    // A reviewed pre-job response and post-job table, separately for each resource.
    if (!(captured <= started && started <= completed && completed <= readAt && readAt <= asOf) ||
        asOf - captured > budget * 1000) fail();
    const expected = new Map(s.body[resource].map(row => [recordKey(row, resource), canonical(row)]));
    if (expected.size !== r.rows.length || r.rows.some(row =>
      expected.get(recordKey(row, resource)) !== canonical(row))) fail();
    return {
      resource, state: "offline_table_match" as const, rowCount: r.rows.length,
      staleRowCount: r.rows.filter(row => row.is_stale === true).length,
      sourceCapturedAt: s.capturedAt, jobCompletedAt: j.completedAt, readbackCapturedAt: r.capturedAt,
      jobAgeSeconds: (asOf - completed) / 1000, maxAgeSeconds: budget,
      sourceBodySha256: digest(s.body),
      tableSha256: digest([...r.rows].sort((a, z) => {
        const x = recordKey(a, resource), y = recordKey(z, resource);
        return x < y ? -1 : x > y ? 1 : 0;
      })),
    };
  });
  return {
    version: 1, state: "offline_tables_match" as const, asOf: input.asOf,
    bindingSha256: digest(b), inputSha256: digest(input), resources: results,
    hostedCalls: 0, sourceAuthenticityVerified: false, liveDeliveryVerified: false,
    metricAcceptance: false, atomicCrossResourceRefresh: false, currentGenerationCertified: false,
  };
}
