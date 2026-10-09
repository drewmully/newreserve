import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import { prepareMetaWorkbook, type MetaWorkbookSources } from "@/lib/analytics/metaWorkbookPreparation";
import { metaHourlyPacketFromCaptures, type MetaGraphCapture } from "@/lib/analytics/metaHourlySpendInput";
import { bindSalesEventWindow } from "@/lib/analytics/salesEventWindowPreparation";
import { salesEventLocatorQuery, paymentEventLocatorQuery } from "@/lib/analytics/salesEventWindowInput";
import { prepareFreshGoogleSpend } from "@/lib/analytics/googleSpendRegistration";
import { fullFixture } from "../fixtures/analyticsFull";
import { runFullReportJob } from "@/lib/analytics/fullReportJob";

// Every source and authority below is synthetic. No network or real operating input.
function fixture(empty = false): MetaWorkbookSources {
  const projectRef = "xnfjdbpjuaezxjgargto", shop = "mullybox-store.myshopify.com", date = "2026-10-06";
  const cycle = "11111111-1111-4111-8111-111111111111";
  const iso = (m: string) => `2026-10-08T00:${m}:00.000Z`;
  const at = iso("11"), approvalRef = "synthetic:separate-owner", actorRef = "synthetic:owner";
  const retain = (value: unknown) => {
    const json = JSON.stringify(value);
    return { json, sha256: createHash("sha256").update(json).digest("hex"),
      startedAt: at, finishedAt: at, evidenceRef: "synthetic:source" };
  };
  const query = salesEventLocatorQuery(date, date);
  const names = ["order_id", "second", "is_sales_reversal", "orders", "quantity_ordered", "reversed_quantity",
    "gross_sales", "discounts", "sales_reversals", "net_sales", "shipping_charges", "taxes", "duties", "additional_fees", "total_sales"];
  const types = ["IDENTITY", "SECOND_TIMESTAMP", "BOOLEAN", "INTEGER", "INTEGER", "INTEGER", ...Array<string>(9).fill("MONEY")];
  const paymentNames = ["order_id", "transaction_id", "second", "payment_gateway", "transaction_kind", "transaction_status",
    "transaction_currency", "gross_payments", "refunded_payments", "net_payments", "transactions"];
  const source = bindSalesEventWindow({
    version: 1, scope: { projectRef, shop, fromDate: date, throughDate: date,
      sourceTimezone: "America/New_York", sourceCurrency: "USD" }, sources: [],
    locator: { ...retain({ sourceType: "shopify_connector", startedAt: at, finishedAt: at, query,
      result: { structured_content: { query, shopDomain: shop, chartHint: { currencyCode: "USD" },
        columns: names.map((name, i) => ({ name, dataType: types[i] })), rows: [], rowCount: 0 } } }),
      sourceType: "shopify_connector", apiVersion: null },
    paymentControls: { ...retain({ shopDomain: shop,
      columns: paymentNames.map((name, i) => ({ name, dataType: i < 2 ? "IDENTITY" : i === 2 ? "SECOND_TIMESTAMP" :
        i < 7 ? "STRING" : i === 10 ? "INTEGER" : "MONEY" })),
      results: [{ query: paymentEventLocatorQuery(date), rows: [], rowCount: 0 }] }),
      sourceType: "shopify_connector", apiVersion: null, captureBasis: "recorded_interval" },
    metadata: retain({ projectRef, shop, cutoff: at, metadataOnly: true,
      completeOriginalPopulation: false, financialHydrationComplete: false, orders: [] }),
    businessPolicy: { decision: { eligibility: "eligible", commerceSource: "other", acquisitionEligible: false,
      approvalRef: "synthetic:business" }, productClasses: {}, financialApprovalRef: "synthetic:business",
      saleClock: "paid_at", refundClock: "refund_created_at" },
  });
  const manifest = { version: 1, projectRef, accountId: "4335795219", loginCustomerId: "9552995078",
    approvalRef: "synthetic:google", actorRef, revisionRef: "synthetic:revision", credentialBindingRef: "synthetic:credential",
    coverage: "whole_account_campaign_day", sourceCurrency: "USD", sourceTimezone: "America/New_York",
    preparedAt: iso("08"), freshnessCutoffAt: iso("08"), expiresAt: iso("50"),
    maxPages: 1, maxRequestsPerDay: 3, deadlineSeconds: 60, days: [{ date, dueAt: iso("08") }] };
  const spendRun = prepareFreshGoogleSpend(manifest).registration.args.p_scope.days[0].runId;
  const metadata: MetaGraphCapture = {
    startedAt: iso("10"), finishedAt: iso("10"), method: "GET",
    url: "https://graph.facebook.com/v25.0/act_2796962933960445", status: 200,
    params: { fields: "id,account_id,currency,timezone_name,account_status,business" },
    bodyBytes: 11, bodySha256: "a".repeat(64), pagingCredentialQueryParametersRemoved: true,
    response: { id: "act_2796962933960445", account_id: "2796962933960445",
      currency: "USD", timezone_name: "America/Los_Angeles", account_status: 1 },
  };
  const hour = (campaign: boolean): MetaGraphCapture => ({
    ...metadata, url: `${metadata.url}/insights`,
    params: { time_range: JSON.stringify({ since: "2026-10-05", until: date }), time_increment: "1",
      breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone", level: campaign ? "campaign" : "account",
      fields: `account_id,account_currency,date_start,date_stop,spend,impressions,clicks${campaign ? ",campaign_id" : ""}`,
      limit: campaign ? "1001" : "49" },
    response: { data: empty ? [] : [{ account_id: "2796962933960445", account_currency: "USD",
      date_start: date, date_stop: date, hourly_stats_aggregated_by_advertiser_time_zone: "20:00:00 - 20:59:59",
      spend: "3.04", ...(campaign ? { campaign_id: "9" } : {}) }] },
  });
  const receipts = { metadata, accountHours: hour(false), campaignHours: hour(true) };
  const meta = metaHourlyPacketFromCaptures({ projectRef, shop, generationId: `meta_workbook_${cycle}`,
    accountId: "act_2796962933960445", date, approvalRef, actorRef, controlApprovalRef: "synthetic:meta-control",
    ...receipts, freshnessCutoffAt: iso("09"), asOf: iso("12") });
  return {
    contract: { version: 1, contractId: "synthetic_meta_contract", revision: "1", projectRef, shop,
      googleCycleId: cycle, googleCaptureSha256: "c".repeat(64), metaPacketSha256: "d".repeat(64),
      runId: `meta_workbook_${cycle}`, baseRunId: `meta_workbook_base_${cycle}`, date,
      notBefore: iso("09"), expiresAt: iso("40"), maxAgeSeconds: 3600, approvalRef, actorRef,
      controlApprovalRef: "synthetic:meta-control" },
    google: { cycleId: cycle, grantId: "synthetic_google_grant", grantRevision: "1", projectRef, shop,
      accountId: manifest.accountId, loginCustomerId: manifest.loginCustomerId, date,
      startedAt: iso("08"), validUntil: iso("50"), captureSha256: "c".repeat(64),
      packet: { manifest, asOf: iso("09"), base: {
        provider: "google_ads", accountId: manifest.accountId, date, baseReportId: spendRun,
        sourceCurrency: "USD", sourceTimezone: "America/New_York", completedAt: iso("09"),
        paginationComplete: true, verifiedEmpty: false, evidenceRef: `lean_private.spend_jobs/${spendRun}`,
        rows: [{ campaignId: "7", costMicros: "12000000" }],
      }, costControl: { provider: "google_ads", accountId: manifest.accountId, date,
        sourceCurrency: "USD", sourceTimezone: "America/New_York", capturedAt: iso("09"),
        evidenceRef: "synthetic:independent-google", independentlyExtracted: true, complete: true,
        verifiedEmpty: false, totalCostMicros: "12000000", campaigns: [{ id: "7", costMicros: "12000000" }] },
      receipt: { accountMetadata: [0, 1].map(() => ({ accountId: manifest.accountId, currency: "USD",
        timezone: "America/New_York", startedAt: iso("08"), finishedAt: iso("09"), responseSha256: "e".repeat(64) })) } } },
    meta: { packet: meta, packetSha256: "d".repeat(64), enabled: false, freshnessCutoffAt: iso("09"), receipts },
    standingScope: { version: 1, definitionVersion: "synthetic-two-account", approvalRef: "synthetic:standing-declaration",
      declaredAt: "2026-10-01T00:00:00Z", declarationSha256: "f".repeat(64),
      identityBindingSha256: { google: "1".repeat(64), meta: "2".repeat(64) },
      accounts: [
        { provider: "google_ads", accountId: "4335795219", sourceCurrency: "USD", sourceTimezone: "America/New_York" },
        { provider: "meta_ads", accountId: "act_2796962933960445", sourceCurrency: "USD", sourceTimezone: "America/Los_Angeles" },
      ] },
    source, policy: { ...fullFixture().policy, asOf: iso("12"), behaviorMode: "excluded", cohorts: [] },
  };
}

