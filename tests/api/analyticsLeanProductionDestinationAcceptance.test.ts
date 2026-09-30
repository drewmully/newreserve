/** Synthetic saved evidence only. Never provider delivery or business-metric acceptance. */
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { mkdtempSync, readFileSync, writeFileSync, rmSync, statSync, mkdirSync, symlinkSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { acceptProductionDestination, type ProductionDestinationInput } from "@/lib/analytics/productionDestinationAcceptance";
import { productionReportPath, validProductionReportPayload } from "@/lib/analytics/productionReportDelivery";
import { acceptProductionReportsFile, parseEvidence } from "../../scripts/analytics/accept-production-reports.mjs";

const names = ["store_daily", "product_daily"] as const;
const storeMetrics = ["gross_merchandise_sales_usd", "discounts_usd", "refunds_usd", "net_merchandise_sales_usd",
  "shipping_net_usd", "tax_net_usd", "duty_net_usd", "other_sales_adjustments_usd", "total_sales_usd",
  "eligible_orders", "purchase_merchandise_net_usd", "aov_usd", "collected_cash_usd", "new_customers",
  "spend_usd", "ncac_usd", "mer"];
const productMetrics = ["units", "gross_merchandise_sales_usd", "discounts_usd", "refunds_usd", "net_merchandise_sales_usd"];
const withheld = ["collected_cash_usd", "new_customers", "spend_usd", "ncac_usd", "mer"];
function row(product = false, date = "2026-09-29"): Record<string, unknown> {
  const metrics = product ? productMetrics : storeMetrics;
  return {
    report_date: date, definition_version: "fixture-observed-v1", is_stale: false,
    report_scope: "webhook_observed_only", certified: false, complete_window: false,
    ...Object.fromEntries(metrics.map(k => [k, withheld.includes(k) ? null :
      k === "eligible_orders" ? "3" : k === "aov_usd" ? "0.666666" : "2.000000"])),
    readiness: Object.fromEntries(metrics.map(k => [k, withheld.includes(k) ? "withheld" : "observed_unverified"])),
    ...(product ? { sku_bucket: "fixture-private-sku" } : {}),
  };
}
function fixture(): ProductionDestinationInput {
  const b = {
    approvalRef: "fixture-private-approval", operatorRef: "fixture-private-operator",
    exclusionReviewRef: "fixture-private-exclusion-review", origin: "https://www.mymully.com",
    projectId: "fixture-private-project", sourceId: "fixture-private-new-source",
    tables: { store_daily: "fixture-private-store-table", product_daily: "fixture-private-product-table" },
    excludedSourceIds: ["fixture-private-sample-source", "fixture-private-trial-source"],
    excludedTableIds: ["fixture-private-sample-table", "fixture-private-trial-table"],
    maxAgeSeconds: { store_daily: 900, product_daily: 600 },
  };
  const observation = (resource: typeof names[number], later: boolean) => {
    const body = { store_daily: [row()], product_daily: [row(true)] };
    // Different saved source values and times are valid across resources.
    if (later) body.store_daily[0].total_sales_usd = "3.000000";
    const target = { projectId: b.projectId, sourceId: b.sourceId, tableId: b.tables[resource], resource };
    return {
      source: { path: productionReportPath, httpStatus: 200, complete: true,
        capturedAt: `2026-09-30T12:${later ? "05" : "00"}:00Z`, evidenceRef: `fixture-${resource}-source`, body },
      readback: { ...target, capturedAt: `2026-09-30T12:${later ? "08" : "03"}:00Z`,
        evidenceRef: `fixture-${resource}-readback`, independentlyExtracted: true,
        wholeTable: true, unfiltered: true, complete: true, nextCursor: null, totalRows: 1,
        rows: structuredClone(body[resource]) },
      job: { ...target, evidenceRef: `fixture-${resource}-job`, status: "completed",
        startedAt: `2026-09-30T12:${later ? "06" : "01"}:00Z`,
        completedAt: `2026-09-30T12:${later ? "07" : "02"}:00Z`, fullRefresh: true },
    };
  };
  return { version: 1, asOf: "2026-09-30T12:10:00Z", binding: b,
    resources: { store_daily: observation("store_daily", false), product_daily: observation("product_daily", true) } };
}
let scratch: string;
beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "production-destination-test-"));
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("network_forbidden"); }));
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  vi.unstubAllGlobals();
  rmSync(scratch, { recursive: true, force: true });
});

