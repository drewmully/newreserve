/** Synthetic HTTP/import receipts only. No database or provider operations. */
import { afterEach, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { productionWorkbookRuntimeGet, workbookRuntimePath, workbookRuntimeSourceId,
  workbookRuntimeManifestHash } from "@/lib/analytics/productionWorkbookRuntime";
import { acceptWorkbookDestination, acceptWorkbookRuntimeDestination } from "@/lib/analytics/workbookDestinationAcceptance";
import { workbookResources, validProductionWorkbookPayload } from "@/lib/analytics/productionWorkbookDelivery";
type Row = Record<string, unknown>;
const oldSource = "01a0f3c6-8758-0000-378b-d15c40a96f3a";
const secret = "synthetic-workbook-separated-bearer-123456";
const legacy = "synthetic-observed-legacy-bearer-123456789";
const digest = (v: string) => createHash("sha256").update(v).digest("hex");
const scope = { report_scope: "selected_full_build", shop_id: "fixture-shop", publication_id: "full:fixture",
  definition_version: "fixture-v1", model_version: "fixture-v1", funnel_version: "fixture-v1",
  as_of_at: "2026-01-02T00:00:00.000Z", report_from_date: "2026-01-01", report_through_date: "2026-01-01",
  atomic_resource_refresh: false };
function payload() {
  const value: Record<string, Row[]> = { report_status: [] };
  for (const [name, spec] of Object.entries(workbookResources)) {
    const selected = name === "store_daily", metrics = [...spec.integers, ...spec.decimals];
    const readiness = Object.fromEntries(metrics.map(k => [k, selected ? k === "total_sales_usd" ? "ready" : "withheld" : "unavailable"]));
    value[name] = selected ? [{ shop_id: scope.shop_id, publication_id: scope.publication_id,
      definition_version: scope.definition_version, report_date: "2026-01-01", is_stale: false, readiness,
      ...Object.fromEntries(metrics.map(k => [k, k === "total_sales_usd" ? "12.000001" : null])) }] : [];
    value.report_status.push({ ...scope, resource_name: name, state: selected ? "selected" : "not_selected",
      row_count: selected ? "1" : null, is_stale: selected ? false : null, readiness });
  }
  return value;
}
function evidence() {
  const body = payload(), names = Object.keys(body);
  const tables = Object.fromEntries(names.map(n => [n, `fixture-table-${n}`]));
  const target = (resource: string) => ({ resource, sourceId: workbookRuntimeSourceId, projectId: "353503", tableId: tables[resource] });
  return { version: 1, asOf: "2026-01-02T00:10:00.000Z", binding: {
    approvalRef: "fixture:approval", operatorRef: "fixture:operator", exclusionReviewRef: "fixture:exclusions",
    origin: "https://www.mymully.com", sourceId: workbookRuntimeSourceId, projectId: "353503", tables,
    excludedSourceIds: [oldSource], excludedTableIds: ["fixture-old-table"], scopes: [{ ...scope }],
    maxAgeSeconds: Object.fromEntries(names.map(n => [n, 3600])),
  }, rounds: [{ source: { path: workbookRuntimePath, httpStatus: 200, capturedAt: "2026-01-02T00:01:00.000Z",
    evidenceRef: "fixture:http", complete: true, body },
  resources: Object.fromEntries(names.map(resource => [resource, {
    readback: { ...target(resource), capturedAt: "2026-01-02T00:03:00.000Z", evidenceRef: `fixture:read:${resource}`,
      importJobId: `fixture-job-${resource}`, independentlyExtracted: true, wholeTable: true, unfiltered: true,
      complete: true, nextCursor: null as string | null, totalRows: body[resource].length, rows: structuredClone(body[resource]) },
    job: { ...target(resource), evidenceRef: `fixture:job:${resource}`, jobId: `fixture-job-${resource}`,
      status: "completed", startedAt: "2026-01-02T00:01:30.000Z", completedAt: "2026-01-02T00:02:00.000Z", fullRefresh: true },
  }])),
  privacy: { evidenceRef: "fixture:privacy", checkedAt: "2026-01-02T00:04:00.000Z", publicationId: scope.publication_id,
    asOfAt: scope.as_of_at, complete: true, independentlyExtracted: true, pendingRemovalCount: 0,
    newerRemovalCount: 0, selectionInvalidated: false } }] };
}
function auth() {
  return { revision: "1", snapshot_hash: "a".repeat(64), token_sha256: digest(secret),
    project_ref: "xnfjdbpjuaezxjgargto", source_id: workbookRuntimeSourceId,
    audience: `posthog:353503:source:${workbookRuntimeSourceId}`, path: workbookRuntimePath,
    manifest_sha256: workbookRuntimeManifestHash, run_id: "fixture", publication_id: "full:fixture",
    result_hash: "fixture", shop: scope.shop_id, approval_ref: "fixture:approval",
    not_before: "2026-01-02T00:00:00.000000Z", expires_at: "2026-01-02T00:30:00.000000Z" };
}
const env = { LEAN_PRODUCTION_REPORTS_ENABLED: "true", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
  LEAN_PRODUCTION_REPORTS_SECRET: legacy, LEAN_ANALYTICS_PIPELINE_PROJECT_REF: "xnfjdbpjuaezxjgargto",
  LEAN_ANALYTICS_SUPABASE_URL: "https://xnfjdbpjuaezxjgargto.supabase.co", LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "fixture-key" };
const request = (token = secret) => new Request("https://www.mymully.com"+workbookRuntimePath,
  { headers: { authorization: "Bearer "+token } });
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
it("serves only the new fixed source/audience with the unchanged manifest and two RPCs", async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-02T00:10:00Z"));
  const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(Response.json(auth())).mockResolvedValueOnce(Response.json(payload()));
  const response = await productionWorkbookRuntimeGet(request(), env, fetcher);
  expect(response.status).toBe(200); expect(fetcher).toHaveBeenCalledTimes(2);
  expect(validProductionWorkbookPayload(await response.json())).toBe(true);
  expect(workbookRuntimeManifestHash).toBe("ede0c179ef4a9f1b28625691823cb8410ae54fdce2af341de915f4a0593df6f3");
});
it.each(["source", "audience", "manifest"])("refuses a mismatched %s before the report RPC", async field => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-01-02T00:10:00Z"));
  const a = auth();
  if (field === "source") a.source_id = oldSource;
  if (field === "audience") a.audience = `posthog:353503:source:${oldSource}`;
  if (field === "manifest") a.manifest_sha256 = "0".repeat(64);
  const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json(a));
  expect((await productionWorkbookRuntimeGet(request(), env, fetcher)).status).toBe(503);
  expect(fetcher).toHaveBeenCalledTimes(1);
});
it("retains legacy observed bearer separation without any RPC", async () => {
  const fetcher = vi.fn<typeof fetch>();
  expect((await productionWorkbookRuntimeGet(request(legacy), env, fetcher)).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
});
it("compares truthful fixed-path six-resource evidence without rewriting it or claiming acceptance", () => {
  const p = evidence(), before = JSON.stringify(p);
  expect(acceptWorkbookRuntimeDestination(p)).toMatchObject({ state: "offline_workbook_match",
    hostedCalls: 0, liveDeliveryVerified: false, sourceAuthenticityVerified: false, metricAcceptance: false });
  expect(JSON.stringify(p)).toBe(before);
  expect(acceptWorkbookDestination(p).state).toBe("not_accepted");
  p.rounds[0].source.path = "/api/analytics/reports/production";
  expect(acceptWorkbookRuntimeDestination(p).state).toBe("not_accepted");
  expect(acceptWorkbookDestination(p).state).toBe("offline_workbook_match");
});
it.each(["project", "source", "observed-path", "partial", "wrong-job", "privacy", "changed-row"])(
  "refuses %s destination evidence", kind => {
    const p = evidence();
    if (kind === "project") p.binding.projectId = "other";
    if (kind === "source") p.binding.sourceId = oldSource;
    if (kind === "observed-path") p.rounds[0].source.path = "/api/analytics/reports/observed-current";
    if (kind === "partial") p.rounds[0].resources.store_daily.readback.nextCursor = "another-page";
    if (kind === "wrong-job") p.rounds[0].resources.store_daily.readback.importJobId = "wrong-job";
    if (kind === "privacy") p.rounds[0].privacy.pendingRemovalCount = 1;
    if (kind === "changed-row") p.rounds[0].resources.store_daily.readback.rows[0].total_sales_usd = "99.000000";
    expect(acceptWorkbookRuntimeDestination(p).state).toBe("not_accepted");
  });
it("has an offline CLI with exclusive private output and duplicate-member rejection", () => {
  const dir = mkdtempSync(join(tmpdir(), "sample-workbook-test-"));
  try {
    const input = join(dir, "input.json"), output = join(dir, "result");
    writeFileSync(input, JSON.stringify(evidence()));
    const call = () => spawnSync(process.execPath, ["scripts/analytics/accept-workbook-runtime-reports.mjs", input, output], { encoding: "utf8" });
    const first = call(); expect(first.status, first.stderr).toBe(0);
    expect(JSON.parse(readFileSync(join(output, "workbook-runtime-destination-validation.json"), "utf8")).state).toBe("offline_workbook_match");
    expect(call().status).toBe(1);
    writeFileSync(input, '{"version":1,"version":1}');
    expect(call().status).toBe(1);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 120000);
it("limits SQL to two CHECKs and an exact disabled-expired source/revision transition", () => {
  const sql = readFileSync("sql/analytics/workbook_sample_source_binding.review.sql", "utf8");
  expect(sql.match(/drop constraint/g)).toHaveLength(2);
  expect(sql.match(/add constraint/g)).toHaveLength(2);
  expect(sql).toContain("mymully.workbook_source_transition");
  expect(sql).toContain("encode(sha256(convert_to(prior::text,'UTF8')),'hex')");
  expect(sql).toContain("after_row-array['source_id','audience','revision']");
  expect(sql).toContain("prior->'enabled' is distinct from 'false'::jsonb");
  expect(sql).toContain("pg_get_constraintdef(p.oid,false)=c.definition");
  expect(sql).not.toMatch(/\b(insert into|delete from|create function|commit;)\b/i);
  expect(sql).not.toMatch(/set\s+enabled\s*=/i);
  expect(sql).not.toMatch(/[a-f0-9]{64}/);
  expect(readFileSync("sql/analytics/observed_delivery_runtime.review.sql", "utf8"))
    .toContain("observed grant requires a distinct workbook-independent token digest");
});
