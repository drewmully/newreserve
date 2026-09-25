import { expect, it, vi } from "vitest";
import { readPosthogBehavior, type BehaviorSource } from "@/lib/analytics/posthogSource";
import { fullFixture } from "../fixtures/analyticsFull";

const uuid = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const at = "2026-01-01T11:00:00Z";
function anonymous() {
  const { behavior } = fullFixture();
  behavior.families.page_view.identityProperty = "anonymous_id";
  behavior.families.page_view.identityNamespace = "anonymous";
  return { behavior, wire: {
    columns: ["uuid", "event", "timestamp", "event_id", "session_id", "anonymous_id", "analytics_permitted"],
    results: [[uuid, "page_view", at, "action1", "session1", "anon1", true] as (string | boolean | null)[]],
  } };
}
function transport(wire: object) {
  return vi.fn<typeof fetch>(async () => Response.json(wire));
}
function query(request: ReturnType<typeof transport>) {
  return JSON.parse(String(request.mock.calls[0][1]?.body)).query.query as string;
}

it("reads no unused identity, session, action or consent properties for an anonymous family", async () => {
  const { behavior, wire } = anonymous(), request = transport(wire);
  const [event] = await readPosthogBehavior(behavior, "fixture", request);
  expect(event).toMatchObject({ nativeUuid: uuid, occurredAt: at, receivedAt: null,
    actionId: "action1", sourceSessionId: "session1", distinctId: "anon1",
    identityNamespace: "anonymous", customerId: null, analyticsPermitted: true });
  expect(query(request).split("FROM events")[0].trim()).toBe(
    "SELECT uuid AS uuid, event AS event, timestamp AS timestamp,\n" +
    "    properties.event_id AS event_id,\n" +
    "    properties.session_id AS session_id,\n" +
    "    properties.anonymous_id AS anonymous_id,\n" +
    "    properties.analytics_permitted AS analytics_permitted");
  expect(query(request)).not.toMatch(/distinct_id|reserve_user_id|shopify_customer_id|mully_anon_id|\$insert_id|\$session_id|analytics_consent/);
  expect(query(request)).toContain("LIMIT 101");
});

it("unions mixed-family fields once in deterministic order and decodes each family's own aliases", async () => {
  const { behavior } = anonymous();
  const family: BehaviorSource["families"][string] = { producer: "server", schemaVersion: "v2",
    identityNamespace: "firebase", actionProperty: "$insert_id", sessionProperty: "$session_id",
    identityProperty: "reserve_user_id", consentProperty: "analytics_consent" };
  behavior.families.checkout_clicked = family;
  const wire = {
    columns: ["uuid", "event", "timestamp", "event_id", "insert_id", "session_id",
      "ph_session_id", "anonymous_id", "analytics_permitted", "analytics_consent", "reserve_user_id"],
    results: [
      [uuid, "page_view", at, "action1", null, "session1", null, "anon1", true, null, null],
      ["bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb", "checkout_clicked", at,
        null, "action2", null, "session2", null, null, true, "uid2"],
    ],
  };
  const first = transport(wire);
  const events = await readPosthogBehavior(behavior, "fixture", first);
  expect(events.map(e => [e.actionId, e.sourceSessionId, e.distinctId, e.analyticsPermitted])).toEqual([
    ["action1", "session1", "anon1", true], ["action2", "session2", "uid2", true],
  ]);
  const second = transport(wire);
  behavior.families = { checkout_clicked: family, page_view: behavior.families.page_view };
  expect(await readPosthogBehavior(behavior, "fixture", second)).toEqual(events);
  expect(query(second)).toBe(query(first));
  expect(query(first).match(/properties\.reserve_user_id AS reserve_user_id/g)).toHaveLength(1);
  expect(query(first)).not.toContain("distinct_id");
});

it("preserves explicitly configured native distinct_id, without rewriting its value", async () => {
  const { behavior, wire } = fullFixture();
  wire.results[0][wire.columns.indexOf("distinct_id")] = "synthetic@example.invalid";
  const request = transport(wire);
  const [event] = await readPosthogBehavior(behavior, "fixture", request);
  expect(query(request)).toContain("timestamp AS timestamp,\n    distinct_id AS distinct_id");
  expect(event.distinctId).toBe("synthetic@example.invalid");
  expect(event.identityNamespace).toBe("firebase");
});

it.each([null, false, "true"])("withholds identity/session when configured permission is not boolean true: %s", async consent => {
  const { behavior, wire } = anonymous();
  wire.results[0][wire.columns.indexOf("analytics_permitted")] = consent;
  expect(await readPosthogBehavior(behavior, "fixture", transport(wire))).toMatchObject([{
    analyticsPermitted: false, distinctId: null, sourceSessionId: null, customerId: null,
  }]);
});

it("keeps null configured identifiers missing instead of inventing a fallback", async () => {
  const { behavior, wire } = anonymous();
  wire.results[0][wire.columns.indexOf("anonymous_id")] = null;
  wire.results[0][wire.columns.indexOf("session_id")] = null;
  expect(await readPosthogBehavior(behavior, "fixture", transport(wire))).toMatchObject([{
    analyticsPermitted: true, distinctId: null, sourceSessionId: null, customerId: null,
  }]);
});

it("still rejects missing selected columns, duplicate native lineage and out-of-window events", async () => {
  const { behavior, wire } = anonymous();
  const missing = { columns: wire.columns.slice(0, -1), results: [wire.results[0].slice(0, -1)] };
  await expect(readPosthogBehavior(behavior, "fixture", transport(missing))).rejects.toThrow("behavior_response_shape");
  await expect(readPosthogBehavior(behavior, "fixture", transport({
    ...wire, results: [...wire.results, ...wire.results],
  }))).rejects.toThrow("behavior_native_lineage");
  wire.results[0][wire.columns.indexOf("timestamp")] = behavior.until;
  await expect(readPosthogBehavior(behavior, "fixture", transport(wire))).rejects.toThrow("behavior_event_outside_scope");
});
