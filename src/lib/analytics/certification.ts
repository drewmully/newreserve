import contracts from "./lean-contracts.json";
import { validateBatchShape } from "./validate-contract";
import { micros, type Row } from "./primitives";
export type Candidate = Record<string, Row[]>;
export type Reconciliation = {
  table: string; expectedKeys: string[]; keyFields: string[]; evidenceRef: string;
  independentlyExtracted: boolean; complete: boolean;
  amountChecks: { field: string; expectedTotal: string }[];
};
/** Callers supply keys from independent source extraction, not these candidate rows. */
export function reconcileCandidate(candidate: Candidate, proofs: Reconciliation[], required: string[]): string[] {
  const issues: string[] = [];
  for (const table of required) {
    const matches = proofs.filter(p => p.table === table);
    if (matches.length !== 1) { issues.push(`${table}:missing_reconciliation`); continue; }
    const p = matches[0], rows = candidate[table] ?? [];
    const contract = contracts.tables.find(t => t.name === table);
    if (!contract || !p.keyFields.length || p.keyFields.some(f => !contract.fields.some(c => c.name === f)) ||
        !p.complete || !p.independentlyExtracted || !p.evidenceRef) { issues.push(`${table}:unverified_source`); continue; }
    const actual = rows.map(r => JSON.stringify(p.keyFields.map(f => r[f]))).sort();
    const expected = [...p.expectedKeys].sort();
    if (new Set(expected).size !== expected.length || JSON.stringify(actual) !== JSON.stringify(expected)) issues.push(`${table}:key_mismatch`);
    for (const check of p.amountChecks) {
      if (!contract.fields.some(f => f.name === check.field && f.logicalType.startsWith("DECIMAL"))) {
        issues.push(`${table}:invalid_amount_check`); continue;
      }
      try {
        if (rows.some(r => typeof r[check.field] !== "string") ||
            rows.reduce((n, r) => n + micros(r[check.field] as string), BigInt(0)) !== micros(check.expectedTotal)) issues.push(`${table}:amount_mismatch`);
      } catch { issues.push(`${table}:amount_mismatch`); }
    }
    if (["sales_ledger", "payments", "marketing_spend_daily"].includes(table) && p.amountChecks.length === 0) issues.push(`${table}:missing_amount_reconciliation`);
  }
  return issues;
}
/** Core graph checks. Native temporal/campaign/provider controls remain separate evidence gates. */
export function validateCandidateGraph(c: Candidate, publication: string, model: string, requireAttribution = true): string[] {
  const issues: string[] = [];
  for (const t of contracts.tables) {
    if (!Array.isArray(c[t.name])) { issues.push(`${t.name}:missing_table`); continue; }
    if (validateBatchShape(t.name, c[t.name], publication).length) issues.push(`${t.name}:shape_or_key`);
  }
  if (issues.length) return issues;
  const indexes = Object.fromEntries(contracts.tables.map(t => [t.name, new Map(c[t.name].map(r => [r[t.primaryKey[0]], r]))]));
  const parent = (from: string, field: string, to: string, nullable: boolean, rule: number) => {
    for (const r of c[from]) if (r[field] === null ? !nullable : !indexes[to].has(r[field])) issues.push(`join_${rule}:missing_parent`);
  };
  parent("orders", "customer_id", "customers", true, 1);
  parent("sessions", "customer_id", "customers", true, 2);
  parent("identity_map", "customer_id", "customers", true, 4);
  parent("customers", "first_eligible_order_id", "orders", true, 6);
  parent("orders", "checkout_session_key", "sessions", true, 8);
  parent("order_items", "order_id", "orders", false, 11);
  parent("sales_ledger", "order_id", "orders", false, 12);
  parent("payments", "order_id", "orders", false, 13);
  parent("sales_ledger", "order_item_id", "order_items", true, 14);
  parent("order_item_offers", "order_item_id", "order_items", false, 15);
  parent("sales_ledger", "reverses_entry_id", "sales_ledger", true, 16);
  parent("payments", "parent_payment_id", "payments", true, 17);
  parent("order_attribution", "order_id", "orders", false, 18);
  parent("order_attribution", "acquisition_session_key", "sessions", true, 19);
  for (const r of c.customers) if (r.first_eligible_order_id !== null) {
    const first = indexes.orders.get(r.first_eligible_order_id);
    if (first?.customer_id !== r.customer_id || first?.eligibility_status !== "eligible" ||
        r.history_complete !== true || r.analytics_permitted !== true || r.identity_status !== "resolved" ||
        first?.paid_at !== r.first_eligible_order_at) issues.push("join_6:invalid_first_order");
    const earliest = c.orders.filter(o => o.customer_id === r.customer_id && o.eligibility_status === "eligible" && o.paid_at)
      .sort((a, b) => Date.parse(a.paid_at as string) - Date.parse(b.paid_at as string) || String(a.order_id).localeCompare(String(b.order_id)))[0];
    if (earliest?.order_id !== r.first_eligible_order_id) issues.push("join_6:not_earliest");
  }
  for (const o of c.orders) {
    if ((o.checkout_session_key !== null) !== (o.checkout_link_status === "matched") ||
        o.checkout_session_key !== null && (!o.evidence_ref || !["corroborated_checkout_id", "verified_first_party_context"].includes(o.checkout_link_method as string))) issues.push("join_8:unverified_link");
  }
  for (const l of c.sales_ledger) {
    if (l.order_item_id !== null && indexes.order_items.get(l.order_item_id)?.order_id !== l.order_id) issues.push("join_14:cross_order_allocation");
    if (l.reverses_entry_id !== null) {
      const original = indexes.sales_ledger.get(l.reverses_entry_id);
      if (!original || original.order_id !== l.order_id || original.component !== l.component ||
          original.source_currency !== l.source_currency || micros(original.source_amount as string) !== -micros(l.source_amount as string)) issues.push("join_16:invalid_reversal");
    }
  }
  for (const p of c.payments) if (p.parent_payment_id !== null) {
    const original = indexes.payments.get(p.parent_payment_id);
    if (original?.order_id !== p.order_id || original?.source_currency !== p.source_currency) issues.push("join_17:invalid_payment_parent");
  }
  for (const o of c.orders.filter(o => requireAttribution && o.eligibility_status === "eligible")) {
    const rows = c.order_attribution.filter(a => a.order_id === o.order_id && a.model_version === model);
    if (rows.length !== 1 || rows[0].credit_weight !== "1.000000000") issues.push("join_18:invalid_credit");
  }
  for (const a of c.order_attribution) {
    const order = indexes.orders.get(a.order_id);
    if (a.model_version !== model || order?.eligibility_status !== "eligible") issues.push("join_18:invalid_scope");
    if (a.acquisition_session_key !== null) {
      const s = indexes.sessions.get(a.acquisition_session_key);
      const paid = Date.parse(order?.paid_at as string), start = Date.parse(s?.started_at as string);
      if (!s || !order?.customer_id || s.customer_id !== order.customer_id || s.analytics_eligible !== true ||
          start > paid || start < paid - Number(a.lookback_days) * 86400000) issues.push("join_19:invalid_touch_window");
    }
  }
  return [...new Set(issues)];
}
export const externalJoinControls = [
  "event_customer_fk", "temporal_identity_intervals", "event_session_fk", "event_order_diagnostics",
  "native_project_uuid_lineage", "attribution_touch_event_fk", "compatible_spend_scope",
] as const;
export function certifyCandidate(c: Candidate, input: {
  publication: string; model: string; requiredTables: string[]; proofs: Reconciliation[];
  policyApprovalRef: string; externalControls: Record<string, { passed: boolean; evidenceRef: string }>;
}) {
  const issues = [...validateCandidateGraph(c, input.publication, input.model, input.requiredTables.includes("order_attribution")),
    ...reconcileCandidate(c, input.proofs, input.requiredTables)];
  if (!input.policyApprovalRef) issues.push("missing_policy_approval");
  // External controls may certify "not applicable" with independently reviewed evidence.
  for (const control of externalJoinControls) {
    const e = input.externalControls[control];
    if (!e?.passed || !e.evidenceRef) issues.push(`${control}:uncertified`);
  }
  if (!input.requiredTables.length || input.requiredTables.some(t => !contracts.tables.some(c => c.name === t))) issues.push("invalid_required_scope");
  return { certified: issues.length === 0, issues };
}
