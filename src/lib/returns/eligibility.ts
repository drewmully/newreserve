/**
 * Server-only: fetch the return-relevant view of a Shopify order and decide
 * what can be returned. Used by BOTH /api/returns/lookup (what the shopper
 * sees) and /api/returns/create (what we actually submit to Shopify), so the
 * two can't drift apart.
 *
 * One Admin GraphQL call per order (kept small to stay well under the
 * 1000-point single-query cost limit).
 */
import {
  RETURN_RULES,
  classifyOrder,
  isWithinReturnWindow,
  returnDeadline,
  type OrderReturnType,
  type ReturnRules,
} from "./policy";

const API_VERSION = () => process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";

function adminHeaders() {
  const token = process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;
  if (!token) throw new Error("Missing Shopify Admin credentials.");
  return {
    "Content-Type": "application/json",
    "X-Shopify-Access-Token": token,
  };
}

/** Throws with full Shopify detail; callers log it and return a generic error. */
export async function shopifyAdminGraphQL<T>(
  query: string,
  variables?: Record<string, unknown>
): Promise<T> {
  const res = await fetch(
    `https://${process.env.SHOPIFY_STORE_DOMAIN}/admin/api/${API_VERSION()}/graphql.json`,
    {
      method: "POST",
      headers: adminHeaders(),
      body: JSON.stringify({ query, variables }),
    }
  );
  if (!res.ok) {
    throw new Error(`Shopify GraphQL HTTP ${res.status}: ${await res.text()}`);
  }
  const json = (await res.json()) as { data: T; errors?: { message: string }[] };
  if (json.errors?.length) {
    throw new Error(`Shopify GraphQL errors: ${JSON.stringify(json.errors)}`);
  }
  return json.data;
}

export const RETURN_ORDER_QUERY = `query ReturnOrderSnapshot($id: ID!) {
  order(id: $id) {
    id
    legacyResourceId
    name
    email
    createdAt
    tags
    lineItems(first: 50) {
      nodes {
        id
        title
        variantTitle
        sku
        quantity
        refundableQuantity
        originalUnitPriceSet { shopMoney { amount } }
        image { url }
        product { featuredImage { url } }
        customAttributes { key value }
        sellingPlan { sellingPlanId }
      }
    }
    fulfillments(first: 10) {
      id
      status
      createdAt
      deliveredAt
      fulfillmentLineItems(first: 25) {
        nodes { id quantity lineItem { id } }
      }
    }
    returns(first: 5) {
      nodes {
        status
        returnLineItems(first: 25) {
          nodes {
            ... on ReturnLineItem {
              quantity
              fulfillmentLineItem { id lineItem { id } }
            }
          }
        }
      }
    }
  }
}`;

/* ── Raw GraphQL shape ── */

interface RawOrder {
  id: string;
  legacyResourceId: string;
  name: string;
  email: string | null;
  createdAt: string;
  tags: string[];
  lineItems: {
    nodes: Array<{
      id: string;
      title: string;
      variantTitle: string | null;
      sku: string | null;
      quantity: number;
      refundableQuantity: number;
      originalUnitPriceSet: { shopMoney: { amount: string } };
      image: { url: string } | null;
      product: { featuredImage: { url: string } | null } | null;
      customAttributes: Array<{ key: string; value: string | null }>;
      sellingPlan: { sellingPlanId: string | null } | null;
    }>;
  };
  fulfillments: Array<{
    id: string;
    status: string;
    createdAt: string;
    deliveredAt: string | null;
    fulfillmentLineItems: { nodes: Array<{ id: string; quantity: number; lineItem: { id: string } }> };
  }>;
  returns: {
    nodes: Array<{
      status: string;
      returnLineItems: {
        nodes: Array<{
          quantity?: number;
          fulfillmentLineItem?: { id: string; lineItem: { id: string } } | null;
        }>;
      };
    }>;
  };
}

/** Return statuses that still "use up" quantity (not declined/canceled). */
const ACTIVE_RETURN_STATUSES = new Set(["REQUESTED", "OPEN", "CLOSED"]);

export function numericId(gid: string): string {
  return String(gid).split("/").pop() ?? "";
}

