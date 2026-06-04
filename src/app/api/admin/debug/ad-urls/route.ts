// Temporary admin probe — inspect final_urls / tracking_url_template for
// every ad in the MR | Prospecting | Search | Gift-Intent campaign. Delete
// after diagnosing the AG5 → 0 LP views issue.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function mintAdsToken(): Promise<string | null> {
  const refresh = process.env.GOOGLE_ADS_REFRESH_TOKEN;
  const clientId = process.env.GOOGLE_ADS_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_ADS_OAUTH_CLIENT_SECRET;
  if (refresh && clientId && clientSecret) {
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
    if (r.ok) {
      const j = (await r.json()) as { access_token?: string };
      if (j.access_token) return j.access_token;
    }
  }
  return null;
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (req.headers.get("authorization") !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const token = await mintAdsToken();
  if (!token) return NextResponse.json({ error: "no token" }, { status: 500 });

  const customerId = process.env.GOOGLE_ADS_CUSTOMER_ID;
  const loginCustomerId = process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID;
  const developerToken = process.env.GOOGLE_ADS_DEVELOPER_TOKEN;

  const query = `
    SELECT
      ad_group.id, ad_group.name,
      ad_group_ad.ad.id, ad_group_ad.ad.type,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.tracking_url_template,
      ad_group_ad.status
    FROM ad_group_ad
    WHERE campaign.id = 23901702384
      AND ad_group_ad.status != 'REMOVED'
  `;

  const res = await fetch(
    `https://googleads.googleapis.com/v21/customers/${customerId}/googleAds:search`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "developer-token": developerToken!,
        "login-customer-id": loginCustomerId!,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: query.replace(/\s+/g, " ").trim() }),
    }
  );
  const j = await res.json();
  return NextResponse.json(j);
}
