import type { FullBuildEvidence } from "./fullReportBuild";
import { key, micros } from "./primitives";
import { evidenceDigest } from "./evidenceIntake";
import { SHOPIFY_ANALYTICS_API_VERSION, shopifyId, shopifyShop, sourceObject, type ShopifyOrderDocument } from "./shopifySource";
export type OfferRegistry = {
  shop: string; attributeKey: string; mappingVersion: string; approvalRef: string;
  values: Record<string, { offerId: string; evidenceRef: string }>;
};
/** Native line allocations need no business taxonomy. Codes get a shop-scoped
 * hashed namespace; applications without a stable global ID stay order-scoped.
 * Never merge automatic/manual/script applications by their display title.
 * Amounts establish membership only, not an allocation of revenue to offers.
 */
export function mapShopifyLineDiscounts(orders: ShopifyOrderDocument[], shop: string): FullBuildEvidence["offers"] {
  shopifyShop(shop);
  if (orders.length > 100) throw new Error("offer_order_budget");
  const result: FullBuildEvidence["offers"] = [], seen = new Set<string>();
  const types = new Set(["DiscountCodeApplication", "AutomaticDiscountApplication",
    "ManualDiscountApplication", "ScriptDiscountApplication"]);
  for (const doc of orders) {
    if (doc.shop !== shop || doc.apiVersion !== SHOPIFY_ANALYTICS_API_VERSION) throw new Error("offer_source_scope");
    const orderId = shopifyId(doc.order.id, "Order"), connection = sourceObject(doc.order.lineItems);
    if (!Array.isArray(connection.nodes) || sourceObject(connection.pageInfo).hasNextPage !== false)
      throw new Error("offer_lines_incomplete");
    const applications = new Map<number, string>();
    const digest = evidenceDigest(doc);
    for (const raw of connection.nodes) {
      const line = sourceObject(raw), lineId = shopifyId(line.id, "LineItem"), orderItemId = key(shop, orderId, lineId);
      if (seen.has(orderItemId)) throw new Error("offer_duplicate_line"); seen.add(orderItemId);
      if (!Array.isArray(line.discountAllocations)) throw new Error("offer_allocations_not_selected");
      const membership = new Set<string>(), indices = new Set<number>();
      for (const rawAllocation of line.discountAllocations) {
        const allocation = sourceObject(rawAllocation), app = sourceObject(allocation.discountApplication);
        const money = sourceObject(sourceObject(allocation.allocatedAmountSet).shopMoney);
        if (typeof money.amount !== "string" || micros(money.amount) < BigInt(0) ||
            typeof money.currencyCode !== "string" || !/^[A-Z]{3}$/.test(money.currencyCode) ||
            money.currencyCode !== doc.order.currencyCode) throw new Error("offer_invalid_allocation");
        if (!Number.isSafeInteger(app.index) || Number(app.index) < 0 || app.targetType !== "LINE_ITEM" ||
            typeof app.__typename !== "string" || !types.has(app.__typename)) throw new Error("offer_application_invalid");
        const index = app.index as number;
        if (indices.has(index)) throw new Error("offer_duplicate_allocation"); indices.add(index);
        const code = app.__typename === "DiscountCodeApplication" ? app.code : null;
        if (app.__typename === "DiscountCodeApplication" &&
            (typeof code !== "string" || !code.trim() || code.length > 256))
          throw new Error("offer_code_invalid");
        const identity = evidenceDigest([app.__typename, code]);
        if (applications.has(index) && applications.get(index) !== identity) throw new Error("offer_application_conflict");
        applications.set(index, identity);
        if (micros(money.amount) === BigInt(0)) continue;
        const offerId = code !== null
          ? `shopify-code:${key(shop, code as string)}`
          : `shopify-application:${key(shop, orderId, String(index), app.__typename)}`;
        if (membership.has(offerId)) continue; membership.add(offerId);
        result.push({ orderItemId, offerId, membershipBasis: "source_line_discount",
          evidenceRef: `shopify-line-discount:sha256:${digest}:line:${lineId}:application:${index}`,
          mappingVersion: "shopify-line-discount-v1" });
      }
    }
  }
  return result;
}
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
