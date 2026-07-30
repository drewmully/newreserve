/**
 * POST /api/admin/events/replay
 *
 * Re-runs identity resolution for events already in the log, from the stored
 * payload. Nothing is re-fetched from a provider and nothing is re-sent to a
 * customer — replay only re-reads what we already captured.
 *
 * Body is one of:
 *   { "id": 1234 }
 *   { "ids": [1234, 1235] }
 *   { "event_name": "order.paid", "since": "...", "until": "...", "limit": 100 }
 *
 * A row whose payload has been purged by the retention cron cannot be replayed:
 * there is nothing left to resolve from. Those are reported as `skipped` with
 * the purge timestamp rather than being silently counted as successes.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { processInboundEvent } from "@/lib/events/ingest";
import { isCanonicalEvent, type EventName, type EventSource } from "@/lib/events/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BATCH = 200;

interface ReplayBody {
  id?: number;
  ids?: number[];
  event_name?: string;
  since?: string;
  until?: string;
  limit?: number;
}

interface EventRow {
  id: number;
  source: string;
  event_name: string;
  payload: unknown;
  payload_purged_at: string | null;
  received_at: string;
}

interface ReplayOutcome {
  id: number;
  event_name: string;
  status: "replayed" | "skipped";
  resolution?: string;
  customer_id?: string | null;
  reason?: string;
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  let body: ReplayBody;
  try {
    body = (await request.json()) as ReplayBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const sb = getSupabaseService();
  const select = "id,source,event_name,payload,payload_purged_at,received_at";

  const explicitIds = body.ids ?? (typeof body.id === "number" ? [body.id] : null);

  let rows: EventRow[];
  if (explicitIds) {
    if (explicitIds.length === 0) {
      return NextResponse.json({ error: "no_ids_supplied" }, { status: 400 });
    }
    if (explicitIds.length > MAX_BATCH) {
      return NextResponse.json(
        { error: "too_many_ids", detail: `Replay at most ${MAX_BATCH} ids per call.` },
        { status: 400 },
      );
    }
    const { data, error } = await sb.from("inbound_event").select(select).in("id", explicitIds);
    if (error) {
      return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 500 });
    }
    rows = (data ?? []) as EventRow[];
  } else if (body.event_name) {
    if (!isCanonicalEvent(body.event_name)) {
      return NextResponse.json(
        { error: "unknown_event_name", detail: `${body.event_name} is not in the canonical catalog.` },
        { status: 400 },
      );
    }
    const limit = Math.min(Math.max(Number(body.limit ?? 50), 1), MAX_BATCH);
    let query = sb
      .from("inbound_event")
      .select(select)
      .eq("event_name", body.event_name)
      .order("received_at", { ascending: false })
      .limit(limit);
    if (body.since) query = query.gte("received_at", body.since);
    if (body.until) query = query.lte("received_at", body.until);

    const { data, error } = await query;
    if (error) {
      return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 500 });
    }
    rows = (data ?? []) as EventRow[];
  } else {
    return NextResponse.json(
      { error: "no_selector", detail: "Supply `id`, `ids`, or `event_name` (optionally with `since`/`until`)." },
      { status: 400 },
    );
  }

  const outcomes: ReplayOutcome[] = [];

  for (const row of rows) {
    if (row.payload === null || row.payload_purged_at !== null) {
      outcomes.push({
        id: row.id,
        event_name: row.event_name,
        status: "skipped",
        reason:
          row.payload_purged_at !== null
            ? `Payload was purged at ${row.payload_purged_at} by the 90-day retention cron; there is nothing left to replay from.`
            : "Row has no stored payload — it was recorded without a parseable body.",
      });
      continue;
    }

    const processed = await processInboundEvent(
      {
        id: row.id,
        source: row.source as EventSource,
        eventName: row.event_name as EventName,
        payload: row.payload,
      },
      sb,
    );

    outcomes.push({
      id: row.id,
      event_name: row.event_name,
      status: "replayed",
      resolution: processed.resolution,
      customer_id: processed.customerId,
    });
  }

  const missing = explicitIds
    ? explicitIds.filter((id) => !rows.some((row) => row.id === id))
    : [];

  return NextResponse.json({
    requested: explicitIds ? explicitIds.length : rows.length,
    replayed: outcomes.filter((o) => o.status === "replayed").length,
    skipped: outcomes.filter((o) => o.status === "skipped").length,
    not_found: missing,
    outcomes,
  });
}