it("matches each full table with distinct capture times, preserving the canonical contract", () => {
  const input = fixture();
  expect(names.every(n => validProductionReportPayload(input.resources[n].source.body))).toBe(true);
  const result = acceptProductionDestination(input);
  expect(result).toMatchObject({ state: "offline_tables_match", hostedCalls: 0,
    metricAcceptance: false, liveDeliveryVerified: false, sourceAuthenticityVerified: false,
    atomicCrossResourceRefresh: false, currentGenerationCertified: false });
  expect(result.resources.map(r => [r.resource, r.jobAgeSeconds])).toEqual([["store_daily", 480], ["product_daily", 180]]);
  expect(JSON.stringify(result)).not.toContain("fixture-private");
  expect(acceptProductionDestination(input)).toEqual(result);
  const manifest = JSON.parse(readFileSync("docs/analytics/production-posthog-manifest.json", "utf8"));
  expect(manifest.client.base_url).toBe(input.binding.origin);
  expect(manifest.resources.map((r: { name: string; primary_key: string[]; endpoint: unknown }) =>
    [r.name, r.primary_key, r.endpoint])).toEqual(names.map(n => [n,
    ["report_date", "definition_version", ...(n === "product_daily" ? ["sku_bucket"] : [])],
    { path: productionReportPath, method: "GET", data_selector: n, paginator: { type: "single_page" } }]));
});

it("compares keys and every field, not row/object order or equal totals", () => {
  const input = fixture(), o = input.resources.product_daily;
  const second = { ...row(true), sku_bucket: "fixture-second-sku", units: "4.000000" };
  o.source.body.product_daily.push(second);
  o.readback.rows = structuredClone(o.source.body.product_daily).reverse().map(r => Object.fromEntries(Object.entries(r).reverse()));
  o.readback.totalRows = 2;
  expect(acceptProductionDestination(input).resources[1].rowCount).toBe(2);
  o.readback.rows[0].units = "3.000000";
  o.readback.rows[1].units = "3.000000";
  expect(() => acceptProductionDestination(input)).toThrow("production_destination_evidence_invalid");
});

it("accepts genuine supplied empty tables and matching stale/null rows without calling them current or numeric", () => {
  const empty = fixture();
  for (const n of names) {
    empty.resources[n].source.body = { store_daily: [], product_daily: [] };
    empty.resources[n].readback.rows = [];
    empty.resources[n].readback.totalRows = 0;
  }
  expect(acceptProductionDestination(empty).resources.map(r => r.rowCount)).toEqual([0, 0]);
  const stale = fixture(), o = stale.resources.store_daily;
  const r = o.source.body.store_daily[0];
  r.is_stale = true; r.aov_usd = null;
  (r.readiness as Record<string, unknown>).aov_usd = "withheld";
  o.readback.rows = structuredClone(o.source.body.store_daily);
  expect(acceptProductionDestination(stale).resources[0].staleRowCount).toBe(1);
});

it.each([
  ["numeric decimal", (r: Record<string, unknown>) => { r.total_sales_usd = 2; }],
  ["rounded decimal", (r: Record<string, unknown>) => { r.aov_usd = "0.666667"; }],
  ["lost precision", (r: Record<string, unknown>) => { r.total_sales_usd = "2.00"; }],
  ["numeric integer", (r: Record<string, unknown>) => { r.eligible_orders = 3; }],
  ["null to zero", (r: Record<string, unknown>) => { r.spend_usd = "0.000000"; }],
  ["null to string", (r: Record<string, unknown>) => { r.spend_usd = "null"; }],
  ["missing field", (r: Record<string, unknown>) => { delete r.aov_usd; }],
  ["extra raw field", (r: Record<string, unknown>) => { r.customer_id = "fixture-private-injected"; }],
  ["certification", (r: Record<string, unknown>) => { r.certified = true; }],
  ["window", (r: Record<string, unknown>) => { r.complete_window = true; }],
  ["scope", (r: Record<string, unknown>) => { r.report_scope = "whole_store"; }],
  ["readiness", (r: Record<string, unknown>) => { (r.readiness as Record<string, unknown>).aov_usd = "withheld"; }],
  ["stale state", (r: Record<string, unknown>) => { r.is_stale = true; }],
  ["date", (r: Record<string, unknown>) => { r.report_date = "2026-02-30"; }],
  ["mixed definition", (r: Record<string, unknown>) => { r.definition_version = "other-definition"; }],
] as const)("rejects destination %s", (_name, mutate) => {
  const input = fixture();
  mutate(input.resources.store_daily.readback.rows[0]);
  expect(() => acceptProductionDestination(input)).toThrow();
});

