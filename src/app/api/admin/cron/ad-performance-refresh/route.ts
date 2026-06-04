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
import { refreshOrganicPerformance } from "@/app/api/_lib/organicPerformance";

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
  // Run paid + organic refresh in parallel; one failing must not kill the other.
  const [paidResult, organicResult] = await Promise.allSettled([
    refreshAdPerformance(days),
    refreshOrganicPerformance(days),
  ]);

  const paid = paidResult.status === "fulfilled"
    ? { ok: true, ...paidResult.value }
    : { ok: false, error: paidResult.reason instanceof Error ? paidResult.reason.message : String(paidResult.reason) };
  const organic = organicResult.status === "fulfilled"
    ? { ok: true, ...organicResult.value }
    : { ok: false, error: organicResult.reason instanceof Error ? organicResult.reason.message : String(organicResult.reason) };

  if (!paid.ok) console.error("[ad-performance-refresh] paid failed", paidResult.status === "rejected" ? paidResult.reason : null);
  if (!organic.ok) console.error("[ad-performance-refresh] organic failed", organicResult.status === "rejected" ? organicResult.reason : null);

  const allOk = paid.ok && organic.ok;
  return NextResponse.json(
    {
      ok: allOk,
      duration_ms: Date.now() - started,
      paid,
      organic,
    },
    { status: allOk ? 200 : 500 }
  );
}
