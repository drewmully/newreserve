/**
 * POST /api/admin/ops/manual
 *
 * Body: {
 *   brand: "mully"|"mfs",
 *   category: string,        // matches what the rollup expects, e.g.
 *                            //   "cs_volume", "marketing_spend", "fulfillment_labor",
 *                            //   "pipeline_landed", "5s_score"
 *   entry_date: "YYYY-MM-DD",
 *   value_numeric?: number,
 *   value_text?: string,
 *   channel?: string,
 *   note?: string,
 * }
 *
 * Inserts a `manual_entries` row. The weekly rollup picks these up during
 * the next Sun 14:00 ET run.
 *
 * Auth: admin allowlist.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";

type Body = {
  brand?: string;
  category?: string;
  channel?: string | null;
  entry_date?: string;
  value_numeric?: number | string | null;
  value_text?: string | null;
  note?: string | null;
};

export async function POST(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: "bad json" }, { status: 400 });
  }
  if (!body.brand || !body.category || !body.entry_date) {
    return NextResponse.json(
      { error: "brand + category + entry_date required" },
      { status: 400 },
    );
  }
  if (!["mully", "mfs"].includes(body.brand)) {
    return NextResponse.json({ error: "bad brand" }, { status: 400 });
  }

  const svc = getSupabaseService();
  const { data, error } = await svc
    .from("manual_entries")
    .insert({
      brand: body.brand,
      category: body.category,
      channel: body.channel || null,
      entry_date: body.entry_date,
      value_numeric: body.value_numeric == null ? null : Number(body.value_numeric),
      value_text: body.value_text || null,
      note: body.note || null,
      entered_by: guard.email,
    })
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, entry: data });
}

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const brand = url.searchParams.get("brand");
  const category = url.searchParams.get("category");
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") || "50")));

  const svc = getSupabaseService();
  let qb = svc.from("manual_entries").select("*").order("entry_date", { ascending: false }).limit(limit);
  if (brand) qb = qb.eq("brand", brand);
  if (category) qb = qb.eq("category", category);
  const { data, error } = await qb;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ entries: data || [] });
}
