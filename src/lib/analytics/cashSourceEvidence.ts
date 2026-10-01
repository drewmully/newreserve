import { evidenceDigest, type EvidenceBinding, type EvidencePacket, type EvidenceScope } from "./evidenceIntake";
import type { FullBuildEvidence } from "./fullReportBuild";
import { normalizePayment } from "./financial";
import { reportDates } from "./commerceCandidate";
import { decimal, micros, nyDate, type Row } from "./primitives";
import { shopifyShop } from "./shopifySource";
import { prepareRefresh, type RefreshInput } from "./refreshPlan";

/** Independently extracted customer-payment controls, not order totals, bank
 * deposits or totals computed from the settlement input being checked.
 * References bind reviewed evidence; this pure function cannot authenticate it.
 */
export type CashSourceControls = {
  scope: EvidenceScope;
  sourceId: string;
  evidenceRef: string;
  capturedAt: string;
  completeThrough: string;
  clockApprovalRef: string;
  lifecycleApprovalRef: string;
  independentlyExtracted: boolean;
  lifecycleComplete: boolean;
  gateways: string[];
  days: {
    date: string;
    evidenceRef: string;
    complete: boolean;
    verifiedEmpty: boolean;
    paymentIds: string[];
    totalUsd: string;
  }[];
};
export type CashSourceContext = {
  scope: EvidenceScope;
  asOf: string;
  maxAgeSeconds: number;
  settlementSourceId: string;
  settlementSourceRecordRef: string;
  settlementCapturedAt: string;
};
export type CashSourceAdmission = { context: CashSourceContext; controls: CashSourceControls | null };
const ref = (v: unknown): v is string => typeof v === "string" && v.trim() === v &&
  v.length > 0 && v.length <= 512 && !/[\u0000-\u001f\u007f]/.test(v);
function time(v: string) { nyDate(v); return Date.parse(v); }
function same(a: string[], b: string[]) {
  return a.length === b.length && JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());
}

/** Apply after validated evidence intake, before sealing/registering a full
 * build. Only narrows existing cash coverage. No source read, mapper, control
 * fabrication, new business definition or promotion of an unavailable metric.
 * Retain `audit` with the original source/control packets outside public feeds.
 */
