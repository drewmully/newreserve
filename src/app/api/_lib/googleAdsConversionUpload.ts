/**
 * Server-side Google Ads purchase upload (ConversionUploadService.uploadClickConversions).
 *
 * Why this exists: the legacy `googleadservices.com/pagead/conversion` ping
 * that `fireGoogleAds` sends cannot carry iOS `wbraid` / `gbraid` clicks and
 * is unreliable for server-originated requests. The Ads API upload is the
 * durable path, but it only accepts conversion actions of type UPLOAD_CLICKS
 * ("Import > Track conversions from clicks"), not the WEBPAGE action the
 * site tag uses. So this module targets a dedicated import action:
 *
 *   1. GOOGLE_ADS_PURCHASE_UPLOAD_ACTION_ID (numeric id) when set, else
 *   2. the ENABLED UPLOAD_CLICKS action named
 *      GOOGLE_ADS_PURCHASE_UPLOAD_ACTION_NAME (default "Mully Purchase (server upload)").
 *
 * If neither resolves, or the upload fails, callers fall back to the legacy
 * pixel so tracking never regresses below today's behavior.
 */

import { mintGoogleAccessToken } from "@/app/api/_lib/googleAuth";

export const GOOGLE_ADS_UPLOAD_API_VERSION = "v25";
export const DEFAULT_PURCHASE_UPLOAD_ACTION_NAME = "Mully Purchase (server upload)";

export interface PurchaseUploadInput {
  gclid?: string;
  gbraid?: string;
  wbraid?: string;
  value?: number;
  currency?: string;
  orderId?: string;
  /** Unix seconds. Defaults to now. */
  timestamp?: number;
}

export type UploadResult =
  | { ok: true; conversionAction: string }
  | { ok: false; reason: string };

function nonEmpty(v: unknown): string | undefined {
  return typeof v === "string" && v.trim().length > 0 ? v.trim() : undefined;
}

/** Google Ads requires "yyyy-mm-dd hh:mm:ss+|-hh:mm". We always send UTC. */
export function formatConversionDateTime(unixSeconds: number): string {
  const d = new Date(unixSeconds * 1000);
  const p = (n: number) => String(n).padStart(2, "0");
  return (
    `${d.getUTCFullYear()}-${p(d.getUTCMonth() + 1)}-${p(d.getUTCDate())} ` +
    `${p(d.getUTCHours())}:${p(d.getUTCMinutes())}:${p(d.getUTCSeconds())}+00:00`
  );
}

/**
 * Build one ClickConversion, or null when there is no click id to attribute.
 * The API rejects a conversion that sets more than one of gclid / gbraid /
 * wbraid, so exactly one is sent, in that priority order.
 */
export function buildClickConversion(
  input: PurchaseUploadInput,
  conversionAction: string,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Record<string, unknown> | null {
  const gclid = nonEmpty(input.gclid);
  const gbraid = nonEmpty(input.gbraid);
  const wbraid = nonEmpty(input.wbraid);
  if (!gclid && !gbraid && !wbraid) return null;

  const value = Number(input.value);
  const conversion: Record<string, unknown> = {
    conversionAction,
    conversionDateTime: formatConversionDateTime(input.timestamp ?? nowSeconds),
    conversionValue: Number.isFinite(value) && value > 0 ? value : 0,
    currencyCode: nonEmpty(input.currency) ?? "USD",
  };
  if (gclid) conversion.gclid = gclid;
  else if (gbraid) conversion.gbraid = gbraid;
  else conversion.wbraid = wbraid;

  const orderId = nonEmpty(input.orderId);
  if (orderId) conversion.orderId = orderId;
  return conversion;
}

interface AdsEnv {
  customerId: string;
  loginCustomerId?: string;
  developerToken: string;
}

function readAdsEnv(): AdsEnv | null {
  const customerId = nonEmpty(process.env.GOOGLE_ADS_CUSTOMER_ID)?.replace(/-/g, "");
  const developerToken = nonEmpty(process.env.GOOGLE_ADS_DEVELOPER_TOKEN);
  if (!customerId || !developerToken) return null;
  return {
    customerId,
    developerToken,
    loginCustomerId: nonEmpty(process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID)?.replace(/-/g, ""),
  };
}

/** Service account first (same as the reporting routes), OAuth refresh token second. */
async function mintToken(): Promise<string | null> {
  if (
    process.env.GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64 ||
    process.env.GOOGLE_SERVICE_ACCOUNT_JSON_BASE64
  ) {
    try {
      const t = await mintGoogleAccessToken({
        scope: "https://www.googleapis.com/auth/adwords",
        sub: process.env.GOOGLE_ADS_IMPERSONATE_EMAIL,
      });
      if (t) return t;
    } catch {
      /* fall through to refresh token */
    }
  }
  const refresh = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_ADS_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET;
  if (!refresh || !clientId || !clientSecret) return null;
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refresh,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) return null;
  const j = (await r.json()) as { access_token?: string };
  return j.access_token ?? null;
}

