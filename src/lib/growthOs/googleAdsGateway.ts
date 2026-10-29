/**
 * Growth OS Google Ads gateway.
 *
 * Lets Growth OS read and make approved budget/status changes on the MyMully
 * Google Ads account using MyMully's own developer token and service account,
 * instead of a shared third-party connector token.
 *
 * Hard limits (not configurable by the caller):
 * - one customer only: 4335795219 (via manager 9552995078)
 * - reads: GAQL SELECT only, max 5 pages
 * - writes: campaign budget amount, campaign status (ENABLED/PAUSED),
 *   attach MyMully's Merchant Center (371722715 only) to a Performance Max campaign,
 *   and add an "all products" listing group to a Performance Max asset group that has none
 * - creates: one image asset per call (JPEG/PNG, max 4 MB), and a complete Performance Max
 *   shop campaign in one atomic request (budget under the cap, US + English, Merchant Center
 *   371722715, asset group, listing groups, negative keywords, URL exclusions, search themes).
 *   Final URLs must be on https://www.mymully.com.
 * - Search campaigns (create_search): one atomic request creating a non-shared budget (under the cap),
 *   a Google Search-only MANUAL_CPC campaign (enhanced CPC off, partners/display off, AI Max off, no broad
 *   match campaign setting, US presence + English), ad groups with a CPC cap, PHRASE/EXACT keywords,
 *   campaign PHRASE negatives and one responsive search ad per ad group. Final URLs for this action
 *   only: https://agentcocoon.com or https://www.agentcocoon.com. No em dashes in ad text.
 * - read-only planning and reporting: keyword_metrics (Keyword Planner historical metrics and ideas,
 *   US, English, Google Search) and ad_group_report (campaign / ad group / keyword / search term).
 * - never creates or edits conversion actions or conversion goals.
 * - budget ceiling: GROWTH_OS_GOOGLE_MAX_DAILY_USD (default 100)
 */
import { timingSafeEqual } from "node:crypto";
import { authorizeGoogleSpend } from "@/lib/analytics/googleSpendSource";

export const GOOGLE_ADS_API_VERSION = "v25";
export const GATEWAY_CUSTOMER_ID = "4335795219";
export const GATEWAY_LOGIN_CUSTOMER_ID = "9552995078";
export const GATEWAY_MERCHANT_ID = "371722715";

type Env = Record<string, string | undefined>;
export type GatewayRequest =
  | { action: "search"; query: string; maxPages?: number }
  | { action: "update_budget"; campaignBudgetId: string; dailyUsd: number; validateOnly?: boolean }
  | { action: "set_campaign_status"; campaignId: string; status: "ENABLED" | "PAUSED"; validateOnly?: boolean }
  | { action: "attach_merchant"; campaignId: string; validateOnly?: boolean }
  | { action: "include_all_products"; assetGroupId: string; validateOnly?: boolean }
  | { action: "upload_image_asset"; name: string; dataBase64: string; validateOnly?: boolean }
  | ({ action: "create_pmax"; validateOnly?: boolean } & PmaxSpec)
  | { action: "keyword_metrics"; keywords: string[]; includeIdeas: boolean; ideasPageSize: number }
  | ({ action: "create_search"; validateOnly?: boolean } & SearchSpec)
  | { action: "ad_group_report"; since: string; until: string; campaignId?: string; includeSearchTerms: boolean };

