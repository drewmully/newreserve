// @vitest-environment node
import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
// Standalone offline operator uses no application runtime or transport.
import { reconcileCashExports } from "../../scripts/analytics/reconcile-cash-exports.mjs";

const ph = ["Transaction Date", "Type", "Order", "Card Brand", "Card Source", "Payout Status",
  "Payout Date", "Payout ID", "Available On", "Amount", "Fee", "Net", "Checkout",
  "Payment Method Name", "Presentment Amount", "Presentment Currency", "Currency",
  "Business Entity Name", "Business Entity ID"];
const oh = ["Payout Date", "Status", "Charges", "Refunds", "Adjustments", "Marketplace Sales Tax",
  "Advances", "Reserved Funds", "Fees", "Retried Amount", "Total", "Currency", "Bank Reference",
  "Business Entity Name", "Business Entity ID"];
const privateMarker = "PRIVATE-DO-NOT-RETURN";
const payment = (overrides: Record<string, string> = {}) => ({
  ...Object.fromEntries(ph.map(k => [k, privateMarker])),
  "Transaction Date": "2026-09-29 02:12:04 -0400", Type: "charge", "Payout Status": "paid",
  "Payout Date": "2026-10-01", "Available On": "2026-10-01",
  Amount: "400.01", Fee: "9.60", Net: "390.41", Currency: "USD", ...overrides,
});
const payout = (overrides: Record<string, string> = {}) => ({
  ...Object.fromEntries(oh.map(k => [k, privateMarker])),
  "Payout Date": "2026-10-01", Status: "paid", Charges: "400.01", Refunds: "0.00",
  Adjustments: "0.00", "Marketplace Sales Tax": "0.00", Advances: "0.00",
  "Reserved Funds": "-39.04", Fees: "9.60", "Retried Amount": "0.00", Total: "351.37",
  Currency: "USD", ...overrides,
});
const csv = (headers: string[], rows: Record<string, string>[]) => Buffer.from(
  [headers, ...rows.map(r => headers.map(k => r[k]))]
    .map(r => r.map(v => `"${v.replaceAll('"', '""')}"`).join(",")).join("\r\n") + "\r\n");
const run = (ps = [payment()], os = [payout()]) => reconcileCashExports(csv(ph, ps), csv(oh, os));

