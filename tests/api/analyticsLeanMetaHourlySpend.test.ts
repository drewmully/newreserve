import { describe, expect, it } from "vitest";
import { metaHourlyPacketFromCaptures, metaHourlyWindow, prepareMetaHourlySpendDay,
  type MetaGraphCapture, type MetaHourlySpendDay } from "@/lib/analytics/metaHourlySpendInput";
import { prepareMetaSpendDay } from "@/lib/analytics/metaSpendInput";
import { prepareMetaSpendRegistration } from "@/lib/analytics/multiProviderSpendRegistration";
import { prepareMultiProviderSpendBuild } from "@/lib/analytics/multiProviderSpendInput";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { guardFreshGoogleSpendReports } from "@/lib/analytics/googleSpendReportInput";
import { normalizeSpendBase } from "@/lib/analytics/spend";
import { key } from "@/lib/analytics/primitives";
import { googleDeliveryFixture } from "../fixtures/analyticsGoogleDelivery";

function fixture(date = "2026-09-29") {
  const w = metaHourlyWindow(date);
  const context = { projectRef: "abcdefghijklmnopqrst", shop: "fixture.myshopify.com",
    publication: "private:fixture", freshnessCutoffAt: "2026-10-07T16:00:00Z", asOf: "2026-10-07T17:00:00Z" };
  const query = { since: w.since, until: w.until, timeIncrement: 1 as const,
    breakdown: "hourly_stats_aggregated_by_advertiser_time_zone" as const, unfiltered: true as const };
  const row = (day: string, hour: string, spend: string) => ({ account_id: "123",
    date_start: day, date_stop: day, hourly_stats_aggregated_by_advertiser_time_zone: `${hour}:00:00 - ${hour}:59:59`, spend });
  const rows = [row(w.since, "20", "100"), row(w.since, "21", "1.01"),
    row(w.until, "20", "2.03"), row(w.until, "21", "200")];
  const packet: MetaHourlySpendDay = {
    version: 2, projectRef: context.projectRef, shop: context.shop, generationId: "fixture:meta-hour",
    accountId: "act_123", date, sourceCurrency: "USD", sourceTimezone: "America/Los_Angeles",
    approvalRef: "fixture:source", actorRef: "fixture:owner",
    window: { reportTimezone: "America/New_York", fromAt: w.fromAt, untilAt: w.untilAt },
    source: { evidenceRef: "fixture:campaign-hours", accountMetadataRef: "fixture:metadata",
      capturedAt: "2026-10-07T16:11:25.126006Z", complete: true, paginationComplete: true, verifiedEmpty: false,
      query: { ...query, level: "campaign" }, rows: rows.map(r => ({ ...r, campaign_id: "9" })) },
    control: { evidenceRef: "fixture:account-hours", approvalRef: "fixture:control",
      capturedAt: "2026-10-07T16:11:24.842618Z", independentlyExtracted: true,
      complete: true, paginationComplete: true, verifiedEmpty: false, query: { ...query, level: "account" }, rows },
  };
  return { packet, context };
}
function captures(empty = true) {
  const { packet, context } = fixture();
  const base: MetaGraphCapture = {
    startedAt: "2026-10-07T16:11:23.663285+00:00", finishedAt: "2026-10-07T16:11:25.126006+00:00",
    method: "GET", url: "https://graph.facebook.com/v25.0/act_123", status: 200,
    params: { fields: "id,account_id,currency,timezone_name,account_status,business" },
    bodyBytes: 11, bodySha256: "a".repeat(64), pagingCredentialQueryParametersRemoved: true,
    response: { id: "act_123", account_id: "123", currency: "USD", timezone_name: "America/Los_Angeles", account_status: 1 },
  };
  const hourCapture = (campaign: boolean): MetaGraphCapture => ({
    ...base, url: `${base.url}/insights`,
    params: { time_range: JSON.stringify({ since: "2026-09-28", until: "2026-09-29" }), time_increment: "1",
      breakdowns: "hourly_stats_aggregated_by_advertiser_time_zone", level: campaign ? "campaign" : "account",
      fields: `account_id,account_currency,date_start,date_stop,spend,impressions,clicks${campaign ? ",campaign_id" : ""}`,
      limit: campaign ? "1001" : "49" },
    response: { data: empty ? [] : (campaign ? packet.source.rows : packet.control.rows)
      .map(r => ({ ...r, account_currency: "USD", clicks: "0", impressions: "0" })) },
  });
  return { ...context, generationId: packet.generationId, accountId: packet.accountId, date: packet.date,
    approvalRef: packet.approvalRef, actorRef: packet.actorRef, controlApprovalRef: packet.control.approvalRef,
    metadata: base, accountHours: hourCapture(false), campaignHours: hourCapture(true) };
}