it.each(names)("rejects duplicate, omitted, additional and retained old rows for %s", n => {
  for (const change of ["duplicate", "omitted", "old", "additional"]) {
    const input = fixture(), o = input.resources[n];
    if (change === "duplicate") o.readback.rows.push(structuredClone(o.readback.rows[0]));
    if (change === "omitted") o.readback.rows = [];
    if (change === "old") o.readback.rows[0].report_date = "2026-09-28";
    if (change === "additional") o.readback.rows.push(row(n === "product_daily", "2026-09-28"));
    o.readback.totalRows = o.readback.rows.length;
    expect(() => acceptProductionDestination(input)).toThrow();
  }
});

it("detects correction/removal failures and accepts their exact reviewed replacements", () => {
  const input = fixture(), o = input.resources.product_daily;
  o.source.body.product_daily[0].refunds_usd = "-1.000000";
  expect(() => acceptProductionDestination(input)).toThrow();
  o.readback.rows = structuredClone(o.source.body.product_daily);
  expect(acceptProductionDestination(input).state).toBe("offline_tables_match");
  o.source.body.product_daily = [];
  expect(() => acceptProductionDestination(input)).toThrow();
  o.readback.rows = []; o.readback.totalRows = 0;
  expect(acceptProductionDestination(input).resources[1].rowCount).toBe(0);
});

it.each([
  ["wrong project", (i: ProductionDestinationInput) => { i.resources.store_daily.readback.projectId = "other"; }],
  ["wrong source", (i: ProductionDestinationInput) => { i.resources.store_daily.job.sourceId = "other"; }],
  ["mixed table", (i: ProductionDestinationInput) => { i.resources.store_daily.readback.tableId = i.binding.tables.product_daily; }],
  ["mixed resource", (i: ProductionDestinationInput) => { i.resources.store_daily.readback.resource = "product_daily"; }],
  ["excluded source", (i: ProductionDestinationInput) => { i.binding.excludedSourceIds.push(i.binding.sourceId); }],
  ["excluded table", (i: ProductionDestinationInput) => { i.binding.excludedTableIds.push(i.binding.tables.product_daily); }],
  ["no exclusion review", (i: ProductionDestinationInput) => { i.binding.exclusionReviewRef = ""; }],
  ["no excluded inventory", (i: ProductionDestinationInput) => { i.binding.excludedSourceIds = []; }],
  ["same tables", (i: ProductionDestinationInput) => { i.binding.tables.store_daily = i.binding.tables.product_daily; }],
  ["filtered read", (i: ProductionDestinationInput) => { i.resources.store_daily.readback.unfiltered = false; }],
  ["partial read", (i: ProductionDestinationInput) => { i.resources.store_daily.readback.complete = false; }],
  ["count mismatch", (i: ProductionDestinationInput) => { i.resources.store_daily.readback.totalRows = 2; }],
  ["same evidence", (i: ProductionDestinationInput) => { i.resources.store_daily.readback.evidenceRef = i.resources.store_daily.source.evidenceRef; }],
  ["not independent", (i: ProductionDestinationInput) => { i.resources.store_daily.readback.independentlyExtracted = false; }],
  ["partial source", (i: ProductionDestinationInput) => { i.resources.store_daily.source.complete = false; }],
  ["failed source", (i: ProductionDestinationInput) => { i.resources.store_daily.source.httpStatus = 503; }],
  ["failed job", (i: ProductionDestinationInput) => { i.resources.store_daily.job.status = "failed"; }],
  ["append job", (i: ProductionDestinationInput) => { i.resources.store_daily.job.fullRefresh = false; }],
  ["old store only", (i: ProductionDestinationInput) => { i.binding.maxAgeSeconds.store_daily = 599; }],
  ["old product only", (i: ProductionDestinationInput) => { i.binding.maxAgeSeconds.product_daily = 299; }],
  ["future job", (i: ProductionDestinationInput) => { i.resources.store_daily.job.completedAt = "2026-09-30T13:00:00Z"; }],
  ["pre-job read", (i: ProductionDestinationInput) => { i.resources.store_daily.readback.capturedAt = "2026-09-30T12:01:00Z"; }],
  ["invalid instant", (i: ProductionDestinationInput) => { i.asOf = "2026-02-30T12:00:00Z"; }],
  ["wrong path", (i: ProductionDestinationInput) => { i.resources.store_daily.source.path += "?date=2026-09-29"; }],
] as const)("fails closed for %s", (_name, mutate) => {
  const input = fixture(); mutate(input);
  expect(() => acceptProductionDestination(input)).toThrow();
});

