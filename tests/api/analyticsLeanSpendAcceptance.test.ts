import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, afterEach, expect, it, vi } from "vitest";
import { acceptGoogleSpend, type GoogleSpendAcceptanceInput } from "@/lib/analytics/googleSpendAcceptance";
import { prepareFreshGoogleSpend } from "@/lib/analytics/googleSpendRegistration";
import { fullFixture } from "../fixtures/analyticsFull";
import { acceptGoogleSpendFile } from "../../scripts/analytics/accept-google-spend.mjs";

// Fixed synthetic January packet. Expected controls are fixture source values,
// not a function of candidate totals. These are not authorized customer inputs.
function packet(): GoogleSpendAcceptanceInput {
  const f = fullFixture();
  f.base.marketing_spend_daily = [];
  const prepared = prepareFreshGoogleSpend({
    version: 1, projectRef: "a".repeat(20), accountId: "1234567890", loginCustomerId: null,
    approvalRef: "fixture:spend-approval", actorRef: "fixture:actor", revisionRef: "fixture:revision",
    credentialBindingRef: "fixture:binding", coverage: "whole_account_campaign_day",
    sourceCurrency: "USD", sourceTimezone: "America/New_York",
    preparedAt: "2026-01-02T09:00:00Z", freshnessCutoffAt: "2026-01-02T10:00:00Z",
    expiresAt: "2026-01-03T12:00:00Z", maxPages: 1, maxRequestsPerDay: 3, deadlineSeconds: 10,
    days: [{ date: "2026-01-01", dueAt: "2026-01-02T10:00:00Z" }],
  });
  const runId = prepared.registration.args.p_scope.days[0].runId;
  return {
    version: 1, manifest: prepared.manifest, shop: f.shop, publication: "base",
    asOf: "2026-01-02T12:00:00Z",
    bases: [{ provider: "google_ads", accountId: "1234567890", date: "2026-01-01", baseReportId: runId,
      sourceTimezone: "America/New_York", sourceCurrency: "USD", completedAt: "2026-01-02T11:00:00Z",
      paginationComplete: true, verifiedEmpty: false, evidenceRef: `lean_private.spend_jobs/${runId}`,
      rows: [{ campaignId: "7", costMicros: "5000000" }] }],
    controls: [{ provider: "google_ads", accountId: "1234567890", date: "2026-01-01",
      sourceCurrency: "USD", sourceTimezone: "America/New_York", capturedAt: "2026-01-02T11:30:00Z",
      independentlyExtracted: true, complete: true, verifiedEmpty: false,
      evidenceRef: "fixture:independent-account-day-control", totalCostMicros: "5000000",
      campaigns: [{ id: "7", costMicros: "5000000" }] }],
    sales: {
      facts: f.base, proofs: f.evidence.proofs.filter(p => ["orders", "order_items", "sales_ledger"].includes(p.table)),
      coverage: { kind: "whole_store_eligible_ledger", shop: f.shop, dates: ["2026-01-01"],
        sourceCurrency: "USD", sourceTimezone: "America/New_York", capturedAt: "2026-01-02T11:30:00Z",
        completeThrough: "2026-01-02T05:00:00Z", complete: true, independentlyExtracted: true,
        evidenceRef: "fixture:independent-sales-coverage", approvalRef: "fixture:sales-approval" },
      marketingInventory: { shop: f.shop, dates: ["2026-01-01"],
        accounts: [{ provider: "google_ads", accountId: "1234567890" }], complete: true,
        independentlyExtracted: true, evidenceRef: "fixture:full-marketing-inventory", approvalRef: "fixture:compatibility-approval" },
    },
  };
}
const row = (p: GoogleSpendAcceptanceInput) => acceptGoogleSpend(p).reports.store_daily[0];
beforeEach(() => {
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("external_network_forbidden"); }));
});
afterEach(() => { vi.unstubAllGlobals(); });

it("reuses reconciled ledger-net sales and exact spend in the existing MER formula, without acceptance/publication", () => {
  const p = packet(), original = structuredClone(p), result = acceptGoogleSpend(p);
  expect(result).toMatchObject({ state: "offline_controls_match", certified: false,
    numericAcceptance: false, sourceAuthorityVerified: false, enabled: false, registered: false,
    hostedCalls: 0, exportReady: false, published: false });
  expect(result.reports.store_daily[0]).toMatchObject({
    net_merchandise_sales_usd: "20.000000", spend_usd: "5.000000", mer: "4.000000",
    collected_cash_usd: null, ncac_usd: null, new_customers: null, eligible_orders: null,
    readiness: { spend_usd: "observed_unverified", mer: "observed_unverified" },
  });
  expect(result.checks[0]).toMatchObject({ spendIssues: [], merIssues: [] });
  expect(p).toEqual(original);
  const serialized = JSON.stringify(result);
  for (const privateValue of [p.bases[0].accountId, p.bases[0].baseReportId, p.controls[0].evidenceRef,
    p.sales!.facts.orders[0].order_id, p.shop])
    expect(serialized).not.toContain(privateValue);
  expect(fetch).not.toHaveBeenCalled();
});

