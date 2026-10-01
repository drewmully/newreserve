import { afterEach, expect, it, vi } from "vitest";
import { runFullPipeline } from "@/lib/analytics/fullPipeline";
import { prepareFreshGoogleSpend } from "@/lib/analytics/googleSpendRegistration";
import type { AnalyticsRpcClient } from "@/lib/analytics/rpcStore";
import type { SpendBase } from "@/lib/analytics/spend";
import { normalizeSpendBase } from "@/lib/analytics/spend";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";
import { fullFixture, campaignKey } from "../fixtures/analyticsFull";
import type { FreshGoogleSpendReportInput } from "@/lib/analytics/googleSpendReportInput";

function fixture() {
  const now = "2026-01-15T12:00:00.000Z";
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(now);
  const prepared = prepareFreshGoogleSpend({
    version: 1, projectRef: "a".repeat(20), accountId: "1234567890", loginCustomerId: null,
    approvalRef: "synthetic:approval", actorRef: "synthetic:actor", revisionRef: "synthetic:revision",
    credentialBindingRef: "synthetic:binding", coverage: "whole_account_campaign_day",
    sourceCurrency: "USD", sourceTimezone: "America/New_York",
    preparedAt: "2026-01-15T09:00:00Z", freshnessCutoffAt: "2026-01-15T10:00:00Z",
    expiresAt: "2026-01-16T12:00:00Z", maxPages: 1, maxRequestsPerDay: 3, deadlineSeconds: 10,
    days: [{ date: "2026-01-14", dueAt: "2026-01-15T10:00:00Z" }],
  });
  const scope = prepared.registration.args.p_scope;
  const next: Record<string, unknown> = { state: "ready", stage: "spend",
    runId: scope.days[0].runId, freshGoogleSpendManifest: prepared.manifest };
  const pilot = { state: "ready", runId: scope.days[0].runId, accountId: scope.accountId };
  let saved: SpendBase | undefined;
  const rpc = vi.fn<AnalyticsRpcClient["rpc"]>(async (name, args) => {
    if (name === "lean_full_next") return { error: null, data: next };
    if (name === "lean_spend_pilot_next") return { error: null, data: pilot };
    if (name === "lean_spend_claim") return { error: null, data: {
      state: "claimed", accountId: scope.accountId, loginCustomerId: scope.loginCustomerId,
      date: scope.days[0].date, maxPages: scope.maxPages, approvalRef: scope.approvalRef,
    } };
    if (name === "lean_spend_finish") { saved = args.p_base as SpendBase; return { error: null, data: true }; }
    throw new Error("unexpected_rpc");
  });
  const request = vi.fn<typeof fetch>(async (url, init) => {
    if (url === "https://oauth2.googleapis.com/token")
      return Response.json({ access_token: "synthetic-token", token_type: "Bearer" });
    if (url !== `https://googleads.googleapis.com/v25/customers/${scope.accountId}/googleAds:search`)
      throw new Error("unexpected_network");
    const query = JSON.parse(String(init?.body)).query;
    return query.includes("FROM customer")
      ? Response.json({ results: [{ customer: { id: scope.accountId, currencyCode: "USD", timeZone: "America/New_York" } }] })
      : Response.json({ fieldMask: "campaign.id,segments.date,metrics.costMicros,metrics.clicks,metrics.impressions" });
  });
  const options = { client: { rpc }, projectRef: scope.projectRef,
    databaseUrl: `https://${scope.projectRef}.supabase.co`, runId: "synthetic-full", shop: "fixture.myshopify.com",
    shopifyToken: "", posthogKey: "", googleClientId: "synthetic:client",
    googleClientSecret: "synthetic:secret", googleRefreshToken: "synthetic:refresh", now, request };
  return { prepared, scope, next, pilot, rpc, request, options, saved: () => saved };
}
afterEach(() => vi.useRealTimers());

it("routes the exact saved fresh dependency through manifest-bounded collector and preserves its verified empty base", async () => {
  const f = fixture();
  expect(await runFullPipeline(f.options)).toEqual({ state: "partial", stage: "spend" });
  expect(f.rpc.mock.calls.map(([name]) => name)).toEqual([
    "lean_full_next", "lean_spend_pilot_next", "lean_spend_claim", "lean_spend_finish",
  ]);
  expect(f.request).toHaveBeenCalledTimes(3);
  expect(f.saved()).toMatchObject({ baseReportId: f.scope.days[0].runId,
    accountId: f.scope.accountId, rows: [], verifiedEmpty: true, paginationComplete: true });
});

it.each(["missing manifest", "wrong project", "wrong run", "legacy run with manifest"] as const)(
  "rejects %s before pilot claim or source request, never falling back to ordinary spend", async kind => {
    const f = fixture();
    if (kind === "missing manifest") delete f.next.freshGoogleSpendManifest;
    if (kind === "wrong project") f.next.freshGoogleSpendManifest = {
      ...f.prepared.manifest, projectRef: "b".repeat(20),
    };
    if (kind === "wrong run") f.next.runId = "fresh-google:unregistered";
    if (kind === "legacy run with manifest") f.next.runId = "legacy-run";
    await expect(runFullPipeline(f.options)).rejects.toThrow();
    expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["lean_full_next"]);
    expect(f.request).not.toHaveBeenCalled();
  });

