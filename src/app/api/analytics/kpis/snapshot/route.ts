/**
 * GET/POST /api/analytics/kpis/snapshot
 *
 * Recomputes population KPI counters for a given day:
 *   - total_users
 *   - users_with_store_credit
 *   - users_with_active_subscription
 *
 * Protected by REPORTING_API_KEY.
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getDailyKPIs,
  refreshPopulationKPIs,
} from "@/app/api/_lib/kpiReporting";

function getProvidedApiKey(request: NextRequest): string {
  const authHeader = request.headers.get("Authorization") ?? "";
  const bearerKey = authHeader.replace(/^Bearer\s+/i, "").trim();
  const queryKey = request.nextUrl.searchParams.get("api_key") ?? "";
  return bearerKey || queryKey;
}

function requireReportingKey(request: NextRequest): NextResponse | null {
  const reportingKey = process.env.REPORTING_API_KEY;
  const providedKey = getProvidedApiKey(request);
  if (!reportingKey || providedKey !== reportingKey) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return null;
}

export async function GET(request: NextRequest) {
  const denied = requireReportingKey(request);
  if (denied) return denied;

  const date = request.nextUrl.searchParams.get("date") ?? undefined;

  try {
    const snapshot = await refreshPopulationKPIs(date);
    const kpis = await getDailyKPIs(snapshot.date);
    return NextResponse.json({ ok: true, snapshot, kpis });
  } catch (err) {
    console.error("[kpis/snapshot][GET] failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const denied = requireReportingKey(request);
  if (denied) return denied;

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    // body is optional
  }

  const dateFromQuery = request.nextUrl.searchParams.get("date") ?? undefined;
  const dateFromBody = body.date as string | undefined;
  const date = dateFromBody ?? dateFromQuery;

  try {
    const snapshot = await refreshPopulationKPIs(date);
    const kpis = await getDailyKPIs(snapshot.date);
    return NextResponse.json({ ok: true, snapshot, kpis });
  } catch (err) {
    console.error("[kpis/snapshot][POST] failed:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
