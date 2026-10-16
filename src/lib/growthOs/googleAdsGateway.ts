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
  | ({ action: "create_pmax"; validateOnly?: boolean } & PmaxSpec);

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
  throw new GatewayError(400, "unsupported_action");
}

async function googleFetch(path: string, payload: unknown, token: string, devToken: string, fetcher: typeof fetch) {
  const r = await fetcher(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${GATEWAY_CUSTOMER_ID}/${path}`, {
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