describe("cash export reconciliation only", () => {
  it("keeps principal, fee, reserve and adjustment separate and never admits cash", () => {
    const result = run([payment(),
      payment({ Type: "reserved_funds", Amount: "-39.04", Fee: "0.00", Net: "-39.04" }),
      payment({ Type: "adjustment", Amount: "-40.00", Fee: "0.00", Net: "-40.00" })],
    [payout({ Total: "311.37" })]);
    expect(result.days[0].types.charge.amount).toBe("400.01");
    expect(result.days[0].types.adjustment.amount).toBe("-40.00");
    expect(result.payoutComparisons[0]).toMatchObject({
      ledgerNet: "311.37", state: "date_aggregate_matches", headerComponentResidual: "-40.00",
    });
    expect(result).toMatchObject({ cash: null, cashGate: false, lifecycleComplete: false, published: false });
    expect(result.coverage.paypalCoverageVerified).toBe(false);
  });
  it("does not emit bank, card, order, entity or checkout fields", () => {
    expect(JSON.stringify(run())).not.toContain(privateMarker);
    const quoted = payment({ Order: 'private,"quoted"\nline' });
    expect(JSON.stringify(run([quoted]))).not.toContain("quoted");
  });
  it("does not present an unpaired date as zero or reconcile different windows", () => {
    const result = run([payment({ "Payout Date": "2026-10-02" })]);
    expect(result.payoutComparisons).toHaveLength(2);
    for (const row of result.payoutComparisons) {
      expect(row.state).toBe("unpaired_export_window");
      expect(row.difference).toBeNull();
    }
  });
  it("reports real disagreement without manufacturing an adjustment", () => {
    expect(run().payoutComparisons[0]).toMatchObject({ state: "date_aggregate_differs", difference: "-39.04" });
  });
  it("uses offset timestamps and New York dates rather than payout dates", () => {
    const result = run([payment({ "Transaction Date": "2026-09-29 01:00:00 +0000" })]);
    expect(result.days[0].day).toBe("2026-09-28");
    expect(result.coverage.transactionInstantRange.first).toBe("2026-09-29T01:00:00.000Z");
  });
  it.each(["2026-09-29 01:00:00", "2026-02-30 01:00:00 -0400", "2026-09-29 24:00:00 -0400",
    "2026-09-29 01:00:00 +1500"])("rejects invalid or ambiguous clock %s", clock => {
    expect(() => run([payment({ "Transaction Date": clock })])).toThrow();
  });
  it("rejects unsupported classifications, invalid sign, currency and arithmetic", () => {
    for (const row of [payment({ Type: "unknown" }), payment({ Type: "refund" }),
      payment({ Currency: "bad" }), payment({ Net: "400.01" }), payment({ Amount: "4e2" })])
      expect(() => run([row])).toThrow();
  });
  it("does not add currencies or collapse identical-looking events", () => {
    const result = run([payment(), payment(), payment({ Currency: "CAD" })]);
    expect(result.byCurrency.USD.rows).toBe(2);
    expect(result.byCurrency.CAD.rows).toBe(1);
    expect(result.inputs.payments.rows).toBe(3);
    expect(result.coverage.paymentTransactionIdsPresent).toBe(false);
  });
  it("refuses truncated CSV, schema drift, duplicate headers and empty exports", () => {
    const valid = csv(ph, [payment()]);
    expect(() => reconcileCashExports(valid.subarray(0, valid.length - 4), csv(oh, [payout()]))).toThrow();
    expect(() => reconcileCashExports(csv([...ph, "Extra"], [payment({ Extra: "x" })]), csv(oh, [payout()]))).toThrow();
    expect(() => reconcileCashExports(csv([...ph.slice(0, -1), ph[0]], [payment()]), csv(oh, [payout()]))).toThrow();
    expect(() => reconcileCashExports(csv(ph, []), csv(oh, [payout()]))).toThrow("cash_export_empty");
  });
  it("caps rows and input bytes without emitting private content", () => {
    expect(() => reconcileCashExports(csv(ph, Array(10001).fill(payment())), csv(oh, [payout()])))
      .toThrow("cash_export_row_budget");
    expect(() => reconcileCashExports(Buffer.alloc(8 * 1024 * 1024 + 1), csv(oh, [payout()])))
      .toThrow("cash_export_size");
  });
  it("writes a private result once and refuses overwrite and input symlinks", () => {
    const dir = mkdtempSync(join(tmpdir(), "cash-export-test-"));
    try {
      const p = join(dir, "payments.csv"), o = join(dir, "payouts.csv"), output = join(dir, "result.json");
      writeFileSync(p, csv(ph, [payment()])); writeFileSync(o, csv(oh, [payout()]));
      const command = resolve("scripts/analytics/reconcile-cash-exports.mjs");
      const first = spawnSync(process.execPath, [command, p, o, output], { encoding: "utf8" });
      expect(first.status).toBe(0);
      expect(statSync(output).mode & 0o777).toBe(0o600);
      const original = readFileSync(output);
      const again = spawnSync(process.execPath, [command, p, o, output], { encoding: "utf8" });
      expect(again.status).toBe(1);
      expect(readFileSync(output)).toEqual(original);
      const link = join(dir, "link.csv"); symlinkSync(p, link);
      expect(spawnSync(process.execPath, [command, link, o, join(dir, "other.json")]).status).toBe(1);
      expect(first.stdout + first.stderr + again.stdout + again.stderr).not.toContain(privateMarker);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
