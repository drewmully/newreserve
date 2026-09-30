import { afterEach, expect, it, vi } from "vitest";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { fullFixture, orderKey, sessionKey, campaignKey } from "../fixtures/analyticsFull";
import { refreshFixture } from "../fixtures/analyticsRefresh";
import { prepareRefresh } from "@/lib/analytics/refreshPlan";
import { readPosthogBehavior } from "@/lib/analytics/posthogSource";
import { boundBehaviorEvidence } from "@/lib/analytics/fullReportJob";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { evidenceDigest } from "@/lib/analytics/evidenceIntake";
import { deferredOrders, verifyDeferredReplacements } from "@/lib/analytics/deferredCommerce";
import { key } from "@/lib/analytics/primitives";
import { replaySessions } from "../../scripts/analytics/replay-sessions.mjs";

const modules = { prepareRefresh, readPosthogBehavior, boundBehaviorEvidence, buildFullReports,
  evidenceDigest, deferredOrders, verifyDeferredReplacements };
const touchKey = key(fullFixture().policy.project, "web", "page_view", "event-1");

// Synthetic input with hand-enumerated expected purchase/spend and exact credit.
// No customer-history assertion, live policy approval or real source acceptance.
function fixture() {
  const f = fullFixture(), refresh = refreshFixture();
  f.evidence.customerHistory = {};
  f.evidence.campaigns = [];
  refresh.behavior.campaignMapping = { property: "utm_campaign", approvalRef: "synthetic:campaign-registry",
    entries: { reviewed_campaign: { channel: "google_ads", campaignKey, direct: false } } };
  for (const packet of refresh.intake.packets) {
    packet.payload = f.evidence[packet.section];
    packet.sha256 = evidenceDigest(packet.payload);
  }
  const orders: Record<string, unknown>[] = [{
    order_id: orderKey, model_version: "last-touch-v1", acquisition_session_key: sessionKey,
    touch_event_key: touchKey, channel: "google_ads", campaign_id: campaignKey,
    attribution_status: "attributed", lookback_days: 30, conversion_time_basis: "orders.paid_at",
    credit_weight: "1.000000000", conversion_date: "2026-01-01", attribution_complete: true,
  }];
  const daily: Record<string, unknown>[] = [{
    report_date: "2026-01-01", channel: "google_ads", campaign_bucket: campaignKey,
    model_version: "last-touch-v1", attributed_purchase_merchandise_net_usd: "20.000000",
    credited_orders: "1.000000", spend_usd: "5.000000", first_party_roas: "4.000000",
  }];
  return { version: 1, refresh, base: f.base, deferredOrders: [],
    posthogResponse: { columns: [...f.wire.columns, "campaign_token"],
      results: f.wire.results.map(row => [...row, "reviewed_campaign"]) },
    expected: { independentlyExtracted: true, evidenceRef: "synthetic:independent-session-control",
      funnel: ["all_sessions", "view"].map(stage_id => ({
        report_date: "2026-01-01", stage_id, measured_sessions: 1, mature_sessions: 1,
        converted_sessions: 1, session_conversion_rate: "1.000000",
      })),
      acquisition: { evidenceRef: "synthetic:independent-order-touch-and-spend-control",
        independentlyExtracted: true, orders, daily },
    },
  };
}
function changePacket(input: ReturnType<typeof fixture>, section: string,
  payload: ReturnType<typeof fixture>["refresh"]["intake"]["packets"][number]["payload"]) {
  const packet = input.refresh.intake.packets.find(p => p.section === section)!;
  packet.payload = payload;
  packet.sha256 = evidenceDigest(payload);
}
afterEach(() => vi.unstubAllGlobals());

