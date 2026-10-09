/**
 * Storewide, read-only order-history adapter for lifecycle decisions.
 *
 * Uses the store's Admin token (read_all_orders), so it sees Loop AND
 * Shopify-native subscription orders regardless of which app owns the contract.
 * Output feeds `@/lib/klaviyo/eligibility`. It never writes, sends or logs PII.
 *
 * `complete` is true ONLY when every page and nested connection was read
 * without truncation or error. Callers must treat `complete: false` as a hold.
 */
import { classifyPaidOrder, matchOrderDelivery, shopifyId } from "@/lib/klaviyo/orderMatching";
import type { OrderHistoryEvidence, PaidCycleEvidence } from "@/lib/klaviyo/eligibility";
import { decideOrderProvider, RENEWAL_SOURCE_NAME, UNIDENTIFIED_PLAN, type SubscriptionProvider } from "./sellingPlans";

export const ORDER_HISTORY_QUERY = `query MullyLifecycleOrderHistory($query: String!, $after: String) {
  orders(first: 50, after: $after, sortKey: CREATED_AT, query: $query) {
    nodes {
      id
      createdAt
      processedAt
      test
      cancelledAt
      displayFinancialStatus
      sourceName
      app { id }
      customer { id }
      currentTotalPriceSet { shopMoney { amount currencyCode } }
      refunds(first: 1) { id }
      lineItems(first: 50) {
        nodes { id sku quantity requiresShipping isGiftCard variant { id } sellingPlan { sellingPlanId } }
        pageInfo { hasNextPage }
      }
      fulfillments(first: 20) {
        id
        status
        displayStatus
        updatedAt
        fulfillmentLineItems(first: 50) { nodes { quantity lineItem { id } } pageInfo { hasNextPage } }
      }
    }
    pageInfo { hasNextPage endCursor }
  }
}`;

const MAX_PAGES = 20; // 1,000 orders per customer; beyond this we hold rather than truncate.

type Bag = Record<string, unknown>;
const bag = (v: unknown): Bag => (v !== null && typeof v === "object" && !Array.isArray(v) ? (v as Bag) : {});
const list = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

export interface AdminOrder {
  raw: Bag;
  orderId: string | null;
  customerId: string | null;
  processedAt: string | null;
  classifierOrder: Bag;
  classifierFulfillments: Bag[];
  truncated: boolean;
}

/** Map one Admin GraphQL order to the REST-shaped input the matchers expect. */
export function normalizeAdminOrder(node: unknown): AdminOrder {
  const o = bag(node);
  const lines = bag(o.lineItems), fulfillments = list(o.fulfillments);
  let truncated = bag(lines.pageInfo).hasNextPage !== false || fulfillments.length >= 20;
  const status = typeof o.displayFinancialStatus === "string" ? o.displayFinancialStatus : null;
  const classifierOrder: Bag = {
    id: o.id,
    test: o.test,
    cancelled_at: o.cancelledAt === undefined ? undefined : o.cancelledAt,
    // Only an explicit PAID maps to "paid"; partial/pending/refunded never qualify.
    financial_status: status === "PAID" ? "paid" : status?.toLowerCase() ?? null,
    total_price: bag(bag(o.currentTotalPriceSet).shopMoney).amount,
    refunds: Array.isArray(o.refunds) ? o.refunds : undefined,
    source_name: o.sourceName,
    customer: { id: bag(o.customer).id },
    line_items: list(lines.nodes).map((raw) => {
      const l = bag(raw);
      return {
        id: l.id, quantity: l.quantity, sku: l.sku, requires_shipping: l.requiresShipping,
        gift_card: l.isGiftCard, variant_id: bag(l.variant).id ?? null,
        // A plan object without an ID (deleted plan) must never look like a
        // one-time line; the sentinel makes both matchers hold the order.
        selling_plan_id: l.sellingPlan == null ? null : bag(l.sellingPlan).sellingPlanId ?? UNIDENTIFIED_PLAN,
      };
    }),
  };
  const classifierFulfillments = fulfillments.map((raw) => {
    const f = bag(raw), fl = bag(f.fulfillmentLineItems);
    if (bag(fl.pageInfo).hasNextPage !== false) truncated = true;
    return {
      id: f.id, order_id: o.id, updated_at: f.updatedAt,
      status: f.status === "SUCCESS" ? "success" : String(f.status ?? "").toLowerCase(),
      shipment_status: f.displayStatus === "DELIVERED" ? "delivered" : String(f.displayStatus ?? "").toLowerCase(),
      line_items: list(fl.nodes).map((n) => ({ id: bag(bag(n).lineItem).id, quantity: bag(n).quantity })),
    };
  });
  return {
    raw: o, orderId: shopifyId(o.id, "Order"), customerId: shopifyId(bag(o.customer).id, "Customer"),
    processedAt: typeof o.processedAt === "string" ? o.processedAt : null,
    classifierOrder, classifierFulfillments, truncated,
  };
}

