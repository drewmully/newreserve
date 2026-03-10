/**
 * GET /api/analytics/kpis
 *
 * Returns daily KPI metrics from Firestore.
 * Protected by REPORTING_API_KEY.
 *
 * Auth (either):
 *   Authorization: Bearer <REPORTING_API_KEY>
 *   ?api_key=<REPORTING_API_KEY>
 *
 * Query params:
 *   date — YYYY-MM-DD (optional, defaults to today UTC)
 *
 * Response: DailyKPIs object
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getDailyKPIs,
  refreshPopulationKPIs,
} from "@/app/api/_lib/kpiReporting";

export async function GET(request: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = request.headers.get("Authorization") ?? "";
  const bearerKey = authHeader.replace(/^Bearer\s+/i, "").trim();
  const queryKey =
    request.nextUrl.searchParams.get("api_key") ?? "";
  const providedKey = bearerKey || queryKey;

  const reportingKey = process.env.REPORTING_API_KEY;
  if (!reportingKey || providedKey !== reportingKey) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // ── Fetch KPIs ────────────────────────────────────────────────────────────
  const date =
    request.nextUrl.searchParams.get("date") ?? undefined;
  const refresh =
    request.nextUrl.searchParams.get("refresh") === "1" ||
    request.nextUrl.searchParams.get("refresh") === "true";

  try {
    if (refresh) {
      await refreshPopulationKPIs(date);
    }
    const kpis = await getDailyKPIs(date);
    return NextResponse.json(kpis);
  } catch (err) {
    console.error("[kpis] Error fetching daily KPIs:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
