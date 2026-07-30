/**
 * The declarative list of Shopify webhook topics Stage A wants registered.
 *
 * Today the live topic set is hand-clicked in the Shopify admin, so "which
 * topics are actually registered" is not answerable from the repo. This list is
 * the desired state; /api/admin/events/topic-drift diffs it against what
 * Shopify reports and writes a snapshot.
 *
 * This module is a description, not an action. Nothing here creates a
 * subscription — creation lands in a follow-up PR once the owner has read the
 * first drift report.
 */

import { LOOP_TOPIC_TO_EVENT, SHOPIFY_TOPIC_TO_EVENT, type CanonicalEvent } from "./catalog";

/** Every Shopify webhook is pointed at the single front door. */
export const SHOPIFY_EVENTS_URI_PATH = "/api/events/shopify";

export interface DesiredTopic {
  provider: "shopify";
  topic: keyof typeof SHOPIFY_TOPIC_TO_EVENT;
  eventName: CanonicalEvent;
  uriPath: string;
}

export const DESIRED_SHOPIFY_TOPICS: readonly DesiredTopic[] = (
  Object.entries(SHOPIFY_TOPIC_TO_EVENT) as [
    keyof typeof SHOPIFY_TOPIC_TO_EVENT,
    CanonicalEvent,
  ][]
).map(([topic, eventName]) => ({
  provider: "shopify" as const,
  topic,
  eventName,
  uriPath: SHOPIFY_EVENTS_URI_PATH,
}));

/**
 * Absolute target URI for a desired topic. `SHOPIFY_EVENTS_BASE_URL` lets a
 * preview deployment be diffed without editing code; it falls back to the
 * production host the existing webhooks already point at.
 */
export function desiredTopicUri(topic: DesiredTopic): string {
  const base = (
    process.env.SHOPIFY_EVENTS_BASE_URL ?? "https://mymully.com"
  ).replace(/\/+$/, "");
  return `${base}${topic.uriPath}`;
}

/**
 * Canonical events Stage A expects to see arrive, which is what the coverage
 * report's `expected` column means.
 *
 * Shopify plus Loop. `shipment.delivered` is included because it is derived
 * from `fulfillments/update`, itself a desired topic. Resend is excluded: Stage
 * A gives it no front door, so an absent email.* event is expected absence, not
 * a gap.
 */
export function expectedCanonicalEvents(): Set<CanonicalEvent> {
  const set = new Set<CanonicalEvent>(DESIRED_SHOPIFY_TOPICS.map((t) => t.eventName));
  for (const eventName of Object.values(LOOP_TOPIC_TO_EVENT)) set.add(eventName);
  if (set.has("fulfillment.updated")) set.add("shipment.delivered");
  return set;
}
