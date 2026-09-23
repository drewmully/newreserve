import { checked, decimal, key, micros, nyDate, type Row } from "./primitives";
export const components = ["merchandise_gross", "merchandise_discount", "merchandise_refund",
  "shipping_net", "tax_net", "duty_net", "other_sales_adjustment", "fee"] as const;
export type Component = typeof components[number];
export type Movement = {
  shop: string; id: string; orderId: string; effectiveAt: string;
  currency: string; sourceTotal: string; evidenceRef: string;
  kind: "sale" | "discount" | "refund" | "adjustment" | "reversal";
  salesEligible: boolean;
  slices: { id: string; component: Component; amount: string; lineId: string | null;
    allocation: "allocated" | "order_level" | "unresolved" | "not_applicable"; reversesEntryId: string | null }[];
};
/** Every source movement is allocated once into exclusive, reconciling slices. */
export function normalizeLedger(m: Movement, publication: string, prior: Row[] = []): Row[] {
  if (!m.evidenceRef || !m.slices.length || !components.length) throw new Error("missing_movement_evidence");
  const keys = new Set<string>();
  const total = m.slices.reduce((n, s) => n + micros(s.amount), BigInt(0));
  if (total !== micros(m.sourceTotal)) throw new Error("allocation_does_not_reconcile");
  return m.slices.map(s => {
    if (keys.has(s.id) || !components.includes(s.component)) throw new Error("duplicate_or_unknown_slice");
    keys.add(s.id);
    const amount = micros(s.amount);
    const orderId = key(m.shop, m.orderId);
    if ((s.allocation === "allocated") !== (s.lineId !== null)) throw new Error("invalid_item_allocation");
    if (m.kind !== "reversal" && m.kind !== "adjustment") {
      if (["merchandise_discount", "merchandise_refund"].includes(s.component) && amount > BigInt(0)) throw new Error("invalid_component_sign");
      if (s.component === "merchandise_gross" && amount < BigInt(0)) throw new Error("invalid_component_sign");
    }
    if (m.kind === "reversal") {
      const original = prior.find(p => p.ledger_entry_id === s.reversesEntryId && p.publication_id === publication);
      if (!original || original.order_id !== orderId || original.component !== s.component ||
          original.source_currency !== m.currency || micros(original.source_amount as string) !== -amount ||
          original.order_item_id !== (s.lineId ? key(m.shop, m.orderId, s.lineId) : null)) throw new Error("invalid_reversal");
    } else if (s.reversesEntryId !== null) throw new Error("unexpected_reversal_link");
    return checked("sales_ledger", {
      ledger_entry_id: key(m.shop, m.id, s.component, s.id), source_movement_id: key(m.shop, m.id),
      order_id: orderId, order_item_id: s.lineId ? key(m.shop, m.orderId, s.lineId) : null,
      component: s.component, movement_kind: m.kind, effective_at: m.effectiveAt, report_date: nyDate(m.effectiveAt),
      source_amount: decimal(amount), source_currency: m.currency, report_currency: "USD",
      amount_usd: m.currency === "USD" ? decimal(amount) : null, sales_eligible: m.salesEligible,
      product_allocation_status: s.allocation, reverses_entry_id: s.reversesEntryId, publication_id: publication,
    });
  });
}
/** Duplicate transport arrivals cannot create a second financial movement. */
export function uniqueLedger(rows: Row[]): Row[] {
  const selected = new Map<string, Row>();
  const reversals = new Set<string>();
  for (const row of rows) {
    const k = key(String(row.publication_id), String(row.ledger_entry_id));
    const prior = selected.get(k);
    if (prior && JSON.stringify(prior) !== JSON.stringify(row)) throw new Error("conflicting_ledger_evidence");
    if (!prior && row.reverses_entry_id) {
      const reverseKey = key(String(row.publication_id), String(row.reverses_entry_id));
      if (reversals.has(reverseKey)) throw new Error("duplicate_reversal");
      reversals.add(reverseKey);
    }
    selected.set(k, row);
  }
  return [...selected.values()];
}
export type PaymentEvidence = {
  shop: string; gateway: string; id: string; orderId: string; parentId: string | null;
  kind: "authorization" | "capture" | "sale" | "refund" | "void" | "chargeback" | "adjustment";
  status: "pending" | "succeeded" | "failed" | "cancelled";
  signedAmount: string; currency: string; settledAt: string | null; settlementEvidenceRef: string | null;
  adjustmentApproved: boolean;
};
export function normalizePayment(p: PaymentEvidence, publication: string): Row {
  const amount = micros(p.signedAmount);
  if (["capture", "sale"].includes(p.kind) && amount < BigInt(0) ||
      ["refund", "chargeback"].includes(p.kind) && amount > BigInt(0)) throw new Error("invalid_cash_sign");
  const eligibleKind = ["capture", "sale", "refund", "chargeback"].includes(p.kind) ||
    p.kind === "adjustment" && p.adjustmentApproved;
  const settled = !!p.settledAt && !!p.settlementEvidenceRef && p.status === "succeeded" && eligibleKind;
  return checked("payments", {
    payment_id: key(p.shop, p.gateway, p.id), source_transaction_id: p.id, order_id: key(p.shop, p.orderId),
    parent_payment_id: p.parentId ? key(p.shop, p.gateway, p.parentId) : null,
    transaction_kind: p.kind, transaction_status: p.status,
    settled_at: settled ? p.settledAt : null, report_date: settled ? nyDate(p.settledAt!) : null,
    source_amount: decimal(amount), source_currency: p.currency, report_currency: "USD",
    cash_amount_usd: settled && p.currency === "USD" ? decimal(amount) : null,
    cash_eligible: settled, publication_id: publication,
  });
}
