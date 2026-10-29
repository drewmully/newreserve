import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/analytics/googleSpendSource", () => ({ authorizeGoogleSpend: vi.fn(async () => "tok") }));
import { isAuthorized, parseRequest, runGateway, GatewayError, buildPmaxOperations, buildSearchOperations, searchAdGroupOps } from "@/lib/growthOs/googleAdsGateway";

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

describe("create_pmax", () => {
  const env2 = { GROWTH_OS_GOOGLE_SECRET: "x".repeat(40), GOOGLE_ADS_DEVELOPER_TOKEN: "d", GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64: "s" };
  const base = { action: "create_pmax", name: "Shop PMax", dailyUsd: 100, status: "ENABLED", finalUrl: "https://www.mymully.com/", businessName: "Mully",
    headlines: ["A", "B", "C"], longHeadlines: ["L"], descriptions: ["D1", "D2"],
    images: { marketing: ["customers/4335795219/assets/1"], square: ["customers/4335795219/assets/2"], portrait: [], logo: ["customers/4335795219/assets/3"] },
    negativeKeywords: ["mully"], excludeUrlContains: ["/lp/"], searchThemes: ["golf vest"], excludeProductTypeL1: ["subscription"], urlExpansion: true };
  it("rejects off-site URLs, foreign assets, long headlines and budgets over the cap", () => {
    expect(() => parseRequest({ ...base, finalUrl: "https://evil.com/" }, env2)).toThrow("final_url_not_mymully");
    expect(() => parseRequest({ ...base, images: { ...base.images, logo: ["customers/999/assets/3"] } }, env2)).toThrow("invalid_images_logo");
    expect(() => parseRequest({ ...base, headlines: ["A", "B", "x".repeat(31)] }, env2)).toThrow("invalid_headlines");
    expect(() => parseRequest({ ...base, dailyUsd: 150 }, env2)).toThrow("daily_usd_above_cap");
  });
  it("builds one atomic request with merchant, exclusions and listing groups", () => {
    const req = parseRequest(base, env2);
    const ops = buildPmaxOperations(req as never);
    const camp = ops.find((o) => o.campaignOperation) as { campaignOperation: { create: Record<string, unknown> } };
    expect(camp.campaignOperation.create).toMatchObject({ advertisingChannelType: "PERFORMANCE_MAX", status: "ENABLED", shoppingSetting: { merchantId: "371722715" } });
    expect(ops.filter((o) => o.assetGroupListingGroupFilterOperation)).toHaveLength(3);
    expect(JSON.stringify(ops)).toContain('"matchType":"PHRASE"');
    expect(JSON.stringify(ops)).toContain('"amountMicros":"100000000"');
  });
  it("only accepts real image bytes for uploads", () => {
    expect(() => parseRequest({ action: "upload_image_asset", name: "x", dataBase64: Buffer.from("hello").toString("base64") }, env2)).toThrow("invalid_image");
    expect(parseRequest({ action: "upload_image_asset", name: "x", dataBase64: Buffer.from([0xff, 0xd8, 0xff, 0x00]).toString("base64") }, env2).action).toBe("upload_image_asset");
  });
});

