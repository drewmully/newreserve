/**
 * GET /api/admin/cron/cmo-brain
 *
 * Nightly Vercel cron entry point. Runs Phase 1 of the CMO Brain pipeline
 * (layers 1-5) then fires Phase 2 (layer 6) on a fresh invocation via
 * /api/admin/cmo/run-synthesis. The safety-net cron at
 * /api/admin/cron/cmo-brain-resume picks up any rows that get stuck.
 *
 * Auth: Vercel cron user-agent OR CRON_SECRET Bearer.
 *
 * Wire to vercel.json:
 *   { "path": "/api/admin/cron/cmo-brain", "schedule": "0 6 * * *" }
 *   (06:00 UTC = ~01:00 ET).
 */

import { NextRequest, NextResponse } from "next/server";
import {
  runCMOBrainPhase1,
  triggerPhase2Async,
} from "@/app/api/_lib/cmo/orchestrator";

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
    const phase1 = await runCMOBrainPhase1({ source: "cron", windowDays: 14 });
    if (phase1.status === "partial") {
      triggerPhase2Async(phase1.id);
    }
    return NextResponse.json(phase1, {
      status: phase1.status === "failed" ? 500 : 202,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
