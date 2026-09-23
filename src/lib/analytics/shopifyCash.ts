import { evidenceDigest } from "./evidenceIntake";
import { normalizePayment, type PaymentEvidence } from "./financial";
import { mapShopifyTransactions } from "./shopifyMapping";
import { nyDate } from "./primitives";
import { SHOPIFY_ANALYTICS_API_VERSION, shopifyId, shopifyShop, sourceString,
  type ShopifyOrderDocument } from "./shopifySource";

export type ShopifyCashPolicy = {
  /** Workbook cash is customer payment cash, not fee-net bank deposits.
   * This clock is available ONLY if the owner explicitly approves success time
   * as its definition. Otherwise continue using independent settlement evidence.
   */
  clock: "approved_successful_transaction_processed_at";
  approvalRef: string; version: string; gateways: string[]; asOf: string;
};
export function mapApprovedShopifyCash(documents: ShopifyOrderDocument[], policy: ShopifyCashPolicy): PaymentEvidence[] {
  if (policy.clock !== "approved_successful_transaction_processed_at" || !policy.approvalRef.trim() ||
      !policy.version.trim() || !policy.gateways.length || policy.gateways.length > 20 ||
      policy.gateways.some(g => !g.trim() || g.length > 128) ||
      new Set(policy.gateways).size !== policy.gateways.length || documents.length > 100)
    throw new Error("cash_policy_required");
  nyDate(policy.asOf);
  const seen = new Set<string>();
  return documents.flatMap(doc => {
    const shop = shopifyShop(doc.shop), orderId = shopifyId(doc.order.id, "Order");
    const key = JSON.stringify([shop, orderId]);
    if (seen.has(key)) throw new Error("cash_duplicate_order"); seen.add(key);
    if (doc.apiVersion !== SHOPIFY_ANALYTICS_API_VERSION || typeof doc.order.test !== "boolean")
      throw new Error("cash_source_contract");
    const currency = sourceString(doc.order.currencyCode);
    if (!/^[A-Z]{3}$/.test(currency)) throw new Error("cash_source_currency");
    const createdAt = sourceString(doc.order.createdAt), updatedAt = sourceString(doc.order.updatedAt);
    nyDate(createdAt); nyDate(updatedAt);
    if (Date.parse(updatedAt) < Date.parse(createdAt) || Date.parse(updatedAt) > Date.parse(policy.asOf))
      throw new Error("cash_source_revision");
    const transactions = mapShopifyTransactions(doc.order, shop, orderId, currency, doc.order.test);
    if (doc.order.test) return [];
    const sourceHash = evidenceDigest(doc), policyHash = evidenceDigest(policy);
    return transactions.filter(t => t.payment.status === "succeeded" &&
      ["sale", "capture", "refund"].includes(t.payment.kind)).map(t => {
      // A new/unknown gateway must not silently disappear from collected cash.
      if (!policy.gateways.includes(t.payment.gateway)) throw new Error("cash_unapproved_gateway");
      if (!t.processedAt || Date.parse(t.processedAt) < Date.parse(createdAt) ||
          Date.parse(t.processedAt) > Date.parse(updatedAt)) throw new Error("cash_processed_time_required");
      const result = { ...t.payment, settledAt: t.processedAt,
        settlementEvidenceRef: `shopify-success-policy:sha256:${policyHash}:source:${sourceHash}` };
      normalizePayment(result, "source-validation");
      return result;
    });
  });
}