it("selects an exact NY day without changing the Pacific source timezone or rounding money", () => {
  const { packet, context } = fixture(), original = structuredClone(packet);
  expect(packet.window).toEqual({ reportTimezone: "America/New_York",
    fromAt: "2026-09-29T04:00:00.000Z", untilAt: "2026-09-30T04:00:00.000Z" });
  const prepared = prepareMetaSpendDay(packet, context);
  expect(prepared.facts).toHaveLength(1);
  expect(prepared.facts[0]).toMatchObject({ report_date: "2026-09-29", source_timezone: "America/Los_Angeles",
    source_amount: "3.040000", spend_usd: "3.040000", clicks: null, impressions: null, click_definition: null });
  expect(packet).toEqual(original);
  expect(prepareMetaSpendRegistration(packet, context).registration.rpc).toBe("lean_marketing_spend_hourly_register");
});
it("native independent HTTP200 data[] plus EOF produces a verified no-activity fact, not missing-data zero", () => {
  const c = captures(), p = metaHourlyPacketFromCaptures(c);
  expect(p.source.rows).toEqual([]);
  expect(p.control.rows).toEqual([]);
  expect(p.source.verifiedEmpty).toBe(true);
  expect(p.control.verifiedEmpty).toBe(true);
  expect(p.source.evidenceRef).not.toBe(p.control.evidenceRef);
  expect(p.source.capturedAt).toBe("2026-10-07T16:11:25.126006Z");
  expect(prepareMetaHourlySpendDay(p, c).facts[0]).toMatchObject({
    source_campaign_id: null, spend_usd: "0.000000", source_timezone: "America/Los_Angeles" });
});
it("projects native nonempty receipt rows and keeps account/campaign checks independent", () => {
  const c = captures(false), p = metaHourlyPacketFromCaptures(c);
  expect(prepareMetaSpendDay(p, c).facts[0].spend_usd).toBe("3.040000");
});
function closingCaptures() {
  const c = captures();
  c.freshnessCutoffAt = "2026-09-30T06:55:00Z"; c.asOf = "2026-09-30T07:01:00Z";
  c.metadata.startedAt = "2026-09-30T06:58:00Z"; c.metadata.finishedAt = "2026-09-30T06:58:01Z";
  for (const capture of [c.accountHours, c.campaignHours]) {
    capture.startedAt = "2026-09-30T07:00:00.000000Z";
    capture.finishedAt = "2026-09-30T07:00:01Z";
  }
  return c;
}
it.each(["accountHours", "campaignHours"] as const)(
  "refuses %s starting one microsecond before provider close even when its response arrives after close", which => {
    const c = closingCaptures();
    c[which].startedAt = "2026-09-30T06:59:59.999999Z";
    expect(() => metaHourlyPacketFromCaptures(c)).toThrow("meta_graph_query_started_open");
  });
it("accepts both native queries starting exactly at provider close", () => {
  const c = closingCaptures(), p = metaHourlyPacketFromCaptures(c);
  expect(prepareMetaHourlySpendDay(p, c).facts[0].spend_usd).toBe("0.000000");
});
it.each(["fromAt", "untilAt"] as const)("refuses a one-microsecond %s boundary drift", which => {
  const { packet, context } = fixture();
  packet.window[which] = packet.window[which].replace(".000Z", ".000001Z");
  expect(() => prepareMetaHourlySpendDay(packet, context)).toThrow("meta_hourly_window");
});
it.each(["2026-03-08", "2026-03-09", "2026-11-01", "2026-11-02"])(
  "refuses advertiser-hour labels on an ambiguous or missing DST-hour query %s", date => {
    expect(() => metaHourlyWindow(date)).toThrow("meta_hourly_dst_unsupported");
  });
it.each(["source_paging", "control_paging", "duplicate", "duplicate_control", "mismatch", "outside_mismatch",
  "timezone", "currency", "newline", "daily_aggregate", "negative", "number", "bad_hour", "query_filter",
  "wrong_boundary", "stale", "future_microsecond", "empty_without_verification", "incomplete"] as const)(
  "refuses %s", bad => {
    const { packet: p, context: c } = fixture();
    if (bad === "source_paging") p.source.paginationComplete = false;
    if (bad === "control_paging") p.control.paginationComplete = false;
    if (bad === "duplicate") p.source.rows.push(p.source.rows[0]);
    if (bad === "duplicate_control") p.control.rows.push(p.control.rows[0]);
    if (bad === "mismatch") p.control.rows[1].spend = "1.02";
    if (bad === "outside_mismatch") p.control.rows[0].spend = "99";
    if (bad === "timezone") p.sourceTimezone = "America/New_York";
    if (bad === "currency") p.sourceCurrency = "CAD";
    if (bad === "newline") p.accountId += "\n";
    if (bad === "daily_aggregate") p.source.rows[0].date_stop = p.date;
    if (bad === "negative") p.source.rows[0].spend = "-1";
    if (bad === "number") (p.source.rows[0] as unknown as Record<string, unknown>).spend = 1.01;
    if (bad === "bad_hour") p.source.rows[0].hourly_stats_aggregated_by_advertiser_time_zone = "20:00:00 - 21:00:00";
    if (bad === "query_filter") (p.source.query as unknown as Record<string, unknown>).filtering = [];
    if (bad === "wrong_boundary") p.window.fromAt = "2026-09-29T07:00:00Z";
    if (bad === "stale") p.source.capturedAt = "2026-10-07T15:59:59.999999Z";
    if (bad === "future_microsecond") p.source.capturedAt = "2026-10-07T17:00:00.000001Z";
    if (bad === "empty_without_verification") { p.source.rows = []; p.control.rows = []; }
    if (bad === "incomplete") p.control.complete = false;
    expect(() => prepareMetaSpendDay(p, c)).toThrow();
  });
