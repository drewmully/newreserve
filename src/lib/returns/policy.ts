/**
 * Single source of truth for MyMully return rules (server + client safe:
 * no Node or Firebase imports).
 *
 * Owner decision (Nov 2026): returns are accepted for 30 days counted from
 * DELIVERY, not from the order date. Pro Shop (one-time) orders and
 * subscription box orders (Reserve / quarterly box via Loop) have separate
 * rule sets so the owner can change one without touching the other.
 *
 * Both /api/returns/lookup and /api/returns/create read these rules through
 * `src/lib/returns/eligibility.ts`, and /returns renders its copy from them.
 */

export type OrderReturnType = "pro_shop" | "subscription";

export type ReturnResolution = "refund_original_payment" | "store_credit";

export interface ReturnRules {
  /** Days after the window start during which a return can be requested. */
  windowDays: number;
  /** What starts the clock. Only "delivered" is supported. */
  windowStart: "delivered";
  /** How the customer is made whole once the return is received. */
  resolution: ReturnResolution;
  /** Whether the /returns page offers the size-exchange request form. */
  exchangeAllowed: boolean;
  /** Items flagged final sale at purchase are never returnable. */
  finalSaleExcluded: true;
  /**
   * True while the owner is still auditing these rules. Purely informational
   * (search for PENDING OWNER DECISION); it does not change behaviour.
   */
  pendingOwnerDecision: boolean;
}

export const RETURN_RULES: Record<OrderReturnType, ReturnRules> = {
  // Matches /policies/refund: 30 days from delivery, unworn/unwashed with
  // tags, refund to the original payment method, final sale excluded.
  pro_shop: {
    windowDays: 30,
    windowStart: "delivered",
    resolution: "refund_original_payment",
    exchangeAllowed: true,
    finalSaleExcluded: true,
    pendingOwnerDecision: false,
  },
  // PENDING OWNER DECISION: subscription box rules are being audited.
  // For now: 30 days from delivery and store credit (what the /returns
  // page has always promised for boxes). Change it here only.
  subscription: {
    windowDays: 30,
    windowStart: "delivered",
    resolution: "store_credit",
    exchangeAllowed: true,
    finalSaleExcluded: true,
    pendingOwnerDecision: true,
  },
};

/**
 * When Shopify has no delivery date for a fulfillment (no carrier tracking
 * events, e.g. a hand-entered tracking number), the window starts this many
 * days after the fulfillment was created, as an estimate of transit time.
 */
export const UNKNOWN_DELIVERY_TRANSIT_BUFFER_DAYS = 7;

const DAY_MS = 24 * 60 * 60 * 1000;

/** Loop / Shopify tags that mark subscription orders (lowercased). */
const SUBSCRIPTION_TAGS = new Set(["subscription first order", "subscription recurring order"]);

/** Legacy box product titles (same signal /returns used for the box flow). */
const BOX_TITLE_RE = /reserve member|back 9/i;

export interface ClassifiableOrder {
  tags: readonly string[];
  lineItems: readonly { title: string; hasSellingPlan: boolean }[];
}

/**
 * Classify an order. Signals, strongest first:
 *  1. Any line item was bought on a Shopify selling plan (subscriptions,
 *     including Loop: Loop renewals and first orders carry the selling plan).
 *  2. Loop's auto tags "Subscription First Order" / "Subscription Recurring
 *     Order" (the same tags orders-paid and the marketing funnel rely on).
 *  3. A box product title ("Reserve Member", "Back 9"), the signal /returns
 *     already used to show the box flow; covers legacy orders.
 * Anything else is a Pro Shop order.
 */
export function classifyOrder(order: ClassifiableOrder): OrderReturnType {
  if (order.lineItems.some((li) => li.hasSellingPlan)) return "subscription";
  if (order.tags.some((t) => SUBSCRIPTION_TAGS.has(t.trim().toLowerCase()))) return "subscription";
  if (order.lineItems.some((li) => BOX_TITLE_RE.test(li.title))) return "subscription";
  return "pro_shop";
}

export interface FulfillmentTiming {
  createdAt: string;
  deliveredAt?: string | null;
}

export interface WindowStart {
  start: Date;
  /** "delivered" when Shopify reported delivery, else "estimated". */
  basis: "delivered" | "estimated";
}

/** Delivery date, or fulfillment date + transit buffer when unknown. */
export function returnWindowStart(f: FulfillmentTiming): WindowStart | null {
  if (f.deliveredAt) {
    const d = new Date(f.deliveredAt);
    if (!Number.isNaN(d.getTime())) return { start: d, basis: "delivered" };
  }
  const created = new Date(f.createdAt);
  if (Number.isNaN(created.getTime())) return null;
  return {
    start: new Date(created.getTime() + UNKNOWN_DELIVERY_TRANSIT_BUFFER_DAYS * DAY_MS),
    basis: "estimated",
  };
}

/** Last moment a return can be requested for this fulfillment. */
export function returnDeadline(f: FulfillmentTiming, rules: ReturnRules): Date | null {
  const ws = returnWindowStart(f);
  if (!ws) return null;
  return new Date(ws.start.getTime() + rules.windowDays * DAY_MS);
}

/** Inclusive: exactly `windowDays` after delivery is still in the window. */
export function isWithinReturnWindow(
  f: FulfillmentTiming,
  rules: ReturnRules,
  now: Date = new Date()
): boolean {
  const deadline = returnDeadline(f, rules);
  return deadline !== null && now.getTime() <= deadline.getTime();
}

export function outsideWindowMessage(rules: ReturnRules): string {
  return `This order is outside our return window (${rules.windowDays} days from delivery). Please email info@mymully.com and we'll take a look.`;
}

/* ── Reasons ── */

/** Labels the UI offers. "Wrong size" is kept for back-compat (old tabs). */
export const RETURN_REASONS = [
  "Too small",
  "Too large",
  "Didn't like the fit",
  "Not as described",
  "Damaged or defective",
  "Changed my mind",
  "Other",
] as const;

/** Label → Shopify ReturnReason (Admin API 2024-10 enum). */
export const RETURN_REASON_MAP: Record<string, string> = {
  "Too small": "SIZE_TOO_SMALL",
  "Too large": "SIZE_TOO_LARGE",
  // Direction unknown: don't guess. OTHER + customerNote "Wrong size".
  "Wrong size": "OTHER",
  "Didn't like the fit": "UNWANTED",
  "Not as described": "NOT_AS_DESCRIBED",
  "Damaged or defective": "DEFECTIVE",
  "Changed my mind": "UNWANTED",
  Other: "OTHER",
};

export function isAllowedReturnReason(reason: unknown): reason is string {
  return typeof reason === "string" && Object.prototype.hasOwnProperty.call(RETURN_REASON_MAP, reason);
}

/* ── Return shipping fee by tier (unchanged amounts) ── */

export function returnShippingCostByTier(tier: string | null | undefined): number {
  if (tier === "member" || tier === "black") return 0;
  if (tier === "access") return 5.95;
  return 9.95;
}
