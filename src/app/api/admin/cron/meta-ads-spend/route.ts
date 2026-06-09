/**
 * GET /api/admin/cron/meta-ads-spend
 *
 * Pulls daily Meta (Facebook/Instagram) ad spend + delivery metrics from
 * the Marketing API and upserts:
 *   1) Daily account-wide spend → `marketing_spend_daily`
 *      (brand='mully', channel='meta_ads', source='meta_marketing_api')
 *   2) Per-ad-set daily snapshots → `meta_ad_performance_snapshots`
 *      so the dashboard can show CPC, impressions, clicks, IC count,
 *      and CAC per Meta ad set alongside Google.
 *
 * Idempotent: both upserts have a natural key conflict target.
 *
 * Default window: last 14 days (re-pull because Meta can adjust spend
 * for up to 28 days; 14 catches most of the drift without paying too
 * much for old data).
 *
 * Requires (all three):
 *   META_MARKETING_API_TOKEN   System User token with `ads_read` scope on
 *                              the ad account (NOT the CAPI-only token —
 *                              that one's scope is read_ads_dataset_quality)
 *   META_AD_ACCOUNT_ID         Numeric ad account id (e.g. 2796962933960445).
 *                              We prepend `act_` ourselves.
 *
 * Optional:
 *   META_API_VERSION           Defaults to v21.0
 *
 * Soft-skips when any required env var is missing so prod doesn't fail
 * during the period before Drew grants Marketing API access. Returns
 * { skipped: true, missing: [...] } in that case.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService, withJobRun } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";
export const maxDuration = 120;

const DEFAULT_API_VERSION = "v21.0";

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return (req.headers.get("user-agent") || "").includes("vercel-cron");
}

function reqEnv() {
  const keys = ["META_MARKETING_API_TOKEN", "META_AD_ACCOUNT_ID"] as const;
  const missing = keys.filter((k) => !process.env[k]);
  return {
    missing,
    env: Object.fromEntries(keys.map((k) => [k, process.env[k] || ""])),
    apiVersion: process.env.META_API_VERSION || DEFAULT_API_VERSION,
  };
}

interface MetaInsightsRow {
  date_start: string;
  date_stop: string;
  spend?: string;
  impressions?: string;
  clicks?: string;
  reach?: string;
  // Ad-set-level only
  adset_id?: string;
  adset_name?: string;
  campaign_id?: string;
  campaign_name?: string;
  // actions[] arrives as an array of {action_type, value}
  actions?: Array<{ action_type: string; value: string }>;
  // action_values[] same shape but with monetary value (purchase revenue)
  action_values?: Array<{ action_type: string; value: string }>;
}

interface MetaInsightsResponse {
  data?: MetaInsightsRow[];
  paging?: { next?: string };
  error?: { message: string; code: number };
}

async function fetchAllPages(initialUrl: string): Promise<MetaInsightsRow[]> {
  const out: MetaInsightsRow[] = [];
  let url: string | undefined = initialUrl;
  let safety = 25;
  while (url && safety > 0) {
    const r = await fetch(url);
    if (!r.ok) {
      throw new Error(`meta insights: ${r.status} ${await r.text()}`);
    }
    const j = (await r.json()) as MetaInsightsResponse;
    if (j.error) {
      throw new Error(`meta insights error: ${j.error.code} ${j.error.message}`);
    }
    for (const row of j.data || []) out.push(row);
    url = j.paging?.next;
    safety--;
  }
  return out;
}

/**
 * Meta exposes the SAME conversion under multiple action_type names in the
 * same `actions[]` array:
 *   - `initiate_checkout`                                   ← omni count (pixel+CAPI dedup'd)
 *   - `offsite_conversion.fb_pixel_initiate_checkout`       ← pixel only (subset)
 *   - `offsite_initiate_checkout_add_20_s_calls`            ← custom-event alias
 *
 * They all report the SAME 22 IC for the same day. Naively summing them
 * triples the count. Prefer `initiate_checkout` (the omni count) when
 * present, fall back to the pixel-only count, then to zero.
 */
function pickAction(
  actions: MetaInsightsRow["actions"],
  preferred: string[]
): number {
  if (!actions) return 0;
  const byType = new Map<string, number>();
  for (const a of actions) {
    byType.set(a.action_type, Number(a.value || 0));
  }
  for (const t of preferred) {
    const v = byType.get(t);
    if (typeof v === "number" && v > 0) return v;
  }
  return 0;
}

function extractInitiateCheckouts(actions: MetaInsightsRow["actions"]): number {
  return pickAction(actions, [
    "initiate_checkout",
    "offsite_conversion.fb_pixel_initiate_checkout",
  ]);
}

function extractPurchases(actions: MetaInsightsRow["actions"]): number {
  return pickAction(actions, [
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "omni_purchase",
  ]);
}

