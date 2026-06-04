/**
 * GET /api/admin/ad-performance
 *
 * Reads pre-aggregated snapshots from Supabase and returns the dashboard
 * payload. ?start=YYYY-MM-DD&end=YYYY-MM-DD (defaults: last 7 days).
 *
 * If ?live=1 is passed, triggers refreshAdPerformance first — useful for
 * a "refresh now" button without waiting for the next cron tick.
 *
 * Auth: Firebase Bearer token + admin email allowlist.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import {
  refreshAdPerformance,
  AD_GROUP_UTM_BY_ID,
} from "@/app/api/_lib/adPerformance";

export const runtime = "nodejs";
export const maxDuration = 60;

async function verifyAdmin(req: NextRequest): Promise<void> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

function defaultWindow(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await verifyAdmin(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unauthorized";
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  const url = new URL(req.url);
  const { start: defStart, end: defEnd } = defaultWindow();
  const start = url.searchParams.get("start") || defStart;
  const end = url.searchParams.get("end") || defEnd;
  const live = url.searchParams.get("live") === "1";

  if (live) {
    try {
      // Recompute the trailing 2 days at minimum, or the requested window
      // if larger.
      const days = Math.max(
        2,
        Math.ceil(
          (new Date(end).getTime() - new Date(start).getTime()) /
            (24 * 60 * 60 * 1000)
        ) + 1
      );
      await refreshAdPerformance(Math.min(days, 30));
    } catch (err) {
      console.error("[ad-performance] live refresh failed", err);
    }
  }

  const sb = getSupabaseService();
  const [snapsRes, kwRes] = await Promise.all([
    sb
      .from("ad_performance_snapshots")
      .select("*")
      .gte("snapshot_date", start)
      .lte("snapshot_date", end)
      .order("snapshot_date", { ascending: true }),
    sb
      .from("ad_performance_keywords")
      .select("*")
      .gte("snapshot_date", start)
      .lte("snapshot_date", end),
  ]);

  if (snapsRes.error) {
    return NextResponse.json(
      { error: snapsRes.error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    start,
    end,
    snapshots: snapsRes.data ?? [],
    keywords: kwRes.data ?? [],
    ad_group_map: AD_GROUP_UTM_BY_ID,
    // Benchmarks are STEP-TO-STEP (each rate is % advancing from the PREVIOUS
    // stage, not from clicks). Cost-per bands are reverse-engineered from CAC:
    // anchor CAC at industry $40–$80, assume 50% checkout→purchase, then daisy
    // chain backward with assumed step rates so the math is internally
    // consistent. CPC and CTR remain anchored to industry sources.
    // Sources for the anchors: Wordstream 2026, Digital Applied 2026, WebFX,
    // Polar Analytics, Rivo, First Page Sage.
    //   CAC                  $40–$80   (anchor: apparel ecom CAC)
    //   Checkout→Purchase    50%       (Drew assumption)
    //   Cost/checkout        $20–$40   = CAC × 0.5
    //   Profile→Checkout     30–50%    (quiz finishers who hit checkout)
    //   Cost/profile         $6–$20    = Cost/checkout × profile→checkout
    //   Click→Profile        20–40%    (ad clicks who finish style quiz)
    //   CPC                  $1–$2.50  (anchor: apparel/retail search)
    //   CTR                  2.5–3.8%  (anchor: industry)
    benchmarks: {
      // Click-through rate on the ad itself (anchor: industry).
      ctr: {
        kind: "rate",
        low: 0.025,
        high: 0.038,
        label: "Ad CTR (e-commerce search)",
      },
      // Cost per click on Google Search, apparel/retail (anchor: industry).
      cpc: {
        kind: "currency",
        low: 1.0,
        high: 2.5,
        label: "Cost per click (retail/apparel search)",
      },
      // STEP: clicks → profile completed.
      click_to_profile: {
        kind: "rate",
        low: 0.2,
        high: 0.4,
        label: "Click \u2192 profile (step)",
      },
      cost_per_profile: {
        kind: "currency",
        low: 6,
        high: 20,
        label: "Cost per profile completed",
      },
      // STEP: profile completed → checkout started.
      click_to_checkout: {
        kind: "rate",
        low: 0.3,
        high: 0.5,
        label: "Profile \u2192 checkout (step)",
      },
      cost_per_checkout: {
        kind: "currency",
        low: 20,
        high: 40,
        label: "Cost per checkout started",
      },
      // STEP: checkout started → purchase.
      click_to_purchase: {
        kind: "rate",
        low: 0.4,
        high: 0.6,
        label: "Checkout \u2192 purchase (step)",
      },
      cost_per_purchase: {
        kind: "currency",
        low: 40,
        high: 80,
        label: "CAC \u00b7 cost per purchase (apparel)",
      },
    },
  });
}
