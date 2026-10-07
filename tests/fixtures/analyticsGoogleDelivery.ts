import { prepareFreshGoogleSpend } from "@/lib/analytics/googleSpendRegistration";
import type { GoogleDeliveryBinding } from "@/lib/analytics/googleDeliveryReport";
import type { FreshGoogleSpendReportInput } from "@/lib/analytics/googleSpendReportInput";
import type { GoogleWorkbookRegistration } from "@/lib/analytics/googleWorkbookRegistration";
import { fullFixture, fullProject, fullShop } from "./analyticsFull";

/** Synthetic closed day, fixed account IDs; current timestamps only for SQL expiry checks. */
export function googleDeliveryFixture(now = Date.now()) {
  const time = (offset: number) => new Date(now + offset).toISOString();
  const manifest = { version: 1, projectRef: fullProject, accountId: "1234567890", loginCustomerId: "9876543210",
    approvalRef: "fixture:source", actorRef: "fixture:owner", revisionRef: "fixture:revision",
    credentialBindingRef: "fixture:dedicated-auth", coverage: "whole_account_campaign_day",
    sourceCurrency: "USD", sourceTimezone: "America/New_York", preparedAt: time(-120000),
    expiresAt: time(3600000), freshnessCutoffAt: time(-60000),
    maxPages: 1, maxRequestsPerDay: 3, deadlineSeconds: 60,
    days: [{ date: "2026-01-01", dueAt: time(-60000) }] };
  const prepared = prepareFreshGoogleSpend(manifest), run = prepared.registration.args.p_scope.days[0].runId;
  const binding: GoogleDeliveryBinding = { version: 1, accountId: manifest.accountId, date: "2026-01-01",
    definitionVersion: "google-account-daily-v1", approvalRef: "fixture:optional-output",
    control: { evidenceRef: "fixture:independent-counts", capturedAt: time(-1000), complete: true,
      independentlyExtracted: true, clickDefinition: "google_ads.metrics.clicks", clicks: "4", impressions: "20",
      campaigns: [{ id: "7", clicks: "1", impressions: "5" }, { id: "8", clicks: "3", impressions: "15" }] } };
  const fresh: FreshGoogleSpendReportInput = { manifest, bases: [{
    provider: "google_ads", accountId: manifest.accountId, date: "2026-01-01", baseReportId: run,
    sourceCurrency: "USD", sourceTimezone: "America/New_York", completedAt: time(-2000),
    paginationComplete: true, verifiedEmpty: false, evidenceRef: `lean_private.spend_jobs/${run}`,
    rows: [{ campaignId: "7", costMicros: "3000000", clicks: "1", impressions: "5" },
      { campaignId: "8", costMicros: "9000000", clicks: "3", impressions: "15" }],
  }], controls: [{ provider: "google_ads", accountId: manifest.accountId, date: "2026-01-01",
    sourceCurrency: "USD", sourceTimezone: "America/New_York", capturedAt: time(-1000),
    evidenceRef: "fixture:independent-cost", independentlyExtracted: true, complete: true,
    verifiedEmpty: false, totalCostMicros: "12000000",
    campaigns: [{ id: "7", costMicros: "3000000" }, { id: "8", costMicros: "9000000" }] }],
  marketingInventory: { shop: fullShop, dates: ["2026-01-01"], accounts: [{ provider: "google_ads", accountId: manifest.accountId }],
    complete: false, independentlyExtracted: true, evidenceRef: "fixture:not-all-marketing",
    approvalRef: "fixture:scope", capturedAt: time(-1000), salesScope: "unverified", salesCoverageRef: null,
    customerScope: "unverified", customerCoverageRef: null } };
  const f = fullFixture();
  const packet: GoogleWorkbookRegistration = { version: 1, projectRef: fullProject, shop: fullShop,
    runId: "google-fixture", baseRunId: "google-base", historyRuns: ["fixture-history"],
    reportPolicy: {}, fullPolicy: { ...f.policy, asOf: time(0), behaviorMode: "excluded" },
    evidence: f.evidence, behavior: {}, freshGoogleSpend: { manifest, controls: fresh.controls,
      marketingInventory: fresh.marketingInventory }, googleDelivery: binding,
    approvalRef: "fixture:registration", actorRef: "fixture:owner" };
  const input = { binding, fresh, projectRef: fullProject, publication: "full:google-fixture", shop: fullShop,
    fromDate: "2026-01-01", throughDate: "2026-01-01", asOf: time(0) };
  return { input, packet, prepared, binding, fresh, full: f };
}
