import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fullFixture } from "../fixtures/analyticsFull";
import { refreshFixture } from "../fixtures/analyticsRefresh";
import { prepareRefresh } from "@/lib/analytics/refreshPlan";
import { readPosthogBehavior } from "@/lib/analytics/posthogSource";
import { boundBehaviorEvidence } from "@/lib/analytics/fullReportJob";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { mapJourneyPermissions } from "@/lib/analytics/journeyPermissions";
import { deferredOrders, verifyDeferredReplacements } from "@/lib/analytics/deferredCommerce";
import { collectionEvent } from "@/lib/analytics/collection";
import { key } from "@/lib/analytics/primitives";
import { replaySessions } from "../../scripts/analytics/replay-sessions.mjs";
const modules = { prepareRefresh, readPosthogBehavior, boundBehaviorEvidence, buildFullReports, evidenceDigest,
  deferredOrders, verifyDeferredReplacements };

// New entry-point integration fixture only. No live grants or customer evidence.
function fixture() {
  const f = fullFixture(), refresh = refreshFixture();
  const sessionId = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const event = collectionEvent({ journey: "reserve", step: "started", analyticsPermitted: true,
    eventId: "cccccccc-cccc-cccc-cccc-cccccccccccc", sessionId })!;
  const sessionKey = key(refresh.policy.project, refresh.policy.sessionVersion, sessionId);
  refresh.policy.stages = { view: event.event };
  refresh.behavior.families = { [event.event]: {
    ...f.behavior.families.page_view, identityNamespace: "lean_subject", identityProperty: "distinct_id",
    actionProperty: "$insert_id", sessionProperty: "$session_id", schemaVersion: "lean-v1",
  } };
  const e = f.evidence;
  // Use the actual producer mapping and existing grant mapper, still with
  // synthetic source records. No legacy identity fallback or infinite grant.
  const grant = { projectRef: refresh.intake.scope.projectRef, shop: f.shop,
    posthogProject: refresh.policy.project, from: refresh.behavior.from, until: refresh.behavior.until,
    capturedAt: refresh.intake.asOf, grants: [{ subjectId: "uid-fixture",
      validFrom: "2026-01-01T10:00:00Z", expiresAt: "2026-01-02T10:00:00Z", revokedAt: null,
      permissionEvidenceRef: "synthetic:grant" }] };
  e.identity = mapJourneyPermissions({ ...grant, digest: evidenceDigest(grant) },
    { ...grant, asOf: refresh.intake.asOf, mappingVersion: refresh.policy.mappingVersion });
  e.currentlyPermitted = []; e.customerHistory = {}; e.orderIdentities = []; e.attributionCoverage = [];
  e.proofs.find(p => p.table === "customers")!.expectedKeys = [];
  e.proofs.find(p => p.table === "identity_map")!.expectedKeys = [
    JSON.stringify(["lean_subject", "uid-fixture", "2026-01-01T10:00:00Z", "identity-v1"]),
  ];
  e.proofs.find(p => p.table === "sessions")!.expectedKeys = [JSON.stringify([sessionKey])];
  e.checkout[0].sessionKey = sessionKey;
  e.campaigns[0].sessionKey = sessionKey;
  for (const p of refresh.intake.packets) {
    p.payload = e[p.section];
    p.sha256 = evidenceDigest(p.payload);
  }
  return { version: 1, refresh, base: f.base, deferredOrders: [] as unknown[],
    posthogResponse: { columns: ["uuid", "event", "timestamp", "distinct_id",
      "insert_id", "ph_session_id", "analytics_permitted"],
    results: [[f.events[0].nativeUuid, event.event, f.events[0].occurredAt,
      "uid-fixture", event.properties.$insert_id, event.properties.$session_id, true]] },
    expected: { evidenceRef: "synthetic:independent-expectation", independentlyExtracted: true,
      funnel: ["all_sessions", "view"].map(stage_id => ({
        report_date: "2026-01-01", stage_id, measured_sessions: 1, mature_sessions: 1,
        converted_sessions: 1, session_conversion_rate: "1.000000",
      })) },
  };
}
afterEach(() => vi.unstubAllGlobals());
it("replays actual preparation, source normalization, coverage and reports without network or customer history", async () => {
  vi.stubGlobal("fetch", () => { throw new Error("network_forbidden"); });
  const input = fixture(), before = JSON.stringify(input);
  const build = vi.fn(buildFullReports);
  const result = await replaySessions(input, { ...modules, buildFullReports: build });
  expect(result).toMatchObject({ state: "offline_expected_match", hostedCalls: 0,
    replayReads: 1, registered: false, enabled: false, certified: false });
  expect(result.funnel).toHaveLength(2);
  const candidate = build.mock.results[0].value;
  expect(candidate.facts.customers).toEqual([]);
  expect(candidate.facts.sessions[0]).toMatchObject({ customer_id: null, identity_status: "anonymous" });
  expect(candidate.reports.store_daily[0]).toMatchObject({ new_customers: null, ncac_usd: null });
  expect(JSON.stringify(input)).toBe(before);
  expect(JSON.stringify(result)).not.toMatch(/uid-fixture|session-fixture|customer-fixture|checkout-1/);
});
it("requires independent expected aggregates, not candidate-generated defaults", async () => {
  const input = fixture(); input.expected.independentlyExtracted = false;
  await expect(replaySessions(input, modules)).rejects.toThrow("replay_expected_evidence_required");
});
it("rejects a changed evidence packet before touching the source response", async () => {
  const input = fixture(); input.refresh.intake.packets[0].sha256 = "0".repeat(64);
  const reader = vi.fn();
  await expect(replaySessions(input, { ...modules, readPosthogBehavior: reader }))
    .rejects.toThrow("evidence_digest_mismatch");
  expect(reader).not.toHaveBeenCalled();
});
it("does not accept a matching count from an unmapped source family", async () => {
  const input = fixture(); input.refresh.policy.stages = { view: "unmapped" };
  await expect(replaySessions(input, modules)).rejects.toThrow("full_behavior_policy_mismatch");
});
it("rejects source windows after the frozen as-of time", async () => {
  const input = fixture(); input.refresh.behavior.until = "2099-01-01T00:00:00Z";
  // The existing source budget rejects this before any transport can run.
  await expect(replaySessions(input, modules)).rejects.toThrow("behavior_window_budget");
});
it("refuses a commerce-only bundle rather than presenting absent behavior as zero", async () => {
  const input = fixture(); input.refresh.policy.behaviorMode = "excluded";
  await expect(replaySessions(input, modules)).rejects.toThrow("replay_behavior_required");
});
it("preserves the full-job deferred original-purchase check before event replay", async () => {
  const input = fixture();
  input.deferredOrders = [{ orderGid: "gid://shopify/Order/1",
    sourceUpdatedAt: "2026-01-01T13:00:00Z", evidenceRef: "synthetic:missing-original" }];
  const reader = vi.fn();
  await expect(replaySessions(input, { ...modules, readPosthogBehavior: reader }))
    .rejects.toThrow("missing_revision_bound_original_purchase");
  expect(reader).not.toHaveBeenCalled();
});
it("fails instead of overwriting an independently expected count with the candidate", async () => {
  const input = fixture(); input.expected.funnel[0].measured_sessions = 2;
  await expect(replaySessions(input, modules)).rejects.toThrow("replay_funnel_mismatch");
});
it("uses the job's coverage bound rather than certifying a partially read reporting date", async () => {
  const input = fixture(); input.refresh.behavior.from = "2026-01-01T10:00:00Z";
  await expect(replaySessions(input, modules)).rejects.toThrow("replay_funnel_mismatch");
});
it("rejects lost permission rather than matching the expected positive session", async () => {
  const input = fixture(); input.posthogResponse.results[0][6] = false;
  await expect(replaySessions(input, modules)).rejects.toThrow("replay_funnel_mismatch");
});
it("executes the actual CLI, writes aggregate-only output and refuses overwrite", () => {
  const dir = mkdtempSync(join(tmpdir(), "session-replay-test-"));
  try {
    const input = join(dir, "input.json"), out = join(dir, "result");
    writeFileSync(input, JSON.stringify(fixture()));
    const stdout = execFileSync(process.execPath, ["scripts/analytics/replay-sessions.mjs", input, out],
      { encoding: "utf8", timeout: 45000 });
    expect(JSON.parse(stdout)).toMatchObject({ state: "offline_expected_match", hostedCalls: 0 });
    const saved = readFileSync(join(out, "session-validation.json"), "utf8");
    expect(JSON.parse(saved).funnel).toHaveLength(2);
    expect(saved).not.toMatch(/uid-fixture|session-fixture|customer-fixture|checkout-1/);
    expect(() => execFileSync(process.execPath, ["scripts/analytics/replay-sessions.mjs", input, out],
      { stdio: "pipe", timeout: 45000 })).toThrow();
    expect(readFileSync(join(out, "session-validation.json"), "utf8")).toBe(saved);
    expect(existsSync(join(out, "facts.json"))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60000);
it("writes no output directory when the actual CLI finds an aggregate mismatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "session-replay-negative-"));
  try {
    const input = fixture(); input.expected.funnel[0].converted_sessions = 0;
    const file = join(dir, "input.json"), out = join(dir, "must-not-exist");
    writeFileSync(file, JSON.stringify(input));
    expect(() => execFileSync(process.execPath, ["scripts/analytics/replay-sessions.mjs", file, out],
      { stdio: "pipe", timeout: 45000 })).toThrow();
    expect(existsSync(out)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60000);
