import { describe, expect, it, vi } from "vitest";
import { daysBack, etToday, mapMetaInsight, runLiveRefresh } from "@/lib/growthOs/liveRefresh";

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
});