export function normalizeEmail(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

/** Same final-sale rule /api/returns/lookup has always used. */
export function isFinalSaleAttributes(attrs: ReadonlyArray<{ name: string; value: string | null }>): boolean {
  return attrs.some(
    (p) => p.name === "_final_sale" || (p.name === "Final Sale" && p.value !== "false")
  );
}

export type IneligibleReason = "final_sale" | "not_fulfilled" | "already_returned" | "outside_window";

export interface FulfillmentAllocation {
  fulfillmentLineItemId: string;
  available: number;
}

export interface LineEligibility {
  lineItemId: string;
  title: string;
  variantTitle: string;
  sku: string;
  quantity: number;
  unitPrice: number;
  image: string;
  isFinalSale: boolean;
  returnableQty: number;
  ineligibleReason: IneligibleReason | null;
  /** Latest return deadline among this item's fulfillments (ISO), if shipped. */
  returnDeadline: string | null;
  /** In-window fulfillment line items with remaining quantity, for returnRequest. */
  allocations: FulfillmentAllocation[];
}

export interface OrderEligibility {
  orderId: string;
  orderName: string;
  email: string;
  createdAt: string;
  orderType: OrderReturnType;
  rules: ReturnRules;
  lines: LineEligibility[];
  /** At least one successful fulfillment exists. */
  hasFulfillments: boolean;
  /** Every successful fulfillment is past its return deadline. */
  allFulfillmentsOutsideWindow: boolean;
}

export function computeEligibility(order: RawOrder, now: Date = new Date()): OrderEligibility {
  const lineNodes = order.lineItems?.nodes ?? [];
  const orderType = classifyOrder({
    tags: order.tags ?? [],
    lineItems: lineNodes.map((li) => ({
      title: li.title ?? "",
      hasSellingPlan: Boolean(li.sellingPlan?.sellingPlanId),
    })),
  });
  const rules = RETURN_RULES[orderType];

  // Quantity already in an active return, by fulfillment line item and by line.
  const returnedByFli: Record<string, number> = {};
  const returnedByLine: Record<string, number> = {};
  for (const r of order.returns?.nodes ?? []) {
    if (!ACTIVE_RETURN_STATUSES.has(r.status)) continue;
    for (const rli of r.returnLineItems?.nodes ?? []) {
      const fli = rli.fulfillmentLineItem;
      if (!fli || typeof rli.quantity !== "number") continue;
      returnedByFli[fli.id] = (returnedByFli[fli.id] ?? 0) + rli.quantity;
      const lid = numericId(fli.lineItem.id);
      returnedByLine[lid] = (returnedByLine[lid] ?? 0) + rli.quantity;
    }
  }

  const successful = (order.fulfillments ?? []).filter((f) => f.status === "SUCCESS");
  const fulfillmentState = successful.map((f) => ({
    f,
    inWindow: isWithinReturnWindow(f, rules, now),
    deadline: returnDeadline(f, rules),
  }));

  const lines: LineEligibility[] = lineNodes.map((li) => {
    const lineItemId = numericId(li.id);
    const attrs = (li.customAttributes ?? []).map((a) => ({ name: a.key, value: a.value }));
    const isFinalSale = isFinalSaleAttributes(attrs);

    let fulfilledQty = 0;
    let inWindowAvailable = 0;
    let latestDeadline: Date | null = null;
    const allocations: FulfillmentAllocation[] = [];
    for (const { f, inWindow, deadline } of fulfillmentState) {
      for (const fli of f.fulfillmentLineItems?.nodes ?? []) {
        if (numericId(fli.lineItem.id) !== lineItemId) continue;
        fulfilledQty += fli.quantity;
        if (deadline && (!latestDeadline || deadline > latestDeadline)) latestDeadline = deadline;
        const available = Math.max(0, fli.quantity - (returnedByFli[fli.id] ?? 0));
        if (inWindow && available > 0) {
          inWindowAvailable += available;
          allocations.push({ fulfillmentLineItemId: fli.id, available });
        }
      }
    }

    // Refunded/removed units are assumed to come off unshipped units first.
    const refundedOrRemoved = Math.max(0, li.quantity - (li.refundableQuantity ?? li.quantity));
    const refundedOfShipped = Math.max(0, refundedOrRemoved - Math.max(0, li.quantity - fulfilledQty));
    const consumed = Math.max(refundedOfShipped, returnedByLine[lineItemId] ?? 0);
    const shippedRemaining = Math.max(0, fulfilledQty - consumed);
    let returnableQty = Math.max(0, Math.min(inWindowAvailable, shippedRemaining));

    let ineligibleReason: IneligibleReason | null = null;
    if (isFinalSale) ineligibleReason = "final_sale";
    else if (fulfilledQty === 0) ineligibleReason = "not_fulfilled";
    else if (shippedRemaining === 0) ineligibleReason = "already_returned";
    else if (returnableQty === 0) ineligibleReason = "outside_window";
    if (ineligibleReason) returnableQty = 0;

    return {
      lineItemId,
      title: li.title ?? "",
      variantTitle: li.variantTitle ?? "",
      sku: li.sku ?? "",
      quantity: li.quantity,
      unitPrice: parseFloat(li.originalUnitPriceSet?.shopMoney?.amount ?? "0") || 0,
      image: li.image?.url ?? li.product?.featuredImage?.url ?? "",
      isFinalSale,
      returnableQty,
      ineligibleReason,
      returnDeadline: latestDeadline ? latestDeadline.toISOString() : null,
      allocations,
    };
  });

  return {
    orderId: String(order.legacyResourceId ?? numericId(order.id)),
    orderName: order.name,
    email: normalizeEmail(order.email),
    createdAt: order.createdAt,
    orderType,
    rules,
    lines,
    hasFulfillments: successful.length > 0,
    allFulfillmentsOutsideWindow:
      successful.length > 0 && fulfillmentState.every((s) => !s.inWindow),
  };
}

/** Fetch + compute. Returns null when Shopify has no such order. */
export async function loadOrderEligibility(
  orderId: string,
  now: Date = new Date()
): Promise<OrderEligibility | null> {
  const data = await shopifyAdminGraphQL<{ order: RawOrder | null }>(RETURN_ORDER_QUERY, {
    id: `gid://shopify/Order/${orderId}`,
  });
  if (!data?.order) return null;
  return computeEligibility(data.order, now);
}

/**
 * Split a requested quantity across in-window fulfillment line items.
 * Caller must already have checked quantity ≤ returnableQty.
 */
export function allocateReturnQuantity(
  line: LineEligibility,
  quantity: number
): Array<{ fulfillmentLineItemId: string; quantity: number }> {
  const out: Array<{ fulfillmentLineItemId: string; quantity: number }> = [];
  let remaining = quantity;
  for (const a of line.allocations) {
    if (remaining <= 0) break;
    const take = Math.min(a.available, remaining);
    if (take > 0) {
      out.push({ fulfillmentLineItemId: a.fulfillmentLineItemId, quantity: take });
      remaining -= take;
    }
  }
  return remaining === 0 ? out : [];
}

export type { RawOrder as ReturnOrderRaw };
