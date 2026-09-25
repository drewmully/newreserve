import { nyDate } from "./primitives";
import { reportDates } from "./commerceCandidate";
import { sourceObject, sourceString } from "./shopifySource";
import { googleSpendBase, normalizeSpendBase, type GoogleCampaignRow, type SpendBase } from "./spend";
import { createGoogleServiceAccountAssertion } from "../../app/api/_lib/googleAuth";

export const GOOGLE_ADS_VERSION = "v25";
export const GOOGLE_ACCOUNT_QUERY = "SELECT customer.id, customer.currency_code, customer.time_zone FROM customer";
const fields = ["campaign.id", "segments.date", "metrics.costMicros", "metrics.clicks", "metrics.impressions"];
export type GoogleSpendScope = {
  accountId: string; loginCustomerId: string | null; date: string; maxPages: number; approvalRef: string;
};
type Transport = { fetcher?: typeof fetch; signal: AbortSignal };
export type GoogleSpendAuth =
  | { mode: "oauth_refresh"; clientId: string; clientSecret: string; refreshToken: string }
  | { mode: "service_account"; serviceAccountJsonBase64: string; subject?: string };

/** Dedicated analytics variables only. Unset mode preserves the OAuth path. */
export function googleSpendAuthFromEnv(env: Record<string, string | undefined>): GoogleSpendAuth {
  const mode = env.LEAN_GOOGLE_ADS_AUTH_MODE ?? "oauth_refresh";
  if (mode === "oauth_refresh") return { mode, clientId: env.LEAN_GOOGLE_ADS_OAUTH_CLIENT_ID ?? "",
    clientSecret: env.LEAN_GOOGLE_ADS_OAUTH_CLIENT_SECRET ?? "", refreshToken: env.LEAN_GOOGLE_ADS_REFRESH_TOKEN ?? "" };
  if (mode !== "service_account") throw new Error("google_spend_invalid_auth_mode");
  return { mode, serviceAccountJsonBase64: env.LEAN_GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64 ?? "",
    subject: env.LEAN_GOOGLE_ADS_IMPERSONATE_EMAIL };
}
async function postJson(url: string, init: RequestInit, transport: Transport): Promise<Record<string, unknown>> {
  let response: Response;
  try {
    transport.signal.throwIfAborted();
    response = await (transport.fetcher ?? fetch)(url, { ...init, redirect: "error",
      signal: AbortSignal.any([transport.signal, AbortSignal.timeout(20000)]) });
    transport.signal.throwIfAborted();
  } catch { throw new Error("google_spend_transport_failed"); }
  if (!response.ok) throw new Error("google_spend_auth_or_http_failed");
  let body: Record<string, unknown>;
  try { body = sourceObject(await response.json()); } catch { throw new Error("google_spend_invalid_response"); }
  if (transport.signal.aborted) throw new Error("google_spend_transport_failed");
  if (body.error !== undefined) throw new Error("google_spend_source_error");
  return body;
}
export async function refreshGoogleSpendToken(input: Transport & { clientId: string; clientSecret: string; refreshToken: string }) {
  if (![input.clientId, input.clientSecret, input.refreshToken].every(s => s.trim())) throw new Error("google_spend_missing_auth");
  const body = await postJson("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: input.clientId, client_secret: input.clientSecret,
      refresh_token: input.refreshToken, grant_type: "refresh_token" }),
  }, input);
  if (typeof body.access_token !== "string" || !body.access_token || body.token_type !== "Bearer")
    throw new Error("google_spend_invalid_token_response");
  return body.access_token;
}
export async function authorizeGoogleSpend(input: Transport & { auth: GoogleSpendAuth; developerToken?: string }) {
  if (input.auth.mode === "oauth_refresh") return refreshGoogleSpendToken({ ...input, ...input.auth });
  if (input.auth.mode !== "service_account" || !input.developerToken?.trim() ||
      !input.auth.serviceAccountJsonBase64.trim() || input.auth.serviceAccountJsonBase64.length > 32768 ||
      input.auth.subject !== undefined && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.auth.subject))
    throw new Error("google_spend_invalid_service_account");
  let assertion: string;
  try {
    assertion = await createGoogleServiceAccountAssertion({
      serviceAccountJsonBase64: input.auth.serviceAccountJsonBase64,
      scope: "https://www.googleapis.com/auth/adwords", sub: input.auth.subject,
    });
  } catch { throw new Error("google_spend_invalid_service_account"); }
  const body = await postJson("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  }, input);
  if (typeof body.access_token !== "string" || !body.access_token || body.token_type !== "Bearer")
    throw new Error("google_spend_invalid_token_response");
  return body.access_token;
}
/** Only fixed read-only GAQL. Source account currency/timezone is read, not supplied.
 * No ad_spend_daily event mirror and no customer operational table writes.
 */
