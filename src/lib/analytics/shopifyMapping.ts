import { normalizeCommerce, type CommerceDecision, type PurchaseLine, type ShopifySnapshot } from "./commerce";
import { normalizePayment, type PaymentEvidence } from "./financial";
import { decimal, micros, nyDate } from "./primitives";
import {
  SHOPIFY_ANALYTICS_API_VERSION, shopifyId, shopifyShop, sourceArray, sourceObject, sourceString,
  type ShopifyOrderDocument, type SourceObject,
} from "./shopifySource";

export type ShopifyMappingPolicy = {
  decision: CommerceDecision;
  /** Reference to the DURABLY retained source response, not an invented approval. */
  sourceEvidenceRef: string;
  /** Approved catalog classification keyed by numeric source line ID. No tag/SKU guessing. */
  lineClasses: Readonly<Record<string, PurchaseLine["itemClass"]>>;
};
function nullableString(value: unknown): string | null {
  return value === null || value === "" ? null : sourceString(value);
}
function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") throw new Error("shopify_schema_drift");
  return value;
}
function timestamp(value: unknown): string {
  const text = sourceString(value);
  nyDate(text);
  return text;
}
function money(value: unknown, currency: string): bigint {
  const amount = sourceObject(sourceObject(value).shopMoney);
  if (amount.currencyCode !== currency) throw new Error("shopify_currency_mismatch");
  const result = micros(sourceString(amount.amount));
  if (result < BigInt(0)) throw new Error("shopify_negative_source_money");
  return result;
}
const kinds: Readonly<Record<string, PaymentEvidence["kind"]>> = {
  AUTHORIZATION: "authorization", EMV_AUTHORIZATION: "authorization",
  CAPTURE: "capture", SALE: "sale", REFUND: "refund", VOID: "void",
};
const statuses: Readonly<Record<string, PaymentEvidence["status"]>> = {
  SUCCESS: "succeeded", FAILURE: "failed", ERROR: "failed",
  PENDING: "pending", AWAITING_RESPONSE: "pending",
};
type MappedTransaction = { payment: PaymentEvidence; processedAt: string | null };
export function mapShopifyTransactions(order: SourceObject, shop: string, orderId: string, currency: string, test: boolean): MappedTransaction[] {
  const rows = sourceArray(order.transactions);
  const count = sourceObject(order.transactionsCount);
  if (count.precision !== "EXACT" || !Number.isSafeInteger(count.count) || count.count !== rows.length || rows.length > 250)
    throw new Error("shopify_incomplete_transactions");
  const ids = new Set<string>();
  const result = rows.map(value => {
    const row = sourceObject(value), id = shopifyId(row.id, "OrderTransaction");
    if (ids.has(id)) throw new Error("shopify_duplicate_transaction");
    ids.add(id);
    if (boolean(row.test) !== test) throw new Error("shopify_mixed_test_transactions");
    const kindName = sourceString(row.kind), statusName = sourceString(row.status);
    if (!Object.hasOwn(kinds, kindName) || !Object.hasOwn(statuses, statusName))
      throw new Error("shopify_unsupported_transaction");
    const gateway = sourceString(row.gateway); // Nullable upstream: unknown is not a made-up gateway.
    const parent = row.parentTransaction === null ? null : sourceObject(row.parentTransaction);
    if (parent && parent.gateway !== gateway) throw new Error("shopify_parent_gateway_mismatch");
    timestamp(row.createdAt);
    const processedAt = row.processedAt === null ? null : timestamp(row.processedAt);
    const amount = money(row.amountSet, currency);
    return { processedAt, payment: {
      shop, gateway, id, orderId, parentId: parent ? shopifyId(parent.id, "OrderTransaction") : null,
      kind: kinds[kindName], status: statuses[statusName],
      signedAmount: decimal(kindName === "REFUND" ? -amount : amount), currency,
      // SUCCESS / processedAt prove processing, not bank settlement.
      settledAt: null, settlementEvidenceRef: null, adjustmentApproved: false,
    } };
  });
  for (const { payment } of result) {
    if (payment.parentId) {
      const parent = result.find(t => t.payment.id === payment.parentId)?.payment;
      if (!parent || parent.id === payment.id || parent.gateway !== payment.gateway)
        throw new Error("shopify_missing_transaction_parent");
      if ((payment.kind === "capture" || payment.kind === "void") && parent.kind !== "authorization")
        throw new Error("shopify_invalid_transaction_parent");
      if (payment.kind === "refund" && !["capture", "sale"].includes(parent.kind))
        throw new Error("shopify_invalid_transaction_parent");
    } else if (payment.kind === "capture" || payment.kind === "refund" || payment.kind === "void") {
      throw new Error("shopify_missing_transaction_parent");
    }
  }
  return result;
}

/** Actual Admin GraphQL response -> existing workbook contracts.
 * Intentionally NOT a full Candidate or publisher. No sales-ledger or settlement
 * evidence is fabricated from an order total or a refund transaction.
 */
