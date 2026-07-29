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
import {
  findAbandonNudgeCandidates,
  recordAbandonNudge,
} from "@/lib/styleProfiles/admin";
import { reserve_abandon } from "@/lib/email/templates/reserve";
import { sendPlainText } from "@/lib/email/resend";
import { getLoopSubscriptionStatus } from "@/app/api/_lib/loopAdmin";

const BATCH_SIZE = 50;
const ABANDON_NUDGE_STALE_MS = 24 * 60 * 60 * 1000;
const ABANDON_NUDGE_BATCH = 50;

/**
 * Per-cron-tick abandon-quiz nudge work.
 *
 * Finds Reserve style profiles that captured an email but never completed the
 * quiz (>=24h stale, never previously nudged), then sends `reserve_abandon`
 * via Resend and stamps `abandonNudgeSentAt` so we never double-nudge.
 *
 * Active Mullybox subscribers are suppressed via Loop's `mullybox_active`
 * field — same rule used at quiz/complete to avoid emailing paying members.
 */
async function processAbandonNudges(): Promise<{
  sent: number;
  suppressed: number;
  failed: number;
}> {
  const candidates = await findAbandonNudgeCandidates({
    staleMs: ABANDON_NUDGE_STALE_MS,
    limit: ABANDON_NUDGE_BATCH,
  });

  if (candidates.length === 0) {
    return { sent: 0, suppressed: 0, failed: 0 };
  }

  let sent = 0;
  let suppressed = 0;
  let failed = 0;

  await Promise.allSettled(
    candidates.map(async (profile) => {
      const email = profile.email;
      if (!email) return;

      try {
        const loop = await getLoopSubscriptionStatus(email).catch(() => null);
        if (loop?.mullybox_active) {
          // Don't email active Mullybox subscribers — just mark so we don't retry.
          await recordAbandonNudge(profile.profileId);
          suppressed += 1;
          return;
        }

        const tmpl = reserve_abandon(null);
        await sendPlainText({
          to: email,
          subject: tmpl.subject,
          text: tmpl.text,
          sendClass: "lifecycle",
          flow: "reserve",
          category: "abandon_nudge",
          idempotencyKey: `reserve_abandon:${profile.profileId}`,
          tags: [
            { name: "flow", value: "reserve" },
            { name: "category", value: "abandon_nudge" },
          ],
          utmCampaign: "reserve_abandon",
          utmContent: "abandon_nudge",
        });
        await recordAbandonNudge(profile.profileId);
        sent += 1;
      } catch (err) {
        console.error(
          `[email/process] reserve abandon nudge failed for profile=${profile.profileId}:`,
          err
        );
        failed += 1;
      }
    })
  );

  return { sent, suppressed, failed };
}

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

  const results = snap.empty
    ? ([] as PromiseSettledResult<void>[])
    : await Promise.allSettled(
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

  // Abandon-quiz nudge sweep — sits inside the same hourly cron so we don't
  // need to register a second Vercel schedule. Failures here are non-fatal
  // and never block the main sequence response.
  let abandon: { sent: number; suppressed: number; failed: number } = {
    sent: 0,
    suppressed: 0,
    failed: 0,
  };
  try {
    abandon = await processAbandonNudges();
  } catch (err) {
    console.error("[email/process] abandon nudge sweep failed:", err);
  }

  console.log(
    `[email/process] processed=${results.length} failed=${failed.length} abandon_sent=${abandon.sent} abandon_suppressed=${abandon.suppressed} abandon_failed=${abandon.failed}`
  );

  return NextResponse.json({
    ok: true,
    processed: results.length,
    failed: failed.length,
    abandon,
  });
}
