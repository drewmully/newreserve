import { expect, it, vi } from "vitest";
import { admitCashSourceEvidence, prepareCashSourceRefresh, type CashSourceControls } from "@/lib/analytics/cashSourceEvidence";
import { assembleEvidence, evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import { normalizePayment } from "@/lib/analytics/financial";
import { key } from "@/lib/analytics/primitives";
import { fullFixture, fullProject, fullShop } from "../fixtures/analyticsFull";
import { refreshFixture } from "../fixtures/analyticsRefresh";

const asOf = "2026-03-02T00:00:00Z";
const paymentId = key(fullShop, "fixture", "4");
function fixture() {
  const full = fullFixture(), refresh = refreshFixture();
  refresh.intake.asOf = asOf; refresh.policy.asOf = asOf;
  refresh.readyAt = asOf; refresh.expiresAt = "2026-03-02T00:30:00Z";
  for (const p of refresh.intake.packets) p.capturedAt = asOf;
  const context = { scope: refresh.intake.scope, asOf, maxAgeSeconds: 3600,
    settlementSourceId: "fixture:export", settlementSourceRecordRef: "fixture:export/settlements",
    settlementCapturedAt: asOf };
  const controls: CashSourceControls = {
    scope: refresh.intake.scope, sourceId: "fixture:independent-cash", evidenceRef: "fixture:control-export",
    capturedAt: asOf, completeThrough: "2026-03-01T00:00:00Z",
    clockApprovalRef: "fixture:reviewed-cash-clock", lifecycleApprovalRef: "fixture:all-gateway-lifecycle",
    independentlyExtracted: true, lifecycleComplete: true, gateways: ["fixture"],
    days: [{ date: "2026-01-01", evidenceRef: "fixture:independent-jan1", complete: true,
      verifiedEmpty: false, paymentIds: [paymentId], totalUsd: "20" }],
  };
  const binding = { sourceId: controls.sourceId, schemaVersion: "cash-controls-v1",
    approvalRef: "fixture:control-binding", maxAgeSeconds: 3600 };
  return { full, refresh, context, controls, binding };
}
function cash(f: ReturnType<typeof fixture>) {
  const out = admitCashSourceEvidence(f.full.evidence, f.context, f.controls);
  const built = buildFullReports({ ...f.full, evidence: out.evidence });
  return { ...out, rows: built.reports.store_daily };
}
it("feeds unchanged preparation and the real full builder; only cash coverage lineage changes", () => {
  const f = fixture(), original = structuredClone(f.refresh);
  const out = prepareCashSourceRefresh(f.refresh, f.controls, f.binding);
  const rebuilt = buildFullReports({ ...f.full, evidence: out.bundle.full.evidence });
  expect(rebuilt.reports.store_daily[0]).toMatchObject({ collected_cash_usd: "20.000000",
    readiness: { collected_cash_usd: "observed_unverified" } });
  expect(f.refresh).toEqual(original);
  expect(out.bundle.full.evidence.settlements).toEqual(f.full.evidence.settlements);
  expect(out.bundle.full.evidence.proofs).toEqual(f.full.evidence.proofs);
  expect(out.bundle.full.evidence.dateCoverage[0].gates).toEqual(f.full.evidence.dateCoverage[0].gates);
  expect(assembleEvidence(out.refresh.intake).evidence).toEqual(out.bundle.full.evidence);
  expect(prepareCashSourceRefresh(f.refresh, f.controls, f.binding)).toEqual(out);
  expect(out.audit).toMatchObject({ state: "offline_cash_controls_match", hostedCalls: 0,
    sourceAuthorityVerified: false, certified: false, published: false });
});
it.each(["total", "keys", "lifecycle", "independence", "same-source", "gateway", "incomplete-day",
  "not-closed", "stale-control", "future-control", "stale-source", "currency", "upstream-false"] as const)(
  "withholds %s without erasing settlements, altering proofs or changing other gates", mode => {
    const f = fixture();
    if (mode === "total") f.controls.days[0].totalUsd = "19";
    if (mode === "keys") f.controls.days[0].paymentIds = ["a".repeat(64)];
    if (mode === "lifecycle") f.controls.lifecycleComplete = false;
    if (mode === "independence") f.controls.independentlyExtracted = false;
    if (mode === "same-source") f.controls.sourceId = f.context.settlementSourceId;
    if (mode === "gateway") f.controls.gateways = ["different"];
    if (mode === "incomplete-day") f.controls.days[0].complete = false;
    if (mode === "not-closed") f.controls.completeThrough = "2026-01-02T04:59:59Z";
    if (mode === "stale-control") f.controls.capturedAt = "2026-03-01T22:59:59Z";
    if (mode === "future-control") f.controls.capturedAt = "2026-03-02T00:00:01Z";
    if (mode === "stale-source") f.context.settlementCapturedAt = "2026-03-01T22:59:59Z";
    if (mode === "currency") f.full.evidence.settlements[0].currency = "CAD";
    if (mode === "upstream-false") f.full.evidence.dateCoverage[0].gates.cash = false;
    const before = structuredClone(f.full.evidence);
    const out = admitCashSourceEvidence(f.full.evidence, f.context, f.controls);
    expect(out.audit.checks[0].admitted).toBe(false);
    expect(out.audit.checks[0].collectedCashUsd).toBeNull();
    expect(out.evidence.settlements).toEqual(before.settlements);
    expect(out.evidence.proofs).toEqual(before.proofs);
    expect(out.evidence.dateCoverage[0].gates).toEqual({ ...before.dateCoverage[0].gates, cash: false });
    expect(f.full.evidence).toEqual(before);
    // The normal full builder keeps sales numeric when a cash control fails.
    if (mode !== "currency") {
      const row = buildFullReports({ ...f.full, evidence: out.evidence }).reports.store_daily[0];
      expect(row.collected_cash_usd).toBeNull();
      expect(row.total_sales_usd).toBe("20.000000");
    }
  });
it("missing independent controls never become a zero", () => {
  const f = fixture(), out = admitCashSourceEvidence(f.full.evidence, f.context, null);
  expect(out.audit.checks[0].issues).toContain("cash_controls_missing");
  expect(buildFullReports({ ...f.full, evidence: out.evidence }).reports.store_daily[0].collected_cash_usd).toBeNull();
});
it("rejects unapproved clock references, duplicate settlements and duplicate/out-of-window controls", () => {
  const f = fixture();
  f.controls.clockApprovalRef = "";
  expect(() => cash(f)).toThrow("cash_control_scope");
  f.controls.clockApprovalRef = "fixture:clock";
  f.full.evidence.settlements.push(structuredClone(f.full.evidence.settlements[0]));
  expect(() => cash(f)).toThrow("cash_duplicate_settlement");
  f.full.evidence.settlements.pop();
  f.controls.days.push(structuredClone(f.controls.days[0]));
  expect(() => cash(f)).toThrow("cash_control_scope");
  f.controls.days.pop(); f.controls.days[0].date = "2026-01-02";
  expect(() => cash(f)).toThrow("cash_control_scope");
});
it.each(["pending", "failed", "future-settlement"] as const)("does not reuse %s as completed cash", mode => {
  const f = fixture();
  if (mode === "future-settlement") f.full.evidence.settlements[0].settledAt = "2026-03-02T00:00:01Z";
  else f.full.evidence.settlements[0].status = mode;
  expect(cash(f).rows[0].collected_cash_usd).toBeNull();
});
it("matches signed chargebacks on their cash-effective day, independent of the order's sales day", () => {
  const f = fixture();
  f.full.throughDate = "2026-01-02";
  f.context.scope.throughDate = "2026-01-02";
  f.full.evidence.dateCoverage.push({ ...structuredClone(f.full.evidence.dateCoverage[0]), date: "2026-01-02" });
  f.full.evidence.settlements.push({ ...f.full.evidence.settlements[0],
    id: "5", parentId: "4", kind: "chargeback", signedAmount: "-5",
    settledAt: "2026-01-02T15:00:00Z", settlementEvidenceRef: "fixture:independent-dispute-source" });
  const proof = f.full.evidence.proofs.find(p => p.table === "payments")!;
  proof.expectedKeys.push(JSON.stringify([key(fullShop, "fixture", "5")]));
  proof.amountChecks[0].expectedTotal = "15"; // Separate synthetic control, not derived from candidate.
  f.controls.days.push({ date: "2026-01-02", evidenceRef: "fixture:independent-jan2", complete: true,
    verifiedEmpty: false, paymentIds: [key(fullShop, "fixture", "5")], totalUsd: "-5" });
  expect(cash(f).rows.map(r => [r.report_date, r.collected_cash_usd, r.total_sales_usd])).toEqual([
    ["2026-01-01", "20.000000", "20.000000"], ["2026-01-02", "-5.000000", "0.000000"],
  ]);
  f.full.evidence.settlements[1].settledAt = "2026-01-01T15:00:00Z"; // Same range total, wrong days.
  expect(cash(f).rows.map(r => r.collected_cash_usd)).toEqual([null, null]);
});
it("requires explicit complete empty-day evidence before the existing builder can show zero", () => {
  const f = fixture();
  f.full.evidence.settlements = []; f.full.base.payments = [];
  const proof = f.full.evidence.proofs.find(p => p.table === "payments")!;
  proof.expectedKeys = []; proof.amountChecks[0].expectedTotal = "0";
  f.controls.days[0].paymentIds = []; f.controls.days[0].totalUsd = "0";
  expect(cash(f).rows[0].collected_cash_usd).toBeNull();
  f.controls.days[0].verifiedEmpty = true;
  expect(cash(f).rows[0].collected_cash_usd).toBe("0.000000");
  f.controls.lifecycleComplete = false;
  expect(cash(f).rows[0].collected_cash_usd).toBeNull();
});
it("keeps the oldest source clock, source/proof packets, and registration hash tied to changed controls", () => {
  const f = fixture();
  const source = f.refresh.intake.packets.find(p => p.section === "settlements")!;
  source.capturedAt = "2026-03-01T23:59:00Z";
  const out = prepareCashSourceRefresh(f.refresh, f.controls, f.binding);
  expect(out.refresh.intake.packets.find(p => p.section === "dateCoverage")?.capturedAt)
    .toBe(new Date(source.capturedAt).toISOString());
  for (const p of f.refresh.intake.packets.filter(p => p.section !== "dateCoverage"))
    expect(out.refresh.intake.packets.find(q => q.section === p.section)).toEqual(p);
  f.controls.days[0].totalUsd = "19";
  const corrected = prepareCashSourceRefresh(f.refresh, f.controls, f.binding);
  expect(corrected.bundle.digest).not.toBe(out.bundle.digest);
  expect(corrected.bundle.full.evidence.dateCoverage[0].gates.cash).toBe(false);
});
it("rejects cross-project control binding, changed packet hashes and execution outliving evidence", () => {
  const f = fixture();
  f.controls.scope = { ...f.controls.scope, projectRef: "b".repeat(20) };
  expect(() => prepareCashSourceRefresh(f.refresh, f.controls, f.binding)).toThrow("cash_control_scope");
  f.controls.scope.projectRef = fullProject;
  const source = f.refresh.intake.packets.find(p => p.section === "settlements")!;
  source.sha256 = "0".repeat(64);
  expect(() => prepareCashSourceRefresh(f.refresh, f.controls, f.binding)).toThrow("evidence_digest_mismatch");
  source.sha256 = evidenceDigest(source.payload);
  expect(() => prepareCashSourceRefresh(f.refresh, f.controls, { ...f.binding, maxAgeSeconds: 60 }))
    .toThrow("refresh_outlives_evidence");
});
it("does not replace the existing independent payment-proof requirement", () => {
  const f = fixture();
  f.full.evidence.proofs.find(p => p.table === "payments")!.complete = false;
  const out = cash(f);
  expect(out.audit.checks[0].admitted).toBe(true); // This admission is necessary, not sufficient.
  expect(out.rows[0].collected_cash_usd).toBeNull();
});
it("cannot extend an original coverage binding's shorter expiry by rebinding it", () => {
  const f = fixture(), old = f.refresh.intake.bindings[0];
  old.maxAgeSeconds = 86400;
  old.sections = old.sections.filter(s => s !== "dateCoverage");
  f.refresh.intake.bindings.push({ ...old, sourceId: "fixture:short-coverage",
    sections: ["dateCoverage"], maxAgeSeconds: 3600 });
  const coverage = f.refresh.intake.packets.find(p => p.section === "dateCoverage")!;
  coverage.sourceId = "fixture:short-coverage";
  coverage.capturedAt = "2026-03-01T23:10:00Z";
  expect(() => prepareCashSourceRefresh(f.refresh, f.controls, { ...f.binding, maxAgeSeconds: 86400 }))
    .toThrow("refresh_outlives_evidence");
});
it.each(["base", "replacement", "empty-base"] as const)(
  "checks extra %s cash in the final consumer, not only settlement inputs", mode => {
    const f = fixture();
    if (mode === "empty-base") {
      const source = f.refresh.intake.packets.find(p => p.section === "settlements")!;
      source.payload = []; source.sha256 = evidenceDigest([]);
      f.controls.days[0] = { ...f.controls.days[0], paymentIds: [], totalUsd: "0", verifiedEmpty: true };
    }
    const out = prepareCashSourceRefresh(f.refresh, f.controls, f.binding);
    expect(out.audit.checks[0].admitted).toBe(true); // Preliminary source check.
    const extra = { ...f.full.evidence.settlements[0], id: "99", signedAmount: "5" };
    const evidence = out.bundle.full.evidence;
    const proof = evidence.proofs.find(p => p.table === "payments")!;
    proof.expectedKeys.push(JSON.stringify([key(fullShop, "fixture", "99")]));
    proof.amountChecks[0].expectedTotal = "25";
    if (mode === "replacement") {
      evidence.replacements.push({ snapshot: f.full.snapshot,
        decision: { eligibility: "eligible", commerceSource: "storefront",
          acquisitionEligible: true, approvalRef: "fixture:replacement" },
        movements: [], payments: [f.full.evidence.settlements[0], extra], evidenceRef: "fixture:replacement" });
    } else f.full.base.payments.push(normalizePayment(extra, "base"));
    const built = buildFullReports({ ...f.full, evidence });
    expect(built.reports.store_daily[0].collected_cash_usd).toBeNull();
    expect(built.manifest.gates[0].gates.cash).toBe(false);
    expect(built.manifest.evidenceRef).toBe(evidence.ref); // Required by SQL021.
  });
it("withholds added base cash on wrong days even when its signed window total is zero", () => {
  const f = fixture();
  f.full.throughDate = "2026-01-02";
  f.refresh.intake.scope.throughDate = "2026-01-02";
  f.refresh.maxSteps = 6;
  const coverage = f.refresh.intake.packets.find(p => p.section === "dateCoverage")!;
  const rows = coverage.payload as typeof f.full.evidence.dateCoverage;
  rows.push({ ...structuredClone(rows[0]), date: "2026-01-02" });
  coverage.sha256 = evidenceDigest(rows);
  f.controls.days.push({ date: "2026-01-02", evidenceRef: "fixture:independent-jan2",
    complete: true, verifiedEmpty: true, paymentIds: [], totalUsd: "0" });
  const out = prepareCashSourceRefresh(f.refresh, f.controls, f.binding);
  const plus = { ...f.full.evidence.settlements[0], id: "99", signedAmount: "5" };
  const minus = { ...plus, id: "100", parentId: "99", kind: "refund" as const,
    signedAmount: "-5", settledAt: "2026-01-02T15:00:00Z" };
  f.full.base.payments.push(normalizePayment(plus, "base"), normalizePayment(minus, "base"));
  const proof = out.bundle.full.evidence.proofs.find(p => p.table === "payments")!;
  proof.expectedKeys.push(...["99", "100"].map(id => JSON.stringify([key(fullShop, "fixture", id)])));
  // The independent aggregate source_amount proof still matches 20.
  expect(buildFullReports({ ...f.full, evidence: out.bundle.full.evidence }).reports.store_daily
    .map(row => row.collected_cash_usd)).toEqual([null, null]);
});
it("rejects repeated preparation and consumer scope drift", () => {
  const f = fixture(), out = prepareCashSourceRefresh(f.refresh, f.controls, f.binding);
  expect(() => prepareCashSourceRefresh(out.refresh, f.controls, { ...f.binding, sourceId: "fixture:new" }))
    .toThrow("cash_composite_binding");
  out.bundle.full.evidence.dateCoverage[0].cashSourceAdmission!.context.scope.shop = "other.myshopify.com";
  expect(() => buildFullReports({ ...f.full, evidence: out.bundle.full.evidence })).toThrow("cash_consumer_scope");
});
it("hands the prepared cash input to the existing runtime's real finish payload, without source I/O", async () => {
  const f = fixture();
  f.refresh.policy.behaviorMode = "excluded";
  const prepared = prepareCashSourceRefresh(f.refresh, f.controls, f.binding);
  const b = prepared.bundle, finish: Record<string, unknown>[] = [];
  const client = { rpc: vi.fn(async (name: string, args?: Record<string, unknown>) => {
    if (name === "lean_full_inputs") return { data: { state: "ready", ...b.full,
      shop: fullShop, publication: f.full.publication, fromDate: f.full.fromDate,
      throughDate: f.full.throughDate, inputHash: b.digest, facts: f.full.base }, error: null };
    if (name === "lean_full_finish") finish.push(args!);
    return { data: true, error: null };
  }) };
  const request = vi.fn(() => { throw new Error("source_network_forbidden"); });
  const options = { client, projectRef: fullProject, databaseUrl: `https://${fullProject}.supabase.co`,
    runId: b.runId, posthogKey: "", request };
  await expect(runFullReportJob(options)).resolves.toMatchObject({ state: "complete", certification: "unverified" });
  await runFullReportJob(options);
  expect(request).not.toHaveBeenCalled();
  expect(finish[0].p_reports).toEqual(finish[1].p_reports);
  expect(finish[0].p_input_hash).toBe(b.digest);
  expect(finish[0].p_manifest).toMatchObject({ evidenceRef: b.full.evidence.ref });
  expect(finish[0].p_reports).toMatchObject({ store_daily: [{ collected_cash_usd: "20.000000" }] });
  expect(client.rpc.mock.calls.map(([name]) => name)).toEqual([
    "lean_full_inputs", "lean_full_claim", "lean_full_finish",
    "lean_full_inputs", "lean_full_claim", "lean_full_finish",
  ]);
});
it("runs the cash consumer guard and B's explicit customer-history cutoff in the same full build", () => {
  const f = fixture();
  const packet = f.refresh.intake.packets.find(p => p.section === "customerHistory")!;
  const history = packet.payload as typeof f.full.evidence.customerHistory;
  history["customer-fixture"].completeThrough = "2026-01-15T00:00:00Z";
  packet.sha256 = evidenceDigest(history);
  const prepared = prepareCashSourceRefresh(f.refresh, f.controls, f.binding);
  const built = buildFullReports({ ...f.full, evidence: prepared.bundle.full.evidence });
  expect(built.reports.store_daily[0].collected_cash_usd).toBe("20.000000");
  expect(built.reports.customer_cohorts[0]).toMatchObject({
    repeat_purchase_rate: null, revenue_ltv_usd: null,
  });
  // Extend only the supported history cutoff. Cash controls are unchanged.
  history["customer-fixture"].completeThrough = asOf;
  packet.sha256 = evidenceDigest(history);
  const mature = prepareCashSourceRefresh(f.refresh, f.controls, f.binding);
  const compared = buildFullReports({ ...f.full, evidence: mature.bundle.full.evidence });
  expect(compared.reports.customer_cohorts[0].repeat_purchase_rate).toBe("0.000000");
  expect(compared.reports.store_daily[0].collected_cash_usd).toBe("20.000000");
});