it("does not add original-purchase snapshots to ledger net sales", () => {
  const p = packet();
  p.sales!.facts.orders[0].purchase_merchandise_net_usd = "100.000000";
  expect(row(p).mer).toBe("4.000000");
});

it("supports independent spend while missing or selected-product sales keep MER unavailable", () => {
  for (const kind of ["selected_product", "webhook_observed_only"]) {
    const p = packet(); p.sales!.coverage.kind = kind;
    expect(row(p)).toMatchObject({ spend_usd: "5.000000", net_merchandise_sales_usd: null, mer: null });
  }
  const p = packet(); p.sales = null;
  expect(row(p)).toMatchObject({ spend_usd: "5.000000", mer: null });
});

it("withholds MER for incomplete dates, wrong clocks/currency, unknown extra accounts or providers", () => {
  const variants = [
    (p: GoogleSpendAcceptanceInput) => { p.sales!.coverage.complete = false; },
    (p: GoogleSpendAcceptanceInput) => { p.sales!.coverage.dates = ["2026-01-02"]; },
    (p: GoogleSpendAcceptanceInput) => { p.sales!.coverage.sourceCurrency = "EUR"; },
    (p: GoogleSpendAcceptanceInput) => { p.sales!.coverage.sourceTimezone = "UTC"; },
    (p: GoogleSpendAcceptanceInput) => { p.sales!.coverage.completeThrough = "2026-01-02T04:59:59Z"; },
    (p: GoogleSpendAcceptanceInput) => { p.sales!.coverage.capturedAt = "2026-01-02T09:59:59Z"; },
    (p: GoogleSpendAcceptanceInput) => { p.sales!.marketingInventory.complete = false; },
    (p: GoogleSpendAcceptanceInput) => { p.sales!.marketingInventory.accounts.push({ provider: "meta", accountId: "unknown" }); },
    (p: GoogleSpendAcceptanceInput) => { p.sales!.marketingInventory.accounts[0].accountId = "9876543210"; },
    (p: GoogleSpendAcceptanceInput) => { p.sales!.coverage.approvalRef = ""; },
  ];
  for (const change of variants) {
    const p = packet(); change(p);
    expect(row(p)).toMatchObject({ spend_usd: "5.000000", mer: null });
  }
});

it("requires independent sales keys and amount_usd reconciliation, not an all-gates declaration", () => {
  for (const change of [
    (p: GoogleSpendAcceptanceInput) => { p.sales!.proofs = []; },
    (p: GoogleSpendAcceptanceInput) => { p.sales!.proofs[0].independentlyExtracted = false; },
    (p: GoogleSpendAcceptanceInput) => { p.sales!.proofs[2].amountChecks = [{ field: "source_amount", expectedTotal: "20" }]; },
    (p: GoogleSpendAcceptanceInput) => { p.sales!.proofs[2].amountChecks[0].expectedTotal = "21"; },
    (p: GoogleSpendAcceptanceInput) => { p.sales!.facts.sales_ledger[0].amount_usd = "21.000000"; },
  ]) {
    const p = packet(); change(p);
    expect(row(p)).toMatchObject({ spend_usd: "5.000000", mer: null });
  }
});

it("distinguishes a complete zero day from missing and unverified empty evidence", () => {
  const p = packet();
  p.bases[0].rows = []; p.bases[0].verifiedEmpty = true;
  p.controls[0].campaigns = []; p.controls[0].verifiedEmpty = true; p.controls[0].totalCostMicros = "0";
  expect(row(p)).toMatchObject({ spend_usd: "0.000000", mer: null });
  expect(acceptGoogleSpend(p).checks[0].merIssues).toContain("zero_spend_denominator");
  p.controls = [];
  expect(row(p).spend_usd).toBeNull();
  p.bases = [];
  expect(acceptGoogleSpend(p).checks[0].sourceState).toBe("missing");
  expect(row(p).spend_usd).toBeNull();
});

it("withholds stale, partial or unsupported spend without fabricating missing amounts", () => {
  for (const change of [
    (p: GoogleSpendAcceptanceInput) => { p.bases[0].completedAt = "2026-01-02T09:59:59Z"; },
    (p: GoogleSpendAcceptanceInput) => { p.bases[0].paginationComplete = false; },
    (p: GoogleSpendAcceptanceInput) => { p.asOf = "2026-01-03T12:00:00Z"; },
    (p: GoogleSpendAcceptanceInput) => { p.controls[0].capturedAt = "2026-01-02T09:59:59Z"; },
    (p: GoogleSpendAcceptanceInput) => { p.controls[0].capturedAt = "2026-01-02T12:00:01Z"; },
    (p: GoogleSpendAcceptanceInput) => { p.controls[0].independentlyExtracted = false; },
    (p: GoogleSpendAcceptanceInput) => { p.controls[0].evidenceRef = p.bases[0].evidenceRef; },
    (p: GoogleSpendAcceptanceInput) => { p.controls[0].sourceTimezone = "UTC"; },
  ]) {
    const p = packet(); change(p);
    expect(row(p)).toMatchObject({ spend_usd: null, mer: null });
    expect(acceptGoogleSpend(p).state).toBe("offline_withheld");
  }
});

