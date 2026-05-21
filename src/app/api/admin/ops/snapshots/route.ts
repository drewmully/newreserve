/**
 * GET /api/admin/ops/snapshots?brand=mully&weeks=8
 *
 * Returns the weekly KPI grid for a brand:
 *   {
 *     defs: [{ slug, title, unit, sort_order }, ...],
 *     weeks: ["2026-05-11", "2026-05-04", ...],   // most-recent first
 *     snapshots: { [slug]: { [weekStart]: { value, prev, goal, meta } } },
 *     goals: [{ slug, goal_value, owner_email, effective_from }, ...]
 *   }
 *
 * Auth: admin allowlist.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/app/api/_lib/adminAuth";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const guard = await requireAdmin(req);
  if (!guard.ok) return guard.response;

  const url = new URL(req.url);
  const brand = url.searchParams.get("brand") === "mfs" ? "mfs" : "mully";
  const weeks = Math.min(26, Math.max(1, Number(url.searchParams.get("weeks") || "8")));

  const svc = getSupabaseService();
  const [{ data: defs }, { data: snaps }, { data: goals }] = await Promise.all([
    svc
      .from("dashboard_kpi_defs")
      .select("slug,title,unit,sort_order,description")
      .eq("entity_scope", brand)
      .eq("is_active", true)
      .order("sort_order"),
    svc
      .from("weekly_kpi_snapshots")
      .select("kpi_slug,week_start_date,value_numeric,prev_value,goal_value,computation_meta")
      .eq("brand", brand)
      .order("week_start_date", { ascending: false })
      .limit(weeks * 30), // 30 KPIs max per brand
    svc
      .from("metric_goals")
      .select("kpi_slug,goal_value,goal_label,owner_email,effective_from,effective_to,notes")
      .eq("brand", brand)
      .order("effective_from", { ascending: false }),
  ]);

  const weekSet = new Set<string>();
  for (const s of snaps || []) weekSet.add(s.week_start_date);
  const weekList = [...weekSet].sort().reverse().slice(0, weeks);

  // shape: { slug: { weekISO: row } }
  const grid: Record<string, Record<string, unknown>> = {};
  for (const s of snaps || []) {
    if (!weekList.includes(s.week_start_date)) continue;
    grid[s.kpi_slug] = grid[s.kpi_slug] || {};
    grid[s.kpi_slug][s.week_start_date] = {
      value: s.value_numeric,
      prev: s.prev_value,
      goal: s.goal_value,
      meta: s.computation_meta,
    };
  }

  return NextResponse.json({
    brand,
    defs: defs || [],
    weeks: weekList,
    snapshots: grid,
    goals: goals || [],
  });
}
