/**
 * POST /api/admin/cmo/run
 *
 * Kicks off a CMO Brain run (PHASE 1 — layers 1-5).
 *
 * After phase 1 finishes (sensors → analysts → research → strategist →
 * simulator), this endpoint fires a background POST to
 * /api/admin/cmo/run-synthesis to run phase 2 (cmo + plays) on a fresh
 * serverless invocation. Returns a 202 with the run id immediately after
 * phase 1 completes.
 *
 * Auth:
 *   - Firebase admin Bearer token, OR
 *   - CRON_SECRET Bearer (for /api/admin/cron/cmo-brain and manual triggers)
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import {
  runCMOBrainPhase1,
  triggerPhase2Async,
} from "@/app/api/_lib/cmo/orchestrator";

export const runtime = "nodejs";
// Phase 1 (sensors + analysts + research + strategist + simulator) is the
// long half of the pipeline. 800s gives us enough headroom on Vercel Pro;
// phase 2 runs in its own invocation.
export const maxDuration = 800;
export const dynamic = "force-dynamic";

async function verifyCaller(request: NextRequest): Promise<{ source: string }> {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");

  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return { source: "cron-or-internal" };
  if (cronSecret && request.headers.get("user-agent")?.includes("vercel-cron")) {
    return { source: "vercel-cron" };
  }

  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
  return { source: `admin:${decoded.email}` };
}

export async function POST(request: NextRequest) {
  let source = "unknown";
  try {
    ({ source } = await verifyCaller(request));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "auth failed" },
      { status: 401 }
    );
  }

  let body: { windowDays?: number } = {};
  try {
    body = await request.json();
  } catch {
    // empty body fine
  }

  try {
    const phase1 = await runCMOBrainPhase1({
      windowDays: body.windowDays ?? 14,
      source,
    });

    // If phase 1 succeeded, kick off phase 2 on a fresh invocation. If it
    // failed, leave the row alone — synthesis can't run without simulator.
    if (phase1.status === "partial") {
      triggerPhase2Async(phase1.id);
    }

    return NextResponse.json(phase1, {
      status: phase1.status === "failed" ? 500 : 202,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET for sanity check / pre-warm.
export async function GET() {
  return NextResponse.json({ ok: true, route: "cmo/run" });
}
