import { RESERVE_OUTFIT_PRICE, money } from "./shopOutfit";

export type FirstBoxItem = { variantId: string; slot: "Top" | "Bottom" | "Layer"; name: string; size: string };
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

/** The subscription is the only purchased product. Order-level attributes are
 * the fulfillment authority; display-only line properties may be retained by
 * the subscription provider and must never drive renewal packing. */
export function firstBoxAttributes(items: FirstBoxItem[], subscriptionVariant: string) {
  if (items.length !== 3 || new Set(items.map(i => i.variantId)).size !== 3 ||
      new Set(items.map(i => i.slot)).size !== 3 ||
      items.some(i => !["Top","Bottom","Layer"].includes(i.slot) ||
        !/^gid:\/\/shopify\/ProductVariant\/\d+$/.test(i.variantId) ||
        i.variantId === subscriptionVariant || !i.name?.trim() || !i.size?.trim())) {
    throw new Error("Choose one top, bottom, and layer for your first shipment.");
  }
  return [
    {key:"_mully_shop_first_box",value:"v2"},
    {key:"First box",value:"Selected outfit. Future shipments are newly curated."},
    ...items.flatMap(item => [
      {key:`First box ${item.slot}`,value:`${item.name.trim()} / ${item.size.trim()} (qty 1)`.slice(0,500)},
      {key:`_first_box_${item.slot.toLowerCase()}_variant`,value:item.variantId},
    ]),
  ];
}

/** Visible checkout properties, explicitly scoped to the first shipment.
 * These are NOT separately purchased or inventory-reserving apparel lines. */
export function firstBoxDisplayAttributes(items: FirstBoxItem[], subscriptionVariant: string) {
  firstBoxAttributes(items, subscriptionVariant);
  return [
    ...items.map(item => ({
      key: `First shipment only · ${item.slot}`,
      value: `${item.name.trim()} / ${item.size.trim()}`.slice(0, 500),
    })),
    { key: "Future shipments", value: `New styles curated for you. ${money(RESERVE_OUTFIT_PRICE)} every 3 months (4x/year).` },
  ];
}

/** Verify the single Reserve product/plan and its undiscounted box price.
 * Garment inventory is irrelevant: those variants are packing instructions. */
export function assertFirstBoxCart(cart: FirstBoxCart | undefined, subscriptionVariant: string, sellingPlan: string) {
  const error = `We couldn’t confirm the ${money(RESERVE_OUTFIT_PRICE)} Reserve checkout. No checkout was opened. Please try again or contact Mully.`;
  const isMoney = (m: Money | undefined, cents: number) => m?.currencyCode === "USD" &&
    Number.isFinite(Number(m.amount)) && Math.round(Number(m.amount) * 100) === cents;
  if (!cart?.lines?.nodes || cart.lines.pageInfo.hasNextPage || cart.lines.nodes.length !== 1 ||
    !isMoney(cart.cost.subtotalAmount, Math.round(RESERVE_OUTFIT_PRICE * 100))) throw new Error(error);
  const lines = cart.lines.nodes;
  const recurring = lines.filter(l => l.sellingPlanAllocation);
  if (recurring.length !== 1 || recurring[0].merchandise.id !== subscriptionVariant ||
      recurring[0].sellingPlanAllocation?.sellingPlan.id !== sellingPlan ||
      recurring[0].quantity !== 1 || !recurring[0].merchandise.availableForSale ||
      !isMoney(recurring[0].cost.totalAmount, Math.round(RESERVE_OUTFIT_PRICE * 100))) throw new Error(error);
}
