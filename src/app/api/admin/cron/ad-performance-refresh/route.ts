/**
 * GET /api/admin/cron/ad-performance-refresh
 *
 * Hourly cron that refreshes the trailing 48h of ad-performance snapshots
 * into public.ad_performance_snapshots and public.ad_performance_keywords.
 *
 * Auth: Bearer CRON_SECRET, or vercel-cron user-agent.
 *
 * Hourly cadence (not 6h) because:
 *   - Google Ads has a ~3h ingestion lag — we want yesterday's spend to
 *     converge today rather than show a 6h-old snapshot all morning.
 *   - PostHog and Shopify are real-time, no reason to wait.
 *   - The query touches a small window, ~ same cost as a 6h refresh.
 */

import { NextRequest, NextResponse } from "next/server";
import { refreshAdPerformance } from "@/app/api/_lib/adPerformance";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return (req.headers.get("user-agent") || "").includes("vercel-cron");
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const url = new URL(req.url);
  const daysParam = url.searchParams.get("days");
  const days = Math.min(Math.max(Number(daysParam ?? "2"), 1), 30);

  const started = Date.now();
  try {
    const summary = await refreshAdPerformance(days);
    return NextResponse.json({
      ok: true,
      duration_ms: Date.now() - started,
      ...summary,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[ad-performance-refresh] failed", err);
    return NextResponse.json(
      { ok: false, error: message, duration_ms: Date.now() - started },
      { status: 500 }
    );
  }
}
