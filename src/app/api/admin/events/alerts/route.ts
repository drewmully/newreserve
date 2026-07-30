/**
 * GET  /api/admin/events/alerts[?all=1&kind=…&limit=…]
 * POST /api/admin/events/alerts   { "ids": [1,2,3] }  → acknowledge
 *
 * Slack delivery is best-effort, so it cannot be the only way an operator sees
 * an alert. The row in public.backbone_alert is the durable record; this route
 * is the channel-independent way to read it.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const SELECT =
  "id,created_at,kind,severity,customer_id,inbound_event_id,summary,detail,acknowledged_at,delivered_at,delivery_error";

export async function GET(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  const params = request.nextUrl.searchParams;
  const includeAcknowledged = params.get("all") === "1";
  const kind = params.get("kind");
  const limit = Math.min(Math.max(Number(params.get("limit") ?? 100), 1), 500);

  const sb = getSupabaseService();

  let query = sb
    .from("backbone_alert")
    .select(SELECT)
    .order("created_at", { ascending: false })
    .limit(limit);
  if (!includeAcknowledged) query = query.is("acknowledged_at", null);
  if (kind) query = query.eq("kind", kind);

  const { data, error } = await query;
  if (error) {
    return NextResponse.json({ error: "query_failed", detail: error.message }, { status: 500 });
  }

  const rows = (data ?? []) as { severity: string | null; delivery_error: string | null }[];

  return NextResponse.json({
    count: rows.length,
    unacknowledged_only: !includeAcknowledged,
    undelivered_count: rows.filter((row) => row.delivery_error !== null).length,
    by_severity: rows.reduce<Record<string, number>>((acc, row) => {
      const key = row.severity ?? "unknown";
      acc[key] = (acc[key] ?? 0) + 1;
      return acc;
    }, {}),
    rows: data ?? [],
  });
}

export async function POST(request: NextRequest) {
  const guard = await requireAdmin(request);
  if (!guard.ok) return guard.response;

  let body: { ids?: number[] };
  try {
    body = (await request.json()) as { ids?: number[] };
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const ids = body.ids ?? [];
  if (ids.length === 0) {
    return NextResponse.json({ error: "no_ids_supplied" }, { status: 400 });
  }

  const sb = getSupabaseService();
  const { data, error } = await sb
    .from("backbone_alert")
    .update({ acknowledged_at: new Date().toISOString() })
    .in("id", ids)
    .is("acknowledged_at", null)
    .select("id");

  if (error) {
    return NextResponse.json({ error: "acknowledge_failed", detail: error.message }, { status: 500 });
  }

  return NextResponse.json({
    acknowledged: (data ?? []).length,
    ids: ((data ?? []) as { id: number }[]).map((row) => row.id),
  });
}
