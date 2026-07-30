/**
 * One synthetic fixture per canonical event.
 *
 * Everything here is invented: ids are in a range no real store uses and every
 * address is @example.com. No production payload is copied into this repo.
 *
 * The catalog-completeness sentinel fails the build if a canonical event has no
 * fixture here, which is what stops a new event being added to the catalog
 * without anyone ever proving it can fire.
 */

import { CANONICAL_EVENTS, type CanonicalEvent } from "@/lib/events/catalog";

export interface EventFixture {
  /** Provider that would deliver it. */
  source: "shopify" | "loop" | "resend";
  /** Provider topic string, exactly as it arrives. */
  topic: string;
  /** Provider-supplied event id. */
  sourceEventId: string;
  payload: Record<string, unknown>;
  /** Shopify customer id the resolver is expected to land on, when there is one. */
  expectedCustomerId: string | null;
}

/** Invented ids, well below the 9e15 synthetic base so they read as real Shopify ids. */
function customerId(n: number): string {
  return String(7100000000000 + n);
}

function shopifyCustomer(n: number) {
  return {
    id: Number(customerId(n)),
    email: `fixture${n}@example.com`,
    phone: null,
  };
}

function shopifyOrder(n: number, extra: Record<string, unknown> = {}) {
  return {
    id: 5500000000000 + n,
    order_number: 1000 + n,
    email: `fixture${n}@example.com`,
    customer: shopifyCustomer(n),
    ...extra,
  };
}

function loopPayload(n: number, topic: string, extra: Record<string, unknown> = {}) {
  return {
    id: `loop-evt-${topic.replace(/\W/g, "-")}-${n}`,
    topic,
    customer: shopifyCustomer(n),
    subscription: { id: `loop-sub-${n}`, status: "ACTIVE" },
    ...extra,
  };
}

function resendPayload(n: number, type: string) {
  return {
    type,
    created_at: "2026-07-01T00:00:00.000Z",
    data: {
      email_id: `resend-${type}-${n}`,
      to: [`fixture${n}@example.com`],
      subject: "fixture",
    },
  };
}