it("compares independent campaign keys and amounts, including swaps with unchanged account total", () => {
  const p = packet();
  p.bases[0].rows.push({ campaignId: "8", costMicros: "2000000" });
  p.controls[0].campaigns.push({ id: "8", costMicros: "2000000" });
  p.controls[0].totalCostMicros = "7000000";
  expect(row(p).spend_usd).toBe("7.000000");
  p.controls[0].campaigns = [{ id: "7", costMicros: "2000000" }, { id: "8", costMicros: "5000000" }];
  expect(row(p).spend_usd).toBeNull();
  p.controls[0].campaigns[0].id = "9";
  expect(row(p).spend_usd).toBeNull();
});

it("rejects unexpected or duplicate controls and conflicting immutable bases; identical bases count once", () => {
  const p = packet();
  p.bases.push(structuredClone(p.bases[0]));
  expect(row(p).spend_usd).toBe("5.000000");
  p.bases[1].rows[0].costMicros = "1";
  expect(() => row(p)).toThrow("conflicting");
  const q = packet(); q.controls.push(structuredClone(q.controls[0]));
  expect(() => row(q)).toThrow("control_scope");
  q.controls = [{ ...q.controls[0], date: "2026-01-02" }];
  expect(() => row(q)).toThrow("control_scope");
});

it("keeps MER's existing six-place truncation and null-denominator behavior", () => {
  const p = packet();
  p.bases[0].rows[0].costMicros = "30000000";
  p.controls[0].campaigns[0].costMicros = "30000000"; p.controls[0].totalCostMicros = "30000000";
  expect(row(p).mer).toBe("0.666666");
});

it("does not reuse a matched day as another date's complete-zero evidence", () => {
  const p = packet(), m = prepareFreshGoogleSpend(p.manifest).manifest;
  m.days.push({ date: "2026-01-02", dueAt: "2026-01-03T10:00:00.000Z" });
  const prepared = prepareFreshGoogleSpend(m);
  p.manifest = prepared.manifest; p.asOf = "2026-01-03T11:00:00Z"; p.sales = null;
  p.bases[0].baseReportId = prepared.registration.args.p_scope.days[0].runId;
  p.bases[0].evidenceRef = `lean_private.spend_jobs/${p.bases[0].baseReportId}`;
  const result = acceptGoogleSpend(p);
  expect(result.reports.store_daily.map(r => r.spend_usd)).toEqual(["5.000000", null]);
  expect(result.checks[1]).toMatchObject({ date: "2026-01-02", sourceState: "missing" });
});

it("does not convert otherwise reconciled EUR evidence into USD, and rejects sub-millisecond cutoffs", () => {
  const p = packet(), m = prepareFreshGoogleSpend(p.manifest).manifest;
  m.sourceCurrency = "EUR";
  const prepared = prepareFreshGoogleSpend(m);
  p.manifest = prepared.manifest;
  p.bases[0].sourceCurrency = "EUR"; p.controls[0].sourceCurrency = "EUR";
  p.bases[0].baseReportId = prepared.registration.args.p_scope.days[0].runId;
  p.bases[0].evidenceRef = `lean_private.spend_jobs/${p.bases[0].baseReportId}`;
  expect(row(p)).toMatchObject({ spend_usd: null, mer: null });
  p.controls[0].capturedAt = "2026-01-02T12:00:00.000001Z";
  expect(() => row(p)).toThrow("timestamp_precision");
});

it("runs the offline CLI with no overwrite and an aggregate-only private result", () => {
  const dir = mkdtempSync(join(tmpdir(), "spend-acceptance-fixture-"));
  try {
    const input = join(dir, "input.json"), output = join(dir, "result");
    writeFileSync(input, JSON.stringify(packet()));
    expect(acceptGoogleSpendFile(input, output)).toEqual({
      state: "offline_controls_match", numericAcceptance: false, hostedCalls: 0, exportReady: false });
    const result = JSON.parse(readFileSync(join(output, "spend-validation.json"), "utf8"));
    expect(result.reports.store_daily[0].mer).toBe("4.000000");
    expect(statSync(output).mode & 0o777).toBe(0o700);
    expect(statSync(join(output, "spend-validation.json")).mode & 0o777).toBe(0o600);
    expect(() => acceptGoogleSpendFile(input, output)).toThrow("existing_output");
    expect(fetch).not.toHaveBeenCalled();
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 30000);