it("builds a NEW disabled workbook with Meta spend and leaves Google and all source inputs unchanged", () => {
  const f = fixture(), before = structuredClone(f), p = prepareMetaWorkbook(f);
  expect(p.registration.rpc).toBe("lean_meta_workbook_stage");
  expect(p).toMatchObject({ enabled: false, registered: false, googleGrantChanged: false, standingClaimed: false, sourceReads: 0 });
  expect(p.result.reports.store_daily[0]).toMatchObject({ spend_usd: "15.040000", ncac_usd: null, collected_cash_usd: null });
  expect(p.result.facts.marketing_spend_daily.find(r => r.provider === "meta_ads")).toMatchObject({
    spend_usd: "3.040000", source_timezone: "America/Los_Angeles", clicks: null, impressions: null });
  expect(p.registration.args.p_scope.evidence.proofs).toEqual([]);
  expect(p.registration.args.p_scope.evidence.dateCoverage[0].gates.spend).toBe(false);
  expect(p.nativeSpendWindow.binding.grantId).toBe(f.contract.contractId);
  expect(f).toEqual(before);
});
it("retains genuine completed empty Meta source and independent control, not manufactured hourly rows", () => {
  const p = prepareMetaWorkbook(fixture(true));
  expect(p.nativeSpendWindow.meta.packet.source.rows).toEqual([]);
  expect(p.result.reports.store_daily[0].spend_usd).toBe("12.000000");
  expect(p.result.facts.marketing_spend_daily.find(r => r.provider === "meta_ads")?.spend_usd).toBe("0.000000");
});
it.each(["old_google", "old_meta", "enabled_meta", "source_hash", "new_account", "original_full",
  "future_asof", "expired", "borrowed_google_asof", "changed_receipts", "authority_microsecond"] as const)(
  "refuses %s without changing grants or filling missing evidence", bad => {
    const f = fixture();
    if (bad === "old_google") f.google.validUntil = "2026-10-08T00:10:00Z";
    if (bad === "old_meta") f.meta.freshnessCutoffAt = "2026-10-08T00:08:00Z";
    if (bad === "enabled_meta") Object.assign(f.meta, { enabled: true });
    if (bad === "source_hash") f.meta.packetSha256 = "0".repeat(64);
    if (bad === "new_account") f.google.accountId = "1234567890";
    if (bad === "original_full") f.contract.runId = `auto_${f.contract.googleCycleId}`;
    if (bad === "future_asof") f.policy.asOf = "2026-10-08T01:00:00Z";
    if (bad === "expired") f.contract.expiresAt = f.policy.asOf;
    if (bad === "borrowed_google_asof") f.policy.asOf = f.google.packet.asOf;
    if (bad === "changed_receipts") f.meta.receipts.campaignHours.response = { data: [] };
    if (bad === "authority_microsecond") f.contract.notBefore = "2026-10-08T00:09:00.000001Z";
    expect(() => prepareMetaWorkbook(f)).toThrow();
  });
