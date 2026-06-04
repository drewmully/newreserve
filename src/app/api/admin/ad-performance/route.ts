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
    // Industry benchmarks for the UI (apparel / e-commerce search, 2026).
    // Sources: Wordstream 2026, Digital Applied 2026, WebFX, Polar Analytics,
    // Rivo, First Page Sage. Rate bands are fractions (0–1); cost bands are
    // USD dollars per event.
    benchmarks: {
      // Click-through rate on the ad itself.
      ctr: {
        kind: "rate",
        low: 0.025,
        high: 0.038,
        label: "Ad CTR (e-commerce search)",
      },
      // Cost per click on Google Search, apparel/retail.
      cpc: {
        kind: "currency",
        low: 1.0,
        high: 2.5,
        label: "Cost per click (retail/apparel search)",
      },
      // Click → profile completed (a.k.a. quiz_completed).
      click_to_profile: {
        kind: "rate",
        low: 0.03,
        high: 0.10,
        label: "Click \u2192 profile completed",
      },
      cost_per_profile: {
        kind: "currency",
        low: 20,
        high: 60,
        label: "Cost per profile completed",
      },
      // Click → checkout started.
      click_to_checkout: {
        kind: "rate",
        low: 0.015,
        high: 0.04,
        label: "Click \u2192 checkout started",
      },
      cost_per_checkout: {
        kind: "currency",
        low: 40,
        high: 90,
        label: "Cost per checkout started",
      },
      // Click → purchase (CAC).
      click_to_purchase: {
        kind: "rate",
        low: 0.005,
        high: 0.02,
        label: "Click \u2192 purchase (apparel ecom)",
      },
      cost_per_purchase: {
        kind: "currency",
        low: 40,
        high: 80,
        label: "Cost per purchase (CAC, apparel)",
      },
    },
  });
}