describe("create_search, keyword_metrics, ad_group_report", () => {
  const env3 = { GROWTH_OS_GOOGLE_SECRET: "x".repeat(40), GOOGLE_ADS_DEVELOPER_TOKEN: "d", GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64: "s" };
  const group = { name: "A", cpcBidUsd: 3.5, finalUrlSuffix: "utm_source=google&utm_medium=cpc&utm_campaign=ac_search&utm_content=g-agents",
    keywords: [{ text: "shopify ai agent", matchType: "PHRASE" }, { text: "shopify ai agent", matchType: "EXACT" }],
    headlines: ["AI Agents for Shopify Stores", "Done-For-You AI Agents", "One Monthly Subscription"], descriptions: ["D one.", "D two."] };
  const base = { action: "create_search", name: "AC | Search", dailyUsd: 50, status: "ENABLED", finalUrl: "https://agentcocoon.com/",
    negativeKeywords: ["jobs", "free"], adGroups: [group] };
  it("allows only agentcocoon final URLs, phrase/exact match, Google lengths and no em dashes", () => {
    expect(parseRequest(base, env3).action).toBe("create_search");
    expect(parseRequest({ ...base, finalUrl: "https://www.agentcocoon.com/x" }, env3).action).toBe("create_search");
    expect(() => parseRequest({ ...base, finalUrl: "https://www.mymully.com/" }, env3)).toThrow("final_url_not_allowed");
    expect(() => parseRequest({ ...base, finalUrl: "https://agentcocoon.com.evil.com/" }, env3)).toThrow("final_url_not_allowed");
    expect(() => parseRequest({ ...base, adGroups: [{ ...group, keywords: [{ text: "x", matchType: "BROAD" }] }] }, env3)).toThrow("match_type_not_allowed");
    expect(() => parseRequest({ ...base, adGroups: [{ ...group, headlines: ["A", "B", "x".repeat(31)] }] }, env3)).toThrow("invalid_headlines");
    expect(() => parseRequest({ ...base, adGroups: [{ ...group, descriptions: ["a", "b", "c", "d", "e"] }] }, env3)).toThrow("invalid_descriptions_count");
    expect(() => parseRequest({ ...base, adGroups: [{ ...group, headlines: ["A", "B", "Fast \u2014 easy"] }] }, env3)).toThrow("headline_contains_dash");
    expect(() => parseRequest({ ...base, adGroups: [{ ...group, cpcBidUsd: 25 }] }, env3)).toThrow("invalid_cpc_bid_usd");
    expect(() => parseRequest({ ...base, adGroups: [{ ...group, finalUrlSuffix: "utm_source=a b" }] }, env3)).toThrow("invalid_final_url_suffix");
    expect(() => parseRequest({ ...base, dailyUsd: 150 }, env3)).toThrow("daily_usd_above_cap");
  });
  it("existing actions stay mymully-only", () => {
    expect(() => parseRequest({ action: "create_pmax", name: "x", dailyUsd: 10, status: "PAUSED", finalUrl: "https://agentcocoon.com/", businessName: "x",
      headlines: ["A", "B", "C"], longHeadlines: ["L"], descriptions: ["D", "E"], images: { marketing: [], square: [], logo: [] } }, env3)).toThrow("final_url_not_mymully");
  });
  it("builds a search-only manual CPC campaign in one request", () => {
    const ops = buildSearchOperations(parseRequest(base, env3) as never);
    const c = (ops.find((o) => o.campaignOperation) as { campaignOperation: { create: Record<string, unknown> } }).campaignOperation.create;
    expect(c).toMatchObject({ advertisingChannelType: "SEARCH", manualCpc: { enhancedCpcEnabled: false }, aiMaxSetting: { enableAiMax: false },
      networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
      geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE" } });
    expect(c.keywordMatchType).toBeUndefined();
    const ag = (ops.find((o) => o.adGroupOperation) as { adGroupOperation: { create: Record<string, unknown> } }).adGroupOperation.create;
    expect(ag).toMatchObject({ cpcBidMicros: "3500000", finalUrlSuffix: group.finalUrlSuffix });
    const json = JSON.stringify(ops);
    expect(json).not.toContain("BROAD");
    expect(json).not.toMatch(/conversionAction|conversionGoal/);
    expect(ops.filter((o) => o.adGroupCriterionOperation)).toHaveLength(2);
    expect(ops.filter((o) => o.adGroupAdOperation)).toHaveLength(1);
    expect(ops.filter((o) => o.campaignCriterionOperation)).toHaveLength(4);
    expect(json).toContain('"amountMicros":"50000000"');
  });
  it("keyword_metrics calls Keyword Planner for US English Google Search", async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [{ text: "shopify ai agent", keywordMetrics: { avgMonthlySearches: "320", competition: "HIGH", lowTopOfPageBidMicros: "4100000", highTopOfPageBidMicros: "12000000" } }] }), { status: 200 }));
    const res = await runGateway(parseRequest({ action: "keyword_metrics", keywords: ["Shopify AI Agent", "nothing here"] }, env3), env3, fetcher as unknown as typeof fetch) as { historical: Array<Record<string, unknown>>; noData: string[] };
    const [url, init] = fetcher.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://googleads.googleapis.com/v25/customers/4335795219:generateKeywordHistoricalMetrics");
    expect(JSON.parse(String(init.body))).toMatchObject({ geoTargetConstants: ["geoTargetConstants/2840"], language: "languageConstants/1000", keywordPlanNetwork: "GOOGLE_SEARCH" });
    expect(String((fetcher.mock.calls[1] as unknown as [string])[0])).toContain(":generateKeywordIdeas");
    expect(res.historical[0]).toMatchObject({ keyword: "shopify ai agent", avgMonthlySearches: 320, lowTopOfPageBidUsd: 4.1, highTopOfPageBidUsd: 12 });
    expect(res.noData).toEqual(["nothing here"]);
  });
  it("ad_group_report validates dates and is read only", async () => {
    expect(() => parseRequest({ action: "ad_group_report", since: "2026-10-30", until: "2026-10-01" }, env3)).toThrow("invalid_date_range");
    expect(() => parseRequest({ action: "ad_group_report", since: "2026-01-01", until: "2026-10-01" }, env3)).toThrow("date_range_too_long");
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ results: [{ campaign: { id: "1", name: "AC" }, adGroup: { id: "2", name: "A" }, metrics: { costMicros: "1500000", clicks: "2", impressions: "40", ctr: 0.05, averageCpc: "750000" } }] }), { status: 200 }));
    const res = await runGateway(parseRequest({ action: "ad_group_report", since: "2026-10-29", until: "2026-10-30", campaignId: "1" }, env3), env3, fetcher as unknown as typeof fetch) as { adGroups: Array<Record<string, unknown>> };
    const urls = fetcher.mock.calls.map((c) => String((c as unknown as [string])[0]));
    expect(urls.every((u) => u.endsWith("googleAds:search"))).toBe(true);
    expect(urls).toHaveLength(4);
    expect(res.adGroups[0]).toMatchObject({ spendUsd: 1.5, avgCpcUsd: 0.75, clicks: 2 });
  });
});

