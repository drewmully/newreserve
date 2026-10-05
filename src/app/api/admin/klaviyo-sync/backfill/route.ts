/**
 * POST /api/admin/klaviyo-sync/backfill
 *
 * Runs the pre-release signup backfill (see src/lib/klaviyo/backfill.ts).
 * Dry-run unless the body is { "apply": true }. Runs server-side so the
 * Klaviyo key never leaves Vercel. Auth: Bearer CRON_SECRET. Counts only.
 * Normally invoked by scripts/klaviyo-backfill-signups.ts.
 */

import { NextResponse } from "next/server";
import { isKlaviyoSyncEnabled } from "@/lib/klaviyo/config";
import { runSignupBackfill } from "@/lib/klaviyo/backfill";
import { isCronAuthorized } from "@/lib/klaviyo/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  let body: { apply?: unknown } = {};
  try {
    body = await req.json();
  } catch {
    /* empty body = dry run */
  }
  const apply = body.apply === true;
  if (apply && !isKlaviyoSyncEnabled()) return NextResponse.json({ error: "disabled" }, { status: 409 });
  try {
    return NextResponse.json({ ok: true, ...(await runSignupBackfill({ apply })) });
  } catch {
    console.error("[klaviyo-backfill] failed");
    return NextResponse.json({ ok: false, error: "backfill_failed" }, { status: 500 });
  }
}
