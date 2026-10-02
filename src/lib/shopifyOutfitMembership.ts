import { normalizeShopifyNumericId, SHOPIFY_OUTFIT_SUBSCRIPTION } from "./membershipConfig";

/** A paid-order receipt, not a cached assertion that a contract is still active.
 * Shopify owns contract status, renewal dates, payment changes and cancellation. */
export interface ShopifyOutfitMembership {
  provider: "shopify";
  variant_id: number;
  order_id: string;
  paid_at: string;
  /** Original unit price on the paid order, before discounts, tax or shipping.
   * Not the amount charged and not a live contract renewal price. */
  amount: string;
  currency: string;
}

export function outfitMembershipFromPaidOrder(order: {
  id: number | string;
  processed_at?: string | null;
  created_at?: string | null;
  currency: string;
  line_items: Array<{ variant_id: unknown; quantity: number; price: string }>;
}): ShopifyOutfitMembership | null {
  const line = order.line_items.find(item =>
    normalizeShopifyNumericId(item.variant_id) === SHOPIFY_OUTFIT_SUBSCRIPTION.variantId &&
    item.quantity > 0
  );
  if (!line || !Number.isFinite(Number(line.price)) || Number(line.price) <= 0) return null;
  // Use the order timestamp, not webhook arrival time, so delayed deliveries
  // don't imply a new charge or move the customer's paid date.
  const date = order.processed_at || order.created_at;
  if (!date || !Number.isFinite(Date.parse(date))) return null;
  return {
    provider: "shopify",
    variant_id: SHOPIFY_OUTFIT_SUBSCRIPTION.variantId,
    order_id: String(order.id),
    paid_at: new Date(date).toISOString(),
    amount: Number(line.price).toFixed(2),
    currency: order.currency,
  };
}

export function readShopifyOutfitMembership(value: unknown): ShopifyOutfitMembership | null {
  if (!value || typeof value !== "object") return null;
  const v = value as Partial<ShopifyOutfitMembership>;
  if (v.provider !== "shopify" || v.variant_id !== SHOPIFY_OUTFIT_SUBSCRIPTION.variantId ||
      typeof v.order_id !== "string" || !v.order_id ||
      typeof v.paid_at !== "string" || !Number.isFinite(Date.parse(v.paid_at)) ||
      typeof v.amount !== "string" || !Number.isFinite(Number(v.amount)) ||
      Number(v.amount) <= 0 || typeof v.currency !== "string" || !/^[A-Z]{3}$/.test(v.currency)) return null;
  return v as ShopifyOutfitMembership;
}
