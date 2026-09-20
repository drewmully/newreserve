import { describe, expect, it } from "vitest";
import { normalizeSpendBase, selectSpendBases, fetchGoogleCampaignPages, googleSpendBase, type SpendBase } from "@/lib/analytics/spend";
const base = (): SpendBase => ({
  provider: "google_ads", accountId: "account", date: "2026-01-01", baseReportId: "base-1",
  sourceTimezone: "America/New_York", sourceCurrency: "USD", completedAt: "2026-01-02T12:00:00Z",
  paginationComplete: true, verifiedEmpty: false, evidenceRef: "source",
  rows: [{ campaignId: "c", costMicros: "12000001", clicks: "2", impressions: "20" }],
});
const expected = [{ provider: "google_ads", accountId: "account", date: "2026-01-01" }];
describe("governed complete campaign spend", () => {
  it("converts micros exactly without rounding cents", () => {
    expect(normalizeSpendBase(base(), "p")[0].spend_usd).toBe("12.000001");
  });
  it("selects the latest complete base including a downward restatement", () => {
    const revision = { ...base(), baseReportId: "base-2", completedAt: "2026-01-03T12:00:00Z", rows: [{ campaignId: "c", costMicros: "1000000" }] };
    expect(selectSpendBases([base(), revision], expected, "approval")[0].base?.baseReportId).toBe("base-2");
  });
  it("labels a previous complete base stale when the newest attempt is partial", () => {
    const partial = { ...base(), baseReportId: "partial", completedAt: "2026-01-03T12:00:00Z", paginationComplete: false };
    expect(selectSpendBases([base(), partial], expected, "approval")[0].status).toBe("stale");
  });
  it("distinguishes a missing account/day from a verified zero", () => {
    expect(selectSpendBases([], expected, "approval")[0].base).toBeNull();
    expect(normalizeSpendBase({ ...base(), rows: [], verifiedEmpty: true }, "p")[0].spend_usd).toBe("0.000000");
    expect(() => normalizeSpendBase({ ...base(), rows: [] }, "p")).toThrow("incomplete");
  });
  it("withholds incompatible currency or actual source timezone", () => {
    expect(normalizeSpendBase({ ...base(), sourceTimezone: "UTC" }, "p")[0].spend_usd).toBeNull();
    expect(normalizeSpendBase({ ...base(), sourceCurrency: "CAD" }, "p")[0].spend_usd).toBeNull();
  });
  it("does not fabricate optional metrics", () => {
    expect(normalizeSpendBase({ ...base(), rows: [{ campaignId: "c", costMicros: "0" }] }, "p")[0]).toMatchObject({ clicks: null, impressions: null, click_definition: null });
  });
  it("rejects unexpected accounts and duplicate campaign rows", () => {
    expect(() => selectSpendBases([{ ...base(), accountId: "other" }], expected, "approval")).toThrow();
    const b = base(); b.rows.push(b.rows[0]);
    expect(() => normalizeSpendBase(b, "p")).toThrow("duplicate");
  });
  it("requires all Google pages and validates date and campaign fields", async () => {
    const rows = await fetchGoogleCampaignPages(async cursor => ({
      results: [{ campaign: { id: cursor ? "2" : "1" }, segments: { date: base().date }, metrics: { costMicros: "5" } }],
      nextPageToken: cursor ? undefined : "next",
    }), 2);
    expect(googleSpendBase(rows, base()).rows).toHaveLength(2);
    await expect(fetchGoogleCampaignPages(async () => ({}), 2)).rejects.toThrow("schema_drift");
    await expect(fetchGoogleCampaignPages(async () => ({ results: [], nextPageToken: "next" }), 1)).rejects.toThrow("incomplete");
  });
});
