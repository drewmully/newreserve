/**
 * True when nothing in `variants` can ship from stock now but at least one
 * variant can still be ordered for restock (continue-selling with quantity
 * at or below zero). Used on cards so a "Restocking" label never appears on a
 * product or color that still has units on hand.
 *
 * Plain module (no "use client") so server components can call it too.
 */
export function isRestockOnly(variants: Array<{ availableForSale: boolean; currentlyNotInStock?: boolean } | null | undefined>): boolean {
  const list = variants.filter((v): v is { availableForSale: boolean; currentlyNotInStock?: boolean } => !!v);
  const inStock = list.some(v => v.availableForSale && !v.currentlyNotInStock);
  return !inStock && list.some(v => v.availableForSale && v.currentlyNotInStock === true);
}
