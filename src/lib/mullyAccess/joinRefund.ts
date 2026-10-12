/**
 * Pure math for the Mully Access join-order credit.
 *
 * A shopper who adds Mully Access to a bag pays full price at checkout
 * (Shopify cannot apply a member discount before the membership exists).
 * After payment we refund the gap so the order ends up at the better of
 * its existing discount or the 10% member rate, plus the shipping paid.
 */
export interface JoinRefundLine {
  variantId: number | null;
  price: number;
  quantity: number;
  /** Discounts already applied to this line (BOGO15, codes, etc.). */
  discount: number;
  requiresShipping: boolean;
}

export interface JoinRefundQuote {
  merchandiseSubtotal: number;
  existingDiscount: number;
  memberDiscount: number;
  productRefund: number;
}

const cents = (n: number) => Math.round(n * 100) / 100;

export function quoteJoinRefund(
  lines: JoinRefundLine[],
  accessVariantId: number,
  rate: number,
): JoinRefundQuote {
  const merch = lines.filter(l => l.variantId !== accessVariantId && l.quantity > 0 && l.price > 0);
  const merchandiseSubtotal = cents(merch.reduce((t, l) => t + l.price * l.quantity, 0));
  const existingDiscount = cents(merch.reduce((t, l) => t + Math.max(0, l.discount), 0));
  const memberDiscount = cents(merchandiseSubtotal * rate);
  // Better discount wins: only refund what 10% beats the existing discount by.
  const productRefund = cents(Math.max(0, memberDiscount - existingDiscount));
  return { merchandiseSubtotal, existingDiscount, memberDiscount, productRefund };
}

/** True when the order has the Access line plus at least one real item. */
export function isJoinOrder(lines: JoinRefundLine[], accessVariantId: number): boolean {
  const hasAccess = lines.some(l => l.variantId === accessVariantId);
  const hasMerch = lines.some(l => l.variantId !== accessVariantId && l.quantity > 0 && l.price > 0);
  return hasAccess && hasMerch;
}
