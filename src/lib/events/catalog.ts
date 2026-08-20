/**
 * The canonical event catalog.
 *
 * Provider topics map into these names here and nowhere else. Nothing
 * downstream of `inbound_event.event_name` ever reads a provider topic string,
 * which is what lets Loop be swapped for another subscription vendor without
 * touching a single flow.
 */

export const CANONICAL_EVENTS = [
  "order.placed",
  "order.paid",
  "order.fulfilled",
  "fulfillment.created",
  "fulfillment.updated",
  "shipment.delivered",
  "order.cancelled",
  "order.refunded",
  "checkout.started",
  "checkout.updated",
  "customer.created",
  "customer.updated",
  "subscription.renewed",
  "subscription.upcoming",
  "subscription.payment_failed",
  "subscription.paused",
  "subscription.resumed",
  "subscription.cancelled",
  "subscription.expired",
  "subscription.skipped",
  "payment_method.expiring",
  "email.delivered",
  "email.opened",
  "email.clicked",
  "email.bounced",
  "email.complained",
] as const;

export type CanonicalEvent = (typeof CANONICAL_EVENTS)[number];

/** Recorded when a topic arrives that this catalog does not know about. */
export const UNKNOWN_EVENT = "unknown";

export type EventName = CanonicalEvent | typeof UNKNOWN_EVENT;

export type EventSource =
  | "shopify"
  | "loop"
  | "resend"
  | "reconciler"
  | "manual_replay";

/** Sources the public front door (`/api/events/[source]`) accepts. */
export const FRONT_DOOR_SOURCES = ["shopify", "loop"] as const;
export type FrontDoorSource = (typeof FRONT_DOOR_SOURCES)[number];

export function isFrontDoorSource(value: string): value is FrontDoorSource {
  return (FRONT_DOOR_SOURCES as readonly string[]).includes(value);
}

export const SHOPIFY_TOPIC_TO_EVENT = {
  "orders/create": "order.placed",
  "orders/paid": "order.paid",
  "orders/fulfilled": "order.fulfilled",
  "fulfillments/create": "fulfillment.created",
  "fulfillments/update": "fulfillment.updated",
  "orders/cancelled": "order.cancelled",
  "refunds/create": "order.refunded",
  "checkouts/create": "checkout.started",
  "checkouts/update": "checkout.updated",
  "customers/create": "customer.created",
  "customers/update": "customer.updated",
} as const satisfies Record<string, CanonicalEvent>;

export const LOOP_TOPIC_TO_EVENT = {
  "order/processed": "subscription.renewed",
  "order/upcoming": "subscription.upcoming",
  "order/paymentFailed": "subscription.payment_failed",
  "subscription/paused": "subscription.paused",
  "subscription/resumed": "subscription.resumed",
  "subscription/cancelled": "subscription.cancelled",
  "subscription/expired": "subscription.expired",
  "subscription/skipped": "subscription.skipped",
  "paymentMethod/expiringSoon": "payment_method.expiring",
} as const satisfies Record<string, CanonicalEvent>;

export const RESEND_TOPIC_TO_EVENT = {
  "email.delivered": "email.delivered",
  "email.opened": "email.opened",
  "email.clicked": "email.clicked",
  "email.bounced": "email.bounced",
  "email.complained": "email.complained",
} as const satisfies Record<string, CanonicalEvent>;

/**
 * Shopify publishes no "delivered" topic. Delivery is `fulfillments/update`
 * reaching shipment_status = "delivered", which only happens if carrier
 * tracking is actually flowing. If it is not, this event is undeliverable by
 * design — which is exactly what the coverage report is there to prove.
 */
function isDeliveredFulfillment(payload: unknown): boolean {
  if (typeof payload !== "object" || payload === null) return false;
  const status = (payload as { shipment_status?: unknown }).shipment_status;
  return typeof status === "string" && status.toLowerCase() === "delivered";
}

/**
 * Maps a provider topic to its canonical name. Returns UNKNOWN_EVENT rather
 * than throwing: an unrecognised topic must still be recorded, never dropped.
 */
export function canonicalEventFor(
  source: EventSource,
  topic: string | null | undefined,
  payload?: unknown,
): EventName {
  if (!topic) return UNKNOWN_EVENT;
  const key = topic.trim();

  if (source === "shopify") {
    const mapped = (SHOPIFY_TOPIC_TO_EVENT as Record<string, CanonicalEvent>)[key];
    if (!mapped) return UNKNOWN_EVENT;
    if (mapped === "fulfillment.updated" && isDeliveredFulfillment(payload)) {
      return "shipment.delivered";
    }
    return mapped;
  }

  if (source === "loop") {
    return (LOOP_TOPIC_TO_EVENT as Record<string, CanonicalEvent>)[key] ?? UNKNOWN_EVENT;
  }

  if (source === "resend") {
    return (RESEND_TOPIC_TO_EVENT as Record<string, CanonicalEvent>)[key] ?? UNKNOWN_EVENT;
  }

  // Reconciler and manual replay carry an already-canonical name.
  return isCanonicalEvent(key) ? key : UNKNOWN_EVENT;
}

export function isCanonicalEvent(value: string): value is CanonicalEvent {
  return (CANONICAL_EVENTS as readonly string[]).includes(value);
}

/** The provider that originates each canonical event, for the coverage report. */
export function providerForEvent(event: CanonicalEvent): "shopify" | "loop" | "resend" {
  if (Object.values(SHOPIFY_TOPIC_TO_EVENT).includes(event as never)) return "shopify";
  if (event === "shipment.delivered") return "shopify";
  if (Object.values(LOOP_TOPIC_TO_EVENT).includes(event as never)) return "loop";
  return "resend";
}
