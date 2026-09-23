import { expect, it } from "vitest";
import { behaviorDiagnosticView } from "@/lib/analytics/behaviorView";
import { fullFixture } from "../fixtures/analyticsFull";
import { collectionEvent } from "@/lib/analytics/collection";
import { normalizeEvents } from "@/lib/analytics/sessions";

it("prepares a bounded non-materialized view without exposing identity or pretending certification", () => {
  const view = behaviorDiagnosticView(fullFixture().behavior);
  expect(view).toMatchObject({ name: "analytics_events", project: "353503", materialize: false });
  expect(view.query).toContain("timestamp < toDateTime('2026-02-01T00:00:00Z')");
  expect(view.query).toContain("GROUP BY properties.event_id");
  expect(view.query).toContain("'diagnostic_only' AS readiness");
  expect(view.query).not.toMatch(/\bAS (distinct_id|customer_id|session_id|analytics_eligible)\b/);
  expect(view.query).not.toContain("SELECT *");
});
it("rejects injected family/property names and invalid source scope", () => {
  const source = fullFixture().behavior;
  source.families["x' UNION SELECT"] = source.families.page_view;
  expect(() => behaviorDiagnosticView(source)).toThrow("mapping");
});
it("emits the reader's explicit permission field and refuses truthy non-booleans", () => {
  const input = { journey: "reserve" as const, step: "started",
    eventId: "a".repeat(32), sessionId: "b".repeat(32), analyticsPermitted: true };
  expect(collectionEvent(input)?.properties.analytics_permitted).toBe(true);
  expect(collectionEvent({ ...input, analyticsPermitted: "true" as unknown as boolean })).toBeNull();
});
it("strips the session link from denied events even if a source supplies a session id", () => {
  const f = fullFixture();
  const config = { project: f.policy.project, families: new Set(["page_view"]), schemaVersions: new Set(["legacy-v1"]),
    sessionVersion: "s", normalizationVersion: "n", publication: "fixture" };
  const [row] = normalizeEvents([{ ...f.events[0], analyticsPermitted: false }], config);
  expect(row).toMatchObject({ session_key: null, distinct_id: null, session_link_status: "missing" });
});
it("rejects retries whose unresolved identity differs instead of arbitrarily selecting one", () => {
  const f = fullFixture();
  expect(() => normalizeEvents([f.events[0], { ...f.events[0], distinctId: "other",
    nativeUuid: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb" }], {
    project: f.policy.project, families: new Set(["page_view"]), schemaVersions: new Set(["legacy-v1"]),
    sessionVersion: "s", normalizationVersion: "n", publication: "fixture",
  })).toThrow("conflicting_event_retry");
});
