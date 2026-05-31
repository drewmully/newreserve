/**
 * POST /api/admin/cmo/run-synthesis
 *
 * Phase 2 of the CMO Brain pipeline (layer 6 — cmo synthesis + plays).
 * Reads a partial marketing_cmo_runs row by id and finishes it.
 *
 * Body: { runId: number }
 *
 * Auth: CRON_SECRET Bearer (called server-to-server by /api/admin/cmo/run
 * and by the safety-net cron). Admin Firebase tokens are also accepted so
 * the admin UI can manually resume a stuck run.
 *
 * Idempotent — if the row is already complete, returns 200 with status
 * 'skipped'.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { runCMOBrainPhase2 } from "@/app/api/_lib/cmo/orchestrator";

export const runtime = "nodejs";
// Phase 2 is just one LLM call but it's a big one — give it plenty of room.
export const maxDuration = 800;
export const dynamic = "force-dynamic";

async function verifyCaller(request: NextRequest): Promise<void> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return;
  if (cronSecret && request.headers.get("user-agent")?.includes("vercel-cron")) {
    return;
  }

  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

export async function POST(request: NextRequest) {
  try {
    await verifyCaller(request);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "auth failed" },
      { status: 401 }
    );
  }

  let body: { runId?: number } = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "invalid json body" }, { status: 400 });
  }

  const runId = Number(body.runId);
  if (!Number.isInteger(runId) || runId <= 0) {
    return NextResponse.json(
      { error: "missing or invalid runId" },
      { status: 400 }
    );
  }

  try {
    const result = await runCMOBrainPhase2(runId);
    const status =
      result.status === "failed"
        ? 500
        : result.status === "skipped"
        ? 200
        : 200;
    return NextResponse.json(result, { status });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}

export async function GET() {
  return NextResponse.json({ ok: true, route: "cmo/run-synthesis" });
}