it.each(["http_error", "flattened", "next_page", "account_next", "wrong_account", "metadata_old", "filter",
  "sentinel", "wrong_currency", "wrong_query", "missing_spend"] as const)(
  "refuses native receipt %s rather than declaring zero", bad => {
    const c = captures();
    if (bad === "http_error") c.campaignHours.status = 429;
    if (bad === "flattened") c.campaignHours.response = { ad_entities: "[]" };
    if (bad === "next_page") c.campaignHours.response = { data: [], paging: { next: "https://graph.facebook.com/next" } };
    if (bad === "account_next") c.accountHours.response = { data: [], paging: { next: "next" } };
    if (bad === "wrong_account") c.metadata.response = { ...(c.metadata.response as object), id: "act_321" };
    if (bad === "metadata_old") { c.metadata.startedAt = "2026-10-07T15:00:00Z"; c.metadata.finishedAt = c.metadata.startedAt; }
    if (bad === "filter") c.campaignHours.params.filtering = "[]";
    if (bad === "sentinel") c.campaignHours.response = { data: Array(1001).fill({}) };
    if (bad === "wrong_currency") c.metadata.response = { ...(c.metadata.response as object), currency: "EUR" };
    if (bad === "wrong_query") c.accountHours.params.time_range = '{"since":"2026-09-29","until":"2026-09-29"}';
    if (bad === "missing_spend") c.campaignHours.params.fields = "account_id,date_start,date_stop,campaign_id";
    expect(() => metaHourlyPacketFromCaptures(c)).toThrow();
  });
describe("existing combined workbook path", () => {
  it("admits hourly Meta through the installed packet interface and unchanged formulas", () => {
    const now = Date.parse("2026-10-07T16:12:00Z"), f = googleDeliveryFixture(now);
    const { packet } = fixture("2026-01-01");
    packet.projectRef = f.input.projectRef; packet.shop = f.input.shop;
    packet.source.rows = [{ ...packet.source.rows[1], spend: "4" }];
    packet.control.rows = [{ ...packet.control.rows[1], spend: "4" }];
    const base = structuredClone(f.full.base);
    base.marketing_spend_daily = f.fresh.bases.flatMap(b => normalizeSpendBase(b, "observed:google-base"));
    const evidence = structuredClone(f.full.evidence);
    evidence.proofs = evidence.proofs.filter(p => p.table !== "marketing_spend_daily");
    evidence.proofs.push({ table: "marketing_spend_daily",
      keyFields: ["provider", "account_id", "campaign_key", "report_date", "base_report_id"],
      expectedKeys: [
        ...["7", "8"].map(id => JSON.stringify(["google_ads", "1234567890", key("google_ads", "1234567890", id),
          "2026-01-01", f.fresh.bases[0].baseReportId])),
        JSON.stringify(["meta_ads", "act_123", key("meta_ads", "act_123", "9"), "2026-01-01", packet.generationId]),
      ], amountChecks: [{ field: "spend_usd", expectedTotal: "16.000000" }],
      evidenceRef: "fixture:independent-combined-proof", complete: true, independentlyExtracted: true });
    const prepared = prepareMultiProviderSpendBuild({ ...f.input, base, evidence, freshGoogleSpend: f.fresh,
      combined: { version: 1, projectRef: f.input.projectRef, shop: f.input.shop, runId: f.packet.runId,
        metaDays: [packet], inventory: { ...f.fresh.marketingInventory, complete: true,
          accounts: [{ provider: "google_ads", accountId: "1234567890" }, { provider: "meta_ads", accountId: "act_123" }],
          salesScope: "whole_store_eligible_ledger", salesCoverageRef: "fixture:ledger",
          customerScope: "whole_store_eligible_customers", customerCoverageRef: "fixture:customers" } } });
    const output = buildFullReports({ ...f.full, base: prepared.base, evidence: prepared.evidence,
      policy: f.packet.fullPolicy, events: [] });
    guardFreshGoogleSpendReports(output.reports, prepared.storeRatioAdmission);
    expect(output.reports.store_daily[0]).toMatchObject({ spend_usd: "16.000000", mer: "1.250000", ncac_usd: "16.000000" });
    expect(prepared.base.marketing_spend_daily[2].source_timezone).toBe("America/Los_Angeles");
  });
});
