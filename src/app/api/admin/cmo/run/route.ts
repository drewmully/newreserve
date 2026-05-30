/**
 * POST /api/admin/cmo/run
 *
 * Kicks off a CMO Brain run.
 *
 * Auth:
 *   - Firebase admin Bearer token, OR
 *   - CRON_SECRET Bearer (for /api/admin/cron/cmo-brain and manual cron triggers)
 *
 * Returns immediately with the run id; the work executes inline on the
 * serverless function (it's a long-running fn — make sure maxDuration is set).
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { runCMOBrain } from "@/app/api/_lib/cmo/orchestrator";

export const runtime = "nodejs";
export const maxDuration = 800; // up to ~13 minutes for the full pipeline
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
    const result = await runCMOBrain({
      windowDays: body.windowDays ?? 14,
      source,
    });
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

// GET for sanity check / pre-warm.
export async function GET() {
  return NextResponse.json({ ok: true, route: "cmo/run" });
}
