import { key, type Row } from "./primitives";

export const ORDER_SIZE_VERSION = "order-size-v1";
export const ORDER_SIZES = ["XS", "S", "M", "L", "XL", "XXL", "XXXL"] as const;
type Size = typeof ORDER_SIZES[number];
type Status = "known" | "missing" | "invalid" | "conflict" | "unsupported" | "projection_absent";
type Semantics = "requested_box_top_size" | "purchased_shirt_variant";
type Evidence = { status: Status; value: Size | null };
export type OrderSizePolicy = {
  policyRef: string;
  /** Explicit approved numeric product IDs, not title/SKU/profile inference. */
  productSemantics: Readonly<Record<string, Semantics>>;
};
export type OrderSizeSidecarOption = { orderSizeSidecar: true };
export type OrderItemSizeRow = {
  order_item_id: string; publication_id: string;
  size_value: Size | null; size_status: Status;
  size_semantics: Semantics | "unsupported";
  size_source: "custom_attribute_top_size" | "variant_title_snapshot" | "none";
  source_evidence_ref: string; policy_ref: string; mapping_version: typeof ORDER_SIZE_VERSION;
};
function object(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ?
    value as Record<string, unknown> : null;
}
function size(value: unknown): Size | null {
  const normalized = typeof value === "string" ? value.trim().toUpperCase() : "";
  return ORDER_SIZES.includes(normalized as Size) ? normalized as Size : null;
}
function topSize(raw: unknown): Evidence {
  if (raw === undefined) return { status: "projection_absent", value: null };
  if (!Array.isArray(raw)) return { status: "invalid", value: null };
  const values = new Set<Size>();
  let invalid = false, found = false;
  for (const item of raw) {
    const attribute = object(item);
    if (!attribute) { invalid = true; continue; }
    if (attribute.key !== "Top size") continue;
    found = true;
    const normalized = size(attribute.value);
    if (normalized) values.add(normalized); else invalid = true;
  }
  if (values.size > 1) return { status: "conflict", value: null };
  if (invalid) return { status: "invalid", value: null };
  return found ? { status: "known", value: [...values][0] } : { status: "missing", value: null };
}
// Fixed financial GraphQL shapes for the size opt-in only. Unknown properties
// must not survive at ANY depth; a selected scalar cannot smuggle an object.
function fields(value: unknown, names: string[]): Record<string, unknown> {
  const row = object(value);
  if (!row) throw new Error("shopify_schema_drift");
  return Object.fromEntries(names.filter(name => Object.hasOwn(row, name)).map(name => {
    const scalar = row[name];
    if (scalar !== null && !["string", "number", "boolean"].includes(typeof scalar))
      throw new Error("shopify_schema_drift");
    return [name, scalar];
  }));
}
function rows(value: unknown): unknown[] {
  if (!Array.isArray(value)) throw new Error("shopify_schema_drift");
  return value;
}
function money(value: unknown) {
  return { shopMoney: fields(object(value)?.shopMoney, ["amount", "currencyCode"]) };
}
/** Only canonical enums/status survive. Never retain raw titles or attributes.
 * Shopify has no customAttributes key filter: live use needs separate approval.
 */
export function projectOrderSizeLine(line: Record<string, unknown>): Record<string, unknown> {
  const variant = size(line.variantTitle);
  const evidence = {
    topSize: topSize(line.customAttributes),
    variantTitle: { status: variant ? "known" : line.variantTitle === undefined ? "projection_absent" :
      line.variantTitle === null || line.variantTitle === "" ? "missing" :
        typeof line.variantTitle === "string" ? "unsupported" : "invalid", value: variant },
  };
  return {
    ...fields(line, ["id", "sku", "quantity", "isGiftCard"]),
    product: line.product === null ? null : fields(line.product, ["id"]),
    originalUnitPriceSet: money(line.originalUnitPriceSet),
    originalTotalSet: money(line.originalTotalSet),
    discountAllocations: rows(line.discountAllocations).map(value => ({
      allocatedAmountSet: money(object(value)?.allocatedAmountSet),
    })),
    orderSize: evidence,
  };
}
/** Sanitize the entire response order, including nested financial objects,
 * before pagination metadata, diagnostics, or a retainable document sees it.
 */
