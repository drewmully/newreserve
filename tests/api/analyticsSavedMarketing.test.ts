import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { prepareSavedMarketingReport, savedMarketingProject as project, savedMarketingShop as shop } from "@/lib/analytics/savedMarketingReport";
import { savedMarketingGet } from "@/lib/analytics/savedMarketingRuntime";
import { prepareFreshGoogleSpend } from "@/lib/analytics/googleSpendRegistration";
import { metaHourlyWindow } from "@/lib/analytics/metaHourlySpendInput";

const now = "2026-10-08T20:00:00.000Z", token = "synthetic-independent-marketing-token";
const digest = (s: string) => createHash("sha256").update(s).digest("hex");
function fixture() {
  const date = "2026-10-07", sourceId = "11111111-1111-4111-8111-111111111111";
  const manifest = { version: 1 as const, projectRef: project, revisionRef: "fixture:saved",
    accountId: "4335795219", loginCustomerId: "9552995078", credentialBindingRef: "fixture:binding",
    sourceCurrency: "USD", sourceTimezone: "America/New_York", coverage: "whole_account_campaign_day",
    freshnessCutoffAt: "2026-10-08T19:00:00.000Z", preparedAt: "2026-10-08T19:00:00.000Z",
    expiresAt: "2026-10-09T19:00:00.000Z", maxPages: 1, maxRequestsPerDay: 3,
    deadlineSeconds: 60, approvalRef: "fixture:source", actorRef: "fixture:actor",
    days: [{ date, dueAt: "2026-10-08T19:00:00.000Z" }] };
  const run = prepareFreshGoogleSpend(manifest).registration.args.p_scope.days[0].runId;
  const base = { provider: "google_ads", accountId: "4335795219", date, baseReportId: run,
    sourceTimezone: "America/New_York", sourceCurrency: "USD", completedAt: "2026-10-08T19:00:02.000Z",
    paginationComplete: true, verifiedEmpty: false, evidenceRef: `lean_private.spend_jobs/${run}`,
    rows: [{ campaignId: "123", costMicros: "2425689", clicks: "10", impressions: "39" }] };
  const costControl = { provider: "google_ads", accountId: base.accountId, date,
    sourceCurrency: "USD", sourceTimezone: "America/New_York", capturedAt: "2026-10-08T19:00:01.000Z",
    evidenceRef: "fixture:google-cost-control", independentlyExtracted: true, complete: true,
    verifiedEmpty: false, totalCostMicros: "2425689", campaigns: [{ id: "123", costMicros: "2425689" }] };
  const delivery = { version: 1, accountId: base.accountId, date, approvalRef: "fixture:delivery",
    definitionVersion: "google-account-daily-v1", control: { evidenceRef: "fixture:counts-control",
      capturedAt: costControl.capturedAt, complete: true, independentlyExtracted: true,
      clickDefinition: "google_ads.metrics.clicks", clicks: "10", impressions: "39",
      campaigns: [{ id: "123", clicks: "10", impressions: "39" }] } };
  const w = metaHourlyWindow(date);
  const query = { since: w.since, until: w.until, timeIncrement: 1,
    breakdown: "hourly_stats_aggregated_by_advertiser_time_zone", unfiltered: true };
  const meta = { version: 2, projectRef: project, shop, generationId: "meta_ingest_daily_2026-10-07",
    accountId: "act_2796962933960445", date, sourceCurrency: "USD", sourceTimezone: "America/Los_Angeles",
    approvalRef: "fixture:meta", actorRef: "fixture:actor",
    window: { reportTimezone: "America/New_York", fromAt: w.fromAt, untilAt: w.untilAt },
    source: { evidenceRef: "fixture:meta-native", accountMetadataRef: "fixture:meta-account",
      capturedAt: "2026-10-08T17:02:45.087877Z", complete: true, paginationComplete: true,
      verifiedEmpty: true, query: { ...query, level: "campaign" }, rows: [] as Record<string, string>[] },
    control: { evidenceRef: "fixture:meta-control", approvalRef: "fixture:control",
      capturedAt: "2026-10-08T17:02:44.678002Z", complete: true, paginationComplete: true,
      independentlyExtracted: true, verifiedEmpty: true, query: { ...query, level: "account" },
      rows: [] as Record<string, string>[] } };
  return { scope: { source_id: sourceId, audience: `posthog:353503:source:${sourceId}`, project_ref: project, shop,
    not_before: "2026-10-08T16:00:00.000000Z", expires_at: "2026-10-09T16:00:00.000000Z",
    lookback_days: 1, include_observed_sales: false },
  days: [{ date, google: { base, costControl, manifest, delivery, asOf: base.completedAt },
    google_sha256: "a".repeat(64), meta, meta_sha256: "b".repeat(64) }], observed: null };
}
const env = { LEAN_PRODUCTION_REPORTS_ENABLED: "true", VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main",
  LEAN_ANALYTICS_PIPELINE_PROJECT_REF: project, LEAN_ANALYTICS_SUPABASE_URL: `https://${project}.supabase.co`,
  LEAN_ANALYTICS_SUPABASE_SERVICE_ROLE_KEY: "synthetic-service-key", LEAN_PRODUCTION_REPORTS_SECRET: "x".repeat(64) };
