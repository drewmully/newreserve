/**
 * GET /api/admin/cmo/latest
 *
 * Returns the most recent CMO Brain run (any status). Used by /admin/cmo.
 * Optional query params:
 *   ?id=<run_id>   → fetch a specific run
 *   ?limit=5       → list summary (id, status, started_at, completed_at, cost) of last N
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function verifyCaller(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return;

  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

export async function GET(request: NextRequest) {
  try {
    await verifyCaller(request);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "auth failed" },
      { status: 401 }
    );
  }

  const supa = getSupabaseService();
  const { searchParams } = new URL(request.url);
  const idParam = searchParams.get("id");
  const limitParam = searchParams.get("limit");

  if (limitParam) {
    const limit = Math.min(50, Math.max(1, parseInt(limitParam, 10) || 5));
    const { data, error } = await supa
      .from("marketing_cmo_runs")
      .select(
        "id, status, source, window_start, window_end, started_at, completed_at, duration_ms, cost_usd_cents, error"
      )
      .order("started_at", { ascending: false })
      .limit(limit);
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ runs: data ?? [] });
  }

  let query = supa
    .from("marketing_cmo_runs")
    .select("*")
    .order("started_at", { ascending: false })
    .limit(1);

  if (idParam) {
    const id = parseInt(idParam, 10);
    if (Number.isNaN(id)) {
      return NextResponse.json({ error: "invalid id" }, { status: 400 });
    }
    query = supa.from("marketing_cmo_runs").select("*").eq("id", id).limit(1);
  }

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
  if (!data || data.length === 0) {
    return NextResponse.json({ run: null });
  }
  return NextResponse.json({ run: data[0] });
}
