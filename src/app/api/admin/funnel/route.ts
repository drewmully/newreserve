/**
 * GET /api/admin/funnel
 *
 * Returns daily KPI data for the admin funnel dashboard.
 * Auth: Firebase Bearer token (admin email allowlist).
 *
 * Query params:
 *   date    — YYYY-MM-DD (defaults to today)
 *   refresh — "1" to recompute population snapshot
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { getDailyKPIs, refreshPopulationKPIs } from "@/app/api/_lib/kpiReporting";

async function verifyAdmin(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

export async function GET(request: NextRequest) {
  try {
    await verifyAdmin(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json({ error: msg }, { status: msg === "Forbidden" ? 403 : 401 });
  }

  const params = request.nextUrl.searchParams;
  const date = params.get("date") ?? undefined;
  const refresh = params.get("refresh") === "1";

  try {
    if (refresh) await refreshPopulationKPIs(date);
    const kpis = await getDailyKPIs(date);
    return NextResponse.json(kpis);
  } catch (err) {
    console.error("[admin/funnel] failed:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