const request = (bearer = token, search = "") => new Request(`https://fixture.invalid/api/analytics/reports/marketing${search}`,
  { headers: { authorization: `Bearer ${bearer}` } });

describe("saved marketing reporting", () => {
  it("combines matched spend, retains six-digit original clocks and does not assert fresh sales or Meta clicks", () => {
    const input = fixture(), before = structuredClone(input), r = prepareSavedMarketingReport(input, now);
    expect(r.marketing_daily).toHaveLength(2);
    expect(r.marketing_daily[0]).toMatchObject({ spend_usd: "2.425689", clicks: "10", impressions: "39" });
    expect(r.marketing_daily[1]).toMatchObject({ spend_usd: "0.000000", verified_empty: true,
      source_captured_at: "2026-10-08T17:02:45.087877Z", source_timezone: "America/Los_Angeles",
      clicks: null, impressions: null, is_stale: true, snapshot_status: "historical_snapshot" });
    expect(r.marketing_totals[0]).toMatchObject({ spend_usd: "2.425689", mer: null, ncac_usd: null,
      first_party_roas: null, total_sales_usd: null, collected_cash_usd: null, complete_marketing_inventory: false });
    expect(input).toEqual(before);
  });
  it("does not make a zero or a combined total from a missing provider", () => {
    const f = fixture();
    const d = f.days[0] as unknown as Record<string, unknown>; d.meta = null; d.meta_sha256 = null;
    const r = prepareSavedMarketingReport(f, now);
    expect(r.marketing_daily).toHaveLength(1); expect(r.marketing_totals[0].spend_usd).toBeNull();
    expect(r.report_status[0].meta_state).toBe("unavailable");
  });
  it("normalizes only the NY hourly window, not a prorated Pacific daily total", () => {
    const f = fixture(), p = f.days[0].meta;
    const row = (date: string, hour: string, spend: string) => ({ account_id: "2796962933960445",
      date_start: date, date_stop: date, hourly_stats_aggregated_by_advertiser_time_zone: `${hour}:00:00 - ${hour}:59:59`, spend });
    p.control.rows = [row("2026-10-06", "20", "100"), row("2026-10-06", "21", "1.01"), row("2026-10-07", "20", "2.03")];
    p.source.rows = p.control.rows.map(r => ({ ...r, campaign_id: "321" }));
    p.source.verifiedEmpty = p.control.verifiedEmpty = false;
    expect(prepareSavedMarketingReport(f, now).marketing_daily[1].spend_usd).toBe("3.040000");
  });
  it.each(["account", "date", "currency", "timezone", "incomplete", "control", "future", "hash", "scope", "expired", "duplicate"] as const)(
    "refuses %s instead of silently using an older/mismatched source", bad => {
      const f = fixture(), d = f.days[0];
      if (bad === "account") d.meta.accountId = "act_999";
      if (bad === "date") d.meta.date = "2026-10-06";
      if (bad === "currency") d.meta.sourceCurrency = "CAD";
      if (bad === "timezone") d.meta.sourceTimezone = "America/New_York";
      if (bad === "incomplete") d.meta.source.paginationComplete = false;
      if (bad === "control") d.google.costControl.totalCostMicros = "1";
      if (bad === "future") d.meta.source.capturedAt = "2026-10-08T21:00:00.000Z";
      if (bad === "hash") d.meta_sha256 = "private-reflection";
      if (bad === "scope") f.scope.audience = "posthog:other";
      if (bad === "expired") f.scope.expires_at = now;
      if (bad === "duplicate") f.days.push(structuredClone(d));
      expect(() => prepareSavedMarketingReport(f, now)).toThrow();
    });
  it("retains observed-commerce labels without filling missing sales or joining ratios", () => {
    const f = fixture(); f.scope.include_observed_sales = true;
    const metrics = ["gross_merchandise_sales_usd", "discounts_usd", "refunds_usd", "net_merchandise_sales_usd",
      "shipping_net_usd", "tax_net_usd", "duty_net_usd", "other_sales_adjustments_usd", "total_sales_usd",
      "eligible_orders", "purchase_merchandise_net_usd", "aov_usd", "collected_cash_usd", "new_customers", "spend_usd", "ncac_usd", "mer"];
    const row = { report_date: "2026-10-07", definition_version: "fixture", is_stale: true,
      report_scope: "webhook_observed_only", certified: false, complete_window: false,
      ...Object.fromEntries(metrics.map(k => [k, null])), total_sales_usd: "22.000000",
      readiness: { ...Object.fromEntries(metrics.map(k => [k, "withheld"])), total_sales_usd: "observed_unverified" } };
    const input = { ...f, observed: { store_daily: [row], product_daily: [] } };
    const result = prepareSavedMarketingReport(input, now);
    expect(result.store_daily).toEqual([row]);
    expect(result.report_status[0].sales_state).toBe("webhook_observed_only");
    expect(result.marketing_totals[0].mer).toBeNull();
  });
  it("route sends only bearer SHA to one fixed read RPC, never the bearer or input packets to the destination", async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(now));
    try {
      const transport = vi.fn(async () => Response.json(fixture()));
      const r = await savedMarketingGet(request(), env, transport), body = await r.text();
      expect(r.status).toBe(200); expect(transport).toHaveBeenCalledTimes(1);
      expect(transport.mock.calls[0]?.length).toBeGreaterThan(0);
      expect(body).not.toContain("credentialBindingRef"); expect(body).not.toContain(token);
      expect(body).not.toContain("approvalRef"); expect(body).not.toContain("campaignId");
      const init = (transport.mock.calls as unknown as [string, RequestInit][])[0][1];
      expect(JSON.parse(String(init.body))).toEqual({ p_token_sha256: digest(token) });
    } finally { vi.useRealTimers(); }
  });
  it("rejects reused existing bearers, query scope and preview without a database call", async () => {
    const transport = vi.fn();
    expect((await savedMarketingGet(request("x".repeat(64)), env, transport)).status).toBe(401);
    expect((await savedMarketingGet(request(token, "?date=2026-10-07"), env, transport)).status).toBe(400);
    expect((await savedMarketingGet(request(), { ...env, VERCEL_ENV: "preview" }, transport)).status).toBe(404);
    expect(transport).not.toHaveBeenCalled();
  });
  it("does not dispatch an already-aborted request or reflect a dedicated capability through an otherwise valid hash field", async () => {
    const c = new AbortController(); c.abort();
    const transport = vi.fn();
    const req = new Request(request(), { signal: c.signal });
    expect((await savedMarketingGet(req, env, transport)).status).toBe(503);
    expect(transport).not.toHaveBeenCalled();
    vi.useFakeTimers(); vi.setSystemTime(new Date(now));
    try {
      const cap = "d".repeat(64), f = fixture(); f.days[0].meta_sha256 = cap;
      expect((await savedMarketingGet(request(cap), env, async () => Response.json(f))).status).toBe(503);
    } finally { vi.useRealTimers(); }
  });
  it("holds missing authorization, oversize input and a hanging stream without logging secrets", async () => {
    expect((await savedMarketingGet(request(), env, async () => Response.json(null))).status).toBe(403);
    expect((await savedMarketingGet(request(), env, async () => new Response("x".repeat(8388609)))).status).toBe(503);
    vi.useFakeTimers();
    try {
      const run = savedMarketingGet(request(), env, async () => new Response(new ReadableStream({ start() {} })));
      await vi.advanceTimersByTimeAsync(15000);
      expect((await run).status).toBe(503);
    } finally { vi.useRealTimers(); }
  });
});
