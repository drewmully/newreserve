import { describe, expect, it, vi } from "vitest";
vi.mock("@/lib/analytics/googleSpendSource", () => ({ authorizeGoogleSpend: vi.fn(async () => "tok") }));
import { isAuthorized, parseRequest, runGateway, GatewayError, buildPmaxOperations, buildSearchOperations, searchAdGroupOps, parseLeadgenPmax, buildLeadgenPmaxOperations, imageSize, conversionLabel } from "@/lib/growthOs/googleAdsGateway";

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

describe("AgentCocoon lead gen", () => {
  const png = (w: number, h: number) => { const b = Buffer.alloc(40); Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20); return b; };
  const img = (n: string) => `https://agentcocoon.com/img/pmax/${n}.png`;
  const base = {
    action: "create_pmax_leadgen", name: "AC | PMax | Hire", dailyUsd: 100, status: "PAUSED", finalUrl: "https://agentcocoon.com/hire",
    finalUrlSuffix: "utm_source=google&utm_medium=cpc&utm_campaign=ac_pmax&utm_content=g-hire", assetGroupName: "Owners | Outsourced AI hire",
    businessName: "AgentCocoon", callToAction: "Learn more", headlines: ["Your outsourced AI hire", "No agency retainers", "Get your hours back"],
    longHeadlines: ["One price instead of a marketing agency, a lead gen agency and a web shop."],
    descriptions: ["Tell us the job. We build the agent and keep it running.", "Month to month. Cancel anytime. You own the accounts the agents run in."],
    images: { marketing: [img("a-1200x628")], square: [img("a-1200x1200")], portrait: [img("a-960x1200")], logo: [img("logo")], landscapeLogo: [img("wide")] },
    negativeKeywords: ["jobs", "mully"], searchThemes: ["ai for law firms", "hire ai consultant"], conversionActionName: "AC | Hire lead",
    audience: { customSegmentName: "AC owners AI intent", minAge: 45 },
  };
  const envL = { GROWTH_OS_GOOGLE_MAX_DAILY_USD: "100" };
  it("validates the lead gen request", () => {
    const r = parseRequest(base, envL) as Extract<ReturnType<typeof parseRequest>, { action: "create_pmax_leadgen" }>;
    expect(r.callToAction).toBe("LEARN_MORE");
    expect(r.audience?.terms).toEqual(base.searchThemes);
    expect(() => parseRequest({ ...base, dailyUsd: 101 }, envL)).toThrow("daily_usd_above_cap");
    expect(() => parseRequest({ ...base, finalUrl: "https://www.mymully.com/" }, envL)).toThrow("final_url_not_allowed");
    expect(() => parseRequest({ ...base, name: "Mully PMax" }, envL)).toThrow("invalid_name");
    expect(() => parseRequest({ ...base, headlines: ["A \u2014 B", "x", "y"] }, envL)).toThrow();
    expect(() => parseRequest({ ...base, headlines: ["x".repeat(31), "x", "y"] }, envL)).toThrow("invalid_headlines");
    expect(() => parseRequest({ ...base, descriptions: ["x".repeat(61), "y".repeat(61)] }, envL)).toThrow("need_short_description");
    expect(() => parseRequest({ ...base, businessName: "x".repeat(26) }, envL)).toThrow("invalid_business_name");
    expect(() => parseRequest({ ...base, images: { ...base.images, logo: ["https://www.mymully.com/logo.png"] } }, envL)).toThrow("invalid_images_logo");
    expect(() => parseRequest({ ...base, conversionActionName: "Purchase (1)" }, envL)).toThrow("invalid_conversion_action_name");
    expect(() => parseRequest({ action: "create_conversion_action_leadgen", name: "Email Submitted" }, envL)).toThrow("invalid_name");
  });
  it("builds a lead gen PMax: no Merchant Center, max conversions, URL expansion off, campaign goal only", () => {
    const spec = parseLeadgenPmax(base, envL);
    const ops = buildLeadgenPmaxOperations(spec, { conversionAction: "customers/4335795219/conversionActions/9", customGoal: null,
      customAudience: "customers/4335795219/customAudiences/7", images: [{ url: img("a-1200x628"), kind: "marketing", dataBase64: "x" }, { url: img("wide"), kind: "landscapeLogo", dataBase64: "y" }] });
    const j = JSON.stringify(ops);
    expect(j).not.toContain("shoppingSetting"); expect(j).not.toContain("merchant"); expect(j).not.toContain("targetCpa");
    expect(j).not.toContain("assetGroupListingGroupFilter");
    const camp = (ops[1].campaignOperation as { create: Record<string, unknown> }).create;
    expect(camp).toMatchObject({ status: "PAUSED", maximizeConversions: {}, finalUrlSuffix: base.finalUrlSuffix,
      assetAutomationSettings: [{ assetAutomationType: "FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION", assetAutomationStatus: "OPTED_OUT" }],
      geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE", negativeGeoTargetType: "PRESENCE" } });
    expect((ops[0].campaignBudgetOperation as { create: Record<string, unknown> }).create).toMatchObject({ amountMicros: "100000000", explicitlyShared: false });
    expect(j).toContain('"conversionActions":["customers/4335795219/conversionActions/9"]');
    expect(j).toContain('"goalConfigLevel":"CAMPAIGN"');
    expect(j).toContain('"callToAction":"LEARN_MORE"'); expect(j).toContain('"fieldType":"LANDSCAPE_LOGO"'); expect(j).toContain('"fieldType":"CALL_TO_ACTION_SELECTION"');
    expect(j).toContain('"ageRanges":[{"minAge":45,"maxAge":54},{"minAge":55,"maxAge":64},{"minAge":65}]');
    expect(j).toContain('"customAudience":"customers/4335795219/customAudiences/7"');
    expect(ops.filter((o) => (o.campaignCriterionOperation as { create?: { negative?: boolean } })?.create?.negative)).toHaveLength(2);
  });
  it("reads image sizes and conversion labels", () => {
    expect(imageSize(png(1200, 628))).toEqual({ w: 1200, h: 628, type: "png" });
    expect(imageSize(Buffer.from("nope"))).toBeNull();
    expect(conversionLabel([{ eventSnippet: "gtag('event', 'conversion', {'send_to': 'AW-603275854/AbC_d-1'});" }])).toEqual({ tag: "AW-603275854", label: "AW-603275854/AbC_d-1" });
  });
  it("creates the conversion action as secondary (outside account goals) and returns the label", async () => {
    const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
    const fetcher = vi.fn(async (url: string, init: { body: string }) => {
      const body = JSON.parse(init.body); calls.push({ url, body });
      if (url.endsWith("conversionActions:mutate")) return new Response(JSON.stringify({ results: [{ resourceName: "customers/4335795219/conversionActions/123" }] }));
      if (String(body.query).includes("conversion_action.tag_snippets")) return new Response(JSON.stringify({ results: [{ conversionAction: { id: "123",
        tagSnippets: [{ eventSnippet: "gtag('event', 'conversion', {'send_to': 'AW-603275854/xyz'});" }] } }] }));
      return new Response(JSON.stringify({ results: [] }));
    });
    const out = await runGateway(parseRequest({ action: "create_conversion_action_leadgen", name: "AC | Hire lead" }, env), env, fetcher as unknown as typeof fetch) as Record<string, unknown>;
    const create = ((calls.find((c) => c.url.endsWith("conversionActions:mutate"))?.body.operations as Array<{ create: Record<string, unknown> }>)[0]).create;
    expect(create).toMatchObject({ name: "AC | Hire lead", type: "WEBPAGE", category: "SUBMIT_LEAD_FORM", countingType: "ONE_PER_CLICK",
      clickThroughLookbackWindowDays: 30, viewThroughLookbackWindowDays: 1, primaryForGoal: false, valueSettings: { defaultValue: 0 } });
    expect(calls.some((c) => /customerConversionGoals|conversionGoalCampaignConfigs/.test(c.url))).toBe(false);
    expect(out.conversionLabel).toBe("AW-603275854/xyz");
  });
  it("rejects images with the wrong aspect ratio before calling Google", async () => {
    const fetcher = vi.fn(async (url: string, init?: { body?: string }) => {
      if (url.startsWith("https://agentcocoon.com/")) return new Response(png(1000, 1000));
      const q = String(JSON.parse(init?.body ?? "{}").query ?? "");
      if (q.includes("FROM conversion_action")) return new Response(JSON.stringify({ results: [{ conversionAction: { resourceName: "customers/4335795219/conversionActions/9", type: "WEBPAGE" } }] }));
      return new Response(JSON.stringify({ results: [] }));
    });
    const req = parseRequest({ ...base, audience: undefined }, env);
    await expect(runGateway(req, env, fetcher as unknown as typeof fetch)).rejects.toThrow("image_wrong_size");
    expect(fetcher.mock.calls.some((c) => String(c[0]).endsWith("googleAds:mutate"))).toBe(false);
  });
});
