// Temporary admin probe — inspect final_urls / tracking_url_template for
// every ad in the MR | Prospecting | Search | Gift-Intent campaign. Delete
// after diagnosing the AG5 → 0 LP views issue.
import { NextRequest, NextResponse } from "next/server";
import { mintGoogleAccessToken } from "@/app/api/_lib/googleAuth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function mintAdsToken(): Promise<string | null> {
  try {
    return await mintGoogleAccessToken({
      scope: "https://www.googleapis.com/auth/adwords",
      sub: process.env.GOOGLE_ADS_IMPERSONATE_EMAIL,
    });
  } catch {
    return null;
  }
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
      ad_group_ad.ad.id, ad_group_ad.ad.type, ad_group_ad.ad.name,
      ad_group_ad.ad.final_urls,
      ad_group_ad.ad.tracking_url_template,
      ad_group_ad.ad.responsive_search_ad.headlines,
      ad_group_ad.ad.responsive_search_ad.descriptions,
      ad_group_ad.ad.responsive_search_ad.path1,
      ad_group_ad.ad.responsive_search_ad.path2,
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
