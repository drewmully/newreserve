/**
 * GET /api/email/process
 *
 * Cron endpoint. Runs every hour via Vercel cron.
 * Queries email_sequences where status=active and nextSendAt <= now,
 * then processes each one (sends email, advances state).
 *
 * Secured with CRON_SECRET (set in Vercel env vars).
 * Vercel automatically sends: Authorization: Bearer <CRON_SECRET>
 */

import { NextRequest, NextResponse } from "next/server";
import { Timestamp } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { processSequence } from "@/lib/email/sequences";

const BATCH_SIZE = 50;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const auth = req.headers.get("authorization");
  return auth === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = Timestamp.now();

  const snap = await adminDb
    .collection("email_sequences")
    .where("status", "==", "active")
    .where("nextSendAt", "<=", now)
    .limit(BATCH_SIZE)
    .get();

  if (snap.empty) {
    return NextResponse.json({ ok: true, processed: 0 });
  }

  const results = await Promise.allSettled(
    snap.docs.map((doc) => processSequence(doc.id))
  );

  const failed = results.filter((r) => r.status === "rejected");
  if (failed.length > 0) {
    failed.forEach((r) => {
      if (r.status === "rejected") {
        console.error("[email/process] sequence failed:", r.reason);
      }
    });
  }

  console.log(
    `[email/process] processed=${results.length} failed=${failed.length}`
  );

  return NextResponse.json({
    ok: true,
    processed: results.length,
    failed: failed.length,
  });
}