export async function readGoogleSpend(input: GoogleSpendScope & Transport & {
  accessToken: string; developerToken?: string; now: string; evidenceRef: string; baseReportId: string;
}): Promise<SpendBase> {
  reportDates(input.date, input.date); nyDate(input.now);
  if (!/^\d{10}$/.test(input.accountId) ||
      input.loginCustomerId !== null && !/^\d{10}$/.test(input.loginCustomerId) ||
      !input.approvalRef.trim() || !input.evidenceRef.trim() || !input.baseReportId.trim() ||
      !input.accessToken.trim() || !Number.isSafeInteger(input.maxPages) ||
      input.maxPages < 1 || input.maxPages > 10 || input.date >= nyDate(input.now))
    throw new Error("google_spend_invalid_scope");
  const request = (query: string, pageToken?: string) => postJson(
    `https://googleads.googleapis.com/${GOOGLE_ADS_VERSION}/customers/${input.accountId}/googleAds:search`, {
      method: "POST", headers: { Authorization: `Bearer ${input.accessToken}`, "Content-Type": "application/json",
        ...(input.developerToken ? { "developer-token": input.developerToken } : {}),
        ...(input.loginCustomerId ? { "login-customer-id": input.loginCustomerId } : {}) },
      body: JSON.stringify({ query, ...(pageToken ? { pageToken } : {}) }),
    }, input);
  const metadata = await request(GOOGLE_ACCOUNT_QUERY);
  if (!Array.isArray(metadata.results) || metadata.results.length !== 1 || metadata.nextPageToken)
    throw new Error("google_spend_invalid_account");
  const account = sourceObject(sourceObject(metadata.results[0]).customer);
  if (account.id !== input.accountId || typeof account.currencyCode !== "string" ||
      !/^[A-Z]{3}$/.test(account.currencyCode) || typeof account.timeZone !== "string" || !account.timeZone)
    throw new Error("google_spend_invalid_account");
  // A local-day source is eligible for NY reports only when its account timezone
  // matches. Other currencies/timezones are retained, with USD metrics withheld.
  try { new Intl.DateTimeFormat("en", { timeZone: account.timeZone }); }
  catch { throw new Error("google_spend_invalid_account"); }
  const accountDate = new Intl.DateTimeFormat("en-CA", { timeZone: account.timeZone,
    year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(input.now));
  if (input.date >= accountDate) throw new Error("google_spend_open_account_day");
  const query = `SELECT campaign.id, segments.date, metrics.cost_micros, metrics.clicks, metrics.impressions FROM campaign WHERE segments.date = '${input.date}' ORDER BY campaign.id`;
  const rows: GoogleCampaignRow[] = [], seenTokens = new Set<string>();
  let token: string | undefined;
  for (let page = 0; page < input.maxPages; page++) {
    const body = await request(query, token);
    // Protobuf JSON may omit repeated results for an empty response. Require the
    // exact expected field mask rather than interpreting {} or errors as zero.
    if (typeof body.fieldMask !== "string" ||
        [...body.fieldMask.split(",")].sort().join(",") !== [...fields].sort().join(","))
      throw new Error("google_spend_schema_drift");
    if (body.results !== undefined && !Array.isArray(body.results)) throw new Error("google_spend_schema_drift");
    const values = (body.results ?? []) as unknown[];
    if (values.length > 10000) throw new Error("google_spend_page_overflow");
    for (const value of values) {
      const row = sourceObject(value), campaign = sourceObject(row.campaign),
        segments = sourceObject(row.segments), metrics = sourceObject(row.metrics);
      const id = sourceString(campaign.id);
      if (!/^[1-9]\d*$/.test(id)) throw new Error("google_spend_invalid_campaign");
      rows.push({ campaign: { id }, segments: { date: sourceString(segments.date) },
        metrics: { costMicros: sourceString(metrics.costMicros),
          clicks: metrics.clicks === undefined ? undefined : sourceString(metrics.clicks),
          impressions: metrics.impressions === undefined ? undefined : sourceString(metrics.impressions) } });
    }
    if (body.nextPageToken !== undefined && typeof body.nextPageToken !== "string") throw new Error("google_spend_schema_drift");
    const next = body.nextPageToken as string | undefined;
    if (!next) {
      const base = googleSpendBase(rows, { provider: "google_ads", accountId: input.accountId,
        date: input.date, baseReportId: input.baseReportId, sourceTimezone: account.timeZone,
        sourceCurrency: account.currencyCode, completedAt: input.now, paginationComplete: true,
        verifiedEmpty: rows.length === 0, evidenceRef: input.evidenceRef });
      normalizeSpendBase(base, "validation-only"); // includes duplicate keys, integer/money bounds
      return base;
    }
    if (!values.length || next.length > 8192 || seenTokens.has(next)) throw new Error("google_spend_invalid_cursor");
    seenTokens.add(next); token = next;
  }
  throw new Error("google_spend_incomplete_pagination");
}