it("checks exact source-mapped attribution and ROAS without requiring first-customer history", async () => {
  vi.stubGlobal("fetch", () => { throw new Error("network_forbidden"); });
  const input = fixture(), original = JSON.stringify(input);
  const build = vi.fn(buildFullReports);
  const result = await replaySessions(input, { ...modules, buildFullReports: build });
  expect(result.acquisition).toMatchObject({ comparedOrders: 1, numericRoasRows: 1, nullRoasRows: 0 });
  expect(result.acquisition!.daily).toEqual(input.expected.acquisition.daily);
  expect(result).toMatchObject({ hostedCalls: 0, enabled: false, registered: false, certified: false });
  const reports = build.mock.results[0].value.reports;
  expect(reports.acquisition_daily[0]).toMatchObject({ first_party_roas: "4.000000",
    weighted_new_customers: null, ncac_usd: null });
  expect(reports.store_daily[0].new_customers).toBeNull();
  expect(JSON.stringify(input)).toBe(original);
  expect(JSON.stringify(result)).not.toMatch(/uid-fixture|customer-fixture|session-fixture|checkout-1/);
  expect(JSON.stringify(result)).not.toContain(orderKey);
  expect(JSON.stringify(result)).not.toContain(touchKey);
  expect(JSON.stringify(result)).not.toContain(sessionKey);
});

