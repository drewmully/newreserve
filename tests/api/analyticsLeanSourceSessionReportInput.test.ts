import { expect, it } from "vitest";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import { prepareSourceSessionReportPacket, sourceSessionReportBinding } from "@/lib/analytics/sourceSessionProducer";
import { SOURCE_SESSION_REPORT_PLAN, sourceReportDay, sourceReportDigest } from "@/lib/analytics/sourceSessionNativeWindow";
import { normalizeCommerce } from "@/lib/analytics/commerce";
import { fullFixture } from "../fixtures/analyticsFull";

// Synthetic source, authority and finance. These fixtures do not attest a live
// native population, completed production base, visitor choice or operating grant.
function fixture(variant: "included" | "outside" | "unknown" = "included", historyFrom = "2026-09-30T00:00:00.000000Z") {
  const f = fullFixture(), date = "2026-10-01", asOf = "2026-10-11T04:00:03.000000Z";
  const shop = "mullybox-store.myshopify.com", projectRef = "xnfjdbpjuaezxjgargto";
  const subject = "a".repeat(64), nativeId = "11111111-1111-4111-8111-111111111111";
  const entryUuid = "22222222-2222-4222-8222-222222222222", grantId = "synthetic-report-grant";
  const filterSha256 = SOURCE_SESSION_REPORT_PLAN.filterSha256, bounds = sourceReportDay(date);
  const target = { mode: "entry_cohort" as const, projectRef, shop, posthogProject: "353503", runId: "b5_cohort_fixture",
    baseRunId: "genuine-base-fixture", fromDate: date, throughDate: date, asOf,
    definition: f.policy.definition, mappingVersion: f.policy.mappingVersion,
    sessionVersion: f.policy.sessionVersion, funnelVersion: f.policy.funnelVersion };
  const receipt = { nativeSessionId: nativeId, capturedAt: "2026-10-01T05:10:00Z", conflicted: false,
    entryUuid, sourceStartedAt: "2026-10-01T05:00:00Z", sourceReadSha256: "b".repeat(64),
    paidLinkUntil: "2026-10-10T05:00:00Z", filterSha256, filterResults: Array<boolean>(6).fill(true),
    subjectId: subject, permissionEvidenceRef: `explicit-browser-choice:source-session-runtime-v3:${subject}`,
    approvalRef: "synthetic:permission", validFrom: "2026-10-01T04:30:00Z", expiresAt: "2026-10-02T04:30:00Z", removed: false };
  const authorityBody = { ...bounds, authorityHistoryFrom: historyFrom, configToken: "c".repeat(32),
    grants: variant === "outside" ? [] : [{ subjectId: subject, validFrom: receipt.validFrom, expiresAt: receipt.expiresAt,
      revokedAt: null, removed: false, permissionEvidenceRef: receipt.permissionEvidenceRef, approvalRef: receipt.approvalRef }],
    receipts: variant === "included" ? [receipt] : [] };
  const authority = (capturedAt: string) => {
    const body = { ...authorityBody, capturedAt, serverDigest: sourceReportDigest(authorityBody) };
    return { ...body, digest: sourceReportDigest(body) };
  };
  const nativeBody = { project: "353503" as const, ...bounds, capturedAt: "2026-10-11T04:00:01.000000Z",
    querySha256: "d".repeat(64), responseSha256: "e".repeat(64), responseBytes: 300,
    planVersion: SOURCE_SESSION_REPORT_PLAN.version,
    rows: [{ project: "353503", nativeSessionId: nativeId, startedAt: receipt.sourceStartedAt,
      endedAt: "2026-10-01T05:30:00Z", entryUuid, entryTimestamp: receipt.sourceStartedAt,
      entryNativeSessionId: nativeId, entryMatches: 1, filterSha256, filterResults: Array<boolean>(6).fill(true) }] };
  const packet = prepareSourceSessionReportPacket({ target,
    reportAuthority: { grantId, grantRevision: "1", claimId: "33333333-3333-4333-8333-333333333333" },
    financialBinding: null, baseBinding: { baseRunId: target.baseRunId, publicationId: `observed:${target.baseRunId}`,
      resultHash: "f".repeat(32), fromDate: date, throughDate: date },
    sourcePolicy: { policyVersion: "source-session-runtime-v3", approvalRef: "synthetic:permission", ttlSeconds: 86400,
      sourceReadKeySha256: "1".repeat(64), webhookKeySha256: "2".repeat(64),
      validUntil: "2026-10-12T04:00:00Z", configToken: authorityBody.configToken },
    entryPolicy: { sourceNamespace: "native-entry", actionNamespace: "native-entry-actions", actionSessionVersion: "native-action-v1",
      sessionVersion: target.sessionVersion, filterVersion: `sha256:${filterSha256}`, filterSha256, filterCount: 6,
      maxReadAgeSeconds: 60, approvalRef: "synthetic:entry" },
    capturedAt: "2026-10-11T04:00:02.000000Z", sourcePlan: SOURCE_SESSION_REPORT_PLAN,
    entries: { native: { ...nativeBody, digest: sourceReportDigest(nativeBody) },
      authorityBefore: authority("2026-10-11T04:00:00.000000Z"), authorityAfter: authority("2026-10-11T04:00:02.000000Z") } });
  const policy = { ...f.policy, cohorts: [], behaviorMode: "excluded" as const, asOf };
  const evidence = { ...f.evidence, identity: [], currentlyPermitted: [], removedCustomers: [], customerHistory: {},
    orderIdentities: [], checkout: [], campaigns: [], attributionCoverage: [], replacements: [], settlements: [], offers: [],
    proofs: [], externalControls: {}, comparisons: [], cohortCoverage: [],
    sessionCoverage: { ...f.evidence.sessionCoverage, behaviorComplete: false, completeThrough: asOf },
    dateCoverage: [{ date, evidenceRef: f.evidence.ref, gates: { ledger: false, cash: false, orders: false, purchase: false,
      customers: false, spend: false, attribution: false, behavior: false, productAllocation: false } }] };
  const base = Object.fromEntries(Object.keys(f.base).map(k => [k, []]));
  Object.assign(base, normalizeCommerce({ ...f.snapshot, shop, createdAt: "2026-10-01T11:00:00Z",
    updatedAt: "2026-10-01T13:00:00Z", paidAt: "2026-10-01T12:00:00Z" },
  { eligibility: "eligible", commerceSource: "storefront", acquisitionEligible: true, approvalRef: "synthetic:financial" },
  `observed:${target.baseRunId}`));
  return { packet, binding: sourceSessionReportBinding(packet), base, policy, evidence,
    publication: `full:${target.runId}`, shop, fromDate: date, throughDate: date, events: [] };
}
function build(f = fixture()) {
  return buildFullReports({ ...f, policy: { ...f.policy, sourceSessionReport: f.binding },
    evidence: { ...f.evidence, sourceSessionReport: f.packet } });
}
it("consumes exact native entry correspondence without action/conversion or financial publication", () => {
  const f = fixture(), result = build(f);
  expect(f.base.orders).toHaveLength(1);
  expect(result.facts.sessions).toHaveLength(1);
  expect(Object.entries(result.facts).filter(([t]) => t !== "sessions").every(([, rows]) => rows.length === 0)).toBe(true);
  expect(result.reports.store_daily).toHaveLength(0);
  expect(result.reports.funnel_daily.find(r => r.stage_id === "all_sessions")?.measured_sessions).toBe(1);
  expect(result.reports.funnel_daily.every(r => r.converted_sessions === null && r.session_conversion_rate === null)).toBe(true);
  expect(result.manifest.gates[0].gates.behavior).toBe(false);
  expect(result.visitorConversion!.entryInventory).toEqual({ native: 1, included: 1, excluded: 0, unknown: 0 });
  expect(result.visitorConversion!.days[0].measuredSessions.value).toBe(1);
  expect(result.visitorConversion!.days[0].knownPaidLinks.orders).toBe(0);
  expect(result.visitorConversion!.days[0].sessionConversionRate.value).toBeNull();
});
it("distinguishes proven outside population from an opted but unbound possible visit", () => {
  expect(build(fixture("outside")).reports.funnel_daily[0].measured_sessions).toBe(0);
  expect(build(fixture("unknown")).reports.funnel_daily[0].measured_sessions).toBeNull();
  expect(build(fixture("outside")).visitorConversion!.days[0].measuredSessions.value).toBe(0);
  expect(build(fixture("unknown")).visitorConversion!.entryInventory).toEqual({ native: 1, included: 0, excluded: 0, unknown: 1 });
  expect(build(fixture("unknown")).visitorConversion!.days[0].measuredSessions.value).toBeNull();
});
it("admits a conclusive older positive without backdating the report authority observation", () => {
  const f = fixture("included", "2026-10-02T04:00:00.000000Z");
  const result = build(f);
  expect(result.reports.funnel_daily[0].measured_sessions).toBe(1);
  expect(f.packet.entries.authorityAfter.authorityHistoryFrom).toBe("2026-10-02T04:00:00.000000Z");
  expect(result.facts.sessions[0].converted_session).toBeNull();
});
it("does not promote old unmatched permission absence to an exclusion", () => {
  expect(build(fixture("outside", "2026-10-02T04:00:00.000000Z")).reports.funnel_daily[0].measured_sessions).toBeNull();
});
it.each([null, undefined, false, []])("refuses malformed named sidecar instead of falling back: %j", value => {
  const f = fixture(); Object.assign(f.policy, { sourceSessionReport: value });
  Object.assign(f.evidence, { sourceSessionReport: value });
  expect(() => buildFullReports(f)).toThrow();
});
it("rejects changed derived membership even after a new packet digest", () => {
  const f = fixture(); f.packet.derived.accounting.included = 0;
  const { digest: _, ...body } = f.packet; void _;
  f.packet.digest = sourceReportDigest(body); f.binding = sourceSessionReportBinding(f.packet);
  expect(() => build(f)).toThrow();
});
it("rejects a cohort with financial authority markers", () => {
  const f = fixture(); Object.assign(f.policy, { salesEventWindow: {} });
  expect(() => build(f)).toThrow();
});
it("keeps the unbound financial builder unchanged", () => {
  const result = buildFullReports(fullFixture());
  expect(result.reports.store_daily[0].spend_usd).toBe("5.000000");
  expect(result.reports.store_daily[0].net_merchandise_sales_usd).toBe("20.000000");
});
it.each([true, false])("returns partial reporting only after a successful actual full finish: %j", async done => {
  const f = fixture(), calls: string[] = []; let written: Record<string, unknown> | undefined;
  const result = await runFullReportJob({ projectRef: f.binding.projectRef,
    databaseUrl: `https://${f.binding.projectRef}.supabase.co`, runId: f.binding.runId, posthogKey: "",
    request: async () => { throw new Error("unexpected unbound provider call"); },
    client: { rpc: async (name, args) => { calls.push(name);
      if (name === "lean_full_inputs") return { data: { state: "ready", publication: f.publication, shop: f.shop,
        fromDate: f.fromDate, throughDate: f.throughDate, facts: f.base, policy: f.policy, evidence: f.evidence,
        behavior: {}, deferredOrders: [], inputHash: "a".repeat(32), sourceSessionReport: f.packet,
        sourceSessionReportBinding: f.binding }, error: null };
      if (name === "lean_full_finish") { written = args; return { data: done, error: null }; }
      return { data: true, error: null };
    } } });
  expect(result.state).toBe(done ? "complete" : "changed");
  expect(Object.hasOwn(result, "visitorConversion")).toBe(done);
  if ("visitorConversion" in result) expect(result.visitorConversion?.days[0].measuredSessions.value).toBe(1);
  expect(calls).toEqual(["lean_full_inputs", "lean_full_claim", "lean_full_finish"]);
  expect((written?.p_reports as Record<string, unknown[]>).store_daily).toHaveLength(0);
});
