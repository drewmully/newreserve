import { expect, it, vi } from "vitest";
import { PROVISIONAL_CALCULATION_DEFAULTS, sessionConversionWindowDays } from "@/lib/analytics/calculationPolicy";
import { deriveSessions, finalizeSessionConversions, normalizeEvents } from "@/lib/analytics/sessions";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import { prepareRefresh } from "@/lib/analytics/refreshPlan";
import { fullFixture, fullProject, sessionKey } from "../fixtures/analyticsFull";
import { refreshFixture } from "../fixtures/analyticsRefresh";

const start = "2026-01-01T11:00:00Z";
const at = (days: number) => new Date(Date.parse(start) + days * 86400000).toISOString();
function sessionConfig(conversionWindowDays?: number) {
  const f = fullFixture();
  return { project: f.policy.project, sessionVersion: f.policy.sessionVersion,
    funnelVersion: f.policy.funnelVersion, publication: f.publication,
    sourceSessionIds: new Map([[sessionKey, "session-fixture"]]),
    stages: new Map([["view", "page_view"]]), now: at(20),
    coverage: { behaviorComplete: true, completeThrough: at(20), graceSeconds: 0, approvalRef: "fixture:coverage" },
    conversionWindowDays };
}
function sessions(config = sessionConfig()) {
  const f = fullFixture();
  const events = normalizeEvents(f.events, { ...config,
    families: new Set(["page_view"]), schemaVersions: new Set(["legacy-v1"]),
    normalizationVersion: f.policy.normalizationVersion });
  return deriveSessions(events, config);
}
function order(paidAt: string) {
  return { publication_id: fullFixture().publication, checkout_link_status: "matched",
    checkout_session_key: sessionKey, eligibility_status: "eligible", paid_at: paidAt };
}

it("exports only provisional calculation choices, without authority or readiness defaults", () => {
  expect(PROVISIONAL_CALCULATION_DEFAULTS).toEqual({ conversionWindowDays: 7,
    attributionLookbackDays: 30, allowObservedDirectFallback: false,
    conversionTimeBasis: "orders.paid_at", ingestionGraceSeconds: 172800, cohortHorizonDays: 30 });
  expect(sessionConversionWindowDays()).toBe(7);
  expect(sessionConversionWindowDays(1)).toBe(1);
  expect(sessionConversionWindowDays(365)).toBe(365);
});

it("keeps omitted and explicit seven-day behavior identical for old callers", () => {
  expect(sessions()).toEqual(sessions(sessionConfig(7)));
  const old = finalizeSessionConversions(sessions(), [order(at(6))], true);
  expect(finalizeSessionConversions(sessions(), [order(at(6))], true, 7)).toEqual(old);
  expect(old[0].converted_session).toBe(true);
  expect(finalizeSessionConversions(sessions(), [order(at(7))], true)[0].converted_session).toBe(false);
  const f = fullFixture(), before = buildFullReports(f);
  f.policy.conversionWindowDays = 7;
  expect(buildFullReports(f)).toEqual(before);
});

it("uses the configured window plus grace for maturity, with independent coverage still required", () => {
  const config = sessionConfig(1);
  config.coverage.graceSeconds = PROVISIONAL_CALCULATION_DEFAULTS.ingestionGraceSeconds;
  config.now = new Date(Date.parse(at(3)) - 1).toISOString();
  expect(sessions(config)[0].conversion_window_complete).toBe(false);
  config.now = at(3);
  expect(sessions(config)[0].conversion_window_complete).toBe(true);
  config.coverage.completeThrough = new Date(Date.parse(at(1)) - 1).toISOString();
  expect(sessions(config)[0].conversion_window_complete).toBe(false);
  config.coverage.completeThrough = at(1);
  expect(sessions(config)[0].conversion_window_complete).toBe(true);
  config.coverage.behaviorComplete = false;
  expect(sessions(config)[0].conversion_window_complete).toBe(false);
});

it("uses the same half-open configurable interval for conversion, including the start boundary", () => {
  const measured = sessions(sessionConfig(2));
  for (const [paidAt, converted] of [
    [new Date(Date.parse(start) - 1).toISOString(), false], [start, true],
    [new Date(Date.parse(at(2)) - 1).toISOString(), true], [at(2), false],
  ] as const) {
    expect(finalizeSessionConversions(measured, [order(paidAt)], true, 2)[0].converted_session).toBe(converted);
  }
});

