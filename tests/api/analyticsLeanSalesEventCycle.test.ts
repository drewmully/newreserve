import { expect, it } from "vitest";
import { admitNativeSpendWindow } from "@/lib/analytics/nativeSpendWindowInput";
import { buildFullReports } from "@/lib/analytics/fullReportBuild";
import { salesEventCaptureQueries } from "@/lib/analytics/salesEventWindowCapture";
import { fullFixture } from "../fixtures/analyticsFull";
import { canonicalEventCycleServerTime } from "@/lib/analytics/salesEventCyclePreparation";

it("converts only explicit server offsets while retaining all source fractional digits", () => {
  expect(canonicalEventCycleServerTime("2026-10-07T10:41:48.123456-07:00")).toBe("2026-10-07T17:41:48.123456Z");
  expect(canonicalEventCycleServerTime("2026-10-07T17:41:48.062+00:00")).toBe("2026-10-07T17:41:48.062000Z");
  expect(() => canonicalEventCycleServerTime("2026-10-07T17:41:48")).toThrow();
  expect(() => canonicalEventCycleServerTime("2026-02-30T17:41:48+00:00")).toThrow();
});

// Synthetic policy and data only. No operating authority or live cycle.
it("leaves legacy spend admission untouched when the scoped mode is absent", () => {
  const f = fullFixture();
  expect(admitNativeSpendWindow(undefined, { projectRef: "a".repeat(20), shop: f.shop,
    publication: f.publication, fromDate: f.fromDate, throughDate: f.throughDate,
    asOf: f.policy.asOf, facts: f.base.marketing_spend_daily })).toBeNull();
  expect(buildFullReports(f).reports.store_daily[0].spend_usd).toBe("5.000000");
  f.evidence.proofs = f.evidence.proofs.filter(p => p.table !== "marketing_spend_daily");
  expect(buildFullReports(f).reports.store_daily[0].spend_usd).toBeNull();
});

it.each([null, undefined, false, [], "UNSET"])("does not fall back for explicit malformed scoped-spend pairing %j", value => {
  const f = fullFixture();
  Object.assign(f.policy, { nativeSpendWindow: value });
  Object.assign(f.evidence, { nativeSpendWindow: value });
  expect(() => buildFullReports(f)).toThrow();
});

it("parameterizes one closed-day recipe without an original-order filter", () => {
  const a = salesEventCaptureQueries("2026-10-05"), b = salesEventCaptureQueries("2026-10-06");
  expect(a).not.toEqual(b);
  for (const query of Object.values(b)) {
    expect(query).toContain("2026-10-06");
    expect(query).toContain("LIMIT 21");
    expect(query).not.toContain("WHERE");
  }
  expect(() => salesEventCaptureQueries("UNSET")).toThrow();
});
