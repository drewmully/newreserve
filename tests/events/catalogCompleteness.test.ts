/**
 * Catalog-completeness sentinel.
 *
 * Modelled on tests/api/emailSendChokepoint.test.ts: a standing assertion that
 * fails the build the moment someone adds a canonical event without also
 * proving it can fire.
 *
 * Adding an entry to CANONICAL_EVENTS without a fixture, a provider, or a row
 * in the coverage report is exactly how an event ends up "supported" on paper
 * and invisible in production.
 */

import { describe, expect, it } from "vitest";
import {
  CANONICAL_EVENTS,
  LOOP_TOPIC_TO_EVENT,
  RESEND_TOPIC_TO_EVENT,
  SHOPIFY_TOPIC_TO_EVENT,
  canonicalEventFor,
  isCanonicalEvent,
  providerForEvent,
} from "@/lib/events/catalog";
import { expectedCanonicalEvents, DESIRED_SHOPIFY_TOPICS } from "@/lib/events/desired-topics";
import { EVENT_FIXTURES, missingFixtures } from "./fixtures";

describe("canonical event catalog is complete", () => {
  it("every canonical event has a fixture", () => {
    expect(missingFixtures()).toEqual([]);
  });

  it("every canonical event has a provider and therefore a coverage row", () => {
    const withoutProvider = CANONICAL_EVENTS.filter(
      (event) => !["shopify", "loop", "resend"].includes(providerForEvent(event)),
    );
    expect(withoutProvider).toEqual([]);

    // The coverage report builds exactly one row per canonical event, so
    // covering the catalog is covering the report.
    expect(new Set(CANONICAL_EVENTS).size).toBe(CANONICAL_EVENTS.length);
  });

  it("every fixture's topic maps back to the event it claims", () => {
    const mismatched = CANONICAL_EVENTS.filter((event) => {
      const fixture = EVENT_FIXTURES[event];
      return canonicalEventFor(fixture.source, fixture.topic, fixture.payload) !== event;
    });
    expect(mismatched).toEqual([]);
  });

  it("every mapped provider topic resolves to a canonical event", () => {
    const allMapped = [
      ...Object.values(SHOPIFY_TOPIC_TO_EVENT),
      ...Object.values(LOOP_TOPIC_TO_EVENT),
      ...Object.values(RESEND_TOPIC_TO_EVENT),
    ];
    expect(allMapped.filter((event) => !isCanonicalEvent(event))).toEqual([]);
  });

  it("every Shopify canonical event is registered in the desired-topic list", () => {
    const desired = new Set<string>(DESIRED_SHOPIFY_TOPICS.map((entry) => entry.topic));
    const unregistered = Object.entries(SHOPIFY_TOPIC_TO_EVENT)
      .filter(([topic]) => !desired.has(topic))
      .map(([topic]) => topic);
    expect(unregistered).toEqual([]);
  });

  it("expects every Shopify- and Loop-originated event, including derived delivery", () => {
    const expected = expectedCanonicalEvents();
    const missing = CANONICAL_EVENTS.filter(
      (event) => providerForEvent(event) !== "resend" && !expected.has(event),
    );
    expect(missing).toEqual([]);
    expect(expected.has("shipment.delivered")).toBe(true);
  });

  it("fixtures carry no real customer data", () => {
    const offenders = CANONICAL_EVENTS.filter((event) => {
      const serialised = JSON.stringify(EVENT_FIXTURES[event].payload);
      const emails = serialised.match(/[\w.+-]+@[\w.-]+/g) ?? [];
      return emails.some((email) => !email.endsWith("@example.com"));
    });
    expect(offenders).toEqual([]);
  });
});