it("runs the existing full job and finish with the SQL-shaped optional input and zero provider calls", async () => {
  const f = fixture(), prepared = prepareMetaWorkbook(f), scope = prepared.registration.args.p_scope;
  const spend = prepared.nativeSpendWindow, base = structuredClone(prepared.result.facts);
  base.marketing_spend_daily = base.marketing_spend_daily.filter(r => r.provider === "google_ads");
  let finished: Record<string, unknown> | undefined;
  const result = await runFullReportJob({ projectRef: f.contract.projectRef,
    databaseUrl: `https://${f.contract.projectRef}.supabase.co`, runId: f.contract.runId, posthogKey: "",
    request: async () => { throw Error("NO_PROVIDER_CALL"); }, client: { async rpc(name, args) {
      if (name === "lean_full_inputs") return { data: {
        state: "ready", shop: f.contract.shop, publication: `full:${f.contract.runId}`,
        fromDate: f.contract.date, throughDate: f.contract.date, policy: scope.fullPolicy,
        evidence: scope.evidence, behavior: {}, facts: base, deferredOrders: scope.reportPolicy.deferredOrders,
        inputHash: "synthetic-current-input", freshGoogleSpend: {
          ...scope.fullPolicy.freshGoogleSpend, bases: [f.google.packet.base] },
        multiProviderSpend: { version: 1, projectRef: f.contract.projectRef, shop: f.contract.shop,
          runId: f.contract.runId, inventory: scope.fullPolicy.freshGoogleSpend!.marketingInventory,
          metaDays: [f.meta.packet] },
        nativeSpendWindow: spend, nativeSpendWindowBinding: { ...spend.binding, digest: spend.digest },
      }, error: null };
      if (name === "lean_full_claim") return { data: true, error: null };
      if (name === "lean_full_finish") { finished = args; return { data: true, error: null }; }
      throw Error(`unexpected RPC ${name}`);
    } } });
  expect(result.state).toBe("complete");
  expect((finished?.p_reports as typeof prepared.result.reports).store_daily[0].spend_usd).toBe("15.040000");
});