it("rejects an independently selected different pilot day before claim or source request", async () => {
  const f = fixture();
  f.pilot.runId = "fresh-google:different";
  await expect(runFullPipeline(f.options)).rejects.toThrow();
  expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["lean_full_next", "lean_spend_pilot_next"]);
  expect(f.request).not.toHaveBeenCalled();
});

it("does not read a source or claim after the immutable manifest expires", async () => {
  const f = fixture();
  vi.setSystemTime(f.prepared.manifest.expiresAt);
  expect(await runFullPipeline(f.options)).toEqual({ state: "expired", stage: "spend" });
  expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["lean_full_next"]);
  expect(f.request).not.toHaveBeenCalled();
});

it("retains ordinary spend dependency dispatch when no fresh manifest is present", async () => {
  const f = fixture();
  f.next.runId = "legacy-run";
  delete f.next.freshGoogleSpendManifest;
  expect(await runFullPipeline(f.options)).toEqual({ state: "partial", stage: "spend" });
  expect(f.rpc.mock.calls.map(([name]) => name)).toEqual(["lean_full_next", "lean_spend_claim", "lean_spend_finish"]);
  expect(f.saved()?.baseReportId).toBe("legacy-run");
});

it.each([
  ["whole_store_eligible_ledger", "whole_store_eligible_customers", true],
  ["selected_product", "selected_product", true],
  ["unverified", "whole_store_eligible_customers", false],
] as const)(
  "passes fresh bases through the actual full job and guards %s ratios before its single finish",
  async (salesScope, customerScope, ledgerComplete) => {
    const dispatch = fixture(), f = fullFixture();
    const plan = prepareFreshGoogleSpend({ ...dispatch.prepared.manifest,
      days: [{ date: f.fromDate, dueAt: "2026-01-15T10:00:00Z" }] });
    const runId = plan.registration.args.p_scope.days[0].runId;
    const source: SpendBase = { provider: "google_ads", accountId: plan.manifest.accountId, date: f.fromDate,
      baseReportId: runId, sourceTimezone: "America/New_York", sourceCurrency: "USD",
      completedAt: "2026-01-15T11:00:00Z", paginationComplete: true, verifiedEmpty: false,
      evidenceRef: `lean_private.spend_jobs/${runId}`, rows: [{ campaignId: "7", costMicros: "5000000" }] };
    const freshGoogleSpend: FreshGoogleSpendReportInput = { manifest: plan.manifest, bases: [source],
      controls: [{ provider: "google_ads", accountId: plan.manifest.accountId, date: f.fromDate,
        sourceCurrency: "USD", sourceTimezone: "America/New_York", capturedAt: "2026-01-15T11:30:00Z",
        evidenceRef: "synthetic:independent-control", independentlyExtracted: true, complete: true,
        verifiedEmpty: false, totalCostMicros: "5000000", campaigns: [{ id: "7", costMicros: "5000000" }] }],
      marketingInventory: { shop: f.shop, dates: [f.fromDate],
        accounts: [{ provider: "google_ads", accountId: plan.manifest.accountId }],
        complete: true, independentlyExtracted: true, evidenceRef: "synthetic:inventory",
        approvalRef: "synthetic:scope", capturedAt: "2026-01-15T11:30:00Z", salesScope,
        salesCoverageRef: salesScope === "whole_store_eligible_ledger" ? "synthetic:whole-store" : null,
        customerScope, customerCoverageRef: customerScope === "whole_store_eligible_customers"
          ? "synthetic:whole-store-customers" : null } };
    f.base.marketing_spend_daily = normalizeSpendBase(source, "base");
    f.evidence.proofs.find(p => p.table === "marketing_spend_daily")!.expectedKeys = [
      JSON.stringify(["google_ads", plan.manifest.accountId, campaignKey, f.fromDate, runId]),
    ];
    f.policy.asOf = f.behavior.until = dispatch.options.now;
    f.evidence.dateCoverage[0].gates.ledger = ledgerComplete;
    let reports: Record<string, Record<string, unknown>[]> = {};
    const rpc = vi.fn<AnalyticsRpcClient["rpc"]>(async (name, args) => {
      if (name === "lean_full_inputs") return { error: null, data: {
        state: "ready", ...f, facts: f.base, inputHash: "synthetic:input", freshGoogleSpend,
      } };
      if (name === "lean_full_finish") reports = args.p_reports as typeof reports;
      if (["lean_full_claim", "lean_full_finish", "lean_full_fail"].includes(name))
        return { error: null, data: true };
      throw new Error("unexpected_rpc");
    });
    const request = vi.fn(async () => Response.json(f.wire));
    expect(await runFullReportJob({ client: { rpc }, projectRef: dispatch.scope.projectRef,
      databaseUrl: dispatch.options.databaseUrl, runId: "fixture", posthogKey: "synthetic:key", request }))
      .toMatchObject({ state: "complete" });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["lean_full_inputs", "lean_full_claim", "lean_full_finish"]);
    expect(reports.store_daily[0]).toMatchObject({ spend_usd: "5.000000",
      mer: salesScope === "whole_store_eligible_ledger" ? "4.000000" : null,
      ncac_usd: customerScope === "whole_store_eligible_customers" ? "5.000000" : null });
    expect(reports.acquisition_daily[0].first_party_roas).toBe("4.000000");
    expect(request).toHaveBeenCalledTimes(1);
  });
