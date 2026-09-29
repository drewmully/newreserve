import type { PilotSource } from "./shopifyPilotSource";

export const FINANCIAL_RETENTION = "financial_allowlist_v1" as const;
type Shape = "scalar" | { [key: string]: Shape } | readonly [Shape];
const scalar = "scalar" as const;
const fields = (...names: string[]): Record<string, Shape> =>
  Object.fromEntries(names.map(name => [name, scalar]));
const money: Shape = { shopMoney: fields("amount", "currencyCode") };
const page = fields("hasNextPage", "endCursor");
const connection = (node: Shape): Shape => ({ nodes: [node], pageInfo: page });
const evidence = fields("status", "value");
const line: Record<string, Shape> = {
  ...fields("id", "sku", "quantity", "isGiftCard"), product: fields("id"),
  originalUnitPriceSet: money, originalTotalSet: money,
  discountAllocations: [{ allocatedAmountSet: money }],
};
const order: Record<string, Shape> = {
  ...fields("id", "createdAt", "updatedAt", "currencyCode", "edited", "taxesIncluded", "test", "cancelledAt"),
  originalTotalPriceSet: money, subtotalPriceSet: money,
  transactionsCount: fields("count", "precision"),
  transactions: [{
    ...fields("id", "kind", "status", "gateway", "test", "createdAt", "processedAt"),
    amountSet: money, parentTransaction: fields("id", "gateway"),
  }],
};
const financial: Shape = {
  ...fields("id", "updatedAt", "currencyCode"), originalTotalPriceSet: money,
  totalTaxSet: money, originalTotalDutiesSet: money, originalTotalAdditionalFeesSet: money,
  totalTipReceivedSet: money,
  shippingLines: connection({ ...fields("id"), discountedPriceSet: money }),
  refunds: [fields("id", "updatedAt")],
};
const refund: Shape = {
  ...fields("id", "createdAt", "updatedAt"), order: fields("id"), totalRefundedSet: money,
  duties: [{ amountSet: money }], orderAdjustments: connection(fields("id")),
  refundLineItems: connection({
    ...fields("id", "quantity"), lineItem: fields("id"), subtotalSet: money, totalTaxSet: money,
  }),
  refundShippingLines: connection({
    ...fields("id"), shippingLine: fields("id"), subtotalAmountSet: money, taxAmountSet: money,
  }),
  transactions: connection({ ...fields("id", "kind", "status", "processedAt"), amountSet: money }),
};
/** Fixed shape copying, not a general caller-configurable retention framework.
 * Null/missing selected fields remain for the existing mapper to reject where
 * required. Objects hidden in scalar fields are rejected rather than retained.
 */
function copy(value: unknown, shape: Shape): unknown {
  if (value === null) return null;
  if (shape === "scalar") {
    if (!["string", "number", "boolean"].includes(typeof value)) throw new Error("invalid_retention_shape");
    return value;
  }
  if (Array.isArray(shape)) {
    if (!Array.isArray(value)) throw new Error("invalid_retention_shape");
    return value.map(item => copy(item, shape[0]));
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_retention_shape");
  const row = value as Record<string, unknown>;
  return Object.fromEntries(Object.entries(shape).filter(([key]) => Object.hasOwn(row, key))
    .map(([key, child]) => [key, copy(row[key], child)]));
}
/** IDs required for reconciliation stay private. This is not anonymization.
 * Fixed queries may transiently receive unexpected fields; none are persisted.
 * Size querying still transiently requests customAttributes and variantTitle.
 */
export function projectPilotRetention(source: PilotSource): PilotSource {
  const projection = source.commerce.projection;
  if (projection !== "financial_no_geo" && projection !== "financial_no_geo_order_size")
    throw new Error("invalid_retention_projection");
  const selectedLine = projection === "financial_no_geo_order_size" ?
    { ...line, orderSize: { topSize: evidence, variantTitle: evidence } } : line;
  return copy(source, {
    commerce: {
      ...fields("shop", "apiVersion", "projection"),
      order: { ...order, lineItems: connection(selectedLine) },
    },
    financial, refunds: [refund],
  }) as PilotSource;
}

/** Called after exact raw-body HMAC verification. Retain only lineage/revision
 * inputs needed by 017 and the existing worker; keep the original body hash.
 */
export function projectReceiptRetention(topic: string, payload: Record<string, unknown>) {
  const result = copy(payload, fields("id", "admin_graphql_api_id", "updated_at", "created_at",
    ...(topic === "refunds/create" ? ["order_id"] : []))) as Record<string, unknown>;
  const validId = (value: unknown, kind: "Order" | "Refund") =>
    typeof value === "number" ? Number.isSafeInteger(value) && value > 0 :
      typeof value === "string" && value.length < 200 &&
      (new RegExp(`^gid://shopify/${kind}/[1-9][0-9]*$`).test(value) || /^[1-9][0-9]*$/.test(value));
  const kind = topic === "refunds/create" ? "Refund" : "Order";
  for (const key of ["id", "admin_graphql_api_id"])
    if (Object.hasOwn(result, key) && !validId(result[key], kind)) throw new Error("invalid_source_id");
  if (topic === "refunds/create" && !validId(result.order_id, "Order"))
    throw new Error("invalid_refund_order_id");
  for (const key of ["updated_at", "created_at"])
    if (Object.hasOwn(result, key) && (typeof result[key] !== "string" || !Number.isFinite(Date.parse(result[key]))))
      throw new Error("invalid_receipt_timestamp");
  return result;
}
