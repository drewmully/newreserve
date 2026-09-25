import { evidenceDigest, type EvidencePacket } from "./evidenceIntake";
import type { RefreshInput } from "./refreshPlan";
import { shopifyId, sourceObject, type ShopifyOrderDocument } from "./shopifySource";
import { mapShopifyAgreements, type AgreementDocument, type AgreementPolicy } from "./shopifyAgreements";
import { deferredOrders } from "./deferredCommerce";

export type OriginalPurchaseInput = { orderGid: string; document: AgreementDocument; policy: AgreementPolicy };
export type OriginalPurchaseCollection = { maxRequestsPerOrder: number;
  orders: { orderGid: string; policy: Omit<AgreementPolicy, "sourceEvidenceRef"> }[] };
export function validateOriginalPurchaseCollection(value: unknown, maxOrders: number): OriginalPurchaseCollection {
  const config = sourceObject(value);
  if (Object.keys(config).some(k => !["maxRequestsPerOrder", "orders"].includes(k)) ||
      !Number.isSafeInteger(config.maxRequestsPerOrder) || Number(config.maxRequestsPerOrder) < 2 ||
      Number(config.maxRequestsPerOrder) > 100 || !Array.isArray(config.orders) ||
      !config.orders.length || config.orders.length > maxOrders)
    throw new Error("collection_original_purchase_budget");
  const seen = new Set<string>();
  for (const raw of config.orders) {
    const item = sourceObject(raw), policy = sourceObject(item.policy), decision = sourceObject(policy.decision);
    shopifyId(item.orderGid, "Order");
    if (Object.keys(item).some(k => !["orderGid", "policy"].includes(k)) || seen.has(String(item.orderGid)))
      throw new Error("collection_original_purchase_target");
    seen.add(String(item.orderGid));
    const classes = sourceObject(policy.lineClasses);
    if (Object.keys(policy).some(k => !["decision", "lineClasses", "financialApprovalRef", "saleClock", "changeClock"].includes(k)) ||
        typeof policy.financialApprovalRef !== "string" || !policy.financialApprovalRef.trim() ||
        policy.saleClock !== "paid_at" || policy.changeClock !== "agreement_happened_at" ||
        typeof decision.approvalRef !== "string" || !decision.approvalRef.trim() || decision.eligibility !== "eligible" ||
        !["storefront", "subscription_renewal", "other"].includes(String(decision.commerceSource)) ||
        typeof decision.acquisitionEligible !== "boolean" || !Object.keys(classes).length ||
        Object.keys(classes).length > 1000 || Object.entries(classes).some(([id, kind]) => !/^[1-9]\d*$/.test(id) || kind !== "merchandise"))
      throw new Error("collection_original_purchase_policy");
  }
  return config as OriginalPurchaseCollection;
}
/** Neither preparation path may silently discard a reviewed financial packet. */
export function requireEmptyOriginalPurchaseEvidence(refresh: RefreshInput) {
  const prior = refresh.intake.packets.find(p => p.section === "replacements");
  if (!prior || !Array.isArray(prior.payload) || prior.payload.length)
    throw new Error("mully_existing_replacements_require_review");
  if (deferredOrders(refresh.commercePolicy.deferredOrders).length)
    throw new Error("mully_existing_deferred_orders_require_review");
}
/** Shared pure packet transform; deliberately does not touch identity, consent,
 * history, offers, settlements, independent controls, bindings or source reads. */
export function prepareOriginalPurchases(refresh: RefreshInput, orders: ShopifyOrderDocument[],
  items: OriginalPurchaseInput[], binding: { sourceId: string; schemaVersion: string }) {
  if (!Array.isArray(items) || !items.length || items.length > 100)
    throw new Error("mully_original_purchase_budget");
  requireEmptyOriginalPurchaseEvidence(refresh);
  const byId = new Map(orders.map(order => [String(order.order.id), order])), seen = new Set<string>();
  const payload = items.map(item => {
    if (seen.has(item.orderGid)) throw new Error("mully_duplicate_original_purchase");
    seen.add(item.orderGid);
    const order = byId.get(item.orderGid);
    if (!order) throw new Error("mully_original_purchase_scope");
    return mapShopifyAgreements(order, item.document, item.policy);
  });
  const packet: EvidencePacket<"replacements"> = { section: "replacements", ...binding,
    sourceRecordRef: `shopify-agreements:sha256:${evidenceDigest(items.map(v => v.document))}`,
    scope: refresh.intake.scope,
    capturedAt: new Date(Math.min(...items.map(v => Date.parse(v.document.capturedAt)))).toISOString(),
    sha256: evidenceDigest(payload), payload };
  const deferredOrders = items.map(item => ({ orderGid: item.orderGid,
    sourceUpdatedAt: item.document.sourceUpdatedAt, evidenceRef: item.policy.sourceEvidenceRef }));
  return { packet, deferredOrders };
}
