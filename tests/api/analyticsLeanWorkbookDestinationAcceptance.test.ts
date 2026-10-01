/** Synthetic contract packets only. No imports, provider reads or metric acceptance. */
import { expect, it } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, statSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { acceptWorkbookDestination, workbookDestinationResources as names } from "@/lib/analytics/workbookDestinationAcceptance";
import { validProductionWorkbookPayload, workbookResources } from "@/lib/analytics/productionWorkbookDelivery";

type Row = Record<string, unknown>;
const clone = <T>(v: T): T => structuredClone(v);
function scope(publication = "full:fixture") {
  return { report_scope: "selected_full_build", shop_id: "fixture-shop", publication_id: publication,
    definition_version: "fixture-definition", model_version: "fixture-model", funnel_version: "fixture-funnel",
    as_of_at: "2026-01-02T00:00:00.000Z", report_from_date: "2026-01-01", report_through_date: "2026-01-01",
    atomic_resource_refresh: false };
}
function body(s = scope()) {
  const result: Record<string, Row[]> = {};
  for (const [name, spec] of Object.entries(workbookResources)) {
    const metrics = [...spec.integers, ...spec.decimals];
    const row: Row = Object.fromEntries(Object.entries(spec.dimensions).map(([k, kind]) =>
      [k, kind === "boolean" ? false : kind === "date" ? "2026-01-01" : kind === "integer" ? "30" :
        kind === "instant" ? s.as_of_at : `fixture-${k}`]));
    Object.assign(row, { shop_id: s.shop_id, publication_id: s.publication_id, definition_version: s.definition_version });
    if (name === "acquisition_daily") row.model_version = s.model_version;
    if (name === "funnel_daily") { row.funnel_version = s.funnel_version; row.stage_id = "all_sessions"; }
    if (name === "customer_cohorts") row.mature = true;
    for (const metric of metrics) row[metric] = (spec.integers as readonly string[]).includes(metric) ? "2" : "12.000001";
    row.readiness = Object.fromEntries(metrics.map(k => [k, "ready"]));
    result[name] = [row];
  }
  result.report_status = Object.entries(workbookResources).map(([resource, spec]) => ({
    ...s, resource_name: resource, state: "selected", row_count: "1", is_stale: false,
    readiness: Object.fromEntries([...spec.integers, ...spec.decimals].map(k => [k, "ready"])),
  }));
  return result;
}
function packet() {
  const source = body(), s = scope();
  const tables = Object.fromEntries(names.map(n => [n, `private-table-${n}`]));
  const target = (resource: string) => ({ projectId: "private-project", sourceId: "private-source",
    tableId: tables[resource], resource });
  const resources = Object.fromEntries(names.map(resource => [resource, {
    readback: { ...target(resource), capturedAt: "2026-01-02T00:03:00.000Z", evidenceRef: `read-${resource}`,
      importJobId: `job-${resource}`, independentlyExtracted: true, wholeTable: true, unfiltered: true,
      complete: true, nextCursor: null as string | null, totalRows: source[resource].length, rows: clone(source[resource]) },
    job: { ...target(resource), evidenceRef: `job-proof-${resource}`, jobId: `job-${resource}`, status: "completed",
      startedAt: "2026-01-02T00:01:30.000Z", completedAt: "2026-01-02T00:02:00.000Z", fullRefresh: true },
  }]));
  return { version: 1, asOf: "2026-01-02T00:10:00.000Z", binding: {
    approvalRef: "private-approval", operatorRef: "private-operator", exclusionReviewRef: "private-exclusion",
    origin: "https://www.mymully.com", projectId: "private-project", sourceId: "private-source", tables,
    excludedSourceIds: ["retired-source"], excludedTableIds: ["retired-table"],
    maxAgeSeconds: Object.fromEntries(names.map(n => [n, 3600])), scopes: [s],
  }, rounds: [{ source: { path: "/api/analytics/reports/production", httpStatus: 200,
    capturedAt: "2026-01-02T00:01:00.000Z", evidenceRef: "private-source-capture", complete: true, body: source },
  resources, privacy: { evidenceRef: "private-privacy", checkedAt: "2026-01-02T00:04:00.000Z",
    publicationId: s.publication_id, asOfAt: s.as_of_at, complete: true, independentlyExtracted: true,
    pendingRemovalCount: 0, newerRemovalCount: 0, selectionInvalidated: false } }] };
}
type Packet = ReturnType<typeof packet>;
function replace(p: Packet, next: Record<string, Row[]>) {
  p.rounds[0].source.body = clone(next);
  for (const resource of names) {
    const o = p.rounds[0].resources[resource];
    o.readback.rows = clone(next[resource]); o.readback.totalRows = next[resource].length;
  }
}
function repeat(p: Packet, correction = false) {
  const next = clone(p.rounds[0]);
  next.source.capturedAt = "2026-01-02T00:05:00.000Z"; next.source.evidenceRef += "-2";
  for (const o of Object.values(next.resources)) {
    o.job.startedAt = "2026-01-02T00:06:00.000Z"; o.job.completedAt = "2026-01-02T00:07:00.000Z";
    o.job.evidenceRef += "-2"; o.job.jobId += "-2";
    o.readback.capturedAt = "2026-01-02T00:08:00.000Z"; o.readback.evidenceRef += "-2"; o.readback.importJobId += "-2";
  }
  next.privacy.checkedAt = "2026-01-02T00:09:00.000Z"; next.privacy.evidenceRef += "-2";
  const s = correction ? scope("full:correction") : scope();
  if (correction) {
    const corrected = body(s);
    corrected.store_daily[0].total_sales_usd = "19.123456";
    next.source.body = clone(corrected);
    for (const resource of names) {
      next.resources[resource].readback.rows = clone(corrected[resource]);
    }
    next.privacy.publicationId = s.publication_id;
  }
  p.binding.scopes.push(s); p.rounds.push(next);
}
it("compares all six exact contracts without claiming live or source-metric acceptance", () => {
  const p = packet();
  expect(validProductionWorkbookPayload(p.rounds[0].source.body)).toBe(true);
  const result = acceptWorkbookDestination(p);
  expect(result).toMatchObject({ state: "offline_workbook_match", metricAcceptance: false,
    sourceAuthenticityVerified: false, sourceMetricAcceptance: "not_evaluated", currentGenerationCertified: false,
    atomicCrossResourceRefresh: false, hostedCalls: 0 });
  expect(JSON.stringify(result)).not.toContain("private-");
});
it("retains selected-empty versus unselected availability and genuine metric nulls", () => {
  const p = packet(), b = body();
  b.product_daily = []; b.acquisition_daily = [];
  Object.assign(b.report_status[1], { row_count: "0",
    readiness: Object.fromEntries(Object.keys(b.report_status[1].readiness as Row).map(k => [k, "no_rows"])) });
  Object.assign(b.report_status[2], { state: "not_selected", row_count: null, is_stale: null,
    readiness: Object.fromEntries(Object.keys(b.report_status[2].readiness as Row).map(k => [k, "unavailable"])) });
  b.store_daily[0].collected_cash_usd = null;
  (b.store_daily[0].readiness as Row).collected_cash_usd = "withheld";
  (b.report_status[0].readiness as Row).collected_cash_usd = "withheld";
  replace(p, b);
  const result = acceptWorkbookDestination(p);
  expect(result.state).toBe("offline_workbook_match");
  if ("rounds" in result) expect(result.rounds[0].resources.map(r => r.availability))
    .toEqual(["selected", "selected", "not_selected", "selected", "selected", "operational_metadata"]);
});
const mutations: [string, (p: Packet) => void][] = [
  ["missing resource", p => { delete (p.rounds[0].resources as Record<string, unknown>).product_daily; }],
  ["metadata-only import", p => { p.rounds[0].resources.store_daily.job.status = "running"; }],
  ["stale job", p => { p.binding.maxAgeSeconds.store_daily = 1; }],
  ["partial pagination", p => { p.rounds[0].resources.store_daily.readback.nextCursor = "more"; }],
  ["partial row count", p => { p.rounds[0].resources.store_daily.readback.totalRows = 2; }],
  ["filtered extraction", p => { p.rounds[0].resources.store_daily.readback.unfiltered = false; }],
  ["wrong import job", p => { p.rounds[0].resources.store_daily.readback.importJobId = "another"; }],
  ["mixed publication", p => { p.rounds[0].resources.store_daily.readback.rows[0].publication_id = "full:other"; }],
  ["rounded decimal", p => { p.rounds[0].resources.store_daily.readback.rows[0].total_sales_usd = "12.000000"; }],
  ["number coercion", p => { p.rounds[0].resources.store_daily.readback.rows[0].total_sales_usd = 12.000001; }],
  ["null to zero", p => { p.rounds[0].resources.store_daily.readback.rows[0].total_sales_usd = null; }],
  ["mixed model", p => { p.rounds[0].resources.acquisition_daily.readback.rows[0].model_version = "other"; }],
  ["mixed cutoff", p => { p.rounds[0].resources.customer_cohorts.readback.rows[0].as_of_at = "2026-01-01T00:00:00Z"; }],
  ["stale table", p => { p.rounds[0].resources.store_daily.readback.rows[0].is_stale = true; }],
  ["duplicate keys", p => { const r = p.rounds[0].resources.product_daily.readback; r.rows.push(clone(r.rows[0])); r.totalRows++; }],
  ["unselected mislabeled empty", p => { p.rounds[0].resources.report_status.readback.rows[1].state = "not_selected"; }],
  ["excluded source", p => { p.binding.excludedSourceIds.push(p.binding.sourceId); }],
  ["excluded table", p => { p.binding.excludedTableIds.push(p.binding.tables.product_daily); }],
  ["target table collision", p => { p.binding.tables.product_daily = p.binding.tables.store_daily; }],
  ["missing exclusion review", p => { p.binding.exclusionReviewRef = ""; }],
  ["missing exclusion array", p => { delete (p.binding as Record<string, unknown>).excludedSourceIds; }],
  ["duplicate job proof", p => { p.rounds[0].resources.product_daily.job.evidenceRef = p.rounds[0].resources.store_daily.job.evidenceRef; }],
  ["duplicate readback proof", p => { p.rounds[0].resources.product_daily.readback.evidenceRef = p.rounds[0].resources.store_daily.readback.evidenceRef; }],
  ["job precedes shared capture", p => { p.rounds[0].resources.product_daily.job.startedAt = "2026-01-02T00:00:30.000Z"; }],
  ["privacy removal", p => { p.rounds[0].privacy.pendingRemovalCount = 1; }],
  ["invalidated selection", p => { p.rounds[0].privacy.selectionInvalidated = true; }],
  ["old privacy capture", p => { p.rounds[0].privacy.checkedAt = "2026-01-02T00:02:00.000Z"; }],
  ["missing source proof", p => { p.rounds[0].source.evidenceRef = ""; }],
  ["missing job proof", p => { p.rounds[0].resources.store_daily.job.evidenceRef = ""; }],
  ["future capture", p => { p.rounds[0].resources.store_daily.readback.capturedAt = "2026-01-02T00:11:00.000Z"; }],
];
it.each(mutations)("fails closed for %s", (_, mutate) => {
  const p = packet(); mutate(p); expect(acceptWorkbookDestination(p).state).toBe("not_accepted");
});
it("rejects stale source even when the readback matches it", () => {
  const p = packet(), b = body(); b.store_daily[0].is_stale = true; b.report_status[0].is_stale = true; replace(p, b);
  expect(acceptWorkbookDestination(p).state).toBe("not_accepted");
});
it("compares reordered rows and separately timed resource jobs without an atomicity claim", () => {
  const p = packet(), o = p.rounds[0].resources.report_status;
  o.job.completedAt = "2026-01-02T00:02:10.000Z";
  o.readback.rows.reverse(); p.rounds[0].source.body.report_status.reverse();
  expect(acceptWorkbookDestination(p)).toMatchObject({ state: "offline_workbook_match", atomicCrossResourceRefresh: false });
});
it("accepts separately proved repeated refresh and corrected publication, never joint-current", () => {
  for (const correction of [false, true]) {
    const p = packet(); repeat(p, correction);
    expect(acceptWorkbookDestination(p)).toMatchObject({ state: "offline_workbook_match", currentGenerationCertified: false });
  }
});
it("rejects metadata-only correction or reusing an old import's job", () => {
  const p = packet(); repeat(p, true);
  p.rounds[1].resources.store_daily.readback = clone(p.rounds[0].resources.store_daily.readback);
  expect(acceptWorkbookDestination(p).state).toBe("not_accepted");
});
it("rejects changing immutable publication content between repeated refreshes", () => {
  const p = packet(); repeat(p);
  p.rounds[1].source.body.store_daily[0].total_sales_usd = "19.000000";
  p.rounds[1].resources.store_daily.readback.rows[0].total_sales_usd = "19.000000";
  expect(acceptWorkbookDestination(p).state).toBe("not_accepted");
});
it("returns explicit not accepted without a packet", () => {
  expect(acceptWorkbookDestination({})).toMatchObject({ state: "not_accepted", metricAcceptance: false });
});
it("allows explicitly reviewed empty exclusion inventories and one shared source snapshot", () => {
  const p = packet(); p.binding.excludedSourceIds = []; p.binding.excludedTableIds = [];
  expect(acceptWorkbookDestination(p).state).toBe("offline_workbook_match");
  expect(Object.values(p.rounds[0].resources).every(o => !("source" in o))).toBe(true);
});
it("fits a large canonical snapshot and all six readbacks without six duplicate bodies", () => {
  const p = packet(), b = body();
  b.product_daily = Array.from({ length: 3400 }, (_, i) => ({
    ...b.product_daily[0], sku_bucket: `${i}-${"x".repeat(450)}`,
  }));
  b.report_status[1].row_count = String(b.product_daily.length);
  replace(p, b);
  expect(Buffer.byteLength(JSON.stringify(b))).toBeGreaterThan(2500000);
  expect(Buffer.byteLength(JSON.stringify(b))).toBeLessThan(4194304);
  expect(Buffer.byteLength(JSON.stringify(p))).toBeLessThan(16000000);
  expect(acceptWorkbookDestination(p).state).toBe("offline_workbook_match");
});
it("retains the aggregate input budget without silently comparing only one round", () => {
  const p = packet(); repeat(p);
  const oversized = { ...p, binding: { ...p.binding, operatorRef: "x".repeat(16000000) } };
  expect(acceptWorkbookDestination(oversized).state).toBe("not_accepted");
});
it("writes only a new private receipt, reuses duplicate-key parser, and never overwrites evidence", () => {
  const dir = mkdtempSync(join(tmpdir(), "workbook-check-test-"));
  const input = join(dir, "packet.json"), output = join(dir, "receipt");
  const run = () => spawnSync(process.execPath, ["scripts/analytics/accept-workbook-reports.mjs", input, output], { encoding: "utf8" });
  try {
    writeFileSync(input, JSON.stringify(packet()));
    expect(run().status).toBe(0);
    const receipt = join(output, "workbook-destination-validation.json"), saved = readFileSync(receipt, "utf8");
    expect(statSync(output).mode & 0o777).toBe(0o700);
    expect(statSync(receipt).mode & 0o777).toBe(0o600);
    expect(saved).not.toContain("private-");
    expect(run().status).toBe(1); expect(readFileSync(receipt, "utf8")).toBe(saved);
    writeFileSync(input, '{"version":1,"version":1}');
    expect(run().status).toBe(1); expect(readFileSync(receipt, "utf8")).toBe(saved);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
