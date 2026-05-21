/**
 * GET /api/admin/cron/weekly-rollup
 *
 * Orchestrator. Computes all 21 KPIs for a single ISO week
 * (Mon → Sun) and upserts rows into `weekly_kpi_snapshots`.
 *
 * Designed to run Sundays 14:00 ET (18:00 UTC) AFTER all upstream
 * ingestors (Junip, ShipHero, Plaid, traffic, marketing spend,
 * subscribers-rebuild) have completed for the week.
 *
 * Source of truth for each KPI:
 *
 *   mully_active_subs_reserve_member      subscribers (live)
 *   mully_active_subs_reserve_access      subscribers (live)
 *   mully_active_subs_back9_legacy        subscribers (live)
 *   mully_new_subs_pct_wow                subscribers (acquired_at)
 *   mully_churned_subs_pct_wow            subscribers (churned_at)
 *   mully_legacy_converted_pct            subscribers (back9_legacy → reserve_*)
 *   mully_order_to_ship_p50               orders (fulfilled_at - created_at, p50 hrs)
 *   mully_net_cash_change                 gsheet_cash_pulls (EOB Fri delta)
 *   mully_marketing_spend_total           marketing_spend_daily + manual_entries
 *   mully_cs_volume                       manual_entries  (channel='cs')
 *   mully_junip_avg_rating                junip_snapshots (latest in week)
 *   mully_visitors                        traffic_pulls (sum source='ga4'|'posthog')
 *   mully_site_to_account_pct             traffic_pulls (accounts / visitors)
 *   mully_account_to_purchase_pct         traffic_pulls (purchases / accounts)
 *
 *   mfs_shiphero_orders                   shiphero_snapshots
 *   mfs_shiphero_net_sales                shiphero_snapshots
 *   mfs_shiphero_special_project_hours    shiphero_snapshots
 *   mfs_fulfillment_labor                 manual_entries (category='fulfillment_labor')
 *   mfs_cash_change                       gsheet_cash_pulls (MFS rows) or manual
 *   mfs_pipeline_landed                   manual_entries (category='pipeline_landed')
 *   mfs_5s_score                          manual_entries (category='5s_score')
 *
 * Idempotent: each KPI upserts on (brand, kpi_slug, week_start_date).
 * Re-running for the same week overwrites. Each row includes
 * computation_meta with the inputs used.
 *
 * Query params:
 *   ?week=YYYY-MM-DD   Force a week_start_date (must be Monday).
 *                      Default: most recent completed Mon→Sun
 *                      relative to "now in America/Detroit".
 *
 * Auth: CRON_SECRET Bearer (or Vercel-Cron User-Agent).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService, withJobRun } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";
export const maxDuration = 300;

// ───────────────────────────────────────────────────── auth
function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  // Vercel Cron uses a special UA on managed crons.
  const ua = req.headers.get("user-agent") || "";
  return ua.includes("vercel-cron");
}

// ───────────────────────────────────────────────────── week math
type Week = { startISO: string; endISO: string; prevStartISO: string; prevEndISO: string };

/**
 * Return the Monday→Sunday window that just COMPLETED relative to `now`
 * interpreted in America/Detroit. The rollup runs Sun 14:00 ET, so the
 * "default" window is the week containing yesterday (Mon..today=Sun).
 */
function defaultWeek(now: Date = new Date()): Week {
  // Convert "now" into a Detroit-local YYYY-MM-DD without time.
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Detroit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  const detroitYMD = fmt.format(now); // "YYYY-MM-DD"
  return weekFromMondayOf(detroitYMD);
}

/**
 * Given any YYYY-MM-DD, return the ISO-week Mon..Sun containing it.
 * If the given date is a Sunday, the week is Mon-of-prior-6-days..thatSunday.
 */
function weekFromMondayOf(ymd: string): Week {
  const d = new Date(`${ymd}T00:00:00Z`);
  const dow = d.getUTCDay(); // 0=Sun,1=Mon,...6=Sat
  // Days to subtract to reach Monday (Mon=0, Sun=6).
  const offsetToMon = (dow + 6) % 7;
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() - offsetToMon);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const prevMon = new Date(mon);
  prevMon.setUTCDate(mon.getUTCDate() - 7);
  const prevSun = new Date(prevMon);
  prevSun.setUTCDate(prevMon.getUTCDate() + 6);
  return {
    startISO: mon.toISOString().slice(0, 10),
    endISO: sun.toISOString().slice(0, 10),
    prevStartISO: prevMon.toISOString().slice(0, 10),
    prevEndISO: prevSun.toISOString().slice(0, 10),
  };
}