it("keeps unavailable or immature conversion null, not a final zero", () => {
  expect(finalizeSessionConversions(sessions(sessionConfig(1)), [], false, 1)[0].converted_session).toBeNull();
  const config = sessionConfig(1); config.now = at(0);
  expect(finalizeSessionConversions(sessions(config), [], true, 1)[0].converted_session).toBeNull();
  config.now = at(20); config.coverage.behaviorComplete = false;
  expect(finalizeSessionConversions(sessions(config), [], true, 1)[0].converted_session).toBeNull();
  expect(finalizeSessionConversions(sessions(sessionConfig(1)), [], true, 1)[0].converted_session).toBe(false);
});

it.each([0, -1, 1.5, 366, Infinity, NaN, Number.MAX_SAFE_INTEGER, null, "7"])(
  "rejects invalid window %s even for empty inputs and before preparing a bundle", value => {
    const invalid = value as number;
    expect(() => deriveSessions([], sessionConfig(invalid))).toThrow("invalid_session_conversion_window");
    expect(() => finalizeSessionConversions([], [], false, invalid)).toThrow("invalid_session_conversion_window");
    const f = fullFixture(); f.policy.conversionWindowDays = invalid;
    expect(() => buildFullReports(f)).toThrow("invalid_session_conversion_window");
    const refresh = refreshFixture(); refresh.policy.conversionWindowDays = invalid;
    expect(() => prepareRefresh(refresh)).toThrow("invalid_session_conversion_window");
  });

it("carries explicit versioned policy through the refresh digest and saved full-build input", () => {
  const refresh = refreshFixture(), original = prepareRefresh(refresh);
  refresh.policy = { ...refresh.policy, conversionWindowDays: 2,
    definition: "fixture-two-day-v2", funnelVersion: "fixture-two-day-funnel-v2" };
  const changed = prepareRefresh(refresh);
  expect(changed.full.policy).toEqual(refresh.policy);
  expect(changed.runId).not.toBe(original.runId);
  expect(changed.digest).not.toBe(original.digest);
  expect(changed.full.evidence).toEqual(original.full.evidence);
});

it("propagates one policy window to both full-build maturity and order conversion", () => {
  const f = fullFixture();
  f.policy = { ...f.policy, conversionWindowDays: 2, asOf: at(3),
    definition: "fixture-two-day-v2", funnelVersion: "fixture-two-day-funnel-v2" };
  f.base.orders[0].paid_at = at(2);
  const result = buildFullReports(f);
  expect(result.facts.sessions[0]).toMatchObject({ conversion_window_complete: true, converted_session: false,
    funnel_version: "fixture-two-day-funnel-v2" });
  expect(result.reports.funnel_daily[0]).toMatchObject({ definition_version: "fixture-two-day-v2",
    funnel_version: "fixture-two-day-funnel-v2", session_conversion_rate: "0.000000" });
  expect(Object.keys(result.manifest).sort()).toEqual(["digest", "evidenceRef", "gates", "logicalEvents", "nativeEvents"]);
  f.policy.asOf = at(1);
  f.base.orders[0].paid_at = start;
  expect(buildFullReports(f).reports.funnel_daily[0].session_conversion_rate).toBeNull();
});

it("consumes the saved window unchanged in the full job and rejects bad configuration before reading events", async () => {
  const f = fullFixture();
  f.policy = { ...f.policy, conversionWindowDays: 2,
    definition: "fixture-two-day-v2", funnelVersion: "fixture-two-day-funnel-v2" };
  f.base.orders[0].paid_at = at(2);
  const input = { state: "ready", policy: f.policy, evidence: f.evidence, behavior: f.behavior,
    facts: f.base, publication: f.publication, shop: f.shop, fromDate: f.fromDate,
    throughDate: f.throughDate, inputHash: "fixture:input", deferredOrders: [] };
  const rpc = vi.fn(async (name: string, args?: Record<string, unknown>) => {
    void args; return { data: name === "lean_full_inputs" ? input : true, error: null };
  });
  const request = vi.fn<typeof fetch>(async () => Response.json(f.wire));
  const options = { client: { rpc }, projectRef: fullProject, databaseUrl: `https://${fullProject}.supabase.co`,
    runId: "fixture:run", posthogKey: "fixture", request };
  await expect(runFullReportJob(options)).resolves.toMatchObject({ state: "complete" });
  const finished = rpc.mock.calls.find(([name]) => name === "lean_full_finish")![1]!;
  expect((finished.p_facts as { sessions: object[] }).sessions[0]).toMatchObject({ converted_session: false });
  input.policy.conversionWindowDays = 0;
  rpc.mockClear(); request.mockClear();
  await expect(runFullReportJob(options)).rejects.toThrow("invalid_session_conversion_window");
  expect(rpc.mock.calls.map(([name]) => name)).toEqual(["lean_full_inputs"]);
  expect(request).not.toHaveBeenCalled();
});
