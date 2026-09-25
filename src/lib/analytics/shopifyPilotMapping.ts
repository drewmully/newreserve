import { mapShopifyAnalyticsOrder, type ShopifyMappingPolicy } from "./shopifyMapping";
import { normalizeLedger, uniqueLedger, type Movement, type Component } from "./financial";
import { decimal, micros, nyDate, type Row } from "./primitives";
import { shopifyId, sourceArray, sourceObject, sourceString, type SourceObject } from "./shopifySource";
import type { PilotSource } from "./shopifyPilotSource";
import { storeDaily, type Facts } from "./reporting";
import { validateCandidateGraph, type Candidate } from "./certification";

function amount(value: unknown): bigint {
  const m = sourceObject(sourceObject(value).shopMoney);
  if (m.currencyCode !== "USD") throw new Error("pilot_usd_only");
  const n = micros(sourceString(m.amount));
  if (n < BigInt(0)) throw new Error("negative_source_money");
  return n;
}
function complete(value: unknown): SourceObject[] {
  const c = sourceObject(value);
  if (sourceObject(c.pageInfo).hasNextPage !== false) throw new Error("pilot_incomplete_connection");
  const rows = sourceArray(c.nodes).map(sourceObject);
  if (rows.length > 100 || rows.some(r => typeof r.id !== "string" || !r.id) ||
      new Set(rows.map(r => r.id)).size !== rows.length) throw new Error("pilot_invalid_connection");
  return rows;
}
/** Explicitly reviewed pilot policy, not an inferred accounting decision.
 * Cash is always withheld; refunds use creation date only with a policy approval.
 */
