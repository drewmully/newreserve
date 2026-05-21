/**
 * POST /api/admin/ops/goals
 *
 * Body: { brand, kpi_slug, goal_value, owner_email?, goal_label?, notes?, effective_from? }
 *
 * Upserts a goal row. Idempotent on (brand, kpi_slug, effective_from).
 * Default effective_from = today.
 *
 * Auth: admin allowlist.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";

type Body = {
  brand?: string;
  kpi_slug?: string;
  goal_value?: number | string | null;
  goal_label?: string | null;
  owner_email?: string | null;
  notes?: string | null;
  effective_from?: string | null;
  effective_to?: string | null;
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
  if (!body.brand || !body.kpi_slug) {
    return NextResponse.json({ error: "brand + kpi_slug required" }, { status: 400 });
  }
  if (!["mully", "mfs"].includes(body.brand)) {
    return NextResponse.json({ error: "bad brand" }, { status: 400 });
  }
  const effective_from = body.effective_from || new Date().toISOString().slice(0, 10);

  const svc = getSupabaseService();
  const { error, data } = await svc
    .from("metric_goals")
    .upsert(
      {
        brand: body.brand,
        kpi_slug: body.kpi_slug,
        goal_value: body.goal_value == null ? null : Number(body.goal_value),
        goal_label: body.goal_label || null,
        owner_email: body.owner_email || null,
        notes: body.notes || null,
        effective_from,
        effective_to: body.effective_to || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "brand,kpi_slug,effective_from" },
    )
    .select()
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true, goal: data });
}
