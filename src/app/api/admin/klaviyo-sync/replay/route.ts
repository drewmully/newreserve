/**
 * POST /api/admin/klaviyo-sync/replay
 *
 * Re-sync one doc to Klaviyo now, ignoring backoff. Body:
 *   { collection: "shop_marketing_leads" | "editorial_drop_list" |
 *                 "back_in_stock_requests" | "klaviyo_sync_jobs",
 *     id: string, stages?: string[] }
 * `stages` forces those stages even if already synced (events stay deduped
 * by unique_id). Auth: Bearer CRON_SECRET. Requires KLAVIYO_SYNC_ENABLED.
 */

import { NextResponse } from "next/server";
import { isKlaviyoSyncEnabled, isSyncCollection } from "@/lib/klaviyo/config";
import { syncDoc } from "@/lib/klaviyo/syncState";
import { isCronAuthorized } from "@/lib/klaviyo/worker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

export async function POST(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  if (!isKlaviyoSyncEnabled()) return NextResponse.json({ error: "disabled" }, { status: 409 });
  let body: { collection?: unknown; id?: unknown; stages?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  if (!isSyncCollection(body.collection) || typeof body.id !== "string" || !body.id) {
    return NextResponse.json({ error: "invalid_request" }, { status: 400 });
  }
  const stages = Array.isArray(body.stages) ? body.stages.filter((s): s is string => typeof s === "string") : [];
  const outcome = await syncDoc(body.collection, body.id, { forceStages: stages });
  return NextResponse.json({ ok: outcome.status === "synced", ...outcome });
}