// ───────────────────────────────────────────────────── snapshot writer
type SnapRow = {
  brand: "mully" | "mfs";
  kpi_slug: string;
  week_start_date: string;
  value_numeric: number | null;
  value_text?: string | null;
  source: string;
  computation_meta?: Record<string, unknown>;
};

async function writeSnap(rows: SnapRow[]) {
  if (rows.length === 0) return;
  const svc = getSupabaseService();
  // Hydrate prev_value & goal_value at write time.
  const prevWeek = weekFromMondayOf(rows[0].week_start_date).prevStartISO;
  const slugs = [...new Set(rows.map((r) => r.kpi_slug))];
  const brands = [...new Set(rows.map((r) => r.brand))];

  const { data: prevs } = await svc
    .from("weekly_kpi_snapshots")
    .select("brand,kpi_slug,value_numeric")
    .eq("week_start_date", prevWeek)
    .in("brand", brands)
    .in("kpi_slug", slugs);
  const prevMap = new Map<string, number | null>();
  for (const p of prevs || []) {
    prevMap.set(`${p.brand}::${p.kpi_slug}`, p.value_numeric);
  }

  const { data: goals } = await svc
    .from("metric_goals")
    .select("brand,kpi_slug,goal_value,effective_from,effective_to")
    .in("brand", brands)
    .in("kpi_slug", slugs);
  const goalMap = new Map<string, number | null>();
  for (const g of goals || []) {
    const wk = rows[0].week_start_date;
    if (g.effective_from && g.effective_from > wk) continue;
    if (g.effective_to && g.effective_to < wk) continue;
    goalMap.set(`${g.brand}::${g.kpi_slug}`, g.goal_value);
  }

  const hydrated = rows.map((r) => ({
    ...r,
    prev_value: prevMap.get(`${r.brand}::${r.kpi_slug}`) ?? null,
    goal_value: goalMap.get(`${r.brand}::${r.kpi_slug}`) ?? null,
    computed_at: new Date().toISOString(),
  }));

  const { error } = await svc
    .from("weekly_kpi_snapshots")
    .upsert(hydrated, { onConflict: "brand,kpi_slug,week_start_date" });
  if (error) throw new Error(`upsert snapshots: ${error.message}`);
}