describe("add_search_ad_group", () => {
  const env4 = { GROWTH_OS_GOOGLE_MAX_DAILY_USD: "100" };
  const adGroup = { name: "E, Agency alternative", cpcBidUsd: 3.5, finalUrlSuffix: "utm_source=google&utm_content=g-compare",
    keywords: [{ text: "marketing agency alternative", matchType: "PHRASE" }, { text: "marketing agency alternative", matchType: "EXACT" }],
    headlines: ["Four Agencies or One?", "Ditch the Agency Retainer", "AI Agents Built for You"], descriptions: ["One.", "Two."] };
  const base = { action: "add_search_ad_group", campaignId: "24405645267", finalUrl: "https://agentcocoon.com/", adGroup };
  it("validates campaign id, site, bid and copy", () => {
    expect(parseRequest(base, env4).action).toBe("add_search_ad_group");
    expect(() => parseRequest({ ...base, campaignId: "x" }, env4)).toThrow();
    expect(() => parseRequest({ ...base, finalUrl: "https://mymully.com/" }, env4)).toThrow();
    expect(() => parseRequest({ ...base, adGroup: { ...adGroup, cpcBidUsd: 50 } }, env4)).toThrow();
    expect(() => parseRequest({ ...base, adGroup: { ...adGroup, headlines: ["A \u2014 B", "x", "y"] } }, env4)).toThrow();
  });
  it("builds ad group, keyword and RSA ops against the existing campaign only", () => {
    const ops = searchAdGroupOps("customers/4335795219/campaigns/24405645267", -10, adGroup as never, "https://agentcocoon.com/");
    expect(ops).toHaveLength(4);
    expect(JSON.stringify(ops)).not.toContain("campaignBudget");
    expect((ops[0].adGroupOperation as { create: Record<string, unknown> }).create).toMatchObject({
      campaign: "customers/4335795219/campaigns/24405645267", cpcBidMicros: "3500000", name: "E, Agency alternative" });
  });
});
