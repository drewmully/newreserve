/**
 * POST /api/admin/close-legacy-flows
 *
 * One-time backfill: find every email_sequences doc still in flow="free" or
 * flow="back9" and mark it status="completed", nextSendAt=null so the cron
 * stops picking them up. These two drips have been retired.
 *
 * Body: { dry_run?: boolean }   defaults to true
 * Auth: CRON_SECRET bearer token (server-to-server).
 */

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const maxDuration = 60;

function verifyAuth(request: NextRequest): void {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) throw new Error("CRON_SECRET not configured");
  if (token === cronSecret) return;
  if (request.headers.get("user-agent")?.includes("vercel-cron")) return;
  throw new Error("Forbidden");
}

const RETIRED_FLOWS = ["free", "back9"] as const;

export async function POST(request: NextRequest) {
  try {
    verifyAuth(request);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    return NextResponse.json(
      { error: msg },
      { status: msg === "Forbidden" ? 403 : 401 },
    );
  }

  let dryRun = true;
  try {
    const body = (await request.json()) as { dry_run?: boolean };
    dryRun = body.dry_run !== false;
  } catch {
    // default dry_run=true
  }

  const closed: Array<{ uid: string; flow: string; status: string }> = [];

  for (const flow of RETIRED_FLOWS) {
    const snap = await adminDb
      .collection("email_sequences")
      .where("flow", "==", flow)
      .where("status", "in", ["active", "paused"])
      .get();

    for (const doc of snap.docs) {
      closed.push({
        uid: doc.id,
        flow,
        status: (doc.data().status as string) ?? "active",
      });

      if (!dryRun) {
        await doc.ref.update({
          status: "completed",
          nextSendAt: null,
          completedAt: Timestamp.now(),
          completedReason: "flow_retired",
        });
      }
    }
  }

  const summary = {
    total_closed: closed.length,
    free: closed.filter((c) => c.flow === "free").length,
    back9: closed.filter((c) => c.flow === "back9").length,
  };

  return NextResponse.json({ dry_run: dryRun, summary, closed });
}