export const EVENT_FIXTURES: Record<CanonicalEvent, EventFixture> = {
  "order.placed": {
    source: "shopify",
    topic: "orders/create",
    sourceEventId: "shopify-wh-order-placed",
    payload: shopifyOrder(1, { financial_status: "pending" }),
    expectedCustomerId: customerId(1),
  },
  "order.paid": {
    source: "shopify",
    topic: "orders/paid",
    sourceEventId: "shopify-wh-order-paid",
    payload: shopifyOrder(2, { financial_status: "paid" }),
    expectedCustomerId: customerId(2),
  },
  "order.fulfilled": {
    source: "shopify",
    topic: "orders/fulfilled",
    sourceEventId: "shopify-wh-order-fulfilled",
    payload: shopifyOrder(3, { fulfillment_status: "fulfilled" }),
    expectedCustomerId: customerId(3),
  },
  "fulfillment.created": {
    source: "shopify",
    topic: "fulfillments/create",
    sourceEventId: "shopify-wh-fulfillment-created",
    payload: {
      id: 6600000000001,
      order_id: 5500000000004,
      status: "success",
      shipment_status: null,
      tracking_number: "FIXTURE-TRACK-1",
      customer: shopifyCustomer(4),
    },
    expectedCustomerId: customerId(4),
  },
  "fulfillment.updated": {
    source: "shopify",
    topic: "fulfillments/update",
    sourceEventId: "shopify-wh-fulfillment-updated",
    payload: {
      id: 6600000000002,
      order_id: 5500000000005,
      status: "success",
      shipment_status: "in_transit",
      customer: shopifyCustomer(5),
    },
    expectedCustomerId: customerId(5),
  },
  // The only way Shopify ever tells us a box arrived: the same topic as above,
  // with shipment_status flipped. If carrier tracking is not flowing, this
  // event cannot fire — which is precisely what coverage is there to expose.
  "shipment.delivered": {
    source: "shopify",
    topic: "fulfillments/update",
    sourceEventId: "shopify-wh-shipment-delivered",
    payload: {
      id: 6600000000003,
      order_id: 5500000000006,
      status: "success",
      shipment_status: "delivered",
      customer: shopifyCustomer(6),
    },
    expectedCustomerId: customerId(6),
  },
  "order.cancelled": {
    source: "shopify",
    topic: "orders/cancelled",
    sourceEventId: "shopify-wh-order-cancelled",
    payload: shopifyOrder(7, { cancelled_at: "2026-07-01T00:00:00Z" }),
    expectedCustomerId: customerId(7),
  },
  "order.refunded": {
    source: "shopify",
    topic: "refunds/create",
    sourceEventId: "shopify-wh-order-refunded",
    payload: {
      id: 7700000000001,
      order_id: 5500000000008,
      note: "fixture refund",
      customer: shopifyCustomer(8),
    },
    expectedCustomerId: customerId(8),
  },
  "checkout.started": {
    source: "shopify",
    topic: "checkouts/create",
    sourceEventId: "shopify-wh-checkout-started",
    payload: {
      id: 8800000000001,
      token: "fixture-checkout-token-1",
      email: "fixture9@example.com",
      customer: shopifyCustomer(9),
    },
    expectedCustomerId: customerId(9),
  },
  "checkout.updated": {
    source: "shopify",
    topic: "checkouts/update",
    sourceEventId: "shopify-wh-checkout-updated",
    payload: {
      id: 8800000000002,
      token: "fixture-checkout-token-2",
      email: "fixture10@example.com",
      customer: shopifyCustomer(10),
    },
    expectedCustomerId: customerId(10),
  },
  // customers/* is the awkward shape: the payload IS the customer, so the id is
  // top-level rather than under `customer`.
  "customer.created": {
    source: "shopify",
    topic: "customers/create",
    sourceEventId: "shopify-wh-customer-created",
    payload: {
      id: Number(customerId(11)),
      email: "fixture11@example.com",
      first_name: "Fixture",
      last_name: "Eleven",
    },
    expectedCustomerId: customerId(11),
  },
  "customer.updated": {
    source: "shopify",
    topic: "customers/update",
    sourceEventId: "shopify-wh-customer-updated",
    payload: {
      id: Number(customerId(12)),
      email: "fixture12@example.com",
      first_name: "Fixture",
      last_name: "Twelve",
    },
    expectedCustomerId: customerId(12),
  },

  "subscription.renewed": {
    source: "loop",
    topic: "order/processed",
    sourceEventId: "loop-evt-order-processed-13",
    payload: loopPayload(13, "order/processed", { order: { id: 5500000000013 } }),
    expectedCustomerId: customerId(13),
  },
  "subscription.upcoming": {
    source: "loop",
    topic: "order/upcoming",
    sourceEventId: "loop-evt-order-upcoming-14",
    payload: loopPayload(14, "order/upcoming"),
    expectedCustomerId: customerId(14),
  },
  "subscription.payment_failed": {
    source: "loop",
    topic: "order/paymentFailed",
    sourceEventId: "loop-evt-order-paymentFailed-15",
    payload: loopPayload(15, "order/paymentFailed", { failureReason: "card_declined" }),
    expectedCustomerId: customerId(15),
  },
  "subscription.paused": {
    source: "loop",
    topic: "subscription/paused",
    sourceEventId: "loop-evt-subscription-paused-16",
    payload: loopPayload(16, "subscription/paused"),
    expectedCustomerId: customerId(16),
  },
  "subscription.resumed": {
    source: "loop",
    topic: "subscription/resumed",
    sourceEventId: "loop-evt-subscription-resumed-17",
    payload: loopPayload(17, "subscription/resumed"),
    expectedCustomerId: customerId(17),
  },
  "subscription.cancelled": {
    source: "loop",
    topic: "subscription/cancelled",
    sourceEventId: "loop-evt-subscription-cancelled-18",
    payload: loopPayload(18, "subscription/cancelled", { cancellationReason: "fixture" }),
    expectedCustomerId: customerId(18),
  },
  "subscription.expired": {
    source: "loop",
    topic: "subscription/expired",
    sourceEventId: "loop-evt-subscription-expired-19",
    payload: loopPayload(19, "subscription/expired"),
    expectedCustomerId: customerId(19),
  },
  "subscription.skipped": {
    source: "loop",
    topic: "subscription/skipped",
    sourceEventId: "loop-evt-subscription-skipped-20",
    payload: loopPayload(20, "subscription/skipped"),
    expectedCustomerId: customerId(20),
  },
  "payment_method.expiring": {
    source: "loop",
    topic: "paymentMethod/expiringSoon",
    sourceEventId: "loop-evt-paymentMethod-expiringSoon-21",
    payload: loopPayload(21, "paymentMethod/expiringSoon", { expiresOn: "2026-09-30" }),
    expectedCustomerId: customerId(21),
  },

  // Resend has no front door in Stage A — these are ingested directly. They are
  // still catalogued so coverage can prove whether they ever arrive.
  "email.delivered": {
    source: "resend",
    topic: "email.delivered",
    sourceEventId: "resend-evt-delivered-22",
    payload: resendPayload(22, "email.delivered"),
    expectedCustomerId: null,
  },
  "email.opened": {
    source: "resend",
    topic: "email.opened",
    sourceEventId: "resend-evt-opened-23",
    payload: resendPayload(23, "email.opened"),
    expectedCustomerId: null,
  },
  "email.clicked": {
    source: "resend",
    topic: "email.clicked",
    sourceEventId: "resend-evt-clicked-24",
    payload: resendPayload(24, "email.clicked"),
    expectedCustomerId: null,
  },
  "email.bounced": {
    source: "resend",
    topic: "email.bounced",
    sourceEventId: "resend-evt-bounced-25",
    payload: resendPayload(25, "email.bounced"),
    expectedCustomerId: null,
  },
  "email.complained": {
    source: "resend",
    topic: "email.complained",
    sourceEventId: "resend-evt-complained-26",
    payload: resendPayload(26, "email.complained"),
    expectedCustomerId: null,
  },
};

/** Canonical events with no fixture. The sentinel asserts this is empty. */
export function missingFixtures(): string[] {
  return CANONICAL_EVENTS.filter((event) => EVENT_FIXTURES[event] === undefined);
}
