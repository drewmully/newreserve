/**
 * Proof of fire.
 *
 * For every canonical event: it lands in inbound_event under its canonical
 * name, identity either resolves or fails loudly with an alert, and a second
 * identical delivery is a no-op 200 that produces no second row.
 *
 * These are the assertions that would have caught the failure this whole build
 * exists to prevent — a pipeline that looks wired and has never once fired.
 */

import crypto from "crypto";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CANONICAL_EVENTS, type CanonicalEvent } from "@/lib/events/catalog";
import { EVENT_FIXTURES } from "./fixtures";
import { createFakeSupabase, type FakeState } from "./fakeSupabase";

const SHOPIFY_SECRET = "fixture-shopify-secret";
const LOOP_TOKEN = "fixture-loop-token";

let supabase: ReturnType<typeof createFakeSupabase>;

vi.mock("@/app/api/_lib/supabaseService", () => ({
  getSupabaseService: () => supabase.client,
}));

function hmac(body: string): string {
  return crypto.createHmac("sha256", SHOPIFY_SECRET).update(body, "utf8").digest("base64");
}

async function loadFrontDoor() {
  vi.resetModules();
  return import("@/app/api/events/[source]/route");
}

async function loadIngest() {
  vi.resetModules();
  return import("@/lib/events/ingest");
}

function frontDoorRequest(fixture: (typeof EVENT_FIXTURES)[CanonicalEvent]) {
  const body = JSON.stringify(fixture.payload);
  const headers: Record<string, string> = { "content-type": "application/json" };

  if (fixture.source === "shopify") {
    headers["x-shopify-topic"] = fixture.topic;
    headers["x-shopify-webhook-id"] = fixture.sourceEventId;
    headers["x-shopify-hmac-sha256"] = hmac(body);
  } else {
    headers["x-loop-topic"] = fixture.topic;
    headers["x-loop-token"] = LOOP_TOKEN;
  }

  return new NextRequest(`http://localhost/api/events/${fixture.source}`, {
    method: "POST",
    headers,
    body,
  });
}

function eventRows(state: FakeState) {
  return state.tables.inbound_event ?? [];
}

beforeEach(() => {
  supabase = createFakeSupabase();
  process.env.SHOPIFY_WEBHOOK_SECRET = SHOPIFY_SECRET;
  process.env.LOOP_WEBHOOK_TOKEN = LOOP_TOKEN;
  // No Slack channel configured: raiseAlert must still write its row.
  delete process.env.SLACK_ALERT_WEBHOOK_URL;
  delete process.env.SLACK_BOT_TOKEN;
  delete process.env.SLACK_ALERT_CHANNEL;
});

