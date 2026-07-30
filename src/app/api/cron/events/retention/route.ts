/**
 * GET /api/cron/events/retention
 *
 * Nightly payload purge. Raw provider payloads older than 90 days are set to
 * NULL and stamped with `payload_purged_at`; the metadata row itself is kept
 * forever, which is why `payload_bytes` is recorded at insert — the volume
 * history survives the purge.
 *
 * Batched, because a single unbounded UPDATE over the whole table would be the
 * one statement in this build capable of causing an incident.
 *
 * A purged row can no longer be replayed. /api/admin/events/replay says so
 * explicitly rather than reporting a silent success.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService, withJobRun } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const RETENTION_DAYS = 90;
const BATCH_SIZE = 500;
const MAX_BATCHES = 40;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return (req.headers.get("user-agent") || "").includes("vercel-cron");
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const cutoff = new Date(Date.now() - RETENTION_DAYS * 86400_000).toISOString();

  const run = await withJobRun("events-retention", async ({ bumpRows, setWatermark, setMeta }) => {
    const sb = getSupabaseService();
    let purged = 0;
    let batches = 0;
    let exhausted = true;

    for (batches = 0; batches < MAX_BATCHES; batches++) {
      const { data: candidates, error: selectError } = await sb
        .from("inbound_event")
        .select("id")
        .lt("received_at", cutoff)
        .not("payload", "is", null)
        .order("id", { ascending: true })
        .limit(BATCH_SIZE);

      if (selectError) throw new Error(`retention select failed: ${selectError.message}`);

      const ids = ((candidates ?? []) as { id: number }[]).map((row) => row.id);
      if (ids.length === 0) break;

      const { data: updated, error: updateError } = await sb
        .from("inbound_event")
        .update({ payload: null, payload_purged_at: new Date().toISOString() })
        .in("id", ids)
        .select("id");

      if (updateError) throw new Error(`retention purge failed: ${updateError.message}`);

      purged += (updated ?? []).length;

      if (ids.length < BATCH_SIZE) break;
      if (batches === MAX_BATCHES - 1) exhausted = false;
    }

    bumpRows(purged, purged);
    setWatermark(cutoff);
    setMeta({ retention_days: RETENTION_DAYS, purged, batches, exhausted });

    return {
      retention_days: RETENTION_DAYS,
      cutoff,
      rows_purged: purged,
      batches,
      /** False means MAX_BATCHES was hit and there is still a backlog for tomorrow. */
      exhausted,
    };
  });

  return NextResponse.json(run, { status: run.ok ? 200 : 500 });
}
