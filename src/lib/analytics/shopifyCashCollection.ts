import { evidenceDigest, type EvidencePacket } from "./evidenceIntake";
import { normalizePayment, type PaymentEvidence } from "./financial";
import { key } from "./primitives";
import type { RefreshInput } from "./refreshPlan";
import { mapApprovedShopifyCash, type ShopifyCashPolicy } from "./shopifyCash";
import { mapShopifyTransactions } from "./shopifyMapping";
import { shopifyId, sourceString, type ShopifyOrderDocument } from "./shopifySource";

/** Explicit customer-payment clock decision, not a claim about bank settlement. */
export type ShopifyCashCollection = Omit<ShopifyCashPolicy, "asOf">;

/** Called only after the existing retained-evidence preflight. No source read. */
export function planCollectedShopifyCash(refresh: RefreshInput, option: ShopifyCashCollection,
  maxAgeSeconds: number, asOf: string) {
  if (!option || typeof option !== "object" || Array.isArray(option) ||
      Object.keys(option).some(k => !["clock", "approvalRef", "version", "gateways"].includes(k)) ||
      typeof option.approvalRef !== "string" || option.approvalRef.length > 512 ||
      typeof option.version !== "string" || option.version.length > 128 ||
      !Array.isArray(option.gateways) || option.gateways.some(g => typeof g !== "string"))
    throw new Error("collection_cash_policy_required");
  // Reuse the existing explicit-clock/gateway checks before any source call.
  mapApprovedShopifyCash([], { ...option, asOf });
  const packet = refresh.intake.packets.find(p => p.section === "settlements")! as EvidencePacket<"settlements">;
  const binding = refresh.intake.bindings.find(b => b.sourceId === packet.sourceId)!;
  if (Date.parse(refresh.expiresAt) - Date.parse(packet.capturedAt) > maxAgeSeconds * 1000)
    throw new Error("refresh_outlives_cash_evidence");
  const seen = new Set<string>();
  for (const p of packet.payload) {
    const id = key(p.shop, p.gateway, p.id);
    if (p.shop !== refresh.intake.scope.shop || seen.has(id)) throw new Error("collection_cash_retained_scope");
    seen.add(id);
  }
  return structuredClone({ policy: option, packet, binding });
}

/** Compose actual read transactions into the existing settlements consumer.
 * Retained authority is never silently replaced or recaptured as new evidence.
 * This function does not set coverage, controls, permission or readiness. */
export function composeCollectedShopifyCash(refresh: RefreshInput,
  plan: ReturnType<typeof planCollectedShopifyCash>, orders: ShopifyOrderDocument[],
  source: { sourceId: string; schemaVersion: string; capturedAt: string }) {
  if (evidenceDigest(refresh.intake.packets.find(p => p.section === "settlements")) !== evidenceDigest(plan.packet))
    throw new Error("collection_cash_retained_changed");
  if (orders.some(o => o.shop !== refresh.intake.scope.shop)) throw new Error("collection_cash_order_scope");
  const policy = { ...plan.policy, asOf: refresh.intake.asOf };
  const fresh = mapApprovedShopifyCash(orders, policy);
  const retained = { packet: plan.packet, binding: plan.binding };
  const payments = new Map(plan.packet.payload.map(p => [key(p.shop, p.gateway, p.id), p]));
  // A now-pending/failed/test transaction must not keep an old succeeded cash
  // row merely because the eligible-only mapper omitted the new source state.
  for (const doc of orders) for (const { payment } of mapShopifyTransactions(doc.order, doc.shop,
    shopifyId(doc.order.id, "Order"), sourceString(doc.order.currencyCode), doc.order.test === true)) {
    const prior = payments.get(key(payment.shop, payment.gateway, payment.id));
    if (!prior) continue;
    const a = normalizePayment(prior, "comparison"), b = normalizePayment(payment, "comparison");
    if (doc.order.test === true || ["order_id", "parent_payment_id", "source_amount", "source_currency",
      "transaction_kind", "transaction_status"].some(k => a[k] !== b[k]))
      throw new Error("collection_cash_conflicting_settlement");
  }
  const economic = (p: PaymentEvidence) => {
    const values = normalizePayment(p, "comparison");
    if (values.settled_at) values.settled_at = new Date(String(values.settled_at)).toISOString();
    return evidenceDigest(values);
  };
  for (const payment of fresh) {
    const id = key(payment.shop, payment.gateway, payment.id), prior = payments.get(id);
    if (prior && economic(prior) !== economic(payment)) throw new Error("collection_cash_conflicting_settlement");
    if (!prior) payments.set(id, payment); // A matching prior row keeps its original authority.
  }
  const payload = [...payments.values()];
  if (payload.length > 10000) throw new Error("collection_cash_row_budget");
  const packet: EvidencePacket<"settlements"> = {
    section: "settlements", sourceId: source.sourceId, schemaVersion: source.schemaVersion,
    scope: refresh.intake.scope, capturedAt: new Date(Math.min(
      Date.parse(source.capturedAt), Date.parse(plan.packet.capturedAt))).toISOString(),
    payload, sha256: evidenceDigest(payload),
    sourceRecordRef: `collected-cash:sha256:${evidenceDigest({ retained, orders, policy })}`,
  };
  return { packet, source: { policy, retained } };
}
