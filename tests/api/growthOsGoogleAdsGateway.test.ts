import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/analytics/googleSpendSource", () => ({ authorizeGoogleSpend: vi.fn(async () => "tok") }));
import { isAuthorized, parseRequest, runGateway, GatewayError } from "@/lib/growthOs/googleAdsGateway";

const secret = "s".repeat(40);
const env = { GROWTH_OS_GOOGLE_SECRET: secret, GOOGLE_ADS_DEVELOPER_TOKEN: "dev", GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64: "e30=" };

describe("growth os google ads gateway", () => {
  it("auth requires exact long secret", () => {
    expect(isAuthorized(`Bearer ${secret}`, env)).toBe(true);
    expect(isAuthorized("Bearer nope", env)).toBe(false);
    expect(isAuthorized(`Bearer short`, { GROWTH_OS_GOOGLE_SECRET: "short" })).toBe(false);
  });
  it("only allows SELECT reads", () => {
    expect(() => parseRequest({ action: "search", query: "DELETE x" }, env)).toThrow(GatewayError);
    expect(parseRequest({ action: "search", query: "SELECT campaign.id FROM campaign", maxPages: 99 }, env)).toMatchObject({ maxPages: 5 });
  });
  it("enforces budget cap and rejects unknown actions", () => {
    expect(() => parseRequest({ action: "update_budget", campaignBudgetId: "1", dailyUsd: 500 }, env)).toThrow("daily_usd_above_cap");
    expect(() => parseRequest({ action: "remove_campaign", campaignId: "1" }, env)).toThrow("unsupported_action");
  });
  it("sends budget mutate to the fixed customer with own developer token", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [{ resourceName: "x" }] }), { status: 200 }));
    await runGateway(parseRequest({ action: "update_budget", campaignBudgetId: "123", dailyUsd: 25 }, env), env, fetcher as unknown as typeof fetch);
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://googleads.googleapis.com/v25/customers/4335795219/campaignBudgets:mutate");
    const h = init.headers as Record<string, string>;
    expect(h["developer-token"]).toBe("dev");
    expect(h["login-customer-id"]).toBe("9552995078");
    expect(JSON.parse(String(init.body)).operations[0].update.amountMicros).toBe("25000000");
  });
  it("only allows MyMully's merchant and refuses non-PMax campaigns", async () => {
    expect(() => parseRequest({ action: "attach_merchant", campaignId: "1", merchantId: "999" }, env)).toThrow("merchant_not_allowed");
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [{ campaign: { advertisingChannelType: "SEARCH" } }] }), { status: 200 }));
    await expect(runGateway(parseRequest({ action: "attach_merchant", campaignId: "1" }, env), env, fetcher as unknown as typeof fetch)).rejects.toThrow("not_performance_max");
  });
  it("attaches merchant 371722715 to a PMax campaign without one", async () => {
    const res = [{ results: [{ campaign: { advertisingChannelType: "PERFORMANCE_MAX", shoppingSetting: {} } }] }, { results: [{ resourceName: "c" }] }];
    const fetcher = vi.fn(async () => new Response(JSON.stringify(res.shift()), { status: 200 }));
    await runGateway(parseRequest({ action: "attach_merchant", campaignId: "24165010315" }, env), env, fetcher as unknown as typeof fetch);
    const [url, init] = fetcher.mock.calls[1] as unknown as [string, RequestInit];
    expect(url).toContain("/campaigns:mutate");
    const op = JSON.parse(String(init.body)).operations[0];
    expect(op.updateMask).toBe("shopping_setting.merchant_id");
    expect(op.update.shoppingSetting.merchantId).toBe("371722715");
  });
  it("adds an all-products root listing group only when none exist", async () => {
    const pm = { results: [{ campaign: { advertisingChannelType: "PERFORMANCE_MAX" } }] };
    const res = [pm, { results: [{ x: 1 }] }];
    const f1 = vi.fn(async () => new Response(JSON.stringify(res.shift()), { status: 200 }));
    await expect(runGateway(parseRequest({ action: "include_all_products", assetGroupId: "6741759020" }, env), env, f1 as unknown as typeof fetch)).rejects.toThrow("listing_groups_already_exist");
    const res2 = [pm, { results: [] }, { results: [{ resourceName: "lg" }] }];
    const f2 = vi.fn(async () => new Response(JSON.stringify(res2.shift()), { status: 200 }));
    await runGateway(parseRequest({ action: "include_all_products", assetGroupId: "6741759020" }, env), env, f2 as unknown as typeof fetch);
    const [url, init] = f2.mock.calls[2] as unknown as [string, RequestInit];
    expect(url).toContain("/assetGroupListingGroupFilters:mutate");
    expect(JSON.parse(String(init.body)).operations[0].create).toEqual({ assetGroup: "customers/4335795219/assetGroups/6741759020", type: "UNIT_INCLUDED", listingSource: "SHOPPING" });
  });
});