describe("every canonical event can verifiably fire", () => {
  const frontDoorEvents = CANONICAL_EVENTS.filter(
    (event) => EVENT_FIXTURES[event].source !== "resend",
  );

  it.each(frontDoorEvents)("%s lands through the front door", async (event) => {
    const fixture = EVENT_FIXTURES[event];
    const { POST } = await loadFrontDoor();

    const response = await POST(frontDoorRequest(fixture), {
      params: Promise.resolve({ source: fixture.source }),
    });

    expect(response.status).toBe(200);
    const json = (await response.json()) as { ok: boolean; event_name: string };
    expect(json.ok).toBe(true);
    expect(json.event_name).toBe(event);

    const rows = eventRows(supabase.state);
    expect(rows).toHaveLength(1);
    expect(rows[0].event_name).toBe(event);
    expect(rows[0].source).toBe(fixture.source);
    expect(rows[0].source_event_id).toBe(fixture.sourceEventId);
    expect(rows[0].payload).not.toBeNull();

    // Resolved, or unresolvable and loud. Never quietly pending.
    expect(["resolved", "created", "linked", "unresolvable"]).toContain(rows[0].resolution);
    if (fixture.expectedCustomerId !== null) {
      expect(String(rows[0].customer_id)).toBe(fixture.expectedCustomerId);
    } else {
      expect(supabase.state.tables.backbone_alert.length).toBeGreaterThan(0);
    }
  });

  it.each(frontDoorEvents)("%s is idempotent on redelivery", async (event) => {
    const fixture = EVENT_FIXTURES[event];
    const { POST } = await loadFrontDoor();
    const ctx = { params: Promise.resolve({ source: fixture.source }) };

    await POST(frontDoorRequest(fixture), ctx);
    const afterFirst = eventRows(supabase.state).length;

    const second = await POST(frontDoorRequest(fixture), {
      params: Promise.resolve({ source: fixture.source }),
    });

    expect(second.status).toBe(200);
    expect(await second.json()).toEqual({ ok: true, duplicate: true });
    expect(eventRows(supabase.state)).toHaveLength(afterFirst);
  });

  const resendEvents = CANONICAL_EVENTS.filter(
    (event) => EVENT_FIXTURES[event].source === "resend",
  );

  // Resend has no front door in Stage A, so these go through the ingest core
  // directly — the same path the reconciler and replay use.
  it.each(resendEvents)("%s lands through direct ingest", async (event) => {
    const fixture = EVENT_FIXTURES[event];
    const { ingestInboundEvent } = await loadIngest();

    const first = await ingestInboundEvent({
      source: "resend",
      sourceEventId: fixture.sourceEventId,
      sourceTopic: fixture.topic,
      eventName: event,
      payload: fixture.payload,
    });

    expect(first.duplicate).toBe(false);
    expect(eventRows(supabase.state)).toHaveLength(1);
    expect(eventRows(supabase.state)[0].event_name).toBe(event);

    const second = await ingestInboundEvent({
      source: "resend",
      sourceEventId: fixture.sourceEventId,
      sourceTopic: fixture.topic,
      eventName: event,
      payload: fixture.payload,
    });

    expect(second.duplicate).toBe(true);
    expect(eventRows(supabase.state)).toHaveLength(1);
  });
});

describe("the front door refuses what it cannot verify", () => {
  it("rejects a bad Shopify HMAC and persists nothing", async () => {
    const { POST } = await loadFrontDoor();
    const body = JSON.stringify(EVENT_FIXTURES["order.paid"].payload);

    const response = await POST(
      new NextRequest("http://localhost/api/events/shopify", {
        method: "POST",
        headers: {
          "x-shopify-topic": "orders/paid",
          "x-shopify-webhook-id": "forged",
          "x-shopify-hmac-sha256": hmac("a different body"),
        },
        body,
      }),
      { params: Promise.resolve({ source: "shopify" }) },
    );

    expect(response.status).toBe(401);
    expect(eventRows(supabase.state)).toHaveLength(0);
  });

  it("rejects a Loop delivery with the wrong shared secret", async () => {
    const { POST } = await loadFrontDoor();

    const response = await POST(
      new NextRequest("http://localhost/api/events/loop", {
        method: "POST",
        headers: { "x-loop-topic": "subscription/cancelled", "x-loop-token": "wrong" },
        body: JSON.stringify(EVENT_FIXTURES["subscription.cancelled"].payload),
      }),
      { params: Promise.resolve({ source: "loop" }) },
    );

    expect(response.status).toBe(401);
    expect(eventRows(supabase.state)).toHaveLength(0);
  });

  it("404s an unknown source", async () => {
    const { POST } = await loadFrontDoor();
    const response = await POST(
      new NextRequest("http://localhost/api/events/stripe", { method: "POST", body: "{}" }),
      { params: Promise.resolve({ source: "stripe" }) },
    );
    expect(response.status).toBe(404);
  });

  it("records an unrecognised topic as unknown rather than dropping it", async () => {
    const { POST } = await loadFrontDoor();
    const body = JSON.stringify({ id: 1, customer: { id: 7100000000999 } });

    const response = await POST(
      new NextRequest("http://localhost/api/events/shopify", {
        method: "POST",
        headers: {
          "x-shopify-topic": "inventory_levels/connect",
          "x-shopify-webhook-id": "unknown-topic-1",
          "x-shopify-hmac-sha256": hmac(body),
        },
        body,
      }),
      { params: Promise.resolve({ source: "shopify" }) },
    );

    expect(response.status).toBe(200);
    const rows = eventRows(supabase.state);
    expect(rows).toHaveLength(1);
    expect(rows[0].event_name).toBe("unknown");
    expect(rows[0].resolution).toBe("unresolvable");
    expect(
      supabase.state.tables.backbone_alert.some((alert) => alert.kind === "unknown_topic"),
    ).toBe(true);
  });
});