export interface SubscriptionOrderFact {
  orderId: string;
  provider: SubscriptionProvider;
  renewal: boolean;
  paidAt: string;
  paidAmountMinor: number;
  qualifiesAsPaidCycle: boolean;
  delivered: boolean;
}

export interface CustomerOrderHistory {
  customerId: string;
  checkedAt: string;
  complete: boolean;
  holds: string[];
  orders: AdminOrder[];
  subscriptionOrders: SubscriptionOrderFact[];
  history: OrderHistoryEvidence;
}

const minor = (amount: unknown): number | null => {
  if (typeof amount !== "string" || !/^\d+(\.\d{1,2})?$/.test(amount)) return null;
  const [whole, frac = ""] = amount.split(".");
  const cents = Number(whole) * 100 + Number(frac.padEnd(2, "0"));
  return Number.isSafeInteger(cents) ? cents : null;
};

/** Pure derivation over already-fetched orders. Exported for tests. */
export function deriveCustomerHistory(customer: string, nodes: unknown[], readComplete: boolean, checkedAt: string): CustomerOrderHistory {
  const customerId = shopifyId(customer, "Customer");
  const holds: string[] = [];
  if (!customerId) holds.push("invalid_customer");
  if (!readComplete) holds.push("order_history_read_incomplete");
  const orders = nodes.map(normalizeAdminOrder);
  const subscriptionOrders: SubscriptionOrderFact[] = [];
  const legacyPaid: Array<{ orderId: string; paidAt: string }> = [];
  const seen = new Set<string>();
  for (const order of orders) {
    if (!order.orderId || order.customerId !== customerId) { holds.push("order_identity_mismatch"); continue; }
    if (seen.has(order.orderId)) { holds.push("duplicate_order"); continue; }
    seen.add(order.orderId);
    if (order.truncated) holds.push("order_connection_truncated");
    const lines = list(order.classifierOrder.line_items).map(bag);
    const decision = decideOrderProvider({
      sourceName: typeof order.raw.sourceName === "string" ? order.raw.sourceName : null,
      appId: typeof bag(order.raw.app).id === "string" ? (bag(order.raw.app).id as string) : null,
      sellingPlanIds: lines.map((l) => (typeof l.selling_plan_id === "string" ? l.selling_plan_id : null)),
      createdAt: typeof order.raw.createdAt === "string" ? order.raw.createdAt : null,
    });
    if (decision.kind === "hold") { holds.push(decision.reason); continue; }
    if (decision.kind === "one_time") continue;
    if (decision.kind === "legacy_subscription") {
      const r = order.raw;
      if (r.test === false && r.cancelledAt === null && ["PAID", "PARTIALLY_REFUNDED"].includes(String(r.displayFinancialStatus)) &&
        order.processedAt) legacyPaid.push({ orderId: order.orderId, paidAt: order.processedAt });
      continue;
    }
    // The Loop app created this renewal, so a deleted-plan line is still a
    // subscription line. Classify a copy that says so explicitly.
    const classifierOrder = decision.renewal && decision.provider === "loop"
      ? { ...order.classifierOrder, source_name: RENEWAL_SOURCE_NAME,
        line_items: lines.map((l) => (l.selling_plan_id === UNIDENTIFIED_PLAN ? { ...l, selling_plan_id: null } : l)) }
      : order.classifierOrder;
    const match = classifyPaidOrder(classifierOrder);
    const amount = minor(order.classifierOrder.total_price);
    const qualifies = match.paidCandidate && match.kind === "subscription" && amount !== null && amount > 0 &&
      order.processedAt !== null && Number.isFinite(Date.parse(order.processedAt));
    subscriptionOrders.push({
      orderId: order.orderId, provider: decision.provider, renewal: decision.renewal,
      paidAt: order.processedAt ?? "", paidAmountMinor: amount ?? 0, qualifiesAsPaidCycle: qualifies,
      delivered: qualifies && matchOrderDelivery(classifierOrder, order.classifierFulfillments).complete,
    });
  }
  const byTime = [...subscriptionOrders].sort((a, b) => Date.parse(a.paidAt) - Date.parse(b.paidAt) || a.orderId.localeCompare(b.orderId));
  const firstCurrent = byTime.find((o) => o.qualifiesAsPaidCycle) ?? null;
  const firstLegacy = [...legacyPaid].sort((a, b) => Date.parse(a.paidAt) - Date.parse(b.paidAt))[0] ?? null;
  // A returning Recharge-era member is not a first-time member: the legacy
  // order becomes the first member order, so new-member programs hold.
  const legacyFirst = firstLegacy && (!firstCurrent || Date.parse(firstLegacy.paidAt) < Date.parse(firstCurrent.paidAt));
  const firstPaid = legacyFirst ? { orderId: firstLegacy!.orderId, delivered: false } : firstCurrent;
  const uniqueHolds = [...new Set(holds)].sort();
  const complete = uniqueHolds.length === 0;
  return {
    customerId: customerId ?? "", checkedAt, complete, holds: uniqueHolds, orders, subscriptionOrders,
    history: {
      customerId: customerId ?? "", complete, checkedAt,
      firstPaidMemberOrderId: firstPaid?.orderId ?? null,
      // The FIRST paid member order must itself be the delivered one; a later
      // delivered order never becomes the "first delivery" retroactively.
      firstDeliveredMemberOrderId: firstPaid?.delivered ? firstPaid.orderId : null,
    },
  };
}

