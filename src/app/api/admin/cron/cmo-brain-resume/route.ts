/**
 * GET /api/admin/cron/cmo-brain-resume
 *
 * Safety-net cron for the CMO Brain pipeline.
 *
 * The pipeline runs in two phases (see _lib/cmo/orchestrator.ts). Phase 1
 * fires Phase 2 via fire-and-forget HTTP, but if that trigger ever fails
 * (network blip, cold-start race, Vercel queue), the row gets stuck in
 * status='running' with simulator IS NOT NULL and cmo IS NULL.
 *
 * This cron runs every 10 minutes and resumes any such partial rows that
 * are older than 2 minutes and younger than 6 hours. Idempotent.
 *
 * Auth: Vercel cron user-agent OR CRON_SECRET Bearer.
 *
 * Wire to vercel.json:
 *   { "path": "/api/admin/cron/cmo-brain-resume", "schedule": "*\/10 * * * *" }
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { triggerPhase2Async } from "@/app/api/_lib/cmo/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 60;
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

interface StuckRow {
  id: number;
  started_at: string;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const supa = getSupabaseService();
  const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
  const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();

  // Pick up rows that finished phase 1 (simulator NOT NULL) but never got
  // their cmo/plays populated. The lower bound on started_at prevents us
  // from re-triggering rows that are still actively running phase 2 in
  // another invocation; the upper bound caps how far back we'll chase.
  const { data, error } = await supa
    .from("marketing_cmo_runs")
    .select("id, started_at")
    .eq("status", "running")
    .not("simulator", "is", null)
    .is("cmo", null)
    .lt("started_at", twoMinAgo)
    .gt("started_at", sixHoursAgo)
    .order("started_at", { ascending: true })
    .limit(5);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as StuckRow[];
  if (rows.length === 0) {
    return NextResponse.json({ ok: true, resumed: 0, ids: [] });
  }

  for (const row of rows) {
    console.log(`[cmo-resume] re-triggering phase2 for stuck run ${row.id}`);
    triggerPhase2Async(row.id);
  }

  return NextResponse.json({
    ok: true,
    resumed: rows.length,
    ids: rows.map((r) => r.id),
  });
}
