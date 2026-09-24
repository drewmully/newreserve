import type { FullBuildEvidence } from "./fullReportBuild";
import { key } from "./primitives";
import { shopifyId, shopifyShop, sourceObject, type ShopifyOrderDocument } from "./shopifySource";
export type OfferRegistry = {
  shop: string; attributeKey: string; mappingVersion: string; approvalRef: string;
  values: Record<string, { offerId: string; evidenceRef: string }>;
};
/** Only a reviewed line-level attribute map is authoritative. Product names,
 * SKUs, cart-level discounts and campaign UTMs never imply offer membership. */
export function mapShopifyOffers(orders: ShopifyOrderDocument[], registry: OfferRegistry): FullBuildEvidence["offers"] {
  shopifyShop(registry.shop);
  if (!registry.approvalRef?.trim() || !registry.mappingVersion?.trim() ||
      !/^[A-Za-z0-9_-]{1,100}$/.test(registry.attributeKey) ||
      Object.keys(registry.values).length > 1000 || orders.length > 100)
    throw new Error("offer_registry_invalid");
  for (const [value, entry] of Object.entries(registry.values))
    if (!value.trim() || value.length > 256 || !entry.offerId?.trim() || entry.offerId.length > 200 ||
        !entry.evidenceRef?.trim() || entry.evidenceRef.length > 512) throw new Error("offer_registry_invalid");
  const result: FullBuildEvidence["offers"] = [], seen = new Set<string>();
  for (const doc of orders) {
    if (doc.shop !== registry.shop) throw new Error("offer_shop_mismatch");
    const connection = sourceObject(doc.order.lineItems);
    if (!Array.isArray(connection.nodes) || sourceObject(connection.pageInfo).hasNextPage !== false)
      throw new Error("offer_lines_incomplete");
    for (const raw of connection.nodes) {
      const line = sourceObject(raw), id = key(doc.shop, shopifyId(doc.order.id, "Order"), shopifyId(line.id, "LineItem"));
      if (seen.has(id)) throw new Error("offer_duplicate_line"); seen.add(id);
      if (!Array.isArray(line.customAttributes)) throw new Error("offer_attributes_not_selected");
      const matches = line.customAttributes.map(sourceObject).filter(a => a.key === registry.attributeKey);
      if (matches.length > 1) throw new Error("offer_conflicting_attributes");
      if (!matches.length) continue;
      const value = matches[0].value;
      if (typeof value !== "string" || !Object.hasOwn(registry.values, value)) throw new Error("offer_unmapped_value");
      const entry = registry.values[value];
      result.push({ orderItemId: id, offerId: entry.offerId, evidenceRef: entry.evidenceRef,
        mappingVersion: registry.mappingVersion });
    }
  }
  return result;
}