export function mapShopifyAnalyticsOrder(document: ShopifyOrderDocument, policy: ShopifyMappingPolicy, publication: string) {
  if (document.apiVersion !== SHOPIFY_ANALYTICS_API_VERSION) throw new Error("shopify_api_version_mismatch");
  const shop = shopifyShop(document.shop), order = sourceObject(document.order);
  const id = shopifyId(order.id, "Order"), currency = sourceString(order.currencyCode);
  if (!/^[A-Z]{3}$/.test(currency)) throw new Error("shopify_schema_drift");
  if (!policy.sourceEvidenceRef.trim() || !policy.decision.approvalRef.trim()) throw new Error("shopify_missing_policy_evidence");
  // Current post-edit lines cannot reconstruct the original purchase; tax-inclusive
  // prices cannot be treated as tax-exclusive merchandise without an allocation rule.
  if (boolean(order.edited)) throw new Error("shopify_original_purchase_snapshot_required");
  if (boolean(order.taxesIncluded)) throw new Error("shopify_tax_inclusive_mapping_required");
  const test = boolean(order.test);
  const cancelledAt = order.cancelledAt === null ? null : timestamp(order.cancelledAt);
  if (test !== (policy.decision.eligibility === "excluded_test")) throw new Error("shopify_test_policy_mismatch");
  if ((cancelledAt && !["excluded_cancelled", "pending", "excluded_test"].includes(policy.decision.eligibility)) ||
      (!cancelledAt && policy.decision.eligibility === "excluded_cancelled"))
    throw new Error("shopify_cancellation_policy_required");
  const createdAt = timestamp(order.createdAt), updatedAt = timestamp(order.updatedAt);
  if (Date.parse(updatedAt) < Date.parse(createdAt)) throw new Error("shopify_invalid_revision");
  const connection = sourceObject(order.lineItems);
  if (sourceObject(connection.pageInfo).hasNextPage !== false) throw new Error("shopify_incomplete_lines");
  const seen = new Set<string>();
  let subtotal = BigInt(0);
  const lines: PurchaseLine[] = sourceArray(connection.nodes).map(value => {
    const line = sourceObject(value), lineId = shopifyId(line.id, "LineItem");
    if (seen.has(lineId)) throw new Error("shopify_duplicate_line");
    seen.add(lineId);
    const quantity = line.quantity;
    if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity <= 0)
      throw new Error("shopify_invalid_quantity");
    const unit = money(line.originalUnitPriceSet, currency);
    const gross = money(line.originalTotalSet, currency);
    if (unit * BigInt(quantity) !== gross) throw new Error("shopify_line_total_mismatch");
    const discount = sourceArray(line.discountAllocations).reduce<bigint>(
      (sum, a) => sum + money(sourceObject(a).allocatedAmountSet, currency), BigInt(0),
    );
    if (discount > gross) throw new Error("shopify_discount_exceeds_gross");
    subtotal += gross - discount;
    const gift = boolean(line.isGiftCard);
    const approvedClass = Object.hasOwn(policy.lineClasses, lineId) ? policy.lineClasses[lineId] : "unknown";
    if (!["merchandise", "gift_card", "other", "unknown"].includes(approvedClass) ||
        (gift && !["gift_card", "unknown"].includes(approvedClass)) || (!gift && approvedClass === "gift_card"))
      throw new Error("shopify_item_class_conflict");
    const itemClass = gift ? "gift_card" : approvedClass;
    return {
      id: lineId, quantity, sku: nullableString(line.sku),
      productId: line.product === null ? null : shopifyId(sourceObject(line.product).id, "Product"),
      itemClass, unitPrice: decimal(unit), merchandiseDiscount: decimal(discount),
      purchaseEvidenceRef: policy.sourceEvidenceRef, offers: [], // Discount code != approved offer membership.
    };
  });
  if (!lines.length) throw new Error("shopify_empty_order_requires_review");
  if (subtotal !== money(order.subtotalPriceSet, currency)) throw new Error("shopify_subtotal_mismatch");
  const originalTotal = money(order.originalTotalPriceSet, currency);
  const txs = mapShopifyTransactions(order, shop, id, currency, test);
  const captures = txs.filter(t => t.payment.status === "succeeded" && ["capture", "sale"].includes(t.payment.kind));
  for (const capture of captures) {
    // Shopify transaction clocks can precede Order.createdAt. The associated
    // order and its retained revision provide the scope; createdAt is not a
    // documented lower bound for the provider's processing timestamp.
    if (capture.processedAt && Date.parse(capture.processedAt) > Date.parse(updatedAt))
      throw new Error("shopify_invalid_paid_timestamp");
  }
  const captured = captures.reduce((sum, t) => sum + micros(t.payment.signedAmount), BigInt(0));
  if (captured > originalTotal) throw new Error("shopify_overpayment_requires_review");
  const paid = !test && originalTotal > BigInt(0) && captured === originalTotal && captures.every(t => t.processedAt !== null);
  const paidAt = paid ? captures.map(t => t.processedAt!).sort((a, b) => Date.parse(a) - Date.parse(b)).at(-1)! : null;
  if (paidAt && Date.parse(paidAt) > Date.parse(updatedAt))
    throw new Error("shopify_invalid_paid_timestamp");
  const shipping = order.shippingAddress === null ? null : sourceObject(order.shippingAddress);
  const snapshot: ShopifySnapshot = {
    shop, id, currency, createdAt, updatedAt, lines, linesComplete: true, checkoutId: null,
    paidAt, paidEvidenceRef: paid ? policy.sourceEvidenceRef : null,
    shippingCountry: shipping ? nullableString(shipping.countryCodeV2) : null,
    shippingRegion: shipping ? nullableString(shipping.provinceCode) : null,
  };
  return {
    ...normalizeCommerce(snapshot, policy.decision, publication),
    payments: test ? [] : txs.map(t => normalizePayment(t.payment, publication)),
    publishable: false as const,
    source: { apiVersion: document.apiVersion, evidenceRef: policy.sourceEvidenceRef, updatedAt },
    remainingGates: [
      "sales_ledger_and_refund_allocation", "independent_settlement_evidence",
      "identity_checkout_and_offer_mapping", "live_source_reconciliation_and_publication",
    ],
  };
}
