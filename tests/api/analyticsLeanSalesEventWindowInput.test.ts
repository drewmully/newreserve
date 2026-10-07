import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { expect, it } from "vitest";
import { bindSalesEventWindow, prepareSalesEventWindowReport } from "@/lib/analytics/salesEventWindowPreparation";
import { prepareSalesEventWindow, salesEventLocatorQuery, paymentEventLocatorQuery,
  type RetainedEventJson } from "@/lib/analytics/salesEventWindowInput";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { fullFixture, fullShop } from "../fixtures/analyticsFull";

// All sources, policies and identifiers in this fixture are synthetic.
function emptyWindow() {
  const at = "2026-10-02T04:00:00Z", date = "2026-10-01", shop = "synthetic.myshopify.com";
  const scope = { projectRef: "a".repeat(20), shop, fromDate: date, throughDate: date,
    sourceTimezone: "America/New_York" as const, sourceCurrency: "USD" as const };
  const retain = (value: unknown): RetainedEventJson => {
    const json = JSON.stringify(value);
    return { json, sha256: createHash("sha256").update(json).digest("hex"),
      startedAt: at, finishedAt: at, evidenceRef: "synthetic:source" };
  };
  const query = salesEventLocatorQuery(date, date);
  const names = ["order_id", "second", "is_sales_reversal", "orders", "quantity_ordered", "reversed_quantity",
    "gross_sales", "discounts", "sales_reversals", "net_sales", "shipping_charges", "taxes", "duties", "additional_fees", "total_sales"];
  const types = ["IDENTITY", "SECOND_TIMESTAMP", "BOOLEAN", "INTEGER", "INTEGER", "INTEGER", ...Array<string>(9).fill("MONEY")];
  const paymentNames = ["order_id", "transaction_id", "second", "payment_gateway", "transaction_kind", "transaction_status",
    "transaction_currency", "gross_payments", "refunded_payments", "net_payments", "transactions"];
  const source = bindSalesEventWindow({ version: 1, scope, sources: [],
    locator: { ...retain({ sourceType: "shopify_connector", startedAt: at, finishedAt: at, query,
      result: { structured_content: { query, shopDomain: shop, chartHint: { currencyCode: "USD" },
        columns: names.map((name, i) => ({ name, dataType: types[i] })), rows: [], rowCount: 0 } } }),
      sourceType: "shopify_connector", apiVersion: null },
    paymentControls: { ...retain({ shopDomain: shop,
      columns: paymentNames.map((name, i) => ({ name, dataType: i < 2 ? "IDENTITY" : i === 2 ? "SECOND_TIMESTAMP" :
        i < 7 ? "STRING" : i === 10 ? "INTEGER" : "MONEY" })),
      results: [{ query: paymentEventLocatorQuery(date), rows: [], rowCount: 0 }] }),
      sourceType: "shopify_connector", apiVersion: null, captureBasis: "recorded_interval" },
    metadata: retain({ projectRef: scope.projectRef, shop, cutoff: at, metadataOnly: true,
      completeOriginalPopulation: false, financialHydrationComplete: false, orders: [] }),
    businessPolicy: { decision: { eligibility: "eligible", commerceSource: "other", acquisitionEligible: false,
      approvalRef: "synthetic:business" }, productClasses: {}, financialApprovalRef: "synthetic:business",
      saleClock: "paid_at", refundClock: "refund_created_at" },
  });
  const context = { ...scope, publication: "synthetic:publication", asOf: at };
  return { source, context };
}
it("admits a genuinely controlled synthetic empty window, not missing source as zero", () => {
  const f = emptyWindow(), p = prepareSalesEventWindow(f.source, f.context);
  expect(p.customerCounts.get(f.source.scope.fromDate)).toBe(0);
  expect(p.paidWindowProof.principalRows).toBe(0);
  expect(p.paidWindowProof.cashLifecycleClaimed).toBe(false);
  const bad = structuredClone(f.source);
  bad.paymentControls.json = "{}";
  expect(() => prepareSalesEventWindow(bad, f.context)).toThrow("input_digest");
});
it("pins date/query shape and bounds without hardcoded orders", () => {
  expect(salesEventLocatorQuery("2026-10-01", "2026-10-01")).not.toContain("WHERE");
  expect(paymentEventLocatorQuery("2026-10-01")).toContain("LIMIT 21");
  expect(() => paymentEventLocatorQuery("2026-10-01", 22)).toThrow("payment_limit");
  expect(() => salesEventLocatorQuery("2026-10-01", "2026-11-01")).toThrow();
});
it("rejects missing raw binding, wrong project and an open day", () => {
  const f = emptyWindow();
  expect(() => prepareSalesEventWindow(f.source, { ...f.context, projectRef: "b".repeat(20) })).toThrow("scope");
  expect(() => prepareSalesEventWindow(f.source, { ...f.context, asOf: "2026-10-02T03:59:59Z" })).toThrow("scope");
  f.source.digest = "0".repeat(64);
  expect(() => prepareSalesEventWindow(f.source, f.context)).toThrow("input_digest");
});
it("refuses rehashed provider error and truncation envelopes", () => {
  for (const field of ["error", "is_error", "structured_content_metadata"]) {
    const f = emptyWindow();
    const body = JSON.parse(f.source.locator.json);
    body.result[field] = field === "error" ? "synthetic:failure" :
      field === "is_error" ? true : { truncated: true };
    f.source.locator.json = JSON.stringify(body);
    f.source.locator.sha256 = createHash("sha256").update(f.source.locator.json).digest("hex");
    const { digest, ...content } = f.source;
    expect(digest).toHaveLength(64);
    expect(() => prepareSalesEventWindow(bindSalesEventWindow(content), f.context)).toThrow("provider_error_or_truncation");
  }
});
it("never falls back to first-action sessions for explicit null or undefined entry inputs", () => {
  for (const value of [null, undefined, false, [], ""]) {
    const f = fullFixture();
    const input = { base: f.base, policy: { ...f.policy, sessionEntryPolicy: value },
      evidence: { ...f.evidence, sessionEntries: value }, events: [], publication: "synthetic:entry",
      shop: fullShop, fromDate: "2026-01-01", throughDate: "2026-01-01" };
    expect(() => buildFullReports(input as unknown as Parameters<typeof buildFullReports>[0]))
      .toThrow("entry_mode_requires_paired_active_source");
  }
});

// This file is private input, never an operational grant or a committed fixture.
const privateInput = process.env.LEAN_EVENT_WINDOW_PRIVATE_INPUT;
it.skipIf(!privateInput)("replays retained genuine source through the full builder without a grant", () => {
  const input = JSON.parse(readFileSync(privateInput!, "utf8")) as Parameters<typeof prepareSalesEventWindowReport>[0];
  const result = prepareSalesEventWindowReport(input);
  expect(result.operatingAuthority).toBeNull();
  expect(result.certified).toBe(false);
  expect(result.result.reports.store_daily.map(r => [r.total_sales_usd, r.eligible_orders, r.new_customers]))
    .toEqual([["-225.000000", 0, 0], ["400.010000", 2, 1]]);
  expect(result.sourceBinding.metadata.unprocessed).toHaveLength(290);
  expect(result.buildInput.evidence.proofs).toEqual([]);
  expect(result.result.manifest.gates.every(g => !g.gates.cash && !g.gates.customers && !g.gates.behavior)).toBe(true);
  const unbound = structuredClone(result.buildInput);
  delete unbound.policy.salesEventWindow;
  delete unbound.evidence.salesEventWindow;
  expect(buildFullReports(unbound).reports.store_daily.every(r => r.total_sales_usd === null)).toBe(true);
});
