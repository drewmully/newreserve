// Synthetic read-only provider responses. No credentials or network access.
import { generateKeyPairSync } from "node:crypto";
const key = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey.export({ format: "pem", type: "pkcs8" });
export const marketingEnv = {
  VERCEL_ENV: "production", VERCEL_GIT_COMMIT_REF: "main", CRON_SECRET: "synthetic-cron",
  META_AD_ACCOUNT_ID: "2796962933960445", META_MARKETING_API_TOKEN: "synthetic-meta-token",
  GOOGLE_ADS_SERVICE_ACCOUNT_JSON_BASE64: Buffer.from(JSON.stringify({
    type: "service_account", client_email: "fixture@fixture.invalid", private_key: key,
  })).toString("base64"),
  GOOGLE_ADS_IMPERSONATE_EMAIL: "fixture@fixture.invalid", GOOGLE_ADS_DEVELOPER_TOKEN: "synthetic-developer-token",
};
export function nativeMarketing(options = {}) {
  const calls = [];
  const request = async (input, init) => {
    const url = new URL(String(input)); calls.push({ url: url.href, init });
    if (options.fail) return new Response("private provider error synthetic-meta-token", {
      status: options.fail, headers: { "Retry-After": options.retryAfter ?? "2400" },
    });
    if (url.hostname === "oauth2.googleapis.com")
      return Response.json({ token_type: "Bearer", access_token: "synthetic-access-token" });
    if (url.hostname === "graph.facebook.com") {
      const level = url.searchParams.get("level");
      if (!level) return Response.json({ id: "act_2796962933960445", account_id: "2796962933960445",
        currency: "USD", timezone_name: "America/Los_Angeles", account_status: 1 });
      const date = JSON.parse(url.searchParams.get("time_range")).until;
      return Response.json({ data: options.empty ? [] : [{ account_id: "2796962933960445", account_currency: "USD",
        date_start: date, date_stop: date, spend: "3.04",
        hourly_stats_aggregated_by_advertiser_time_zone: "12:00:00 - 12:59:59",
        ...(level === "campaign" ? { campaign_id: "123" } : {}),
      }] });
    }
    if (url.hostname !== "googleads.googleapis.com") throw new Error("unexpected fixture destination");
    const query = JSON.parse(String(init.body)).query;
    if (query.includes("customer.currency_code")) return Response.json({
      fieldMask: "customer.id,customer.currencyCode,customer.timeZone",
      results: [{ customer: { id: "4335795219", currencyCode: "USD", timeZone: "America/New_York" } }],
    });
    const date = /'(\d{4}-\d\d-\d\d)'/.exec(query)[1], campaign = query.includes("FROM campaign");
    return Response.json({
      fieldMask: (campaign ? "campaign.id," : "") + "segments.date,metrics.costMicros,metrics.clicks,metrics.impressions",
      results: options.empty ? [] : [{ ...(campaign ? { campaign: { id: "123" } } : {}),
        segments: { date }, metrics: { costMicros: "2425689", clicks: "10", impressions: "39" } }],
    });
  };
  return { request, calls };
}