// ───────────────────────────────────────────────────── computations
async function computeSubsKPIs(week: Week): Promise<SnapRow[]> {
  const svc = getSupabaseService();
  const out: SnapRow[] = [];

  // Live counts by plan_code (status='active')
  const { data: live, error: liveErr } = await svc
    .from("subscribers")
    .select("plan_code,status")
    .eq("status", "active");
  if (liveErr) throw new Error(`subs live: ${liveErr.message}`);
  const counts: Record<string, number> = {};
  for (const r of live || []) {
    const k = r.plan_code || "_unknown";
    counts[k] = (counts[k] || 0) + 1;
  }
  const planSlug: Record<string, string> = {
    reserve_member: "mully_active_subs_reserve_member",
    reserve_access: "mully_active_subs_reserve_access",
    back9_legacy: "mully_active_subs_back9_legacy",
  };
  for (const [code, slug] of Object.entries(planSlug)) {
    out.push({
      brand: "mully",
      kpi_slug: slug,
      week_start_date: week.startISO,
      value_numeric: counts[code] || 0,
      source: "subscribers.plan_code",
      computation_meta: { snapshot_at: new Date().toISOString(), plan_code: code },
    });
  }

  // %WoW new and churned
  const { count: newThis } = await svc
    .from("subscribers")
    .select("customer_id", { count: "exact", head: true })
    .gte("acquired_at", week.startISO)
    .lte("acquired_at", week.endISO);
  const { count: newPrev } = await svc
    .from("subscribers")
    .select("customer_id", { count: "exact", head: true })
    .gte("acquired_at", week.prevStartISO)
    .lte("acquired_at", week.prevEndISO);
  const { count: churnThis } = await svc
    .from("subscribers")
    .select("customer_id", { count: "exact", head: true })
    .gte("churned_at", week.startISO)
    .lte("churned_at", week.endISO);
  const { count: churnPrev } = await svc
    .from("subscribers")
    .select("customer_id", { count: "exact", head: true })
    .gte("churned_at", week.prevStartISO)
    .lte("churned_at", week.prevEndISO);

  const pctWow = (cur: number, prev: number) =>
    prev > 0 ? ((cur - prev) / prev) * 100 : cur > 0 ? 100 : 0;

  out.push({
    brand: "mully",
    kpi_slug: "mully_new_subs_pct_wow",
    week_start_date: week.startISO,
    value_numeric: Number(pctWow(newThis || 0, newPrev || 0).toFixed(2)),
    source: "subscribers.acquired_at",
    computation_meta: { new_this: newThis, new_prev: newPrev },
  });
  out.push({
    brand: "mully",
    kpi_slug: "mully_churned_subs_pct_wow",
    week_start_date: week.startISO,
    value_numeric: Number(pctWow(churnThis || 0, churnPrev || 0).toFixed(2)),
    source: "subscribers.churned_at",
    computation_meta: { churn_this: churnThis, churn_prev: churnPrev },
  });

  // Legacy converted % — back9_legacy customers that flipped to reserve_*
  // during the week. We approximate using subscribers.updated_at and current
  // plan_code; a future migration can add a plan_history table for exactness.
  const { data: legacyConverts } = await svc
    .from("subscribers")
    .select("customer_id,plan_code,updated_at")
    .in("plan_code", ["reserve_member", "reserve_access"])
    .gte("updated_at", `${week.startISO}T00:00:00Z`)
    .lte("updated_at", `${week.endISO}T23:59:59Z`);
  // Population: still-legacy at start of week ≈ today's legacy count + converts.
  const legacyNow = counts["back9_legacy"] || 0;
  const converted = legacyConverts?.length || 0;
  const pop = legacyNow + converted;
  out.push({
    brand: "mully",
    kpi_slug: "mully_legacy_converted_pct",
    week_start_date: week.startISO,
    value_numeric: pop > 0 ? Number(((converted / pop) * 100).toFixed(2)) : 0,
    source: "subscribers.plan_code",
    computation_meta: { converted, pop, legacy_now: legacyNow },
  });

  return out;
}

async function computeOrderToShipP50(week: Week): Promise<SnapRow> {
  const svc = getSupabaseService();
  const { data, error } = await svc
    .from("orders")
    .select("created_at,fulfilled_at")
    .gte("created_at", `${week.startISO}T00:00:00Z`)
    .lte("created_at", `${week.endISO}T23:59:59Z`)
    .not("fulfilled_at", "is", null);
  if (error) throw new Error(`orders p50: ${error.message}`);
  const hrs = (data || [])
    .map((o) => {
      const a = new Date(o.created_at).getTime();
      const b = new Date(o.fulfilled_at as string).getTime();
      return (b - a) / 36e5;
    })
    .filter((h) => h >= 0 && Number.isFinite(h))
    .sort((a, b) => a - b);
  const p50 = hrs.length > 0 ? hrs[Math.floor(hrs.length / 2)] : null;
  return {
    brand: "mully",
    kpi_slug: "mully_order_to_ship_p50",
    week_start_date: week.startISO,
    value_numeric: p50 != null ? Number(p50.toFixed(2)) : null,
    source: "orders.fulfilled_at - created_at",
    computation_meta: { sample_size: hrs.length },
  };
}

async function computeCashChange(week: Week, brand: "mully" | "mfs"): Promise<SnapRow> {
  // Use EOB Friday entries (per Drew). week.endISO is Sunday;
  // Friday = endISO - 2 days; prevFriday = prevEndISO - 2 days.
  const friThis = addDays(week.endISO, -2);
  const friPrev = addDays(week.prevEndISO, -2);
  const svc = getSupabaseService();

  // Cash is in gsheet_cash_pulls; brand split lives in raw_row.brand if Drew
  // tags it, else default to "mully". This is best-effort until the sheet
  // schema is firmed up.
  const { data: rows } = await svc
    .from("gsheet_cash_pulls")
    .select("row_date,cash_total,raw_row")
    .in("row_date", [friThis, friPrev]);
  const pick = (date: string) => {
    const matches = (rows || []).filter((r) => r.row_date === date);
    if (matches.length === 0) return null;
    const branded = matches.filter((r) => {
      const b = (r.raw_row as Record<string, unknown> | null)?.brand;
      return typeof b === "string" ? b.toLowerCase() === brand : brand === "mully";
    });
    const picked = branded.length > 0 ? branded : brand === "mully" ? matches : [];
    if (picked.length === 0) return null;
    return picked.reduce((s, r) => s + Number(r.cash_total || 0), 0);
  };
  const cur = pick(friThis);
  const prev = pick(friPrev);
  const delta = cur != null && prev != null ? Number((cur - prev).toFixed(2)) : null;
  return {
    brand,
    kpi_slug: brand === "mully" ? "mully_net_cash_change" : "mfs_cash_change",
    week_start_date: week.startISO,
    value_numeric: delta,
    source: "gsheet_cash_pulls",
    computation_meta: { fri_this: friThis, fri_prev: friPrev, cur, prev },
  };
}