export type PilotPolicy = Omit<ShopifyMappingPolicy, "sourceEvidenceRef"> & {
  financialApprovalRef: string;
  saleClock: "paid_at";
  refundClock: "refund_created_at";
};
export function mapPilotSource(source: PilotSource, policy: PilotPolicy, publication: string, evidenceRef: string) {
  if (!policy.financialApprovalRef.trim() || policy.saleClock !== "paid_at" || policy.refundClock !== "refund_created_at")
    throw new Error("pilot_financial_policy_required");
  const mapped = mapShopifyAnalyticsOrder(source.commerce, { ...policy, sourceEvidenceRef: evidenceRef }, publication);
  const order = mapped.orders[0], raw = source.commerce.order, fin = source.financial;
  const orderId = shopifyId(raw.id, "Order"), shop = source.commerce.shop;
  if (order.eligibility_status !== "eligible" || order.source_currency !== "USD" || !order.paid_at ||
      mapped.order_items.some(i => i.item_class !== "merchandise" || i.purchase_value_complete !== true))
    throw new Error("pilot_requires_paid_usd_merchandise");
  if (fin.id !== raw.id || fin.updatedAt !== raw.updatedAt || fin.currencyCode !== "USD")
    throw new Error("pilot_source_scope_mismatch");
  if ((fin.originalTotalAdditionalFeesSet !== null && amount(fin.originalTotalAdditionalFeesSet) !== BigInt(0)) ||
      amount(fin.totalTipReceivedSet) !== BigInt(0)) throw new Error("pilot_fees_or_tips_require_mapping");
  const shipping = complete(fin.shippingLines);
  const slices: Movement["slices"] = [];
  const slice = (id: string, component: Component, n: bigint, lineId: string | null = null) => ({
    id, component, amount: decimal(n), lineId,
    allocation: lineId ? "allocated" as const : "order_level" as const, reversesEntryId: null,
  });
  for (const item of mapped.order_items) {
    const id = item.source_line_id as string;
    slices.push(slice(`gross:${id}`, "merchandise_gross", micros(item.purchase_gross_usd as string), id));
    slices.push(slice(`discount:${id}`, "merchandise_discount", -micros(item.purchase_discount_usd as string), id));
  }
  for (const row of shipping) {
    shopifyId(row.id, "ShippingLine");
    slices.push(slice(`shipping:${row.id}`, "shipping_net", amount(row.discountedPriceSet)));
  }
  // Tax must be explicitly provided; nullable does not silently mean zero.
  slices.push(slice("tax", "tax_net", amount(fin.totalTaxSet)));
  slices.push(slice("duty", "duty_net", fin.originalTotalDutiesSet === null ? BigInt(0) : amount(fin.originalTotalDutiesSet)));
  const total = amount(fin.originalTotalPriceSet);
  if (total !== amount(raw.originalTotalPriceSet)) throw new Error("pilot_original_total_mismatch");
  const movements: Movement[] = [{
    shop, orderId, id: `shopify-sale:${orderId}`, effectiveAt: order.paid_at as string, currency: "USD",
    sourceTotal: decimal(total), evidenceRef, kind: "sale", salesEligible: true, slices,
  }];
  const expectedRefunds = sourceArray(fin.refunds).map(sourceObject);
  if (expectedRefunds.length !== source.refunds.length || new Set(source.refunds.map(r => r.id)).size !== source.refunds.length)
    throw new Error("pilot_refund_set_mismatch");
  const allRefundTransactions = new Set<string>();
  const refundedQuantities = new Map<string, number>();
  const refundedAmounts = new Map<string, bigint>();
  for (const refund of source.refunds) {
    const id = shopifyId(refund.id, "Refund");
    const reference = expectedRefunds.find(r => r.id === refund.id);
    if (!reference || reference.updatedAt !== refund.updatedAt || sourceObject(refund.order).id !== raw.id)
      throw new Error("pilot_refund_set_mismatch");
    if (complete(refund.orderAdjustments).length || (refund.duties !== null && sourceArray(refund.duties).length))
      throw new Error("pilot_refund_adjustments_or_duties_unsupported");
    const effectiveAt = sourceString(refund.createdAt); nyDate(effectiveAt);
    if (Date.parse(effectiveAt) < Date.parse(order.paid_at as string) || Date.parse(effectiveAt) > Date.parse(raw.updatedAt as string))
      throw new Error("pilot_refund_clock_invalid");
    const parts: Movement["slices"] = [];
    for (const line of complete(refund.refundLineItems)) {
      const lineId = shopifyId(sourceObject(line.lineItem).id, "LineItem");
      const original = mapped.order_items.find(i => i.source_line_id === lineId);
      if (!original || !Number.isSafeInteger(line.quantity) || (line.quantity as number) <= 0)
        throw new Error("pilot_refund_line_invalid");
      const quantity = (refundedQuantities.get(lineId) ?? 0) + (line.quantity as number);
      const net = (refundedAmounts.get(lineId) ?? BigInt(0)) + amount(line.subtotalSet);
      if (BigInt(quantity) * BigInt(1000000) > micros(original.quantity as string) ||
          net > micros(original.purchase_net_usd as string)) throw new Error("pilot_refund_exceeds_purchase");
      refundedQuantities.set(lineId, quantity); refundedAmounts.set(lineId, net);
      parts.push(slice(`line:${line.id}`, "merchandise_refund", -amount(line.subtotalSet), lineId));
      parts.push(slice(`tax:${line.id}`, "tax_net", -amount(line.totalTaxSet)));
    }
    for (const line of complete(refund.refundShippingLines)) {
      if (!shipping.some(s => s.id === sourceObject(line.shippingLine).id)) throw new Error("pilot_refund_shipping_unknown");
      parts.push(slice(`shipping:${line.id}`, "shipping_net", -amount(line.subtotalAmountSet)));
      parts.push(slice(`shipping-tax:${line.id}`, "tax_net", -amount(line.taxAmountSet)));
    }
    const transactions = complete(refund.transactions);
    const expected = amount(refund.totalRefundedSet);
    let processed = BigInt(0);
    for (const tx of transactions) {
      const tid = shopifyId(tx.id, "OrderTransaction");
      const original = sourceArray(raw.transactions).map(sourceObject).find(t => t.id === tx.id);
      if (!original || tx.kind !== "REFUND" || tx.status !== "SUCCESS" || original.kind !== tx.kind ||
          original.status !== tx.status || amount(original.amountSet) !== amount(tx.amountSet) ||
          original.processedAt !== tx.processedAt || allRefundTransactions.has(tid))
        throw new Error("pilot_refund_payment_unproven");
      nyDate(sourceString(tx.processedAt));
      // Provider processing can precede creation of the Shopify refund record.
      // Keep the matched transaction's clock distinct from the approved ledger
      // clock; neither a tolerance nor a rewritten timestamp is appropriate.
      if (Date.parse(tx.processedAt as string) > Date.parse(raw.updatedAt as string))
        throw new Error("pilot_refund_clock_invalid");
      allRefundTransactions.add(tid); processed += amount(tx.amountSet);
    }
    if (!transactions.length || processed !== expected || expected <= BigInt(0))
      throw new Error("pilot_refund_payment_unproven");
    movements.push({ shop, orderId, id: `shopify-refund:${id}`, effectiveAt, currency: "USD",
      sourceTotal: decimal(-expected), evidenceRef, kind: "refund", salesEligible: true, slices: parts });
  }
  const successfulRefunds = sourceArray(raw.transactions).map(sourceObject).filter(t => t.kind === "REFUND" && t.status === "SUCCESS");
  if (successfulRefunds.some(t => !allRefundTransactions.has(shopifyId(t.id, "OrderTransaction"))))
    throw new Error("pilot_unallocated_refund");
  for (const component of ["tax_net", "shipping_net"] as const) {
    const sold = slices.filter(s => s.component === component).reduce((n, s) => n + micros(s.amount), BigInt(0));
    const refunded = movements.slice(1).flatMap(m => m.slices).filter(s => s.component === component)
      .reduce((n, s) => n - micros(s.amount), BigInt(0));
    if (refunded > sold) throw new Error("pilot_refund_exceeds_purchase");
  }
  const facts: Candidate = {
    customers: [], identity_map: [], orders: mapped.orders, order_items: mapped.order_items,
    order_item_offers: [], sales_ledger: uniqueLedger(movements.flatMap(m => normalizeLedger(m, publication))),
    payments: mapped.payments, sessions: [], marketing_spend_daily: [], order_attribution: [],
  };
  if (validateCandidateGraph(facts, publication, "pilot-no-attribution", false).length) throw new Error("pilot_invalid_fact_graph");
  const dates = new Set<string>([order.purchase_date as string, ...facts.sales_ledger.map(r => r.report_date as string)]);
  const reports: Row[] = [...dates].sort().map(date => storeDaily(facts as Facts, {
    shop, publication, definition: "shopify-pilot-v1", model: "pilot-no-attribution", date, stale: false,
    gates: { ledger: true, cash: false, orders: true, purchase: true, customers: false,
      spend: false, attribution: false, behavior: false, productAllocation: true },
  }));
  return { facts, reports, sourceTotals: movements.map(m => ({ id: m.id, total: m.sourceTotal })),
    certification: "unverified" as const, sampleScope: "single_order" as const };
}
