/**
 * GET /api/admin/cron/cmo-brain
 *
 * Nightly Vercel cron entry point. Calls runCMOBrain and reports result.
 * Auth: Vercel cron user-agent OR CRON_SECRET Bearer.
 *
 * Wire to vercel.json:
 *   { "path": "/api/admin/cron/cmo-brain", "schedule": "0 6 * * *" }
 *   (06:00 UTC = ~01:00 ET).
 */

import { NextRequest, NextResponse } from "next/server";
import { runCMOBrain } from "@/app/api/_lib/cmo/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 800;
export const dynamic = "force-dynamic";

function authorized(request: NextRequest): boolean {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return true;
  const ua = request.headers.get("user-agent") ?? "";
  if (cronSecret && ua.includes("vercel-cron")) return true;
  return false;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  try {
    const result = await runCMOBrain({ source: "cron", windowDays: 14 });
    return NextResponse.json(result);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
