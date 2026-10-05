/**
 * GET /api/admin/cron/klaviyo-sync-report
 *
 * Daily reconciliation (9 AM ET). For the last 24h: captures per source,
 * synced / not synced / failed / dead counts, the oldest unsynced age, and
 * Klaviyo's own "Mully Site Signup" count. Stored in Firestore
 * `klaviyo_sync_reports/{YYYY-MM-DD}`. Raises a klaviyo_sync_failed alert
 * when anything has been unsynced for more than 1 hour or is dead.
 *
 * Counts only; no PII. Auth: Bearer CRON_SECRET.
 */

import { NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { raiseAlert } from "@/lib/events/alert";
import { SIGNUP_METRIC, isKlaviyoSyncEnabled } from "@/lib/klaviyo/config";
import { klaviyoRequest } from "@/lib/klaviyo/client";
import { buildSyncReport, isCronAuthorized } from "@/lib/klaviyo/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

async function klaviyoSignupCount(start: string, end: string): Promise<number | null> {
  try {
    const filter = encodeURIComponent(`equals(name,"${SIGNUP_METRIC}")`);
    const metrics = await klaviyoRequest<{ data?: Array<{ id: string }> }>(`/api/metrics?filter=${filter}`, { method: "GET" });
    const metricId = metrics.body?.data?.[0]?.id;
    if (!metricId) return 0;
    const agg = await klaviyoRequest<{ data?: { attributes?: { data?: Array<{ measurements?: { count?: number[] } }> } } }>(
      "/api/metric-aggregates",
      {
        body: {
          data: {
            type: "metric-aggregate",
            attributes: {
              metric_id: metricId,
              measurements: ["count"],
              interval: "day",
              timezone: "US/Eastern",
              filter: [`greater-or-equal(datetime,${start})`, `less-than(datetime,${end})`],
            },
          },
        },
      },
    );
    const rows = agg.body?.data?.attributes?.data ?? [];
    return rows.reduce((sum, r) => sum + (r.measurements?.count ?? []).reduce((a, b) => a + b, 0), 0);
  } catch {
    return null;
  }
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isKlaviyoSyncEnabled()) return NextResponse.json({ ok: true, skipped: true, reason: "disabled" });

  const now = new Date();
  try {
    const report = await buildSyncReport(now);
    const klaviyoSignupEvents = await klaviyoSignupCount(report.windowStart.slice(0, 19), report.windowEnd.slice(0, 19));
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York" }).format(now);
    const stored = { ...report, klaviyoSignupEvents, generatedAt: now.toISOString() };
    await adminDb.collection("klaviyo_sync_reports").doc(day).set(stored);

    const stuck = (report.oldestUnsyncedMinutes ?? 0) > 60;
    if (stuck || report.totals.dead > 0) {
      await raiseAlert({
        kind: "klaviyo_sync_failed",
        severity: "warning",
        summary: `Klaviyo signup sync report ${day}: ${report.totals.captured} captured, ${report.totals.synced} synced, ${report.totals.failed} failed, ${report.totals.dead} dead, oldest unsynced ${report.oldestUnsyncedMinutes ?? 0} min`,
        detail: { day, totals: report.totals, oldestUnsyncedMinutes: report.oldestUnsyncedMinutes },
      });
    }
    return NextResponse.json({ ok: true, day, ...stored });
  } catch {
    console.error("[klaviyo-sync-report] failed");
    return NextResponse.json({ ok: false, error: "report_failed" }, { status: 500 });
  }
}