export function admitCashSourceEvidence(evidence: FullBuildEvidence, context: CashSourceContext,
  controls: CashSourceControls | null, finalPayments?: Row[]) {
  const { scope } = context;
  shopifyShop(scope.shop);
  const dates = reportDates(scope.fromDate, scope.throughDate), asOf = time(context.asOf);
  if (!/^[a-z]{20}$/.test(scope.projectRef) || dates.length > 31 ||
      !Number.isSafeInteger(context.maxAgeSeconds) || context.maxAgeSeconds < 1 ||
      context.maxAgeSeconds > 604800 || !ref(context.settlementSourceId) ||
      !ref(context.settlementSourceRecordRef) || evidence.settlements.length > 10000 ||
      Buffer.byteLength(JSON.stringify({ evidence: evidence.settlements, controls })) > 5000000)
    throw new Error("cash_source_input");
  const fresh = (value: string) => {
    const age = asOf - time(value);
    return age >= 0 && age <= context.maxAgeSeconds * 1000;
  };
  const globalIssues: string[] = [];
  if (!fresh(context.settlementCapturedAt)) globalIssues.push("settlement_source_not_current");
  if (!controls) globalIssues.push("cash_controls_missing");
  if (controls) {
    if (evidenceDigest(controls.scope) !== evidenceDigest(scope) || !ref(controls.sourceId) ||
        !ref(controls.evidenceRef) || !ref(controls.clockApprovalRef) || !ref(controls.lifecycleApprovalRef) ||
        !Array.isArray(controls.gateways) || controls.gateways.length < 1 || controls.gateways.length > 20 ||
        controls.gateways.some(g => !ref(g) || g.length > 128) ||
        new Set(controls.gateways).size !== controls.gateways.length ||
        !Array.isArray(controls.days) || controls.days.length > 31 ||
        controls.days.some(d => !dates.includes(d.date)) ||
        new Set(controls.days.map(d => d.date)).size !== controls.days.length)
      throw new Error("cash_control_scope");
    if (controls.sourceId === context.settlementSourceId ||
        controls.evidenceRef === context.settlementSourceRecordRef ||
        controls.independentlyExtracted !== true) globalIssues.push("cash_controls_not_independent");
    if (controls.lifecycleComplete !== true) globalIssues.push("cash_lifecycle_incomplete");
    if (!fresh(controls.capturedAt) ||
        time(controls.completeThrough) > time(controls.capturedAt) ||
        time(controls.capturedAt) < time(context.settlementCapturedAt))
      globalIssues.push("cash_controls_not_current");
    for (const day of controls.days) {
      if (!ref(day.evidenceRef) || !Array.isArray(day.paymentIds) || day.paymentIds.length > 10000 ||
          day.paymentIds.some(id => !/^[a-f0-9]{64}$/.test(id)) ||
          new Set(day.paymentIds).size !== day.paymentIds.length ||
          typeof day.complete !== "boolean" || typeof day.verifiedEmpty !== "boolean")
        throw new Error("cash_control_day");
      micros(day.totalUsd);
    }
    if (controls.days.reduce((n, d) => n + d.paymentIds.length, 0) > 10000)
      throw new Error("cash_control_budget");
  }
  const sourceKeys = new Set<string>();
  const settlements = evidence.settlements.map(payment => {
    if (payment.shop !== scope.shop || !ref(payment.settlementEvidenceRef) || !payment.settledAt)
      throw new Error("cash_settlement_authority");
    const row = normalizePayment(payment, "cash-source-admission");
    const id = String(row.payment_id);
    if (sourceKeys.has(id)) throw new Error("cash_duplicate_settlement");
    sourceKeys.add(id);
    if (row.cash_eligible !== true || time(payment.settledAt) > time(context.settlementCapturedAt))
      globalIssues.push("cash_source_lifecycle_invalid");
    if (controls && !controls.gateways.includes(payment.gateway))
      globalIssues.push("cash_gateway_inventory_mismatch");
    return row;
  });
  const source = finalPayments ?? settlements;
  if (finalPayments) {
    if (finalPayments.length > 10000) throw new Error("cash_final_payment_budget");
    const controlled = new Map(settlements.map(row => [String(row.payment_id), row]));
    // Other base/replacement cash must not bypass the controlled settlements.
    // Compare the exact normalized economics/clock, independent of publication.
    for (const row of finalPayments.filter(row => row.cash_eligible === true)) {
      const prior = controlled.get(String(row.payment_id));
      if (!prior || Object.keys(prior).filter(field => field !== "publication_id")
        .some(field => prior[field] !== row[field])) globalIssues.push("cash_uncontrolled_final_payment");
    }
    const eligible = finalPayments.filter(row => row.cash_eligible === true).map(row => String(row.payment_id));
    if (new Set(eligible).size !== eligible.length ||
        settlements.some(row => row.cash_eligible === true && !eligible.includes(String(row.payment_id))))
      globalIssues.push("cash_final_payment_set_mismatch");
  }
  const checks = dates.map(date => {
    const issues = [...new Set(globalIssues)];
    const claim = controls?.days.find(day => day.date === date);
    const rows = source.filter(row => row.cash_eligible === true && row.report_date === date);
    if (!claim || !claim.complete) issues.push("cash_day_control_incomplete");
    if (controls && nyDate(controls.completeThrough) <= date) issues.push("cash_day_not_closed");
    if (rows.some(row => row.source_currency !== "USD" || row.cash_amount_usd === null))
      issues.push("cash_currency_unavailable");
    if (claim) {
      if (!same(rows.map(row => String(row.payment_id)), claim.paymentIds)) issues.push("cash_day_keys_mismatch");
      if (claim.verifiedEmpty !== (claim.paymentIds.length === 0) ||
          claim.verifiedEmpty && micros(claim.totalUsd) !== BigInt(0))
        issues.push("cash_empty_not_verified");
      if (!rows.some(row => row.cash_amount_usd === null) &&
          rows.reduce((n, row) => n + micros(String(row.cash_amount_usd)), BigInt(0)) !== micros(claim.totalUsd))
        issues.push("cash_day_amount_mismatch");
    }
    const existing = evidence.dateCoverage.filter(row => row.date === date);
    if (existing.length !== 1) throw new Error("cash_date_coverage");
    if (existing[0].gates.cash !== true) issues.push("cash_upstream_coverage_unavailable");
    return { date, issues, admitted: issues.length === 0,
      collectedCashUsd: issues.length ? null : decimal(micros(claim!.totalUsd)) };
  });
  const bindingDigest = evidenceDigest({ context, controls, settlements: evidence.settlements,
    finalPayments: finalPayments ?? null });
  const output = structuredClone(evidence);
  output.ref = `cash-admission:sha256:${evidenceDigest({ prior: evidence.ref, bindingDigest })}`;
  output.dateCoverage = output.dateCoverage.map(row => {
    const check = checks.find(c => c.date === row.date);
    if (!check) return row;
    return { ...row, gates: { ...row.gates, cash: check.admitted },
      evidenceRef: `cash-admission:sha256:${evidenceDigest({ prior: row.evidenceRef, bindingDigest, date: row.date })}` };
  });
  return { evidence: output, audit: {
    state: checks.every(c => c.admitted) ? "offline_cash_controls_match" : "offline_cash_withheld",
    inputDigest: bindingDigest, checks, hostedCalls: 0, sourceAuthorityVerified: false,
    finalPaymentSetChecked: finalPayments !== undefined, certified: false, published: false,
  } };
}