async function computeMarketingSpend(week: Week): Promise<SnapRow> {
  const svc = getSupabaseService();
  const { data: pulled } = await svc
    .from("marketing_spend_daily")
    .select("amount")
    .gte("spend_date", week.startISO)
    .lte("spend_date", week.endISO)
    .eq("brand", "mully");
  const { data: manual } = await svc
    .from("manual_entries")
    .select("value_numeric")
    .eq("brand", "mully")
    .eq("category", "marketing_spend")
    .gte("entry_date", week.startISO)
    .lte("entry_date", week.endISO);
  const sumPulled = (pulled || []).reduce((s, r) => s + Number(r.amount || 0), 0);
  const sumManual = (manual || []).reduce((s, r) => s + Number(r.value_numeric || 0), 0);
  return {
    brand: "mully",
    kpi_slug: "mully_marketing_spend_total",
    week_start_date: week.startISO,
    value_numeric: Number((sumPulled + sumManual).toFixed(2)),
    source: "marketing_spend_daily + manual_entries",
    computation_meta: { sum_pulled: sumPulled, sum_manual: sumManual },
  };
}

async function computeManualKPI(
  brand: "mully" | "mfs",
  slug: string,
  category: string,
  week: Week,
  unit: "count" | "sum" | "avg" = "sum",
): Promise<SnapRow> {
  const svc = getSupabaseService();
  const { data } = await svc
    .from("manual_entries")
    .select("value_numeric")
    .eq("brand", brand)
    .eq("category", category)
    .gte("entry_date", week.startISO)
    .lte("entry_date", week.endISO);
  let v: number | null = null;
  if (data && data.length) {
    if (unit === "count") v = data.length;
    else if (unit === "sum") v = data.reduce((s, r) => s + Number(r.value_numeric || 0), 0);
    else v = data.reduce((s, r) => s + Number(r.value_numeric || 0), 0) / data.length;
    v = Number(v.toFixed(2));
  }
  return {
    brand,
    kpi_slug: slug,
    week_start_date: week.startISO,
    value_numeric: v,
    source: `manual_entries.category='${category}'`,
    computation_meta: { rows: data?.length || 0, mode: unit },
  };
}

async function computeJunipAvg(week: Week): Promise<SnapRow> {
  const svc = getSupabaseService();
  const { data } = await svc
    .from("junip_snapshots")
    .select("avg_rating,snapshot_date")
    .gte("snapshot_date", week.startISO)
    .lte("snapshot_date", week.endISO)
    .order("snapshot_date", { ascending: false })
    .limit(1);
  return {
    brand: "mully",
    kpi_slug: "mully_junip_avg_rating",
    week_start_date: week.startISO,
    value_numeric: data?.[0]?.avg_rating != null ? Number(data[0].avg_rating) : null,
    source: "junip_snapshots",
    computation_meta: { snapshot_date: data?.[0]?.snapshot_date || null },
  };
}

