import { describe, expect, it } from "vitest";
import { deriveEntrySessions, mapEntryCheckoutEvidence, mapEntryObservations, prepareSessionEntries,
  sessionEntryDayCount, type SessionEntryPolicy, type SourceSessionEntryInput } from "@/lib/analytics/sessionEntryInput";
import { finalizeSessionConversions, normalizeEvents, type ObservedEvent } from "@/lib/analytics/sessions";
import type { IdentityEvidence } from "@/lib/analytics/identity";
import { key } from "@/lib/analytics/primitives";

// All populations/subjects/relations below are synthetic. These are not source or consent evidence.
const filterSha256 = "61504f7e32de2ff2d4197a26e25ba57f412891b9c03e6d27b3ef7568e3829819";
function fixture(asOf = "2026-10-11T04:00:00Z") {
  const policy: SessionEntryPolicy = { sourceNamespace: "posthog_native_session", actionNamespace: "lean_grant",
    actionSessionVersion: "grant-v2-fixture", sessionVersion: "native-entry-fixture-v1", filterVersion: `sha256:${filterSha256}`,
    filterSha256, filterCount: 6, maxReadAgeSeconds: 60, approvalRef: "synthetic:policy" };
  const input: SourceSessionEntryInput = { project: "353503", sourceNamespace: policy.sourceNamespace,
    sessionVersion: policy.sessionVersion, from: "2026-10-01T04:00:00Z", until: "2026-10-02T04:00:00Z",
    capturedAt: asOf, complete: true, sourceRef: "synthetic:source", permissionSnapshotRef: "synthetic:permission",
    filterVersion: policy.filterVersion, filterSha256, filterEvaluationRef: "synthetic:filter-query",
    entries: ["native-a", "native-b"].map((id, i) => ({ sourceSessionId: id,
      startedAt: `2026-10-01T0${5 + i}:00:00Z`, endedAt: `2026-10-01T0${5 + i}:30:00Z`,
      clock: "source_session_start", sourceRecordRef: `synthetic:source:${id}`, identityNamespace: "lean_subject",
      identifier: `subject-${i}`, subjectEvidenceRef: `synthetic:exact-subject:${i}`, filterResults: Array(6).fill(true) })),
    relations: [{ actionNamespace: policy.actionNamespace, actionSessionId: "grant-a", sourceSessionId: "native-a",
      identityNamespace: "lean_subject", identifier: "subject-0", evidenceRef: "synthetic:exact-relation" }] };
  const identity: IdentityEvidence[] = input.entries.map(e => ({ namespace: e.identityNamespace, identifier: e.identifier,
    customerId: null, from: "2026-10-01T04:00:00Z", to: "2026-10-02T04:00:00Z", type: "analytics_grant",
    evidenceRef: "synthetic:permission-record", mappingVersion: "identity-fixture-v1",
    resolution: "unresolved", consent: "permitted", removal: "active" }));
  const context = { policy, project: "353503", sessionVersion: policy.sessionVersion,
    mappingVersion: "identity-fixture-v1", publication: "fixture", asOf, identity,
    currentlyPermitted: [] as string[], removedCustomers: [] as string[] };
  const event: ObservedEvent = { project: "353503", producer: "reserve", actionId: "action-a",
    nativeUuid: "uuid-fixture", family: "lean_reserve_started", schemaVersion: "v1",
    occurredAt: "2026-10-01T05:10:00Z", receivedAt: null, sourceSessionId: "grant-a",
    distinctId: "subject-0", identityNamespace: "lean_subject", customerId: null, analyticsPermitted: true };
  const config = { funnelVersion: "funnel-fixture", publication: "fixture", now: asOf,
    stages: new Map([["started", "lean_reserve_started"]]), relationsComplete: true,
    coverage: { behaviorComplete: true, completeThrough: "2026-10-09T06:00:00Z",
      graceSeconds: 48 * 3600, approvalRef: "synthetic:coverage" } };
  return { input, context, event, config };
}
function calculate(f = fixture()) {
  const prepared = prepareSessionEntries(f.input, f.context);
  const actions = mapEntryObservations([f.event], prepared);
  const logical = normalizeEvents(actions.events, { project: "353503", publication: "fixture",
    families: new Set(["lean_reserve_started"]), schemaVersions: new Set(["v1"]),
    sessionVersion: f.context.sessionVersion, normalizationVersion: "fixture" });
  const sessions = deriveEntrySessions(logical, prepared, { ...f.config, relationsComplete: actions.unmappedActions === 0 });
  return { prepared, logical, sessions, actions };
}
describe("exact source-entry integration", () => {
  it("includes zero-action entries and uses true source starts, never quiz or Allow time", () => {
    const r = calculate();
    expect(r.sessions).toHaveLength(2);
    expect(r.sessions[0]).toMatchObject({ source_session_id: "native-a", started_at: "2026-10-01T05:00:00Z",
      ended_at: "2026-10-01T05:30:00Z", customer_id: null, eligible_event_count: 1 });
    expect(r.sessions[1]).toMatchObject({ source_session_id: "native-b", eligible_event_count: 0,
      analytics_eligible: true, funnel_flags: { started: false } });
    expect(r.logical).toHaveLength(1); // No fabricated entry event.
    expect(sessionEntryDayCount(r.prepared, "2026-10-01")).toBe(2);
    expect(JSON.stringify(r.prepared.lineage)).not.toMatch(/native-a|subject-0|grant-a/);
  });
  it("counts sessions immediately without making immature purchases false", () => {
    const f = fixture("2026-10-02T04:00:00Z"), r = calculate(f);
    expect(sessionEntryDayCount(r.prepared, "2026-10-01")).toBe(2);
    expect(r.sessions.every(s => s.conversion_window_complete === false)).toBe(true);
    expect(finalizeSessionConversions(r.sessions, [], true).every(s => s.converted_session === null)).toBe(true);
  });
  it("counts entries independently while missing action coverage withholds stages/conversion", () => {
    const f = fixture(); f.config.coverage.behaviorComplete = false;
    const r = calculate(f);
    expect(sessionEntryDayCount(r.prepared, "2026-10-01")).toBe(2);
    expect(r.sessions.every(s => s.behavior_complete === false && s.conversion_window_complete === false)).toBe(true);
    expect(r.sessions[1].funnel_flags).toEqual({ started: null });
  });
  it("uses exact grant-to-native relation, not coincident IDs", () => {
    const f = fixture(); f.input.relations = []; f.event.sourceSessionId = "native-a";
    const r = calculate(f);
    expect(r.actions.unmappedActions).toBe(1);
    expect(r.logical[0].session_key).toBeNull();
    expect(sessionEntryDayCount(r.prepared, "2026-10-01")).toBe(2);
    expect(r.sessions.every(s => s.behavior_complete === false)).toBe(true);
  });
  it.each(["quiz", "grant", "first_observed"])("rejects a %s clock relabeled as entry", clock => {
    const f = fixture(); Object.assign(f.input.entries[0], { clock });
    expect(() => prepareSessionEntries(f.input, f.context)).toThrow("entry_record_shape");
  });
  it.each(["2026-10-01T04:59:59.999999Z", "2026-10-01T05:30:00.000001Z"])("rejects action outside exact source session at %s", at => {
    const f = fixture(); f.event.occurredAt = at;
    expect(() => calculate(f)).toThrow("entry_action_relation");
  });
  it("rejects one grant mapped to two visits instead of using proximity", () => {
    const f = fixture(); f.input.relations.push({ ...f.input.relations[0] });
    expect(() => prepareSessionEntries(f.input, f.context)).toThrow("entry_ambiguous_relation");
  });
  it.each(["project", "sourceNamespace", "sessionVersion", "filterVersion", "filterSha256"] as const)("rejects mismatched %s binding", field => {
    const f = fixture(); f.input[field] = "unbound";
    expect(() => prepareSessionEntries(f.input, f.context)).toThrow("entry_source_binding");
  });
  it.each([0, 1, 2, 3, 4, 5])("applies known exclusion predicate %i without exporting its value", index => {
    const f = fixture(); f.input.entries[0].filterResults[index] = false;
    const p = prepareSessionEntries(f.input, f.context);
    expect(sessionEntryDayCount(p, "2026-10-01")).toBe(1);
    expect(p.lineage.excludedEntries).toBe(1);
  });
  it("withholds unknown filters and missing predicate output rather than treating them as pass", () => {
    const f = fixture(); f.input.entries[0].filterResults[2] = null;
    const p = prepareSessionEntries(f.input, f.context);
    expect(sessionEntryDayCount(p, "2026-10-01")).toBeNull();
    f.input.entries[0].filterResults = [true];
    expect(() => prepareSessionEntries(f.input, f.context)).toThrow("entry_record_shape");
  });
  it("does not backdate Allow, even if the subsequent action was permitted", () => {
    const f = fixture(); f.context.identity[0].from = f.event.occurredAt;
    const p = prepareSessionEntries(f.input, f.context);
    expect(p.lineage.unknownEntries).toBe(1);
    expect(sessionEntryDayCount(p, "2026-10-01")).toBeNull();
  });
  it.each(["denied", "removed"] as const)("excludes known current %s permission", state => {
    const f = fixture();
    if (state === "denied") f.context.identity[0].consent = "denied";
    else f.context.identity[0].removal = "removed";
    expect(sessionEntryDayCount(prepareSessionEntries(f.input, f.context), "2026-10-01")).toBe(1);
  });
  it("preserves exclusive microsecond permission expiry", () => {
    const f = fixture(); f.context.identity[0].to = "2026-10-01T05:00:00.000000Z";
    expect(prepareSessionEntries(f.input, f.context).lineage.unknownEntries).toBe(1);
    f.context.identity[0].to = "2026-10-01T05:00:00.000001Z";
    expect(prepareSessionEntries(f.input, f.context).lineage.unknownEntries).toBe(0);
  });
  it("does not accept mismatched subject or injected customer identities", () => {
    const f = fixture(); f.event.distinctId = "other";
    expect(() => calculate(f)).toThrow("entry_action_relation");
    f.event.distinctId = "subject-0"; f.event.customerId = "forged-customer";
    expect(() => calculate(f)).toThrow("entry_logical_conflict");
  });
  it("strips later campaign tags without labeling untagged entry direct", () => {
    const f = fixture(); f.event.campaignContext = { channel: "paid", direct: false, campaignKey: "later", evidenceRef: "synthetic:later" };
    const r = calculate(f);
    expect(r.actions.events[0].campaignContext).toBeUndefined();
    expect(r.sessions.every(s => s.campaign_id === null && s.traffic_source === null)).toBe(true);
  });
  it("translates existing checkout evidence but never creates an order or paid relation", () => {
    const p = calculate().prepared;
    expect(mapEntryCheckoutEvidence([], p)).toEqual({ checkout: [], unmappedCheckout: 0 });
    const link = { orderId: "synthetic:order", sessionKey: key("353503", "grant-v2-fixture", "grant-a"),
      evidenceRef: "synthetic:independent-paid-link", method: "verified_first_party_context" as const };
    const result = mapEntryCheckoutEvidence([link, { ...link, sessionKey: "unknown" }], p);
    expect(result.unmappedCheckout).toBe(1);
    expect(result.checkout).toHaveLength(1);
    expect(result.checkout[0]).toMatchObject({ orderId: link.orderId, sessionKey: key("353503", "native-entry-fixture-v1", "native-a") });
  });
  it("rejects duplicate source entry keys/records rather than silently repairing source counts", () => {
    const f = fixture(); f.input.entries.push({ ...f.input.entries[0] });
    expect(() => prepareSessionEntries(f.input, f.context)).toThrow("entry_duplicate_lineage");
  });
  it.each(["partial", "late-start", "early-end"])("withholds %s entry window", state => {
    const f = fixture();
    if (state === "partial") f.input.complete = false;
    if (state === "late-start") f.input.from = "2026-10-01T04:01:00Z";
    if (state === "early-end") f.input.until = "2026-10-02T03:59:59Z";
    expect(sessionEntryDayCount(prepareSessionEntries(f.input, f.context), "2026-10-01")).toBeNull();
  });
  it("does not round a partial NY window up at a microsecond boundary", () => {
    const f = fixture(); f.input.from = "2026-10-01T04:00:00.000001Z";
    expect(sessionEntryDayCount(prepareSessionEntries(f.input, f.context), "2026-10-01")).toBeNull();
  });
  it("supports an independently complete empty eligible entry cohort as real zero", () => {
    const f = fixture(); f.input.entries = []; f.input.relations = []; f.context.identity = [];
    const p = prepareSessionEntries(f.input, f.context);
    expect(sessionEntryDayCount(p, "2026-10-01")).toBe(0);
    expect(deriveEntrySessions([], p, f.config)).toEqual([]);
  });
  it("requires 7 days plus full 48-hour grace from actual entry", () => {
    const f = fixture("2026-10-10T04:59:59Z");
    expect(calculate(f).sessions[0].conversion_window_complete).toBe(false);
    f.input.capturedAt = f.context.asOf = f.config.now = "2026-10-10T05:00:00Z";
    expect(calculate(f).sessions[0].conversion_window_complete).toBe(true);
  });
  it("rejects stale source reads, future end clocks, and 10001-row input", () => {
    const f = fixture(); f.input.capturedAt = "2026-10-11T03:58:59Z";
    expect(() => prepareSessionEntries(f.input, f.context)).toThrow("entry_source_clock");
    f.input.capturedAt = f.context.asOf; f.input.entries[0].endedAt = "2026-10-12T00:00:00Z";
    expect(() => prepareSessionEntries(f.input, f.context)).toThrow("entry_end_clock");
    f.input.entries = Array(10001).fill(f.input.entries[0]);
    expect(() => prepareSessionEntries(f.input, f.context)).toThrow("entry_source_budget");
  });
  it.each([
    ["2026-03-08", "2026-03-08T05:00:00Z", "2026-03-09T04:00:00Z"],
    ["2026-11-01", "2026-11-01T04:00:00Z", "2026-11-02T05:00:00Z"],
  ])("uses exact NY %s boundary across DST", (date, from, until) => {
    const f = fixture(until); f.input.from = from; f.input.until = until;
    f.input.entries = []; f.input.relations = []; f.context.identity = [];
    expect(sessionEntryDayCount(prepareSessionEntries(f.input, f.context), date)).toBe(0);
    f.input.until = new Date(Date.parse(until) - 1000).toISOString();
    expect(sessionEntryDayCount(prepareSessionEntries(f.input, f.context), date)).toBeNull();
  });
});