function extractPurchaseRevenue(
  values: MetaInsightsRow["action_values"]
): number {
  return pickAction(values, [
    "purchase",
    "offsite_conversion.fb_pixel_purchase",
    "omni_purchase",
  ]);
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const days = Number(url.searchParams.get("days") || "14");

  const result = await withJobRun("meta-ads-spend", async ({ setMeta, bumpRows }) => {
    const { missing, env, apiVersion } = reqEnv();
    if (missing.length > 0) {
      setMeta({ skipped: true, missing });
      return { skipped: true, missing };
    }

    const accountId = env.META_AD_ACCOUNT_ID.startsWith("act_")
      ? env.META_AD_ACCOUNT_ID
      : `act_${env.META_AD_ACCOUNT_ID}`;
    const token = env.META_MARKETING_API_TOKEN;

    const end = new Date();
    const start = new Date();
    start.setUTCDate(end.getUTCDate() - days);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const timeRange = JSON.stringify({ since: fmt(start), until: fmt(end) });

    // ── Pull 1: account-level daily totals → marketing_spend_daily ────────
    const accountFields = ["spend", "impressions", "clicks"].join(",");
    const accountUrl =
      `https://graph.facebook.com/${apiVersion}/${accountId}/insights` +
      `?level=account&fields=${accountFields}` +
      `&time_increment=1&time_range=${encodeURIComponent(timeRange)}` +
      `&access_token=${token}`;
    const accountRows = await fetchAllPages(accountUrl);

    const spendRows = accountRows
      .filter((r) => r.date_start && Number(r.spend || 0) > 0)
      .map((r) => ({
        brand: "mully",
        spend_date: r.date_start,
        channel: "meta_ads",
        source: "meta_marketing_api",
        amount: Number(Number(r.spend || 0).toFixed(2)),
        raw: {
          spend: r.spend,
          impressions: r.impressions,
          clicks: r.clicks,
        },
      }));

    const svc = getSupabaseService();
    if (spendRows.length > 0) {
      const { error } = await svc
        .from("marketing_spend_daily")
        .upsert(spendRows, { onConflict: "brand,spend_date,channel,source" });
      if (error) throw new Error(`marketing_spend upsert: ${error.message}`);
    }

    // ── Pull 2: per-ad-set daily snapshots → meta_ad_performance_snapshots ─
    const adsetFields = [
      "spend",
      "impressions",
      "clicks",
      "reach",
      "adset_id",
      "adset_name",
      "campaign_id",
      "campaign_name",
      "actions",
      "action_values",
    ].join(",");
    const adsetUrl =
      `https://graph.facebook.com/${apiVersion}/${accountId}/insights` +
      `?level=adset&fields=${adsetFields}` +
      `&time_increment=1&time_range=${encodeURIComponent(timeRange)}` +
      `&access_token=${token}`;
    const adsetRows = await fetchAllPages(adsetUrl);

    const snapshotRows = adsetRows
      .filter((r) => r.date_start && r.adset_id)
      .map((r) => ({
        snapshot_date: r.date_start,
        ad_account_id: accountId,
        campaign_id: r.campaign_id || "(unknown)",
        campaign_name: r.campaign_name || null,
        adset_id: r.adset_id || "(unknown)",
        adset_name: r.adset_name || null,
        impressions: Number(r.impressions || 0),
        clicks: Number(r.clicks || 0),
        reach: Number(r.reach || 0),
        spend_cents: Math.round(Number(r.spend || 0) * 100),
        initiate_checkouts: extractInitiateCheckouts(r.actions),
        purchases: extractPurchases(r.actions),
        purchase_revenue_cents: Math.round(
          extractPurchaseRevenue(r.action_values) * 100
        ),
        raw: r,
      }));

    if (snapshotRows.length > 0) {
      const { error } = await svc
        .from("meta_ad_performance_snapshots")
        .upsert(snapshotRows, {
          onConflict: "snapshot_date,ad_account_id,adset_id",
        });
      if (error) {
        // Table might not exist yet on first deploy. Surface the error but
        // don't break the marketing_spend_daily upsert.
        console.error("[meta-ads-spend] snapshot upsert", error.message);
        setMeta({
          spend_rows: spendRows.length,
          snapshot_rows: 0,
          snapshot_error: error.message,
        });
        bumpRows(accountRows.length + adsetRows.length, spendRows.length);
        return {
          spend_rows: spendRows.length,
          snapshot_rows: 0,
          snapshot_error: error.message,
        };
      }
    }

    bumpRows(
      accountRows.length + adsetRows.length,
      spendRows.length + snapshotRows.length
    );
    setMeta({
      spend_rows: spendRows.length,
      snapshot_rows: snapshotRows.length,
      range: [fmt(start), fmt(end)],
    });
    return {
      spend_rows: spendRows.length,
      snapshot_rows: snapshotRows.length,
    };
  });

  return NextResponse.json(result);
}
