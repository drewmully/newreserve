/**
 * GET /api/admin/cron/loop-firebase-backfill
 *
 * One-time (and re-runnable) backfill: walks every ACTIVE Loop subscriber
 * from the `subscribers` Supabase table and ensures they have a matching
 * Firebase Auth user + Firestore profile via provisionPaidMemberFromLoop.
 *
 * This closes the gap for legacy Mullybox / Back 9 members whose Loop
 * subscription predates Firebase Auth adoption — without this backfill
 * they would only get provisioned the next time they submit their email
 * on the homepage.
 *
 * Auth: CRON_SECRET Bearer.
 *
 * Query params (all optional):
 *   ?limit=250       Process at most N subscribers this invocation.
 *                    Default 250. Keep this well under Vercel's 800s cap.
 *   ?cursor=<email>  Resume after the given email (exclusive). The response
 *                    always returns `next_cursor` for the caller to pass on
 *                    the next invocation. Loop through until it's null.
 *   ?dry_run=1       Skip all writes and email sends — useful for a first
 *                    pass to see how many rows would be touched.
 *   ?send_email=0    Skip the "Unlock your Mully account" magic-link email.
 *                    Firestore + Firebase Auth writes still happen. Useful
 *                    when you want to backfill data quietly and re-run with
 *                    send_email=1 once you're ready to notify people.
 *   ?resend=1        Re-send the magic-link email even to users who already
 *                    have magic_link_sent_at set (e.g. after fixing a bad
 *                    prior send).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import {
  provisionPaidMemberFromLoop,
  type ProvisionResult,
} from "@/app/api/_lib/provisionPaidMember";

export const runtime = "nodejs";
export const maxDuration = 800;

const DEFAULT_LIMIT = 250;
const MAX_LIMIT = 1000;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

type ResultBucket =
  | "provisioned_new"
  | "already_had_firebase_user"
  | "not_paid"
  | "errored"
  | "skipped_no_email"
  | "dry_run_would_process";

function bucketFor(res: ProvisionResult): ResultBucket {
  if (res.status === "error") return "errored";
  if (res.status === "not_paid") return "not_paid";
  return res.isNewFirebaseUser ? "provisioned_new" : "already_had_firebase_user";
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, Number(url.searchParams.get("limit")) || DEFAULT_LIMIT)
  );
  const cursor = url.searchParams.get("cursor") ?? null;
  const dryRun = url.searchParams.get("dry_run") === "1";
  const skipEmail = url.searchParams.get("send_email") === "0";
  const forceResend = url.searchParams.get("resend") === "1";

  const sb = getSupabaseService();

  // Pull one page of active subscribers, ordered by email so the cursor is
  // stable across invocations.
  let query = sb
    .from("subscribers")
    .select("email")
    .eq("status", "active")
    .not("email", "is", null)
    .order("email", { ascending: true })
    .limit(limit);

  if (cursor) {
    query = query.gt("email", cursor);
  }

  const { data, error } = await query;
  if (error) {
    console.error("[loop-firebase-backfill] supabase query failed:", error);
    return NextResponse.json(
      { error: `Supabase query failed: ${error.message}` },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as Array<{ email: string | null }>;

  const counters: Record<ResultBucket, number> = {
    provisioned_new: 0,
    already_had_firebase_user: 0,
    not_paid: 0,
    errored: 0,
    skipped_no_email: 0,
    dry_run_would_process: 0,
  };

  // Collect a few sample errors for the response — don't spam the JSON with
  // thousands of rows on a large run.
  const sampleErrors: Array<{ email: string; error: string }> = [];
  const MAX_ERROR_SAMPLES = 10;

  let lastEmail: string | null = cursor;

  for (const row of rows) {
    const email = row.email?.trim().toLowerCase();
    if (!email) {
      counters.skipped_no_email += 1;
      continue;
    }
    lastEmail = email;

    if (dryRun) {
      counters.dry_run_would_process += 1;
      continue;
    }

    try {
      const result = await provisionPaidMemberFromLoop(email, {
        source: "loop_firebase_backfill",
        skipMagicLink: skipEmail,
        forceResendMagicLink: forceResend,
      });
      counters[bucketFor(result)] += 1;
      if (result.status === "error" && sampleErrors.length < MAX_ERROR_SAMPLES) {
        sampleErrors.push({ email, error: result.error });
      }
    } catch (err) {
      counters.errored += 1;
      const message = err instanceof Error ? err.message : String(err);
      if (sampleErrors.length < MAX_ERROR_SAMPLES) {
        sampleErrors.push({ email, error: message });
      }
      console.error(
        "[loop-firebase-backfill] provision failed for",
        email,
        err
      );
    }
  }

  // If we returned a full page, there's likely more — hand back a cursor.
  const nextCursor = rows.length === limit ? lastEmail : null;

  return NextResponse.json({
    cron: "loop-firebase-backfill",
    dry_run: dryRun,
    skip_email: skipEmail,
    force_resend: forceResend,
    processed: rows.length,
    counters,
    next_cursor: nextCursor,
    sample_errors: sampleErrors,
  });
}
