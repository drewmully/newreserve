import { checked, collectPages, decimal, key, micros, nyDate, type Page, type Row } from "./primitives";
export type PurchaseLine = {
  id: string; sku: string | null; productId: string | null; quantity: number;
  itemClass: "merchandise" | "gift_card" | "other" | "unknown";
  unitPrice: string | null; merchandiseDiscount: string | null;
  purchaseEvidenceRef: string | null;
  offers: { id: string; evidenceRef: string; mappingVersion: string }[];
};
export type ShopifySnapshot = {
  shop: string; id: string; createdAt: string; updatedAt: string; currency: string;
  paidAt: string | null; paidEvidenceRef: string | null; checkoutId: string | null;
  shippingCountry: string | null; shippingRegion: string | null;
  lines: PurchaseLine[]; linesComplete: boolean;
};
export type CommerceDecision = {
  eligibility: "eligible" | "excluded_test" | "excluded_cancelled" | "pending";
  commerceSource: "storefront" | "subscription_renewal" | "other";
  acquisitionEligible: boolean; approvalRef: string;
};
/** Source adapters must supply original purchase evidence, NOT current order totals. */
export function normalizeCommerce(s: ShopifySnapshot, decision: CommerceDecision, publication: string) {
  if (!decision.approvalRef || !s.linesComplete) throw new Error("commerce_not_complete");
  if (decision.eligibility === "eligible" && (!s.paidAt || !s.paidEvidenceRef)) throw new Error("missing_paid_evidence");
  nyDate(s.createdAt); nyDate(s.updatedAt);
  if (s.paidAt) nyDate(s.paidAt);
  const orderId = key(s.shop, s.id);
  const seen = new Set<string>();
  const offers: Row[] = [];
  const items = s.lines.map(line => {
    if (seen.has(line.id)) throw new Error("duplicate_line");
    seen.add(line.id);
    if (!Number.isSafeInteger(line.quantity) || line.quantity <= 0) throw new Error("invalid_purchase_quantity");
    const id = key(s.shop, s.id, line.id);
    const ready = s.currency === "USD" && line.itemClass === "merchandise" &&
      !!line.purchaseEvidenceRef && line.unitPrice !== null && line.merchandiseDiscount !== null;
    const unit = ready ? micros(line.unitPrice!) : null;
    const gross = unit === null ? null : unit * BigInt(line.quantity);
    const discount = ready ? micros(line.merchandiseDiscount!) : null;
    if ((unit !== null && unit < BigInt(0)) || (discount !== null && (discount < BigInt(0) || discount > gross!))) throw new Error("invalid_purchase_value");
    const membership = new Set<string>();
    for (const offer of line.offers) {
      if (membership.has(offer.id)) continue;
      membership.add(offer.id);
      offers.push(checked("order_item_offers", {
        order_item_id: id, offer_id: offer.id, membership_basis: "source_evidence",
        evidence_ref: offer.evidenceRef, offer_mapping_version: offer.mappingVersion, publication_id: publication,
      }));
    }
    return checked("order_items", {
      order_item_id: id, order_id: orderId, source_line_id: line.id,
      sku: line.sku, product_id: line.productId ? key(s.shop, line.productId) : null,
      quantity: decimal(BigInt(line.quantity) * BigInt(1000000)), item_class: line.itemClass, purchase_value_complete: ready,
      source_currency: s.currency, report_currency: "USD", unit_price_usd: unit === null ? null : decimal(unit),
      purchase_gross_usd: gross === null ? null : decimal(gross),
      purchase_discount_usd: discount === null ? null : decimal(discount),
      purchase_net_usd: gross === null || discount === null ? null : decimal(gross - discount),
      unit_cost_usd: null, cost_evidence_ref: null, publication_id: publication,
    });
  });
  const merchandise = items.filter(i => i.item_class === "merchandise");
  const ready = s.currency === "USD" && items.every(i => i.item_class !== "unknown") &&
    merchandise.every(i => i.purchase_value_complete === true);
  const sum = (field: string) => ready ? decimal(merchandise.reduce((n, i) => n + micros(i[field] as string), BigInt(0))) : null;
  const order = checked("orders", {
    order_id: orderId, source_order_id: s.id, shop_id: s.shop, customer_id: null,
    checkout_id: s.checkoutId ? key(s.shop, s.checkoutId) : null, created_at: s.createdAt, paid_at: s.paidAt,
    commerce_source: decision.commerceSource, eligibility_status: decision.eligibility,
    checkout_session_key: null, checkout_link_status: "pending", checkout_link_method: "none",
    evidence_ref: null, link_version: "unlinked-v1", shipping_country: s.shippingCountry, shipping_region: s.shippingRegion,
    source_updated_at: s.updatedAt, purchase_date: s.paidAt ? nyDate(s.paidAt) : null,
    acquisition_eligible: decision.eligibility === "eligible" && decision.acquisitionEligible,
    source_currency: s.currency, report_currency: "USD", purchase_merchandise_gross_usd: sum("purchase_gross_usd"),
    purchase_discount_usd: sum("purchase_discount_usd"), purchase_merchandise_net_usd: sum("purchase_net_usd"),
    publication_id: publication,
  });
  return { orders: [order], order_items: items, order_item_offers: offers };
}
/** Fetch every nested connection; reaching a safety bound fails rather than truncates. */
export async function collectCommerceSnapshot(
  fetchOrders: (cursor: string | null) => Promise<Page<Omit<ShopifySnapshot, "lines" | "linesComplete">>>,
  fetchLines: (orderId: string, cursor: string | null) => Promise<Page<PurchaseLine>>,
  maxOrderPages: number, maxLinePages: number,
): Promise<ShopifySnapshot[]> {
  const orders = await collectPages(fetchOrders, maxOrderPages);
  const output: ShopifySnapshot[] = [];
  for (const order of orders) output.push({ ...order, lines: await collectPages(c => fetchLines(order.id, c), maxLinePages), linesComplete: true });
  return output;
}
/** Live/backfill overlaps use source update order, never arrival order. */
export function selectLatestSnapshots(snapshots: ShopifySnapshot[]): ShopifySnapshot[] {
  const selected = new Map<string, ShopifySnapshot>();
  for (const snapshot of snapshots) {
    nyDate(snapshot.updatedAt);
    const k = key(snapshot.shop, snapshot.id), prior = selected.get(k);
    if (!prior || Date.parse(snapshot.updatedAt) > Date.parse(prior.updatedAt)) selected.set(k, snapshot);
    else if (Date.parse(snapshot.updatedAt) === Date.parse(prior.updatedAt) && JSON.stringify(snapshot) !== JSON.stringify(prior)) throw new Error("conflicting_source_revision");
  }
  return [...selected.values()];
}
