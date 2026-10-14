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
 * Auth: Bearer CRON_SECRET. Exits early when KLAVIYO_SYNC_ENABLED !== "true".
 * Returns counts only.
 */

import { NextResponse } from "next/server";
import { isKlaviyoSyncEnabled } from "@/lib/klaviyo/config";
import { drainSyncQueue, isCronAuthorized } from "@/lib/klaviyo/worker";
import { collectMetaOfferSignups, type CollectSummary } from "@/lib/klaviyo/metaOffers";

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
  try {
    const summary = await drainSyncQueue({ deadlineMs: Date.now() + 50_000 });
    return NextResponse.json({ ok: true, metaOffers, ...summary });
  } catch {
    console.error("[klaviyo-signup-sync] drain failed");
    return NextResponse.json({ ok: false, error: "drain_failed" }, { status: 500 });
  }
}
