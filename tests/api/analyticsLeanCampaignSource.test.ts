import { expect, it, vi } from "vitest";
import { readPosthogBehavior } from "@/lib/analytics/posthogSource";
import { observedCampaigns } from "@/lib/analytics/campaignSource";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { fullFixture, campaignKey, sessionKey } from "../fixtures/analyticsFull";

function fixture() {
  const f = fullFixture();
  f.behavior.campaignMapping = { property: "utm_id", approvalRef: "fixture:registry",
    entries: { campaign7: { channel: "google_ads", campaignKey, direct: false } } };
  f.wire.columns.push("campaign_token");
  f.wire.results[0].push("campaign7");
  f.evidence.campaigns = [];
  return f;
}
it("wires the native property through session and order attribution without a manual campaign packet", async () => {
  const f = fixture(), request = vi.fn(async () => Response.json(f.wire));
  f.events = await readPosthogBehavior(f.behavior, "fixture", request);
  const result = buildFullReports(f);
  expect(result.facts.sessions[0]).toMatchObject({ campaign_id: campaignKey, traffic_source: "google_ads" });
  expect(result.facts.order_attribution[0]).toMatchObject({ campaign_id: campaignKey, attribution_status: "attributed" });
  expect(result.reports.acquisition_daily[0].first_party_roas).toBe("4.000000");
  const init = request.mock.calls[0] as unknown as [string, RequestInit];
  expect(init[1].body).toContain("properties.utm_id AS campaign_token");
  expect(init[1].body).not.toMatch(/current_url|SELECT \*/);
});
it.each([null, "", "unregistered", "someone@example.com"])("does not turn an unrecognized campaign into direct traffic: %s", async value => {
  const f = fixture(); f.wire.results[0][11] = value;
  const events = await readPosthogBehavior(f.behavior, "fixture", async () => Response.json(f.wire));
  expect(events[0].campaignContext).toBeUndefined();
  expect(JSON.stringify(events)).not.toContain("someone@example.com");
});
it("strips campaign information with denied collection permission", async () => {
  const f = fixture(); f.wire.results[0][9] = false;
  const events = await readPosthogBehavior(f.behavior, "fixture", async () => Response.json(f.wire));
  expect(events[0].campaignContext).toBeUndefined();
});
it("does not replace an unknown entry with a later tagged action", () => {
  const f = fixture(), first = f.events[0];
  const second = { ...first, occurredAt: "2026-01-01T11:01:00Z", actionId: "second",
    campaignContext: { ...f.behavior.campaignMapping!.entries.campaign7, evidenceRef: "fixture:observed" } };
  expect(observedCampaigns([second, first], f.policy.project, f.policy.sessionVersion, []).size).toBe(0);
});
it("fails on contradictory retries and conflicting reviewed context", () => {
  const f = fixture(), event = { ...f.events[0],
    campaignContext: { ...f.behavior.campaignMapping!.entries.campaign7, evidenceRef: "fixture:observed" } };
  const changed = { ...event, campaignContext: { ...event.campaignContext, channel: "other" } };
  expect(() => observedCampaigns([event, changed], f.policy.project, f.policy.sessionVersion, []))
    .toThrow("conflicting_campaign_retry");
  expect(() => observedCampaigns([event], f.policy.project, f.policy.sessionVersion,
    [{ sessionKey, context: changed.campaignContext }])).toThrow("conflicting_campaign_evidence");
});
it("rejects injected properties and ambiguous direct mapping before any network call", async () => {
  const f = fixture(), request = vi.fn();
  Object.assign(f.behavior.campaignMapping!, { property: "email" });
  await expect(readPosthogBehavior(f.behavior, "fixture", request)).rejects.toThrow("invalid_campaign_mapping");
  f.behavior.campaignMapping!.property = "utm_id";
  f.behavior.campaignMapping!.entries.campaign7.direct = true;
  await expect(readPosthogBehavior(f.behavior, "fixture", request)).rejects.toThrow("invalid_campaign_mapping");
  expect(request).not.toHaveBeenCalled();
});
