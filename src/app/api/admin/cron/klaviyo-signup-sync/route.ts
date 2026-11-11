/**
 * GET /api/admin/cron/klaviyo-signup-sync
 *
 * Retry worker for the Klaviyo signup sync. Every 5 minutes it drains docs
 * left `not_synced` or `failed` (whose nextAttemptAt has passed) across
 * shop_marketing_leads, editorial_drop_list, back_in_stock_requests and
 * klaviyo_sync_jobs. Backoff: 1, 5, 15, 30, 60, 120, 240, 480 minutes; after
 * 8 attempts a doc is marked `dead` and a klaviyo_sync_failed alert fires.
 *
 * Before draining, it queues new Meta offer sign-ups (codes created by the
 * Facebook & Instagram app) into meta_offer_leads; see lib/klaviyo/metaOffers.
 * A failure there never blocks the drain.
 *
 * When Take a Shot is on, it also retries pending game codes in Shopify,
 * claims abandoned games and deletes replaced codes (lib/takeAShot), so
 * activated codes are drained in the same run. Also never blocks the drain.
 *
 * Auth: Bearer CRON_SECRET. Exits early when KLAVIYO_SYNC_ENABLED !== "true".
 * Returns counts only.
 */

import { NextResponse } from "next/server";
import { isKlaviyoSyncEnabled } from "@/lib/klaviyo/config";
import { drainSyncQueue, isCronAuthorized } from "@/lib/klaviyo/worker";
import { collectMetaOfferSignups, type CollectSummary } from "@/lib/klaviyo/metaOffers";
import { isTakeAShotServerEnabled } from "@/lib/takeAShot/config";
import { takeAShotService } from "@/lib/takeAShot/firestoreStore";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isKlaviyoSyncEnabled()) return NextResponse.json({ ok: true, skipped: true, reason: "disabled" });
  let metaOffers: CollectSummary | { error: string } | null = null;
  try {
    metaOffers = await collectMetaOfferSignups();
  } catch (err) {
    const detail = (err instanceof Error ? err.message : String(err)).slice(0, 500);
    console.error("[klaviyo-signup-sync] meta offer collection failed", detail);
    metaOffers = { error: "meta_offers_failed" };
  }
  let takeAShot: Record<string, number> | { error: string } | null = null;
  const tasStarted = Date.now();
  if (isTakeAShotServerEnabled()) {
    try {
      takeAShot = await takeAShotService().maintain({ deadlineMs: tasStarted + 15_000 });
    } catch {
      console.error("[klaviyo-signup-sync] take a shot maintenance failed");
      takeAShot = { error: "take_a_shot_failed" };
    }
  }
  try {
    const drainMs = Math.max(20_000, 50_000 - (Date.now() - tasStarted));
    const summary = await drainSyncQueue({ deadlineMs: Date.now() + drainMs });
    return NextResponse.json({ ok: true, metaOffers, takeAShot, ...summary });
  } catch {
    console.error("[klaviyo-signup-sync] drain failed");
    return NextResponse.json({ ok: false, error: "drain_failed" }, { status: 500 });
  }
}
