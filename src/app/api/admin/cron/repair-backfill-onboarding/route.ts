/**
 * GET /api/admin/cron/repair-backfill-onboarding
 *
 * One-time repair for the regression introduced by the first run of
 * /api/admin/cron/loop-firebase-backfill: users provisioned from an already
 * active Loop membership were incorrectly created with
 * `onboarding_completed: false`. On login, /login/page.tsx routes anyone
 * with that flag to /onboarding — a full new-member signup / Shopify
 * checkout flow — which for long-tenured paying members reads as
 * "the site broke and won't let me log in."
 *
 * This endpoint walks the Firestore `users` collection, finds every doc
 * with:
 *   - provisioned_from == "loop_firebase_backfill"
 *   - onboarding_completed == false
 * ... and flips onboarding_completed to true. Paginated so it can safely
 * run under the Vercel timeout on projects of any size.
 *
 * Idempotent: re-running does nothing on already-flipped docs.
 *
 * Auth: CRON_SECRET Bearer.
 *
 * Query params (all optional):
 *   ?limit=500       Process at most N docs this invocation. Default 500,
 *                    max 1000. Firestore batched writes cap at 500.
 *   ?cursor=<uid>    Resume after the given uid (exclusive). The response
 *                    returns `next_cursor` for the caller to pass on the
 *                    next invocation. Loop until null.
 *   ?dry_run=1       Report what would be flipped without writing.
 *   ?source=<value>  Restrict to a specific `provisioned_from` value.
 *                    Default: "loop_firebase_backfill".
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

export const runtime = "nodejs";
export const maxDuration = 800;

const DEFAULT_LIMIT = 500;
const MAX_LIMIT = 1000;
const MAX_ERROR_SAMPLES = 10;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const limit = Math.min(
    Number(url.searchParams.get("limit")) || DEFAULT_LIMIT,
    MAX_LIMIT
  );
  const cursor = url.searchParams.get("cursor") ?? null;
  const dryRun = url.searchParams.get("dry_run") === "1";
  const provisionedFrom =
    url.searchParams.get("source") ?? "loop_firebase_backfill";

  const counters = {
    scanned: 0,
    would_flip: 0,
    flipped: 0,
    skipped_already_true: 0,
    errored: 0,
  };
  const sampleErrors: Array<{ uid: string; error: string }> = [];
  const sampleFlipped: string[] = [];

  try {
    // Order by document id so we can page deterministically with a cursor.
    let query = adminDb
      .collection("users")
      .where("provisioned_from", "==", provisionedFrom)
      .where("onboarding_completed", "==", false)
      .orderBy("__name__")
      .limit(limit);

    if (cursor) {
      query = query.startAfter(cursor);
    }

    const snap = await query.get();
    counters.scanned = snap.size;

    let lastUid: string | null = null;

    if (dryRun) {
      counters.would_flip = snap.size;
      for (const doc of snap.docs) {
        lastUid = doc.id;
        if (sampleFlipped.length < 10) sampleFlipped.push(doc.id);
      }
    } else {
      // Batched writes: Firestore caps a batch at 500 ops.
      let batch = adminDb.batch();
      let inBatch = 0;
      const flush = async () => {
        if (inBatch === 0) return;
        await batch.commit();
        batch = adminDb.batch();
        inBatch = 0;
      };

      for (const doc of snap.docs) {
        lastUid = doc.id;
        try {
          batch.update(doc.ref, {
            onboarding_completed: true,
            onboarding_repaired_at: FieldValue.serverTimestamp(),
          });
          inBatch += 1;
          counters.flipped += 1;
          if (sampleFlipped.length < 10) sampleFlipped.push(doc.id);
          if (inBatch >= 400) {
            await flush();
          }
        } catch (err) {
          counters.errored += 1;
          if (sampleErrors.length < MAX_ERROR_SAMPLES) {
            sampleErrors.push({
              uid: doc.id,
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
      await flush();
    }

    // If we hit the page limit, hand back a cursor for the next call.
    const nextCursor = snap.size === limit ? lastUid : null;

    return NextResponse.json({
      cron: "repair-backfill-onboarding",
      dry_run: dryRun,
      provisioned_from: provisionedFrom,
      counters,
      sample_flipped: sampleFlipped,
      sample_errors: sampleErrors,
      next_cursor: nextCursor,
    });
  } catch (err) {
    console.error("[repair-backfill-onboarding] fatal:", err);
    return NextResponse.json(
      {
        error: "Internal error",
        detail: err instanceof Error ? err.message : String(err),
        counters,
        sample_errors: sampleErrors,
      },
      { status: 500 }
    );
  }
}