export type MatchType = "PHRASE" | "EXACT";
export type SearchAdGroupSpec = {
  name: string; cpcBidUsd: number; finalUrlSuffix: string;
  keywords: Array<{ text: string; matchType: MatchType }>;
  headlines: string[]; descriptions: string[];
};
export type SearchSpec = {
  name: string; dailyUsd: number; status: "ENABLED" | "PAUSED"; finalUrl: string;
  negativeKeywords: string[]; adGroups: SearchAdGroupSpec[];
};
const AC_SITE = /^https:\/\/(www\.)?agentcocoon\.com(\/[^\s]*)?$/;
const SUFFIX = /^[A-Za-z0-9_.~-]+=[A-Za-z0-9_.~%-]+(&[A-Za-z0-9_.~-]+=[A-Za-z0-9_.~%-]+)*$/;
const DASHES = /[\u2013\u2014]/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
export const MAX_CPC_USD = 10;
function kwText(v: unknown, field: string): string {
  const t = typeof v === "string" ? v.trim().toLowerCase().replace(/\s+/g, " ") : "";
  if (!t || t.length > 80 || t.split(" ").length > 10 || /[!@%^*()={}~`<>?\\|"[\]]/.test(t)) throw new GatewayError(400, `invalid_${field}`, { value: v });
  return t;
}
function noDashes(list: string[], field: string) {
  for (const t of list) if (DASHES.test(t)) throw new GatewayError(400, `${field}_contains_dash`, { value: t });
  return list;
}

export type PmaxSpec = {
  name: string; dailyUsd: number; status: "ENABLED" | "PAUSED"; finalUrl: string; businessName: string;
  headlines: string[]; longHeadlines: string[]; descriptions: string[];
  images: { marketing: string[]; square: string[]; portrait: string[]; logo: string[] };
  negativeKeywords: string[]; excludeUrlContains: string[]; searchThemes: string[];
  excludeProductTypeL1: string[]; urlExpansion: boolean;
};
const SITE = /^https:\/\/www\.mymully\.com(\/[^\s]*)?$/;
const ASSET_RN = /^customers\/4335795219\/assets\/\d{1,20}$/;
function strs(v: unknown, field: string, min: number, max: number, maxLen: number): string[] {
  if (!Array.isArray(v) || v.length < min || v.length > max) throw new GatewayError(400, `invalid_${field}_count`, { min, max });
  return v.map((x) => {
    const t = typeof x === "string" ? x.trim() : "";
    if (!t || t.length > maxLen) throw new GatewayError(400, `invalid_${field}`, { value: x, maxLen });
    return t;
  });
}

export class GatewayError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) { super(message); }
}

export function isAuthorized(header: string | null, env: Env): boolean {
  const secret = env.GROWTH_OS_GOOGLE_SECRET ?? "";
  if (secret.length < 32) return false;
  const got = (header ?? "").replace(/^Bearer\s+/i, "");
  const a = Buffer.from(got), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

const ID = /^\d{1,20}$/;
export function parseRequest(body: unknown, env: Env): GatewayRequest {
  if (!body || typeof body !== "object") throw new GatewayError(400, "invalid_body");
  const b = body as Record<string, unknown>;
  if (b.action === "search") {
    const q = typeof b.query === "string" ? b.query.trim() : "";
    if (!/^select\s/i.test(q) || q.length > 10000) throw new GatewayError(400, "query_must_be_select");
    const maxPages = Math.min(Math.max(Number(b.maxPages ?? 1) || 1, 1), 5);
    return { action: "search", query: q, maxPages };
  }
  if (b.action === "update_budget") {
    const id = String(b.campaignBudgetId ?? "");
    const usd = Number(b.dailyUsd);
    const cap = Number(env.GROWTH_OS_GOOGLE_MAX_DAILY_USD ?? "100");
    if (!ID.test(id)) throw new GatewayError(400, "invalid_campaign_budget_id");
    if (!Number.isFinite(usd) || usd < 1) throw new GatewayError(400, "invalid_daily_usd");
    if (usd > cap) throw new GatewayError(400, "daily_usd_above_cap", { cap });
    return { action: "update_budget", campaignBudgetId: id, dailyUsd: usd, validateOnly: b.validateOnly === true };
  }
  if (b.action === "set_campaign_status") {
    const id = String(b.campaignId ?? "");
    if (!ID.test(id)) throw new GatewayError(400, "invalid_campaign_id");
    if (b.status !== "ENABLED" && b.status !== "PAUSED") throw new GatewayError(400, "invalid_status");
    return { action: "set_campaign_status", campaignId: id, status: b.status, validateOnly: b.validateOnly === true };
  }
  if (b.action === "attach_merchant") {
    const id = String(b.campaignId ?? "");
    if (!ID.test(id)) throw new GatewayError(400, "invalid_campaign_id");
    if (b.merchantId !== undefined && String(b.merchantId) !== GATEWAY_MERCHANT_ID) throw new GatewayError(400, "merchant_not_allowed");
    return { action: "attach_merchant", campaignId: id, validateOnly: b.validateOnly === true };
  }
  if (b.action === "include_all_products") {
    const id = String(b.assetGroupId ?? "");
    if (!ID.test(id)) throw new GatewayError(400, "invalid_asset_group_id");
    return { action: "include_all_products", assetGroupId: id, validateOnly: b.validateOnly === true };
  }
  if (b.action === "upload_image_asset") {
    const name = typeof b.name === "string" ? b.name.trim().slice(0, 120) : "";
    const data = typeof b.dataBase64 === "string" ? b.dataBase64 : "";
    if (!name) throw new GatewayError(400, "invalid_name");
    const bytes = Buffer.from(data, "base64");
    const png = bytes.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const jpg = bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]));
    if (!(png || jpg) || bytes.length > 4 * 1024 * 1024) throw new GatewayError(400, "invalid_image");
    return { action: "upload_image_asset", name, dataBase64: data, validateOnly: b.validateOnly === true };
  }
  if (b.action === "create_pmax") {
    const cap = Number(env.GROWTH_OS_GOOGLE_MAX_DAILY_USD ?? "100");
    const usd = Number(b.dailyUsd);
    if (!Number.isFinite(usd) || usd < 1) throw new GatewayError(400, "invalid_daily_usd");
    if (usd > cap) throw new GatewayError(400, "daily_usd_above_cap", { cap });
    const finalUrl = String(b.finalUrl ?? "");
    if (!SITE.test(finalUrl)) throw new GatewayError(400, "final_url_not_mymully");
    const name = strs([b.name], "name", 1, 1, 120)[0];
    const businessName = strs([b.businessName], "business_name", 1, 1, 25)[0];
    const im = (b.images ?? {}) as Record<string, unknown>;
    const imgs = (k: string, min: number, max: number) => {
      const v = strs(im[k] ?? [], `images_${k}`, min, max, 200);
      if (v.some((x) => !ASSET_RN.test(x))) throw new GatewayError(400, `invalid_images_${k}`);
      return v;
    };
    return { action: "create_pmax", validateOnly: b.validateOnly === true, name, dailyUsd: usd,
      status: b.status === "ENABLED" ? "ENABLED" : "PAUSED", finalUrl, businessName,
      headlines: strs(b.headlines, "headlines", 3, 15, 30), longHeadlines: strs(b.longHeadlines, "long_headlines", 1, 5, 90),
      descriptions: strs(b.descriptions, "descriptions", 2, 5, 90),
      images: { marketing: imgs("marketing", 1, 20), square: imgs("square", 1, 20), portrait: imgs("portrait", 0, 20), logo: imgs("logo", 1, 5) },
      negativeKeywords: strs(b.negativeKeywords ?? [], "negative_keywords", 0, 50, 80),
      excludeUrlContains: strs(b.excludeUrlContains ?? [], "exclude_url_contains", 0, 10, 100),
      searchThemes: strs(b.searchThemes ?? [], "search_themes", 0, 25, 80),
      excludeProductTypeL1: strs(b.excludeProductTypeL1 ?? [], "exclude_product_type", 0, 5, 100),
      urlExpansion: b.urlExpansion === true };
  }
  if (b.action === "keyword_metrics") {
    if (!Array.isArray(b.keywords) || b.keywords.length < 1 || b.keywords.length > 100) throw new GatewayError(400, "invalid_keywords_count", { min: 1, max: 100 });
    const keywords = [...new Set(b.keywords.map((k) => kwText(k, "keyword")))];
    const ideasPageSize = Math.min(Math.max(Number(b.ideasPageSize ?? 50) || 50, 1), 200);
    return { action: "keyword_metrics", keywords, includeIdeas: b.includeIdeas !== false, ideasPageSize };
  }
  if (b.action === "create_search") {
    const cap = Number(env.GROWTH_OS_GOOGLE_MAX_DAILY_USD ?? "100");
    const usd = Number(b.dailyUsd);
    if (!Number.isFinite(usd) || usd < 1) throw new GatewayError(400, "invalid_daily_usd");
    if (usd > cap) throw new GatewayError(400, "daily_usd_above_cap", { cap });
    const finalUrl = String(b.finalUrl ?? "");
    if (!AC_SITE.test(finalUrl)) throw new GatewayError(400, "final_url_not_allowed");
    const name = strs([b.name], "name", 1, 1, 120)[0];
    const negIn = b.negativeKeywords ?? [];
    if (!Array.isArray(negIn) || negIn.length > 200) throw new GatewayError(400, "invalid_negative_keywords_count", { max: 200 });
    const negativeKeywords = [...new Set(negIn.map((k) => kwText(k, "negative_keyword")))];
    if (!Array.isArray(b.adGroups) || b.adGroups.length < 1 || b.adGroups.length > 10) throw new GatewayError(400, "invalid_ad_groups_count", { min: 1, max: 10 });
    const names = new Set<string>();
    const adGroups = b.adGroups.map((g0): SearchAdGroupSpec => {
      const g = (g0 ?? {}) as Record<string, unknown>;
      const agName = strs([g.name], "ad_group_name", 1, 1, 120)[0];
      if (names.has(agName)) throw new GatewayError(400, "duplicate_ad_group_name", { value: agName });
      names.add(agName);
      const cpc = Number(g.cpcBidUsd);
      if (!Number.isFinite(cpc) || cpc < 0.1 || cpc > MAX_CPC_USD) throw new GatewayError(400, "invalid_cpc_bid_usd", { min: 0.1, max: MAX_CPC_USD });
      const finalUrlSuffix = String(g.finalUrlSuffix ?? "");
      if (!SUFFIX.test(finalUrlSuffix) || finalUrlSuffix.length > 500) throw new GatewayError(400, "invalid_final_url_suffix", { value: g.finalUrlSuffix });
      if (!Array.isArray(g.keywords) || g.keywords.length < 1 || g.keywords.length > 100) throw new GatewayError(400, "invalid_keywords_count", { min: 1, max: 100 });
      const seen = new Set<string>();
      const keywords = g.keywords.map((k0) => {
        const k = (k0 ?? {}) as Record<string, unknown>;
        if (k.matchType !== "PHRASE" && k.matchType !== "EXACT") throw new GatewayError(400, "match_type_not_allowed", { value: k.matchType });
        const text = kwText(k.text, "keyword");
        const key = `${k.matchType}:${text}`;
        if (seen.has(key)) throw new GatewayError(400, "duplicate_keyword", { value: key });
        seen.add(key);
        return { text, matchType: k.matchType as MatchType };
      });
      const headlines = noDashes(strs(g.headlines, "headlines", 3, 15, 30), "headline");
      const descriptions = noDashes(strs(g.descriptions, "descriptions", 2, 4, 90), "description");
      return { name: agName, cpcBidUsd: cpc, finalUrlSuffix, keywords, headlines, descriptions };
    });
    noDashes([name, ...negativeKeywords], "text");
    return { action: "create_search", validateOnly: b.validateOnly === true, name, dailyUsd: usd,
      status: b.status === "ENABLED" ? "ENABLED" : "PAUSED", finalUrl, negativeKeywords, adGroups };
  }
  if (b.action === "ad_group_report") {
    const since = String(b.since ?? ""), until = String(b.until ?? "");
    if (!DATE.test(since) || !DATE.test(until) || since > until) throw new GatewayError(400, "invalid_date_range");
    if ((Date.parse(until) - Date.parse(since)) / 86400000 > 92) throw new GatewayError(400, "date_range_too_long", { maxDays: 93 });
    const campaignId = b.campaignId === undefined ? undefined : String(b.campaignId);
    if (campaignId !== undefined && !ID.test(campaignId)) throw new GatewayError(400, "invalid_campaign_id");
    return { action: "ad_group_report", since, until, campaignId, includeSearchTerms: b.includeSearchTerms !== false };
  }
  throw new GatewayError(400, "unsupported_action");
}

async function googleFetch(path: string, payload: unknown, token: string, devToken: string, fetcher: typeof fetch) {
  const sep = path.startsWith(":") ? "" : "/";
  const r = await fetcher(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${GATEWAY_CUSTOMER_ID}${sep}${path}`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(25000),
    headers: { Authorization: `Bearer ${token}`, "developer-token": devToken,
      "login-customer-id": GATEWAY_LOGIN_CUSTOMER_ID, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const text = await r.text();
  let json: unknown; try { json = JSON.parse(text); } catch { json = { raw: text.slice(0, 2000) }; }
  if (!r.ok) throw new GatewayError(r.status === 429 ? 429 : 502, "google_ads_error", json);
  return json as Record<string, unknown>;
}

export async function runGateway(req: GatewayRequest, env: Env, fetcher: typeof fetch = fetch) {
  const devToken = env.GOOGLE_ADS_DEVELOPER_TOKEN ?? "";
  const sa = env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64 ?? "";
  if (!devToken || !sa) throw new GatewayError(503, "google_credentials_missing");
  let token: string;
  try {
    token = await authorizeGoogleSpend({ auth: { mode: "service_account", serviceAccountJsonBase64: sa,
      subject: env.GOOGLE_ADS_IMPERSONATE_EMAIL || undefined }, developerToken: devToken,
      fetcher, signal: AbortSignal.timeout(20000) });
  } catch (e) { throw new GatewayError(502, "google_auth_failed", (e as Error).message); }

  if (req.action === "search") {
    const rows: unknown[] = []; let pageToken: string | undefined; let pages = 0; let fieldMask: unknown;
    do {
      const res = await googleFetch("googleAds:search", { query: req.query, ...(pageToken ? { pageToken } : {}) }, token, devToken, fetcher);
      rows.push(...((res.results as unknown[]) ?? [])); fieldMask = res.fieldMask;
      pageToken = typeof res.nextPageToken === "string" && res.nextPageToken ? res.nextPageToken : undefined; pages++;
    } while (pageToken && pages < (req.maxPages ?? 1));
    return { customerId: GATEWAY_CUSTOMER_ID, rows, fieldMask, truncated: Boolean(pageToken) };
  }
  if (req.action === "update_budget") {
    return googleFetch("campaignBudgets:mutate", { validateOnly: req.validateOnly ?? false, operations: [{
      updateMask: "amount_micros",
      update: { resourceName: `customers/${GATEWAY_CUSTOMER_ID}/campaignBudgets/${req.campaignBudgetId}`,
        amountMicros: String(Math.round(req.dailyUsd * 1_000_000)) } }] }, token, devToken, fetcher);
  }
  if (req.action === "attach_merchant") {
    const c = await googleFetch("googleAds:search", { query: `SELECT campaign.advertising_channel_type, campaign.shopping_setting.merchant_id FROM campaign WHERE campaign.id = ${req.campaignId}` }, token, devToken, fetcher);
    const row = ((c.results as Array<{ campaign?: { advertisingChannelType?: string; shoppingSetting?: { merchantId?: string } } }>) ?? [])[0];
    if (row?.campaign?.advertisingChannelType !== "PERFORMANCE_MAX") throw new GatewayError(400, "not_performance_max");
    const existing = row.campaign.shoppingSetting?.merchantId;
    if (existing && String(existing) !== GATEWAY_MERCHANT_ID) throw new GatewayError(409, "different_merchant_attached", { existing });
    if (existing) return { alreadyAttached: true, merchantId: GATEWAY_MERCHANT_ID };
    return googleFetch("campaigns:mutate", { validateOnly: req.validateOnly ?? false, operations: [{
      updateMask: "shopping_setting.merchant_id",
      update: { resourceName: `customers/${GATEWAY_CUSTOMER_ID}/campaigns/${req.campaignId}`,
        shoppingSetting: { merchantId: GATEWAY_MERCHANT_ID } } }] }, token, devToken, fetcher);
  }
  if (req.action === "include_all_products") {
    const ag = await googleFetch("googleAds:search", { query: `SELECT campaign.advertising_channel_type, asset_group.id FROM asset_group WHERE asset_group.id = ${req.assetGroupId}` }, token, devToken, fetcher);
    const row = ((ag.results as Array<{ campaign?: { advertisingChannelType?: string } }>) ?? [])[0];
    if (row?.campaign?.advertisingChannelType !== "PERFORMANCE_MAX") throw new GatewayError(400, "not_performance_max_asset_group");
    const lg = await googleFetch("googleAds:search", { query: `SELECT asset_group_listing_group_filter.id FROM asset_group_listing_group_filter WHERE asset_group.id = ${req.assetGroupId}` }, token, devToken, fetcher);
    if (((lg.results as unknown[]) ?? []).length) throw new GatewayError(409, "listing_groups_already_exist");
    return googleFetch("assetGroupListingGroupFilters:mutate", { validateOnly: req.validateOnly ?? false, operations: [{
      create: { assetGroup: `customers/${GATEWAY_CUSTOMER_ID}/assetGroups/${req.assetGroupId}`,
        type: "UNIT_INCLUDED", listingSource: "SHOPPING" } }] }, token, devToken, fetcher);
  }
  if (req.action === "upload_image_asset") {
    return googleFetch("assets:mutate", { validateOnly: req.validateOnly ?? false, operations: [{
      create: { name: req.name, type: "IMAGE", imageAsset: { data: req.dataBase64 } } }] }, token, devToken, fetcher);
  }
  if (req.action === "create_pmax") {
    return googleFetch("googleAds:mutate", { validateOnly: req.validateOnly ?? false, mutateOperations: buildPmaxOperations(req) }, token, devToken, fetcher);
  }
  if (req.action === "create_search") {
    return googleFetch("googleAds:mutate", { validateOnly: req.validateOnly ?? false, mutateOperations: buildSearchOperations(req) }, token, devToken, fetcher);
  }
  if (req.action === "keyword_metrics") {
    const base = { geoTargetConstants: ["geoTargetConstants/2840"], language: "languageConstants/1000",
      keywordPlanNetwork: "GOOGLE_SEARCH", includeAdultKeywords: false };
    const hist = await googleFetch(":generateKeywordHistoricalMetrics", { ...base, keywords: req.keywords }, token, devToken, fetcher);
    const historical = ((hist.results as Array<Record<string, unknown>>) ?? []).map((r) => ({
      keyword: r.text, closeVariants: r.closeVariants ?? [], ...kwMetrics(r.keywordMetrics) }));
    const returned = new Set(historical.flatMap((h) => [String(h.keyword), ...((h.closeVariants as string[]) ?? [])]));
    const noData = req.keywords.filter((k) => !returned.has(k));
    let ideas: unknown[] = [];
    if (req.includeIdeas) {
      const res = await googleFetch(":generateKeywordIdeas", { ...base, keywordSeed: { keywords: req.keywords.slice(0, 20) }, pageSize: req.ideasPageSize }, token, devToken, fetcher);
      ideas = ((res.results as Array<Record<string, unknown>>) ?? []).map((r) => ({ keyword: r.text, ...kwMetrics(r.keywordIdeaMetrics) }));
    }
    return { geo: "US", language: "English", network: "GOOGLE_SEARCH", historical, noData, ideas };
  }
  if (req.action === "ad_group_report") {
    const where = `segments.date BETWEEN '${req.since}' AND '${req.until}'${req.campaignId ? ` AND campaign.id = ${req.campaignId}` : ""}`;
    const m = "metrics.cost_micros, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.conversions";
    const all = async (query: string) => {
      const rows: Array<Record<string, Record<string, unknown>>> = []; let pageToken: string | undefined; let pages = 0;
      do {
        const res = await googleFetch("googleAds:search", { query, ...(pageToken ? { pageToken } : {}) }, token, devToken, fetcher);
        rows.push(...((res.results as Array<Record<string, Record<string, unknown>>>) ?? []));
        pageToken = typeof res.nextPageToken === "string" && res.nextPageToken ? res.nextPageToken : undefined; pages++;
      } while (pageToken && pages < 5);
      return rows;
    };
    const met = (r: Record<string, Record<string, unknown>>) => {
      const x = r.metrics ?? {};
      return { spendUsd: Number(x.costMicros ?? 0) / 1e6, impressions: Number(x.impressions ?? 0), clicks: Number(x.clicks ?? 0),
        ctr: Number(x.ctr ?? 0), avgCpcUsd: Number(x.averageCpc ?? 0) / 1e6, conversions: Number(x.conversions ?? 0) };
    };
    const camp = (r: Record<string, Record<string, unknown>>) => ({ campaignId: r.campaign?.id, campaignName: r.campaign?.name });
    const campaigns = (await all(`SELECT campaign.id, campaign.name, campaign.status, campaign.advertising_channel_type, ${m} FROM campaign WHERE ${where}`))
      .map((r) => ({ ...camp(r), status: r.campaign?.status, channel: r.campaign?.advertisingChannelType, ...met(r) }));
    const adGroups = (await all(`SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group.status, ad_group.cpc_bid_micros, ${m} FROM ad_group WHERE ${where}`))
      .map((r) => ({ ...camp(r), adGroupId: r.adGroup?.id, adGroupName: r.adGroup?.name, status: r.adGroup?.status,
        cpcBidUsd: Number(r.adGroup?.cpcBidMicros ?? 0) / 1e6, ...met(r) }));
    const keywords = (await all(`SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.criterion_id, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, ad_group_criterion.approval_status, ${m} FROM keyword_view WHERE ${where}`))
      .map((r) => { const c = (r.adGroupCriterion ?? {}) as Record<string, unknown>; const k = (c.keyword ?? {}) as Record<string, unknown>;
        return { ...camp(r), adGroupId: r.adGroup?.id, adGroupName: r.adGroup?.name, criterionId: c.criterionId, keyword: k.text,
          matchType: k.matchType, status: c.status, approvalStatus: c.approvalStatus, ...met(r) }; });
    const searchTerms = req.includeSearchTerms
      ? (await all(`SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, search_term_view.search_term, search_term_view.status, segments.keyword.info.text, segments.keyword.info.match_type, ${m} FROM search_term_view WHERE ${where}`))
        .map((r) => { const st = r.searchTermView ?? {}; const kw = ((r.segments?.keyword as Record<string, unknown>)?.info ?? {}) as Record<string, unknown>;
          return { ...camp(r), adGroupId: r.adGroup?.id, adGroupName: r.adGroup?.name, searchTerm: st.searchTerm, status: st.status,
            keyword: kw.text, matchType: kw.matchType, ...met(r) }; })
      : undefined;
    return { since: req.since, until: req.until, campaignId: req.campaignId ?? null, campaigns, adGroups, keywords, searchTerms };
  }
  return googleFetch("campaigns:mutate", { validateOnly: req.validateOnly ?? false, operations: [{
    updateMask: "status",
    update: { resourceName: `customers/${GATEWAY_CUSTOMER_ID}/campaigns/${req.campaignId}`, status: req.status } }] },
    token, devToken, fetcher);
}

/** One atomic googleAds:mutate request for a complete Performance Max shop campaign. */
export function buildPmaxOperations(spec: PmaxSpec) {
  const C = `customers/${GATEWAY_CUSTOMER_ID}`;
  const budget = `${C}/campaignBudgets/-1`, campaign = `${C}/campaigns/-2`, ag = `${C}/assetGroups/-3`;
  const ops: Array<Record<string, unknown>> = [];
  ops.push({ campaignBudgetOperation: { create: { resourceName: budget, name: `${spec.name} budget`,
    amountMicros: String(Math.round(spec.dailyUsd * 1_000_000)), deliveryMethod: "STANDARD", explicitlyShared: false } } });
  ops.push({ campaignOperation: { create: { resourceName: campaign, name: spec.name, status: spec.status,
    advertisingChannelType: "PERFORMANCE_MAX", campaignBudget: budget, maximizeConversionValue: {},
    shoppingSetting: { merchantId: GATEWAY_MERCHANT_ID }, brandGuidelinesEnabled: false,
    containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING",
    assetAutomationSettings: [{ assetAutomationType: "FINAL_URL_EXPANSION_TEXT_ASSET_AUTOMATION",
      assetAutomationStatus: spec.urlExpansion ? "OPTED_IN" : "OPTED_OUT" }] } } });
  const crit = (c: Record<string, unknown>) => ops.push({ campaignCriterionOperation: { create: { campaign, ...c } } });
  crit({ location: { geoTargetConstant: "geoTargetConstants/2840" } });
  crit({ language: { languageConstant: "languageConstants/1000" } });
  for (const k of spec.negativeKeywords) crit({ negative: true, keyword: { text: k, matchType: "PHRASE" } });
  spec.excludeUrlContains.forEach((u, i) => crit({ negative: true, webpage: { criterionName: `Exclude ${i + 1}`,
    conditions: [{ operand: "URL", operator: "CONTAINS", argument: u }] } }));
  let id = -10; const text = (t: string) => { const rn = `${C}/assets/${id--}`; ops.push({ assetOperation: { create: { resourceName: rn, textAsset: { text: t } } } }); return rn; };
  const links: Array<[string, string]> = [];
  spec.headlines.forEach((t) => links.push([text(t), "HEADLINE"]));
  spec.longHeadlines.forEach((t) => links.push([text(t), "LONG_HEADLINE"]));
  spec.descriptions.forEach((t) => links.push([text(t), "DESCRIPTION"]));
  links.push([text(spec.businessName), "BUSINESS_NAME"]);
  spec.images.marketing.forEach((r) => links.push([r, "MARKETING_IMAGE"]));
  spec.images.square.forEach((r) => links.push([r, "SQUARE_MARKETING_IMAGE"]));
  spec.images.portrait.forEach((r) => links.push([r, "PORTRAIT_MARKETING_IMAGE"]));
  spec.images.logo.forEach((r) => links.push([r, "LOGO"]));
  ops.push({ assetGroupOperation: { create: { resourceName: ag, campaign, name: `${spec.name} | Shop`, finalUrls: [spec.finalUrl], status: "ENABLED" } } });
  for (const [asset, fieldType] of links) ops.push({ assetGroupAssetOperation: { create: { assetGroup: ag, asset, fieldType } } });
  const lg = (n: number) => `${C}/assetGroupListingGroupFilters/-3~${n}`;
  if (spec.excludeProductTypeL1.length) {
    ops.push({ assetGroupListingGroupFilterOperation: { create: { resourceName: lg(-100), assetGroup: ag, type: "SUBDIVISION", listingSource: "SHOPPING" } } });
    let n = -101;
    for (const v of spec.excludeProductTypeL1) ops.push({ assetGroupListingGroupFilterOperation: { create: { resourceName: lg(n--), assetGroup: ag,
      type: "UNIT_EXCLUDED", listingSource: "SHOPPING", parentListingGroupFilter: lg(-100), caseValue: { productType: { level: "LEVEL1", value: v } } } } });
    ops.push({ assetGroupListingGroupFilterOperation: { create: { resourceName: lg(n--), assetGroup: ag,
      type: "UNIT_INCLUDED", listingSource: "SHOPPING", parentListingGroupFilter: lg(-100), caseValue: { productType: { level: "LEVEL1" } } } } });
  } else {
    ops.push({ assetGroupListingGroupFilterOperation: { create: { resourceName: lg(-100), assetGroup: ag, type: "UNIT_INCLUDED", listingSource: "SHOPPING" } } });
  }
  for (const t of spec.searchThemes) ops.push({ assetGroupSignalOperation: { create: { assetGroup: ag, searchTheme: { text: t } } } });
  return ops;
}

function kwMetrics(v: unknown) {
  const m = (v ?? {}) as Record<string, unknown>;
  const usd = (x: unknown) => (x === undefined || x === null ? null : Number(x) / 1e6);
  return { avgMonthlySearches: m.avgMonthlySearches === undefined ? null : Number(m.avgMonthlySearches),
    competition: m.competition ?? null, competitionIndex: m.competitionIndex === undefined ? null : Number(m.competitionIndex),
    lowTopOfPageBidUsd: usd(m.lowTopOfPageBidMicros), highTopOfPageBidUsd: usd(m.highTopOfPageBidMicros) };
}

/** One atomic googleAds:mutate request for a Google Search-only manual CPC campaign. */
export function buildSearchOperations(spec: SearchSpec) {
  const C = `customers/${GATEWAY_CUSTOMER_ID}`;
  const budget = `${C}/campaignBudgets/-1`, campaign = `${C}/campaigns/-2`;
  const ops: Array<Record<string, unknown>> = [];
  ops.push({ campaignBudgetOperation: { create: { resourceName: budget, name: `${spec.name} budget`,
    amountMicros: String(Math.round(spec.dailyUsd * 1_000_000)), deliveryMethod: "STANDARD", explicitlyShared: false } } });
  ops.push({ campaignOperation: { create: { resourceName: campaign, name: spec.name, status: spec.status,
    advertisingChannelType: "SEARCH", campaignBudget: budget, manualCpc: { enhancedCpcEnabled: false },
    networkSettings: { targetGoogleSearch: true, targetSearchNetwork: false, targetContentNetwork: false, targetPartnerSearchNetwork: false },
    geoTargetTypeSetting: { positiveGeoTargetType: "PRESENCE", negativeGeoTargetType: "PRESENCE" },
    aiMaxSetting: { enableAiMax: false },
    containsEuPoliticalAdvertising: "DOES_NOT_CONTAIN_EU_POLITICAL_ADVERTISING" } } });
  const crit = (c: Record<string, unknown>) => ops.push({ campaignCriterionOperation: { create: { campaign, ...c } } });
  crit({ location: { geoTargetConstant: "geoTargetConstants/2840" } });
  crit({ language: { languageConstant: "languageConstants/1000" } });
  for (const k of spec.negativeKeywords) crit({ negative: true, keyword: { text: k, matchType: "PHRASE" } });
  spec.adGroups.forEach((g, i) => {
    const ag = `${C}/adGroups/${-10 - i}`;
    ops.push({ adGroupOperation: { create: { resourceName: ag, campaign, name: g.name, status: "ENABLED", type: "SEARCH_STANDARD",
      cpcBidMicros: String(Math.round(g.cpcBidUsd * 1_000_000)), finalUrlSuffix: g.finalUrlSuffix } } });
    for (const k of g.keywords) ops.push({ adGroupCriterionOperation: { create: { adGroup: ag, status: "ENABLED",
      keyword: { text: k.text, matchType: k.matchType } } } });
    ops.push({ adGroupAdOperation: { create: { adGroup: ag, status: "ENABLED", ad: { finalUrls: [spec.finalUrl],
      responsiveSearchAd: { headlines: g.headlines.map((text) => ({ text })), descriptions: g.descriptions.map((text) => ({ text })) } } } } });
  });
  return ops;
}
