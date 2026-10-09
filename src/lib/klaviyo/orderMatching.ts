/**
 * Conservative, order-scoped lifecycle matching.
 *
 * No profile booleans, customer emails, consent writes or event sends. These
 * decisions are audit candidates, NOT permission to release a flow. A fresh
 * refund/cancellation read, service ownership, native membership coverage and
 * explicit launch approval are still required at dispatch.
 */
import { resolveMemberTierFromVariantId } from "@/lib/membershipConfig";

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => v !== null && typeof v === "object" && !Array.isArray(v) ? v as Bag : {};
export function shopifyId(v: unknown, resource?: string): string | null {
  if (typeof v === "number") return Number.isSafeInteger(v) && v > 0 ? String(v) : null;
  if (typeof v !== "string") return null;
  const match = v.trim().match(/^(?:gid:\/\/shopify\/([A-Za-z]+)\/)?([1-9]\d*)$/);
  if (!match || (resource && match[1] && match[1] !== resource)) return null;
  return match[2];
}
const count = (v: unknown) => typeof v === "number" && Number.isSafeInteger(v) && v > 0 ? v : null;
const subscriptionSkus = new Set(["RES-MEM", "RES-ACC", "BCK-9"]);
export type OrderKind = "shop" | "subscription" | "mixed" | "unknown";
export interface OrderMatch {
  orderId: string | null;
  kind: OrderKind;
  paidCandidate: boolean;
  reason: string;
  shippingLines: Array<{ id: string; quantity: number }>;
}

export function classifyPaidOrder(value: unknown): OrderMatch {
  const order = bag(value);
  const orderId = shopifyId(order.id, "Order");
  const hold = (reason: string, kind: OrderKind = "unknown"): OrderMatch =>
    ({ orderId, kind, paidCandidate: false, reason, shippingLines: [] });
  if (!orderId) return hold("missing_order_id");
  if (order.test !== false) return hold("test_status_unverified");
  if (order.cancelled_at) return hold("cancelled");
  if (order.cancelled_at !== null) return hold("cancel_state_unverified");
  if (order.financial_status !== "paid") return hold("not_fully_paid");
  if (!Number.isFinite(Number(order.total_price)) || Number(order.total_price) <= 0) return hold("no_positive_payment");
  if (!Array.isArray(order.refunds)) return hold("refund_state_unverified");
  if (order.refunds.length) return hold("refund_present");
  if (!Array.isArray(order.line_items) || !order.line_items.length) return hold("missing_lines");
  const source = typeof order.source_name === "string" ? order.source_name : "";
  const recurring = source === "subscription_contract_checkout_one";
  // Only known store checkout channels establish one-time commerce. Unknown
  // integrations/draft orders must not become shop orders through absence alone.
  const shopSource = source === "web" || source === "channel:7831744";
  let subscription = 0, shop = 0;
  const shippingLines: OrderMatch["shippingLines"] = [];
  const lineIds = new Set<string>();
  for (const raw of order.line_items) {
    const line = bag(raw), id = shopifyId(line.id, "LineItem"), quantity = count(line.quantity);
    if (!id || !quantity || lineIds.has(id)) return hold("invalid_or_duplicate_line");
    lineIds.add(id);
    if (line.gift_card === true) return hold("gift_card_requires_separate_handling");
    const allocation = bag(line.selling_plan_allocation);
    const variantId = shopifyId(line.variant_id, "ProductVariant");
    if (line.variant_id != null && !variantId) return hold("variant_identity_unverified");
    const planValues = [line.selling_plan_id, allocation.selling_plan_id, bag(allocation.selling_plan).id];
    if (planValues.some(v => v != null && !shopifyId(v, "SellingPlan")) ||
      (line.selling_plan_allocation != null && !planValues.some(v => shopifyId(v, "SellingPlan")))) {
      return hold("selling_plan_unverified");
    }
    const hasSubscription = !!resolveMemberTierFromVariantId(variantId) ||
      subscriptionSkus.has(String(line.sku ?? "").trim().toUpperCase()) ||
      !!shopifyId(line.selling_plan_id, "SellingPlan") || !!shopifyId(allocation.selling_plan_id, "SellingPlan") ||
      !!shopifyId(bag(allocation.selling_plan).id, "SellingPlan");
    if (hasSubscription || recurring) subscription++;
    else if (shopSource && variantId) shop++;
    else return hold("unclassified_line");
    if (line.requires_shipping === true) shippingLines.push({ id, quantity });
    else if (line.requires_shipping !== false) return hold("shipping_requirement_unverified");
  }
  const kind: OrderKind = subscription && shop ? "mixed" : subscription ? "subscription" : "shop";
  return {
    orderId, kind, paidCandidate: kind !== "mixed",
    reason: kind === "mixed" ? "mixed_order_manual_review" : "paid_snapshot_classified",
    shippingLines,
  };
}

export interface DeliveryMatch {
  orderId: string | null;
  kind: OrderKind;
  complete: boolean;
  reason: string;
  fulfillmentIds: string[];
}

/** All fulfillment updates for the exact order, including non-delivered updates.
 * Retain the newest snapshot per fulfillment ID; never count a duplicate twice.
 */
export function matchOrderDelivery(orderValue: unknown, fulfillmentValues: unknown[]): DeliveryMatch {
  const order = classifyPaidOrder(orderValue);
  const result = (complete: boolean, reason: string, fulfillmentIds: string[] = []): DeliveryMatch =>
    ({ orderId: order.orderId, kind: order.kind, complete, reason, fulfillmentIds });
  if (!order.paidCandidate) return result(false, order.reason);
  if (!order.shippingLines.length) return result(false, "no_shippable_lines");
  const shipments = new Map<string, Bag>();
  for (const value of fulfillmentValues) {
    const f = bag(value);
    if (shopifyId(f.order_id, "Order") !== order.orderId) continue; // Never match by email.
    const id = shopifyId(f.id, "Fulfillment");
    const time = Date.parse(String(f.updated_at ?? ""));
    if (!id || !Number.isFinite(time)) return result(false, "unidentified_fulfillment");
    const previous = shipments.get(id);
    const previousTime = previous ? Date.parse(String(previous.updated_at)) : -Infinity;
    if (previous && time === previousTime && JSON.stringify(previous) !== JSON.stringify(f)) {
      return result(false, "conflicting_fulfillment_snapshot");
    }
    if (!previous || time > previousTime) shipments.set(id, f);
  }
  const quantities = new Map<string, number>();
  const used: string[] = [];
  const wanted = new Map(order.shippingLines.map(l => [l.id, l.quantity]));
  for (const [id, f] of shipments) {
    if (f.shipment_status !== "delivered" || f.status !== "success") continue;
    if (!Array.isArray(f.line_items) || !f.line_items.length) return result(false, "missing_fulfillment_lines");
    const seen = new Set<string>();
    for (const value of f.line_items) {
      const line = bag(value), lineId = shopifyId(line.id, "LineItem"), quantity = count(line.quantity);
      if (!lineId || !quantity || seen.has(lineId) || !wanted.has(lineId)) return result(false, "fulfillment_line_mismatch");
      seen.add(lineId);
      quantities.set(lineId, (quantities.get(lineId) ?? 0) + quantity);
    }
    used.push(id);
  }
  if ([...quantities].some(([id, q]) => q > wanted.get(id)!)) return result(false, "overlapping_fulfillment_quantities");
  if (order.shippingLines.some(l => quantities.get(l.id) !== l.quantity)) return result(false, "partial_or_missing_delivery", used);
  return result(true, "exact_order_all_shipping_lines_delivered", used.sort());
}
