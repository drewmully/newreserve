import { describe, expect, it, vi } from "vitest";
import { daysBack, etToday, mapMetaInsight, runLiveRefresh, fetchAcSearchDetail, AC_SEARCH_CAMPAIGN_ID } from "@/lib/growthOs/liveRefresh";

describe("growth os live refresh", () => {
  it("maps Graph insights to the connector shape ingest_meta expects", () => {
    const r = mapMetaInsight({ ad_id: "1", ad_name: "A", date_start: "2026-10-15", campaign_id: "c", campaign_name: "C", adset_id: "s", adset_name: "S",
      spend: "155.79", impressions: "1936", actions: [{ action_type: "link_click", value: "64" }, { action_type: "omni_add_to_cart", value: "2" }, { action_type: "omni_purchase", value: "2" }],
      action_values: [{ action_type: "omni_purchase", value: "350.46" }] });
    expect(r).toMatchObject({ id: "1", date_start: "2026-10-15", amount_spent: "155.79", link_click: "64", omni_add_to_cart: "2", omni_purchase: "2", omni_purchase_values: "350.46", omni_initiated_checkout: "0" });
  });
  it("uses Eastern dates", () => {
    expect(etToday(new Date("2026-10-16T03:30:00Z"))).toBe("2026-10-15");
    expect(daysBack("2026-10-16", 7)).toBe("2026-10-09");
  });
  it("still ingests when every source fails, and reports each failure", async () => {
    const fetcher = vi.fn(async () => new Response("{}", { status: 500 }));
    const rpc = vi.fn(async () => ({ status: "PARTIAL" }));
    const out = await runLiveRefresh({}, rpc, fetcher as unknown as typeof fetch);
    expect(out.errors.map((e) => e.source).sort()).toEqual(["google", "meta", "shopify_attribution"]);
    expect(rpc).toHaveBeenCalledWith("gos_live_ingest", expect.objectContaining({ p: expect.objectContaining({ meta: null, google: null, orders: null }) }));
  });
  it("maps AgentCocoon Search ad group, keyword and search term rows per day, each part independent", async () => {
    const mt = { impressions: "40", clicks: "3", costMicros: "7500000", conversions: 0, conversionsValue: 0 };
    const q = vi.fn(async (query: string) => {
      if (query.includes("FROM search_term_view")) throw new Error("boom");
      if (query.includes("FROM keyword_view")) return { rows: [{ segments: { date: "2026-10-29" }, adGroup: { id: "210070479348" },
        adGroupCriterion: { criterionId: "55", keyword: { text: "shopify ai agent", matchType: "EXACT" } }, metrics: mt }] };
      return { rows: [{ segments: { date: "2026-10-29" }, adGroup: { id: "210070479348", name: "A | Shopify AI agents" }, metrics: mt }] };
    });
    const out = await fetchAcSearchDetail("2026-10-15", "2026-10-29", q);
    expect(q.mock.calls.every((c) => String(c[0]).includes(`campaign.id = ${AC_SEARCH_CAMPAIGN_ID}`))).toBe(true);
    expect(out.detail).toEqual([
      { kind: "ad_group", campaign_id: AC_SEARCH_CAMPAIGN_ID, date: "2026-10-29", key: "210070479348", label: "A | Shopify AI agents", impressions: "40", clicks: "3", cost_micros: "7500000", conversions: 0, conv_value: 0 },
      { kind: "keyword", campaign_id: AC_SEARCH_CAMPAIGN_ID, date: "2026-10-29", key: "210070479348~55", label: "shopify ai agent [EXACT]", impressions: "40", clicks: "3", cost_micros: "7500000", conversions: 0, conv_value: 0 },
    ]);
    expect(out.errors).toEqual([{ source: "google_ac_search_term", error: "boom" }]);
  });
});