export type GraphQLFetch = (query: string, variables: Record<string, unknown>) => Promise<unknown>;

/** Read a customer's complete order history with full pagination. */
export async function readCustomerOrderHistory(customer: string, gql: GraphQLFetch, now = () => new Date()): Promise<CustomerOrderHistory> {
  const customerId = shopifyId(customer, "Customer");
  const checkedAt = now().toISOString();
  if (!customerId) return deriveCustomerHistory(customer, [], false, checkedAt);
  const nodes: unknown[] = [];
  let after: string | null = null, complete = false;
  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const data = bag(await gql(ORDER_HISTORY_QUERY, { query: `customer_id:${customerId}`, after }));
      const conn = bag(data.orders), info = bag(conn.pageInfo);
      if (!Array.isArray(conn.nodes) || typeof info.hasNextPage !== "boolean") break;
      nodes.push(...conn.nodes);
      if (!info.hasNextPage) { complete = true; break; }
      if (typeof info.endCursor !== "string" || !info.endCursor) break;
      after = info.endCursor;
    }
  } catch {
    complete = false; // Never surface raw errors; they can echo request data.
  }
  return deriveCustomerHistory(customerId, nodes, complete, checkedAt);
}

/** Paid-cycle evidence for one provider, given a resolver from order to contract. */
export function paidCyclesFor(
  history: CustomerOrderHistory,
  provider: SubscriptionProvider,
  contractForOrder: (orderId: string) => string | null,
): { cycles: PaidCycleEvidence[]; holds: string[] } {
  const cycles: PaidCycleEvidence[] = [], holds: string[] = [];
  for (const order of history.subscriptionOrders) {
    if (order.provider !== provider || !order.qualifiesAsPaidCycle) continue;
    const contractId = contractForOrder(order.orderId);
    if (!contractId) { holds.push("cycle_contract_unresolved"); continue; }
    cycles.push({
      provider, contractId, customerId: history.customerId, cycleId: order.orderId, orderId: order.orderId,
      successful: true, paidAmountMinor: order.paidAmountMinor, refunded: false, cancelled: false,
      paidAt: order.paidAt, checkedAt: history.checkedAt,
    });
  }
  return { cycles, holds: [...new Set(holds)].sort() };
}
