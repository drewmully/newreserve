import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { googleAutomaticColumns, googleAtomicTableQuery, observeGoogleAutomatic } from "@/lib/analytics/googleAutomaticObserver";
import { prepareGoogleDeliveryReport } from "@/lib/analytics/googleDeliveryReport";
import { googleDeliveryFixture } from "../fixtures/analyticsGoogleDelivery";

function fixture() {
  const report = prepareGoogleDeliveryReport(googleDeliveryFixture().input);
  const row = { ...report, is_stale: false, readiness: Object.fromEntries(Object.entries(report.readiness)
    .map(([key, value]) => [key, value === "observed_unverified" ? "ready" : value])) };
  const at = (offset: number) => new Date(Date.now() + offset).toISOString();
  const sourceId = "11111111-1111-4111-8111-111111111111", schemaId = "22222222-2222-4222-8222-222222222222";
  const tableId = "33333333-3333-4333-8333-333333333333", manifest = '{"resources":["fixture"]}';
  const destination = { projectId: "353503" as const, sourceId, schemaId, tableId,
    tableName: "fixture_google_account_daily", manifestSha256: createHash("sha256").update(manifest).digest("hex"),
    contractSha256: "a".repeat(64), maxAgeSeconds: 60 };
  const claim = { state: "observe", selectionRevision: "1", deadline: at(60000), destination,
    body: { google_account_daily: [row], google_delivery_status: { state: "selected", report_scope: "single_google_account",
      run_id: "google-fixture", result_hash: "b".repeat(32), row_hash: "c".repeat(32), selection_revision: "1",
      row_count: "1", atomic_resource_refresh: false, not_before: at(-5000), expires_at: at(60000) } } };
  const source = { id: sourceId, source_type: "Custom", job_inputs: { manifest_json: manifest },
    schemas: [{ id: schemaId, name: "google_account_daily", status: "Completed", should_sync: true,
      sync_type: "full_refresh", last_synced_at: at(-1000), table: { id: tableId, name: destination.tableName } }] };
  const jobs = [{ id: "fixture_job", status: "Completed", created_at: at(-4000), finished_at: at(-1000),
    schema: { id: schemaId, name: "google_account_daily", should_sync: true, sync_type: "full_refresh" } }];
  const tuple: unknown[] = googleAutomaticColumns.map(name => row[name]);
  const result = () => ({ query: { kind: "HogQLQuery", query: googleAtomicTableQuery(destination) },
    results: `total_rows|row_json\n1|${JSON.stringify(tuple)}` });
  const transport = { source: async () => source, jobs: async () => jobs, query: async () => result() };
  return { row, tuple, result, claim, transport };
}

describe("native HogQL readiness JSON-string compatibility only", () => {
  it("decodes the real nineteen-column shape once and preserves object-path hash and raw receipt", async () => {
    const f = fixture();
    const objectEvidence = await observeGoogleAutomatic(f.claim, f.transport);
    // Actual provider shape: JSON column is itself a JSON string inside tuple JSON.
    f.tuple[18] = JSON.stringify(Object.fromEntries(Object.entries(f.row.readiness).reverse()));
    const before = JSON.stringify(f.result());
    const decoded = await observeGoogleAutomatic(f.claim, f.transport);
    expect(decoded.import.rows).toEqual([f.row]);
    expect(decoded.tableSha256).toBe(objectEvidence.tableSha256);
    expect(JSON.stringify(f.result())).toBe(before);
    expect(typeof f.tuple[18]).toBe("string");
  });

  it("rejects malformed, nonobject and double-encoded readiness", async () => {
    for (const value of ['{"spend_usd":', "null", "[]", "true", "42", '"ready"', JSON.stringify(JSON.stringify({ spend_usd: "ready" }))]) {
      const f = fixture(); f.tuple[18] = value;
      await expect(observeGoogleAutomatic(f.claim, f.transport)).rejects.toThrow();
    }
  });

  it("rejects duplicate members even when JSON.parse would produce the expected object", async () => {
    for (const key of ['"spend_usd"', '"spend_\\u0075sd"']) {
      const f = fixture(), normal = JSON.stringify(f.row.readiness);
      f.tuple[18] = normal.slice(0, -1) + `,${key}:"ready"}`;
      expect(JSON.parse(String(f.tuple[18]))).toEqual(f.row.readiness);
      await expect(observeGoogleAutomatic(f.claim, f.transport)).rejects.toThrow();
    }
  });

  it("unchanged exact comparison rejects extra, missing and changed readiness fields", async () => {
    for (const change of ["extra", "missing", "changed"]) {
      const f = fixture(), readiness = { ...f.row.readiness };
      if (change === "extra") readiness.extra = "ready";
      if (change === "missing") delete readiness.ctr;
      if (change === "changed") readiness.ctr = "withheld";
      f.tuple[18] = JSON.stringify(readiness);
      await expect(observeGoogleAutomatic(f.claim, f.transport)).rejects.toThrow("value_mismatch");
    }
  });

  it("does not decode or coerce money, counts or other tuple fields", async () => {
    for (const column of ["spend_usd", "clicks", "publication_id"] as const) {
      const f = fixture(); f.tuple[18] = JSON.stringify(f.row.readiness);
      const index = googleAutomaticColumns.indexOf(column);
      f.tuple[index] = column === "publication_id" ? "other_publication" : Number(f.tuple[index]);
      await expect(observeGoogleAutomatic(f.claim, f.transport)).rejects.toThrow("value_mismatch");
    }
  });

  it("retains the complete-envelope and sixteen-KiB tuple boundaries", async () => {
    const f = fixture(); f.tuple[18] = JSON.stringify(f.row.readiness);
    await expect(observeGoogleAutomatic(f.claim, { ...f.transport,
      query: async () => ({ ...f.result(), structured_content_metadata: { truncated: true } }) })).rejects.toThrow();
    f.tuple[18] = " ".repeat(16384) + JSON.stringify(f.row.readiness);
    await expect(observeGoogleAutomatic(f.claim, f.transport)).rejects.toThrow("table_incomplete");
  });
});