it.each(["order_id", "acquisition_session_key", "touch_event_key", "model_version", "campaign_id"])(
  "rejects changed private %s even when daily ROAS still matches", async field => {
    const input = fixture(); input.expected.acquisition.orders[0][field] = "synthetic:wrong-link";
    await expect(replaySessions(input, modules)).rejects.toThrow("replay_attribution_mismatch");
  }
);
it.each(["spend_usd", "attributed_purchase_merchandise_net_usd", "credited_orders", "first_party_roas"])(
  "rejects changed expected %s instead of manufacturing an expectation", async field => {
    const input = fixture(); input.expected.acquisition.daily[0][field] = "0.000000";
    await expect(replaySessions(input, modules)).rejects.toThrow("replay_acquisition_mismatch");
  }
);
it("requires both independent controls and rejects extra fields before reading the saved response", async () => {
  for (const mutate of [
    (input: ReturnType<typeof fixture>) => { input.expected.acquisition.independentlyExtracted = false; },
    (input: ReturnType<typeof fixture>) => { input.expected.acquisition.evidenceRef = ""; },
    (input: ReturnType<typeof fixture>) => { delete input.expected.acquisition.orders[0].touch_event_key; },
    (input: ReturnType<typeof fixture>) => { input.expected.acquisition.daily[0].customer_id = "forbidden"; },
  ]) {
    const input = fixture(); mutate(input);
    const reader = vi.fn();
    await expect(replaySessions(input, { ...modules, readPosthogBehavior: reader }))
      .rejects.toThrow("replay_acquisition_evidence_required");
    expect(reader).not.toHaveBeenCalled();
  }
});
it.each(["orders", "daily"] as const)("rejects duplicate %s keys", async table => {
  const input = fixture(); input.expected.acquisition[table].push({ ...input.expected.acquisition[table][0] });
  await expect(replaySessions(input, modules)).rejects.toThrow("replay_duplicate_expected_or_actual_key");
});
it("rejects missing expected order credits and extra aggregate buckets", async () => {
  const input = fixture(); input.expected.acquisition.orders = [];
  await expect(replaySessions(input, modules)).rejects.toThrow("replay_attribution_mismatch");
  const extra = fixture();
  extra.expected.acquisition.daily.push({ ...extra.expected.acquisition.daily[0], channel: "extra" });
  await expect(replaySessions(extra, modules)).rejects.toThrow("replay_acquisition_mismatch");
});
it("keeps independently expected unmatched spend unavailable, not zero or a numeric ROAS pass", async () => {
  const input = fixture();
  changePacket(input, "comparisons", []);
  input.expected.acquisition.daily[0].spend_usd = null;
  input.expected.acquisition.daily[0].first_party_roas = null;
  const result = await replaySessions(input, modules);
  expect(result.acquisition).toMatchObject({ numericRoasRows: 0, nullRoasRows: 1 });
  expect(result.acquisition!.daily[0]).toMatchObject({ spend_usd: null, first_party_roas: null,
    attributed_purchase_merchandise_net_usd: "20.000000" });
  input.expected.acquisition.daily[0].first_party_roas = "0.000000";
  await expect(replaySessions(input, modules)).rejects.toThrow("replay_acquisition_mismatch");
});
it("requires attribution lookback separately from full-date session coverage", async () => {
  const input = fixture(); input.refresh.behavior.from = "2026-01-01T00:00:00Z";
  // Still includes the session date and mature conversion interval, but cannot
  // establish the declared 30-day lookback. No policy default is approved here.
  await expect(replaySessions(input, modules)).rejects.toThrow("replay_attribution_mismatch");
});
it("does not turn an unknown campaign token into the expected mapped credit", async () => {
  const input = fixture(); input.posthogResponse.results[0][7] = "unknown_campaign";
  await expect(replaySessions(input, modules)).rejects.toThrow("replay_attribution_mismatch");
});
it("does not infer conversion linkage from a matching customer or paid timestamp", async () => {
  const input = fixture(); changePacket(input, "checkout", []);
  await expect(replaySessions(input, modules)).rejects.toThrow("replay_funnel_mismatch");
});
it("rejects loss of source permission rather than accepting positive attribution", async () => {
  const input = fixture(); input.posthogResponse.results[0][6] = false;
  await expect(replaySessions(input, modules)).rejects.toThrow();
});
it("writes only private aggregate/digest output through the real CLI and preserves existing output", () => {
  const dir = mkdtempSync(join(tmpdir(), "acquisition-replay-test-"));
  try {
    const input = join(dir, "input.json"), out = join(dir, "output");
    writeFileSync(input, JSON.stringify(fixture()), { mode: 0o600 });
    const stdout = execFileSync(process.execPath, ["scripts/analytics/replay-sessions.mjs", input, out],
      { encoding: "utf8", timeout: 45000 });
    expect(JSON.parse(stdout)).toMatchObject({ state: "offline_expected_match", hostedCalls: 0 });
    const saved = readFileSync(join(out, "session-validation.json"), "utf8");
    expect(JSON.parse(saved).acquisition.numericRoasRows).toBe(1);
    for (const id of [orderKey, sessionKey, touchKey, "uid-fixture", "customer-fixture", "checkout-1"])
      expect(saved).not.toContain(id);
    expect(statSync(out).mode & 0o777).toBe(0o700);
    expect(statSync(join(out, "session-validation.json")).mode & 0o777).toBe(0o600);
    expect(() => execFileSync(process.execPath, ["scripts/analytics/replay-sessions.mjs", input, out],
      { stdio: "pipe", timeout: 45000 })).toThrow();
    expect(readFileSync(join(out, "session-validation.json"), "utf8")).toBe(saved);
    expect(existsSync(join(out, "facts.json"))).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60000);
it("leaves no output and no private identifiers in CLI errors after a credit mismatch", () => {
  const dir = mkdtempSync(join(tmpdir(), "acquisition-replay-negative-"));
  try {
    const input = fixture(); input.expected.acquisition.orders[0].touch_event_key = "private-wrong-touch";
    const file = join(dir, "input.json"), out = join(dir, "must-not-exist");
    writeFileSync(file, JSON.stringify(input), { mode: 0o600 });
    try {
      execFileSync(process.execPath, ["scripts/analytics/replay-sessions.mjs", file, out],
        { stdio: "pipe", timeout: 45000 });
      throw new Error("expected rejection");
    } catch (error) {
      const stderr = String((error as { stderr: unknown }).stderr);
      expect(stderr).toContain("session_replay_failed");
      expect(stderr).not.toMatch(/private-wrong-touch|uid-fixture|customer-fixture/);
    }
    expect(existsSync(out)).toBe(false);
  } finally { rmSync(dir, { recursive: true, force: true }); }
}, 60000);