it("rejects extra/missing envelope fields, pagination, corrupt source and oversized source", () => {
  const inputs = [fixture(), fixture(), fixture(), fixture(), fixture()];
  (inputs[0] as unknown as Record<string, unknown>).revision = "unsupported";
  delete (inputs[1].resources as Partial<ProductionDestinationInput["resources"]>).product_daily;
  (inputs[2].resources.store_daily.readback as unknown as Record<string, unknown>).nextCursor = "next";
  inputs[3].resources.product_daily.source.body.product_daily.push(row(true));
  inputs[4].resources.store_daily.source.body.store_daily = Array.from({ length: 367 }, () => row());
  for (const input of inputs) expect(() => acceptProductionDestination(input)).toThrow();
});

it("rejects duplicate JSON members including escaped names, truncation and non-JSON values", () => {
  expect(parseEvidence(JSON.stringify(fixture()))).toEqual(fixture());
  for (const raw of ['{"a":1,"a":2}', '{"a":{"x":1,"\\u0078":2}}', '{"a":[1,]}', '{"a":NaN}',
    '{"a":1} trailing', '{"a":', '{"a":01}', "[".repeat(34) + "0" + "]".repeat(34)]) {
    expect(() => parseEvidence(raw)).toThrow();
  }
});

it("writes only a new private receipt, preserves prior bytes and does not leak identifiers", () => {
  const input = join(scratch, "private.json"), output = join(scratch, "new-receipt");
  writeFileSync(input, JSON.stringify(fixture()));
  const summary = acceptProductionReportsFile(input, output);
  expect(summary).toMatchObject({ state: "offline_tables_match", metricAcceptance: false, hostedCalls: 0 });
  expect(JSON.stringify(summary)).not.toContain("fixture");
  const receipt = join(output, "destination-validation.json"), before = readFileSync(receipt, "utf8");
  expect(before).not.toContain("fixture-private");
  expect(statSync(output).mode & 0o777).toBe(0o700);
  expect(statSync(receipt).mode & 0o777).toBe(0o600);
  expect(() => acceptProductionReportsFile(input, output)).toThrow();
  expect(readFileSync(receipt, "utf8")).toBe(before);
  const alias = join(scratch, "alias"); symlinkSync(output, alias);
  expect(() => acceptProductionReportsFile(input, alias)).toThrow();
  expect(readFileSync(receipt, "utf8")).toBe(before);
  const empty = join(scratch, "existing-empty"); mkdirSync(empty);
  expect(() => acceptProductionReportsFile(input, empty)).toThrow();
  writeFileSync(input, '{"secret":"fixture-private","secret":"other"}');
  expect(() => acceptProductionReportsFile(input, join(scratch, "invalid"))).toThrow();
  expect(existsSync(join(scratch, "invalid"))).toBe(false);
  writeFileSync(input, Buffer.from([0x7b, 0x22, 0xff, 0x22, 0x3a, 0x31, 0x7d]));
  expect(() => acceptProductionReportsFile(input, join(scratch, "invalid-utf8"))).toThrow();
  expect(existsSync(join(scratch, "invalid-utf8"))).toBe(false);
}, 60000);

it("keeps corrupt-input CLI errors generic and creates no receipt", () => {
  const input = join(scratch, "fixture-private-input.json"), output = join(scratch, "new-output");
  writeFileSync(input, '{"fixture-private-id":');
  const result = spawnSync(process.execPath,
    ["scripts/analytics/accept-production-reports.mjs", input, output], { encoding: "utf8" });
  expect(result.status).toBe(1);
  expect(result.stdout).toBe("");
  expect(result.stderr).toBe("production_destination_acceptance_failed: check private evidence and a new output directory; no hosted action performed\n");
  expect(existsSync(output)).toBe(false);
});
