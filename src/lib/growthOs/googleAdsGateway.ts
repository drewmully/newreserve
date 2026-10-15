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
 * - writes: campaign budget amount, campaign status (ENABLED/PAUSED) only
 * - budget ceiling: GROWTH_OS_GOOGLE_MAX_DAILY_USD (default 100)
 */
import { timingSafeEqual } from "node:crypto";
import { authorizeGoogleSpend } from "@/lib/analytics/googleSpendSource";

export const GOOGLE_ADS_API_VERSION = "v25";
export const GATEWAY_CUSTOMER_ID = "4335795219";
export const GATEWAY_LOGIN_CUSTOMER_ID = "9552995078";

type Env = Record<string, string | undefined>;
export type GatewayRequest =
  | { action: "search"; query: string; maxPages?: number }
  | { action: "update_budget"; campaignBudgetId: string; dailyUsd: number; validateOnly?: boolean }
  | { action: "set_campaign_status"; campaignId: string; status: "ENABLED" | "PAUSED"; validateOnly?: boolean };

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
  return googleFetch("campaigns:mutate", { validateOnly: req.validateOnly ?? false, operations: [{
    updateMask: "status",
    update: { resourceName: `customers/${GATEWAY_CUSTOMER_ID}/campaigns/${req.campaignId}`, status: req.status } }] },
    token, devToken, fetcher);
}