export function projectOrderSizeOrder(order: Record<string, unknown>): Record<string, unknown> {
  const connection = object(order.lineItems);
  return {
    ...fields(order, ["id", "createdAt", "updatedAt", "currencyCode", "edited", "taxesIncluded", "test", "cancelledAt"]),
    originalTotalPriceSet: money(order.originalTotalPriceSet),
    subtotalPriceSet: money(order.subtotalPriceSet),
    transactionsCount: fields(order.transactionsCount, ["count", "precision"]),
    transactions: rows(order.transactions).map(value => {
      const row = object(value);
      return {
        ...fields(value, ["id", "kind", "status", "gateway", "test", "createdAt", "processedAt"]),
        amountSet: money(row?.amountSet),
        parentTransaction: row?.parentTransaction === null ? null : fields(row?.parentTransaction, ["id", "gateway"]),
      };
    }),
    lineItems: {
      nodes: rows(connection?.nodes).map(value => {
        const row = object(value);
        if (!row) throw new Error("shopify_schema_drift");
        return projectOrderSizeLine(row);
      }),
      pageInfo: fields(connection?.pageInfo, ["hasNextPage", "endCursor"]),
    },
  };
}
function readEvidence(value: unknown): Evidence {
  const row = object(value);
  if (!row || Object.keys(row).sort().join(",") !== "status,value" ||
      !["known", "missing", "invalid", "conflict", "unsupported", "projection_absent"].includes(String(row.status)) ||
      (row.status === "known" ? !ORDER_SIZES.includes(row.value as Size) : row.value !== null))
    throw new Error("shopify_invalid_size_projection");
  return row as Evidence;
}
export function mapOrderItemSizes(input: {
  lines: Record<string, unknown>[]; items: Row[]; shop: string; publication: string;
  projected: boolean; policy: OrderSizePolicy; evidenceRef: string;
}): OrderItemSizeRow[] {
  const { policy } = input;
  if (!policy || typeof policy.policyRef !== "string" || !policy.policyRef.trim() ||
      !object(policy.productSemantics) || Object.entries(policy.productSemantics).some(([id, meaning]) =>
        !/^[1-9]\d*$/.test(id) || !["requested_box_top_size", "purchased_shirt_variant"].includes(meaning)))
    throw new Error("shopify_invalid_size_policy");
  return input.items.map((item, index) => {
    const line = input.lines[index];
    const product = Object.keys(policy.productSemantics).find(id => item.product_id === key(input.shop, id));
    const semantics = product && item.item_class === "merchandise" ? policy.productSemantics[product] : "unsupported";
    const base: OrderItemSizeRow = {
      order_item_id: item.order_item_id as string, publication_id: input.publication,
      size_value: null, size_status: "unsupported", size_semantics: semantics, size_source: "none",
      source_evidence_ref: input.evidenceRef, policy_ref: policy.policyRef, mapping_version: ORDER_SIZE_VERSION,
    };
    if (input.projected && (Object.hasOwn(line, "customAttributes") || Object.hasOwn(line, "variantTitle")))
      throw new Error("shopify_unsanitized_size_projection");
    if (!input.projected || !Object.hasOwn(line, "orderSize"))
      return { ...base, size_status: "projection_absent" };
    const projected = object(line.orderSize);
    if (!projected || Object.keys(projected).sort().join(",") !== "topSize,variantTitle")
      throw new Error("shopify_invalid_size_projection");
    const top = readEvidence(projected.topSize), variant = readEvidence(projected.variantTitle);
    if (semantics === "unsupported") return base;
    const evidence = semantics === "requested_box_top_size" ? top : variant;
    const conflict = top.status === "known" && variant.status === "known" && top.value !== variant.value;
    return { ...base, size_value: conflict ? null : evidence.value, size_status: conflict ? "conflict" : evidence.status,
      size_source: evidence.status === "projection_absent" ? "none" :
        semantics === "requested_box_top_size" ? "custom_attribute_top_size" : "variant_title_snapshot" };
  });
}
