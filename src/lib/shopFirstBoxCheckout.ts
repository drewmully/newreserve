import { RESERVE_OUTFIT_PRICE } from "./shopOutfit";

export type FirstBoxItem = { variantId: string; slot: "Top" | "Bottom" | "Layer" };
type Money = { amount: string; currencyCode: string };
type VerifiedLine = {
  quantity: number;
  merchandise: { id: string; availableForSale: boolean };
  sellingPlanAllocation: { sellingPlan: { id: string } } | null;
  cost: { totalAmount: Money };
};
export type FirstBoxCart = {
  cost: { subtotalAmount: Money };
  lines: { nodes: VerifiedLine[]; pageInfo: { hasNextPage: boolean } };
};

/** These are separate, one-time merchandise lines. Never put selections on
 * the recurring line: subscription apps can retain its properties on renewal. */
export function firstBoxLines(items: FirstBoxItem[], subscriptionVariant: string) {
  if (items.length !== 3 || new Set(items.map(i => i.variantId)).size !== 3 ||
      new Set(items.map(i => i.slot)).size !== 3 ||
      items.some(i => !["Top","Bottom","Layer"].includes(i.slot) ||
        !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(i.variantId) ||
        i.variantId === subscriptionVariant)) {
    throw new Error("Choose one top, bottom, and layer for your first shipment.");
  }
  return items.map(item => ({
    merchandiseId: item.variantId, quantity: 1,
    attributes: [
      { key: "Shipment", value: "First box only" },
      { key: "Outfit piece", value: item.slot },
    ],
    // Intentionally no sellingPlanId.
  }));
}

/** Fail closed. A UI estimate or a cart's existence is not proof of pricing.
 * Shopify must apply the merchant's conditional first-box discount itself. */
export function assertFirstBoxCart(cart: FirstBoxCart | undefined, items: FirstBoxItem[], subscriptionVariant: string, sellingPlan: string) {
  const error = "We couldn’t confirm the $250 first-box offer. No checkout was opened. Please contact Mully or buy your outfit once.";
  const isMoney = (m: Money | undefined, cents: number) => m?.currencyCode === "USD" &&
    Number.isFinite(Number(m.amount)) && Math.round(Number(m.amount) * 100) === cents;
  if (!cart || cart.lines.pageInfo.hasNextPage || cart.lines.nodes.length !== 4 ||
    !isMoney(cart.cost.subtotalAmount, RESERVE_OUTFIT_PRICE * 100)) throw new Error(error);
  const lines = cart.lines.nodes;
  const recurring = lines.filter(l => l.sellingPlanAllocation);
  if (recurring.length !== 1 || recurring[0].merchandise.id !== subscriptionVariant ||
      recurring[0].sellingPlanAllocation?.sellingPlan.id !== sellingPlan ||
      recurring[0].quantity !== 1 || !recurring[0].merchandise.availableForSale ||
      !isMoney(recurring[0].cost.totalAmount, RESERVE_OUTFIT_PRICE * 100)) throw new Error(error);
  for (const item of items) {
    const matches = lines.filter(l => l.merchandise.id === item.variantId);
    if (matches.length !== 1 || matches[0].quantity !== 1 || matches[0].sellingPlanAllocation ||
      !matches[0].merchandise.availableForSale || !isMoney(matches[0].cost.totalAmount, 0)) throw new Error(error);
  }
}
