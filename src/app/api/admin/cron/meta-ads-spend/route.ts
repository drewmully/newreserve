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
import { postAdSpendToPostHog } from "@/app/api/admin/cron/_lib/postAdSpendToPostHog";
import { createMetaSpendReader, metaSpendCents, metaDeliveryCount,
  type MetaInsightsRow } from "@/app/api/admin/cron/_lib/metaSpendSource";

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
  if (!Number.isSafeInteger(days) || days < 1 || days > 31)
    return NextResponse.json({ error: "invalid_days" }, { status: 400 });

  const result = await withJobRun("meta-ads-spend", async ({ setMeta, bumpRows }) => {
    const { missing, env, apiVersion } = reqEnv();
    if (missing.length > 0) {
      setMeta({ skipped: true, missing });
      return { skipped: true, missing };
    }

    const reader = createMetaSpendReader({
      accountId: env.META_AD_ACCOUNT_ID, token: env.META_MARKETING_API_TOKEN, apiVersion,
      signal: AbortSignal.any([req.signal, AbortSignal.timeout(90000)]),
    });
    const account = await reader.readAccount();
    const accountId = account.accountId;

    const end = new Date();
    const start = new Date();
    start.setUTCDate(end.getUTCDate() - days);
    const fmt = (d: Date) => d.toISOString().slice(0, 10);
    const range = { since: fmt(start), until: fmt(end) };

    // ── Pull 1: account-level daily totals → marketing_spend_daily ────────
    const accountFields = ["spend", "impressions", "clicks"].join(",");
    const accountResult = await reader.readInsights({ ...range, level: "account", fields: accountFields });
    const accountRows = accountResult.rows;
    const accountCollectedAt = new Date().toISOString();

    const spendRows = accountRows
      .map((r) => ({
        brand: "mully",
        spend_date: r.date_start,
        channel: "meta_ads",
        source: "meta_marketing_api",
        amount: metaSpendCents(r.spend) / 100,
        raw: {
          spend: r.spend,
          impressions: r.impressions,
          clicks: r.clicks,
          account_id: accountId,
          source_currency: account.currency,
          source_timezone: account.timezone,
          pagination_complete: accountResult.paginationComplete,
          source_observed_at: accountCollectedAt,
          requested_from: range.since,
          requested_through: range.until,
        },
      }));

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
    const adsetResult = await reader.readInsights({ ...range, level: "adset", fields: adsetFields });
    const adsetRows = adsetResult.rows;
    const adsetCollectedAt = new Date().toISOString();

    const snapshotRows = adsetRows
      .filter((r) => r.date_start && r.adset_id)
      .map((r) => ({
        snapshot_date: r.date_start,
        ad_account_id: accountId,
        campaign_id: r.campaign_id || "(unknown)",
        campaign_name: r.campaign_name || null,
        adset_id: r.adset_id || "(unknown)",
        adset_name: r.adset_name || null,
        impressions: metaDeliveryCount(r.impressions),
        clicks: metaDeliveryCount(r.clicks),
        reach: Number(r.reach || 0),
        spend_cents: metaSpendCents(r.spend),
        initiate_checkouts: extractInitiateCheckouts(r.actions),
        purchases: extractPurchases(r.actions),
        purchase_revenue_cents: Math.round(
          extractPurchaseRevenue(r.action_values) * 100
        ),
        raw: { ...r, account_id: accountId, source_currency: account.currency,
          source_timezone: account.timezone, pagination_complete: adsetResult.paginationComplete,
          source_observed_at: adsetCollectedAt },
      }));

    // Finish and validate both bounded source reads before either table changes.
    // Explicit returned zeros replace old positive values; missing dates do not.
    setMeta({
      source_account_id: accountId,
      source_currency: account.currency,
      source_timezone: account.timezone,
      account_pages: accountResult.pages,
      adset_pages: adsetResult.pages,
      account_collected_at: accountCollectedAt,
      adset_collected_at: adsetCollectedAt,
      account_missing_dates: accountResult.missingDates,
      adset_missing_dates: adsetResult.missingDates,
      all_marketing_inventory_complete: false,
    });
    const svc = getSupabaseService();
    if (spendRows.length > 0) {
      const { error } = await svc
        .from("marketing_spend_daily")
        .upsert(spendRows, { onConflict: "brand,spend_date,channel,source" });
      if (error) throw new Error(`marketing_spend upsert: ${error.message}`);
    }

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

    // ── Pull 3: mirror daily totals into PostHog as ad_spend_daily events
    //   so blended CAC can be computed on the PostHog side without joining
    //   Supabase. Non-fatal.
    const posthogRows = accountRows
      .filter((r) => r.date_start)
      .map((r) => ({
        spend_date: r.date_start,
        amount: metaSpendCents(r.spend) / 100,
        impressions: metaDeliveryCount(r.impressions),
        clicks: metaDeliveryCount(r.clicks),
      }));
    const posthogResult = await postAdSpendToPostHog({
      channel: "meta_ads",
      rows: posthogRows,
    });

    bumpRows(
      accountRows.length + adsetRows.length,
      spendRows.length + snapshotRows.length
    );
    setMeta({
      spend_rows: spendRows.length,
      snapshot_rows: snapshotRows.length,
      posthog_captured: posthogResult.captured,
      posthog_error: posthogResult.error ?? null,
      range: [fmt(start), fmt(end)],
    });
    return {
      spend_rows: spendRows.length,
      snapshot_rows: snapshotRows.length,
      posthog_captured: posthogResult.captured,
    };
  });

  return NextResponse.json(result);
}