/** Existing preparation path, with only the date-coverage cash gate narrowed.
 * The new composite packet retains the oldest contributing capture time and
 * binds both reviewed control sources. The usual intake validation, immutable
 * run digest, execution deadline and full-report registration format remain.
 */
export function prepareCashSourceRefresh(input: RefreshInput, controls: CashSourceControls,
  binding: Omit<EvidenceBinding, "sections" | "independentControlSource">) {
  // Validate the original execution window against every original binding
  // before replacing any binding. An older, short-lived coverage source must
  // not acquire the longer lifetime of the new control source.
  const original = prepareRefresh(input);
  const source = input.intake.packets.find(p => p.section === "settlements")!;
  const prior = input.intake.packets.find(p => p.section === "dateCoverage")!;
  if (controls.independentlyExtracted !== true || binding.sourceId !== controls.sourceId ||
      input.intake.bindings.some(b => b.sourceId === binding.sourceId))
    throw new Error("cash_composite_binding");
  const context: CashSourceContext = {
    scope: input.intake.scope, asOf: input.intake.asOf, maxAgeSeconds: binding.maxAgeSeconds,
    settlementSourceId: source.sourceId, settlementSourceRecordRef: source.sourceRecordRef,
    settlementCapturedAt: source.capturedAt,
  };
  if (original.full.evidence.dateCoverage.some(row => row.cashSourceAdmission))
    throw new Error("cash_admission_already_prepared");
  const checked = admitCashSourceEvidence(original.full.evidence, context, controls);
  const payload = checked.evidence.dateCoverage.map((row, index) => index === 0
    ? { ...row, cashSourceAdmission: { context: structuredClone(context), controls: structuredClone(controls) } }
    : row);
  const packet: EvidencePacket<"dateCoverage"> = {
    section: "dateCoverage", sourceId: binding.sourceId, schemaVersion: binding.schemaVersion,
    scope: input.intake.scope,
    capturedAt: new Date(Math.min(time(prior.capturedAt), time(source.capturedAt), time(controls.capturedAt))).toISOString(),
    sourceRecordRef: `cash-composite:sha256:${evidenceDigest({ prior, source, controls, audit: checked.audit })}`,
    payload, sha256: evidenceDigest(payload),
  };
  const refresh = structuredClone(input);
  refresh.intake.packets = refresh.intake.packets.map(p => p.section === "dateCoverage" ? packet : p);
  refresh.intake.bindings = [
    ...refresh.intake.bindings.map(b => ({ ...b, sections: b.sections.filter(s => s !== "dateCoverage") }))
      .filter(b => b.sections.length),
    { ...binding, sections: ["dateCoverage"], independentControlSource: true },
  ];
  return { refresh, bundle: prepareRefresh(refresh), audit: checked.audit,
    retained: { originalCoverage: structuredClone(prior), controls: structuredClone(controls) } };
}
