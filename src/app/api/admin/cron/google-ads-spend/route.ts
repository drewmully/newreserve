/**
 * GET /api/admin/cron/google-ads-spend
 *
 * Pulls daily ad spend from Google Ads → `marketing_spend_daily`
 * (brand='mully', channel='google_ads', source='google_ads_api').
 * Idempotent on (brand, spend_date, channel, source).
 *
 * Default window: last 14 days (so we re-pull a window in case
 * upstream spend is finalized late).
 *
 * Requires (all four):
 *   GOOGLE_ADS_DEVELOPER_TOKEN
 *   GOOGLE_ADS_LOGIN_CUSTOMER_ID    (manager / MCC; format: "1234567890")
 *   GOOGLE_ADS_CUSTOMER_ID          (account being queried; same format)
 *   GOOGLE_ADS_REFRESH_TOKEN
 *   GOOGLE_ADS_OAUTH_CLIENT_ID
 *   GOOGLE_ADS_OAUTH_CLIENT_SECRET
 *
 * Soft-skips when any required env var is missing.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService, withJobRun } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";
export const maxDuration = 120;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return (req.headers.get("user-agent") || "").includes("vercel-cron");
}

function reqEnv() {
  const keys = [
    "GOOGLE_ADS_DEVELOPER_TOKEN",
    "GOOGLE_ADS_LOGIN_CUSTOMER_ID",
    "GOOGLE_ADS_CUSTOMER_ID",
    "GOOGLE_ADS_REFRESH_TOKEN",
    "GOOGLE_ADS_OAUTH_CLIENT_ID",
    "GOOGLE_ADS_OAUTH_CLIENT_SECRET",
  ] as const;
  const missing = keys.filter((k) => !process.env[k]);
  return { missing, env: Object.fromEntries(keys.map((k) => [k, process.env[k] || ""])) };
}

async function refreshAccessToken(clientId: string, clientSecret: string, refreshToken: string) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
  });
  if (!r.ok) throw new Error(`google oauth: ${r.status} ${await r.text()}`);
  return ((await r.json()) as { access_token: string }).access_token;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") || "14");

  const result = await withJobRun("google-ads-spend", async ({ setMeta, bumpRows }) => {
    const { missing, env } = reqEnv();
    if (missing.length > 0) {
      setMeta({ skipped: true, missing });
      return { skipped: true, missing };
    }

    const accessToken = await refreshAccessToken(
      env.GOOGLE_ADS_OAUTH_CLIENT_ID,
      env.GOOGLE_ADS_OAUTH_CLIENT_SECRET,
      env.GOOGLE_ADS_REFRESH_TOKEN,
    );

    const end = new Date();
    const start = new Date();
    start.setUTCDate(end.getUTCDate() - days);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);

    const query = `
      SELECT segments.date, metrics.cost_micros
      FROM customer
      WHERE segments.date BETWEEN '${fmt(start)}' AND '${fmt(end)}'
    `;

    const apiUrl = `https://googleads.googleapis.com/v17/customers/${env.GOOGLE_ADS_CUSTOMER_ID}/googleAds:search`;
    const r = await fetch(apiUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "developer-token": env.GOOGLE_ADS_DEVELOPER_TOKEN,
        "login-customer-id": env.GOOGLE_ADS_LOGIN_CUSTOMER_ID,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query }),
    });
    if (!r.ok) throw new Error(`google ads api: ${r.status} ${await r.text()}`);
    const j = (await r.json()) as {
      results?: Array<{
        segments?: { date?: string };
        metrics?: { costMicros?: string };
      }>;
    };

    // Sum cost_micros by date (the API returns segmented rows when accounts
    // have campaigns; if there's only one row per date this is a no-op).
    const totals = new Map<string, number>();
    for (const row of j.results || []) {
      const d = row.segments?.date;
      const micros = Number(row.metrics?.costMicros || 0);
      if (!d) continue;
      totals.set(d, (totals.get(d) || 0) + micros);
    }

    const rows = [...totals.entries()].map(([date, micros]) => ({
      brand: "mully",
      spend_date: date,
      channel: "google_ads",
      source: "google_ads_api",
      amount: Number((micros / 1_000_000).toFixed(2)),
      raw: { cost_micros: micros },
    }));

    if (rows.length === 0) {
      setMeta({ rows: 0, range: [fmt(start), fmt(end)] });
      return { rows: 0 };
    }

    const svc = getSupabaseService();
    const { error } = await svc
      .from("marketing_spend_daily")
      .upsert(rows, { onConflict: "brand,spend_date,channel,source" });
    if (error) throw new Error(`marketing_spend upsert: ${error.message}`);

    bumpRows(j.results?.length || 0, rows.length);
    setMeta({ rows: rows.length, range: [fmt(start), fmt(end)] });
    return { rows: rows.length };
  });

  return NextResponse.json(result);
}