function headers(env: AdsEnv, token: string): Record<string, string> {
  const h: Record<string, string> = {
    Authorization: `Bearer ${token}`,
    "developer-token": env.developerToken,
    "Content-Type": "application/json",
  };
  if (env.loginCustomerId) h["login-customer-id"] = env.loginCustomerId;
  return h;
}

// Per-process cache. Negative results expire so a newly created action is
// picked up without a redeploy.
let cachedAction: { value: string | null; expiresAt: number } | null = null;
const POSITIVE_TTL_MS = 6 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 10 * 60 * 1000;

export function __resetUploadActionCacheForTests(): void {
  cachedAction = null;
}

async function resolveConversionAction(env: AdsEnv, token: string): Promise<string | null> {
  const explicit = nonEmpty(process.env.GOOGLE_ADS_PURCHASE_UPLOAD_ACTION_ID);
  if (explicit && /^\d+$/.test(explicit)) {
    return `customers/${env.customerId}/conversionActions/${explicit}`;
  }
  if (cachedAction && cachedAction.expiresAt > Date.now()) return cachedAction.value;

  const name =
    nonEmpty(process.env.GOOGLE_ADS_PURCHASE_UPLOAD_ACTION_NAME) ??
    DEFAULT_PURCHASE_UPLOAD_ACTION_NAME;
  const query =
    "SELECT conversion_action.resource_name FROM conversion_action " +
    "WHERE conversion_action.type = 'UPLOAD_CLICKS' " +
    "AND conversion_action.status = 'ENABLED' " +
    `AND conversion_action.name = '${name.replace(/'/g, "\\'")}' LIMIT 1`;

  const res = await fetch(
    `https://googleads.googleapis.com/${GOOGLE_ADS_UPLOAD_API_VERSION}/customers/${env.customerId}/googleAds:search`,
    { method: "POST", headers: headers(env, token), body: JSON.stringify({ query }) }
  );
  if (!res.ok) {
    // Don't cache transport errors; next order retries the lookup.
    throw new Error(`conversion_action lookup ${res.status}: ${(await res.text()).slice(0, 300)}`);
  }
  const body = (await res.json()) as {
    results?: Array<{ conversionAction?: { resourceName?: string } }>;
  };
  const value = body.results?.[0]?.conversionAction?.resourceName ?? null;
  cachedAction = {
    value,
    expiresAt: Date.now() + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  };
  return value;
}

/**
 * Upload one purchase. Never throws; the caller decides whether to fall
 * back to the legacy pixel based on `ok`.
 */
export async function uploadPurchaseConversion(
  input: PurchaseUploadInput
): Promise<UploadResult> {
  try {
    if (!nonEmpty(input.gclid) && !nonEmpty(input.gbraid) && !nonEmpty(input.wbraid)) {
      return { ok: false, reason: "no_click_id" };
    }
    const env = readAdsEnv();
    if (!env) return { ok: false, reason: "missing_env" };
    const token = await mintToken();
    if (!token) return { ok: false, reason: "no_token" };

    const conversionAction = await resolveConversionAction(env, token);
    if (!conversionAction) return { ok: false, reason: "no_upload_action" };

    const conversion = buildClickConversion(input, conversionAction);
    if (!conversion) return { ok: false, reason: "no_click_id" };

    const res = await fetch(
      `https://googleads.googleapis.com/${GOOGLE_ADS_UPLOAD_API_VERSION}/customers/${env.customerId}:uploadClickConversions`,
      {
        method: "POST",
        headers: headers(env, token),
        body: JSON.stringify({ conversions: [conversion], partialFailure: true }),
      }
    );
    if (!res.ok) {
      return { ok: false, reason: `http_${res.status}: ${(await res.text()).slice(0, 300)}` };
    }
    const body = (await res.json()) as { partialFailureError?: { message?: string } };
    if (body.partialFailureError) {
      return {
        ok: false,
        reason: `partial_failure: ${(body.partialFailureError.message ?? "").slice(0, 300)}`,
      };
    }
    return { ok: true, conversionAction };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : String(err) };
  }
}