async function computeTrafficFunnel(week: Week): Promise<SnapRow[]> {
  const svc = getSupabaseService();
  const { data } = await svc
    .from("traffic_pulls")
    .select("source,metric,value,pull_date")
    .gte("pull_date", week.startISO)
    .lte("pull_date", week.endISO);
  const sumMetric = (metric: string) =>
    (data || []).filter((r) => r.metric === metric).reduce((s, r) => s + Number(r.value || 0), 0);
  const visitors = sumMetric("visitors");
  const accounts = sumMetric("accounts_created");
  const purchases = sumMetric("purchases");
  return [
    {
      brand: "mully",
      kpi_slug: "mully_visitors",
      week_start_date: week.startISO,
      value_numeric: visitors || null,
      source: "traffic_pulls.visitors",
      computation_meta: { rows: data?.length || 0 },
    },
    {
      brand: "mully",
      kpi_slug: "mully_site_to_account_pct",
      week_start_date: week.startISO,
      value_numeric: visitors > 0 ? Number(((accounts / visitors) * 100).toFixed(2)) : null,
      source: "traffic_pulls",
      computation_meta: { visitors, accounts },
    },
    {
      brand: "mully",
      kpi_slug: "mully_account_to_purchase_pct",
      week_start_date: week.startISO,
      value_numeric: accounts > 0 ? Number(((purchases / accounts) * 100).toFixed(2)) : null,
      source: "traffic_pulls",
      computation_meta: { accounts, purchases },
    },
  ];
}

async function computeShipHero(week: Week): Promise<SnapRow[]> {
  const svc = getSupabaseService();
  const { data } = await svc
    .from("shiphero_snapshots")
    .select("orders_count,net_sales,special_proj_hours,snapshot_date")
    .gte("snapshot_date", week.startISO)
    .lte("snapshot_date", week.endISO);
  const sum = (k: "orders_count" | "net_sales" | "special_proj_hours") =>
    (data || []).reduce((s, r) => s + Number(r[k] || 0), 0);
  return [
    {
      brand: "mfs",
      kpi_slug: "mfs_shiphero_orders",
      week_start_date: week.startISO,
      value_numeric: sum("orders_count"),
      source: "shiphero_snapshots",
    },
    {
      brand: "mfs",
      kpi_slug: "mfs_shiphero_net_sales",
      week_start_date: week.startISO,
      value_numeric: Number(sum("net_sales").toFixed(2)),
      source: "shiphero_snapshots",
    },
    {
      brand: "mfs",
      kpi_slug: "mfs_shiphero_special_project_hours",
      week_start_date: week.startISO,
      value_numeric: Number(sum("special_proj_hours").toFixed(2)),
      source: "shiphero_snapshots",
    },
  ];
}

// ───────────────────────────────────────────────────── helpers
function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

// ───────────────────────────────────────────────────── handler
export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const weekParam = url.searchParams.get("week");
  const week: Week = weekParam ? weekFromMondayOf(weekParam) : defaultWeek();

  const result = await withJobRun("weekly-rollup", async ({ setWatermark, setMeta, bumpRows }) => {
    setWatermark(week.startISO);

    const all: SnapRow[] = [];
    const sectionErrors: Array<{ section: string; error: string }> = [];

    const sections: Array<[string, () => Promise<SnapRow[] | SnapRow>]> = [
      ["subs", () => computeSubsKPIs(week)],
      ["order_to_ship", () => computeOrderToShipP50(week)],
      ["mully_cash", () => computeCashChange(week, "mully")],
      ["mfs_cash", () => computeCashChange(week, "mfs")],
      ["mktg_spend", () => computeMarketingSpend(week)],
      ["cs_volume", () => computeManualKPI("mully", "mully_cs_volume", "cs_volume", week, "sum")],
      ["junip", () => computeJunipAvg(week)],
      ["traffic", () => computeTrafficFunnel(week)],
      ["shiphero", () => computeShipHero(week)],
      [
        "fulfillment_labor",
        () => computeManualKPI("mfs", "mfs_fulfillment_labor", "fulfillment_labor", week, "sum"),
      ],
      [
        "pipeline_landed",
        () => computeManualKPI("mfs", "mfs_pipeline_landed", "pipeline_landed", week, "sum"),
      ],
      ["5s_score", () => computeManualKPI("mfs", "mfs_5s_score", "5s_score", week, "avg")],
    ];

    for (const [name, fn] of sections) {
      try {
        const r = await fn();
        const rows = Array.isArray(r) ? r : [r];
        all.push(...rows);
        bumpRows(rows.length, 0);
      } catch (e) {
        sectionErrors.push({ section: name, error: e instanceof Error ? e.message : String(e) });
      }
    }

    await writeSnap(all);
    bumpRows(0, all.length);

    setMeta({
      week_start: week.startISO,
      week_end: week.endISO,
      kpis_written: all.length,
      section_errors: sectionErrors,
    });
    return { week, kpisWritten: all.length, sectionErrors };
  });

  return NextResponse.json(result);
}
