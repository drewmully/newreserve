"use client";

/**
 * /admin/ad-performance — Mully Reserve acquisition funnel dashboard.
 *
 * Dark Linear/Vercel-style admin UI. Funnel chart up top, dense table below.
 * Auth is handled by /admin/layout.tsx.
 *
 * Data source: /api/admin/ad-performance (reads pre-aggregated snapshots).
 * Numbers refresh hourly via /api/admin/cron/ad-performance-refresh; the
 * "Refresh now" button triggers an immediate recompute by passing live=1.
 */

import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";
import EmailView from "./EmailView";

// ─── Types matching the API response ────────────────────────────────────────

interface Snapshot {
  snapshot_date: string;
  campaign_id: string;
  ad_group_id: string;
  campaign_name: string | null;
  ad_group_name: string | null;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  lp_views: number;
  quiz_started: number;
  quiz_completed: number;
  quiz_email_captured: number;
  checkout_clicked: number;
  begin_checkout: number;
  new_purchases: number;
  new_revenue_cents: number;
}

interface Keyword {
  snapshot_date: string;
  campaign_id: string;
  ad_group_id: string;
  criterion_id: string;
  keyword_text: string | null;
  match_type: string | null;
  impressions: number;
  clicks: number;
  cost_micros: number;
  conversions: number;
  ctr: number;
  avg_cpc_micros: number;
}

interface BenchmarkBand {
  // "rate" → fractions (0–1) rendered as %; "currency" → USD dollars per event.
  kind: "rate" | "currency";
  low: number;
  high: number;
  label: string;
}

interface Benchmarks {
  ctr: BenchmarkBand;
  cpc: BenchmarkBand;
  click_to_profile: BenchmarkBand;
  cost_per_profile: BenchmarkBand;
  click_to_checkout: BenchmarkBand;
  cost_per_checkout: BenchmarkBand;
  click_to_purchase: BenchmarkBand;
  cost_per_purchase: BenchmarkBand;
}

interface ApiPayload {
  start: string;
  end: string;
  snapshots: Snapshot[];
  keywords: Keyword[];
  ad_group_map: Record<string, { campaign_slug: string; ad_group_slug: string }>;
  benchmarks: Benchmarks;
}

// ─── Aggregation helpers ────────────────────────────────────────────────────

interface AggregatedRow {
  campaign_id: string;
  ad_group_id: string;
  campaign_name: string;
  ad_group_name: string;
  impressions: number;
  clicks: number;
  cost_cents: number;
  conversions: number;
  lp_views: number;
  quiz_started: number;
  quiz_completed: number;
  quiz_email_captured: number;
  checkout_clicked: number;
  begin_checkout: number;
  new_purchases: number;
  new_revenue_cents: number;
}

function emptyRow(): Omit<AggregatedRow, "campaign_id" | "ad_group_id" | "campaign_name" | "ad_group_name"> {
  return {
    impressions: 0,
    clicks: 0,
    cost_cents: 0,
    conversions: 0,
    lp_views: 0,
    quiz_started: 0,
    quiz_completed: 0,
    quiz_email_captured: 0,
    checkout_clicked: 0,
    begin_checkout: 0,
    new_purchases: 0,
    new_revenue_cents: 0,
  };
}

function aggregateByAdGroup(snapshots: Snapshot[]): AggregatedRow[] {
  const map = new Map<string, AggregatedRow>();
  for (const s of snapshots) {
    const key = s.ad_group_id;
    const existing = map.get(key);
    if (existing) {
      existing.impressions += s.impressions;
      existing.clicks += s.clicks;
      existing.cost_cents += Math.round(s.cost_micros / 10000);
      existing.conversions += Number(s.conversions);
      existing.lp_views += s.lp_views;
      existing.quiz_started += s.quiz_started;
      existing.quiz_completed += s.quiz_completed;
      existing.quiz_email_captured += s.quiz_email_captured;
      existing.checkout_clicked += s.checkout_clicked;
      existing.begin_checkout += s.begin_checkout;
      existing.new_purchases += s.new_purchases;
      existing.new_revenue_cents += s.new_revenue_cents;
      // Prefer non-null name
      if (!existing.campaign_name && s.campaign_name) existing.campaign_name = s.campaign_name;
      if (!existing.ad_group_name && s.ad_group_name) existing.ad_group_name = s.ad_group_name;
    } else {
      map.set(key, {
        campaign_id: s.campaign_id,
        ad_group_id: s.ad_group_id,
        campaign_name: s.campaign_name ?? "—",
        ad_group_name: s.ad_group_name ?? "—",
        ...emptyRow(),
        impressions: s.impressions,
        clicks: s.clicks,
        cost_cents: Math.round(s.cost_micros / 10000),
        conversions: Number(s.conversions),
        lp_views: s.lp_views,
        quiz_started: s.quiz_started,
        quiz_completed: s.quiz_completed,
        quiz_email_captured: s.quiz_email_captured,
        checkout_clicked: s.checkout_clicked,
        begin_checkout: s.begin_checkout,
        new_purchases: s.new_purchases,
        new_revenue_cents: s.new_revenue_cents,
      });
    }
  }
  return Array.from(map.values());
}

function totals(rows: AggregatedRow[]): AggregatedRow {
  const t = {
    campaign_id: "TOTAL",
    ad_group_id: "TOTAL",
    campaign_name: "Total",
    ad_group_name: "All ad groups",
    ...emptyRow(),
  };
  for (const r of rows) {
    t.impressions += r.impressions;
    t.clicks += r.clicks;
    t.cost_cents += r.cost_cents;
    t.conversions += r.conversions;
    t.lp_views += r.lp_views;
    t.quiz_started += r.quiz_started;
    t.quiz_completed += r.quiz_completed;
    t.quiz_email_captured += r.quiz_email_captured;
    t.checkout_clicked += r.checkout_clicked;
    t.begin_checkout += r.begin_checkout;
    t.new_purchases += r.new_purchases;
    t.new_revenue_cents += r.new_revenue_cents;
  }
  return t;
}

// ─── Formatting ────────────────────────────────────────────────────────────

const fmtInt = new Intl.NumberFormat("en-US");
const fmtMoney = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});
const fmtMoneyWhole = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

function pct(num: number, denom: number): number {
  if (!denom) return 0;
  return num / denom;
}
function fmtPct(p: number, digits = 1): string {
  return `${(p * 100).toFixed(digits)}%`;
}

// Color a metric vs. a benchmark band.
// For rates: higher = better → green ≥ high, yellow [low, high), red < low.
// For currency (cost-per): lower = better, so the polarity is inverted
// (green ≤ low, yellow (low, high], red > high).
function bandColor(value: number, band: BenchmarkBand): "green" | "yellow" | "red" {
  if (!isFinite(value) || value <= 0) return "red";
  if (band.kind === "currency") {
    if (value <= band.low) return "green";
    if (value <= band.high) return "yellow";
    return "red";
  }
  if (value >= band.high) return "green";
  if (value >= band.low) return "yellow";
  return "red";
}

// Format a band's low/high pair, respecting its kind.
function fmtBandRange(band: BenchmarkBand): string {
  if (band.kind === "currency") {
    return `${fmtMoneyWhole.format(band.low)} – ${fmtMoneyWhole.format(band.high)}`;
  }
  return `${fmtPct(band.low, 0)} – ${fmtPct(band.high, 0)}`;
}

// Format a single value for the band’s kind.
function fmtBandValue(value: number, band: BenchmarkBand): string {
  if (band.kind === "currency") return fmtMoneyWhole.format(value);
  return fmtPct(value);
}
const BAND_CLASS: Record<"green" | "yellow" | "red", string> = {
  green: "text-emerald-400",
  yellow: "text-amber-400",
  red: "text-rose-400",
};
const BAND_BG: Record<"green" | "yellow" | "red", string> = {
  green: "bg-emerald-500/15 ring-1 ring-emerald-500/30",
  yellow: "bg-amber-500/15 ring-1 ring-amber-500/30",
  red: "bg-rose-500/15 ring-1 ring-rose-500/30",
};

// ─── Funnel chart (SVG) ─────────────────────────────────────────────────────
// Five trapezoid stages with widths proportional to volume. Each stage shows
// the count, the % advancing from the prior stage, and a benchmark badge.

interface StageMetric {
  // Computed metric value. Format depends on `band.kind`.
  value: number;
  band: BenchmarkBand;
  // Optional short label (e.g. "CTR", "Cost/click"). Defaults to band.label.
  label?: string;
}

interface FunnelStage {
  label: string;
  count: number;
  // Up to two metrics to render under the stage value (rate, cost-per).
  metrics?: StageMetric[];
  color: string;
  // If true, render the stage as a label + number only (no colored rectangle,
  // no flow ribbon). Used for the Impressions stage which dwarfs the others.
  numberOnly?: boolean;
}

function FunnelChart({
  stages,
  height = 320,
}: {
  stages: FunnelStage[];
  height?: number;
}) {
  const width = 1100;
  const padX = 24;
  const segW = (width - 2 * padX) / stages.length;

  // Reserve a chunk at the bottom for label + count + up to two metric rows
  // (each metric uses one value line + one grey benchmark line).
  // Label → 16, count → 28, metric block ≈ 38 per metric.
  const metricsBlockH = Math.max(
    ...stages.map((s) => (s.metrics?.length ?? 0) * 38)
  );
  const bottomReserve = 70 + metricsBlockH; // label + count band + metrics
  const chartH = height - bottomReserve;
  const yCenter = chartH / 2;

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
    >
      {/* Recompute maxCount excluding number-only stages so the visualized
          bars use the largest *boxed* stage as the scale anchor. */}
      {(() => {
        const boxed = stages.filter((s) => !s.numberOnly);
        const visMax = Math.max(1, ...boxed.map((s) => s.count));
        // The full visual height available for a stage rectangle.
        const fullH = chartH - 24;
        return stages.map((s, i) => {
        const next = stages.slice(i + 1).find((n) => !n.numberOnly);
        const ratio = s.count / visMax;
        const h = Math.max(28, ratio * fullH);
        const x = padX + i * segW;
        const y = yCenter - h / 2;

        return (
          <g key={s.label}>
            {/* Number-only stage — render as an intake trapezoid that pours
                into the next boxed stage. Left edge is the full chart height
                ('open mouth'), right edge matches the next stage's height.
                Filled with the next stage's color at low opacity so it reads
                as a stream of intake, not a separate bar. */}
            {s.numberOnly && next ? (() => {
              const nextRatio = next.count / visMax;
              const nextH = Math.max(28, nextRatio * fullH);
              const nextY = yCenter - nextH / 2;
              const xLeft = x + 4;
              const xRight = x + segW - 4;
              const topLeft = yCenter - fullH / 2;
              const botLeft = yCenter + fullH / 2;
              return (
                <>
                  <polygon
                    points={`
                      ${xLeft},${topLeft}
                      ${xRight},${nextY}
                      ${xRight},${nextY + nextH}
                      ${xLeft},${botLeft}
                    `}
                    fill={next.color}
                    opacity={0.22}
                  />
                  {/* Subtle outline so the mouth of the funnel reads as a shape */}
                  <polyline
                    points={`${xLeft},${topLeft} ${xRight},${nextY}`}
                    stroke={next.color}
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                    fill="none"
                  />
                  <polyline
                    points={`${xLeft},${botLeft} ${xRight},${nextY + nextH}`}
                    stroke={next.color}
                    strokeOpacity={0.55}
                    strokeWidth={1.5}
                    fill="none"
                  />
                </>
              );
            })() : null}
            {!s.numberOnly ? (
              <rect
                x={x + 4}
                y={y}
                width={segW - 8}
                height={h}
                rx={6}
                fill={s.color}
                opacity={0.9}
              />
            ) : null}
            {/* Connecting flow polygon — only between consecutive boxed stages */}
            {!s.numberOnly && next ? (() => {
              const nextRatio = next.count / visMax;
              const nextH = Math.max(28, nextRatio * fullH);
              const nextY = yCenter - nextH / 2;
              const xRight = x + segW - 4;
              const xNextLeft = x + segW + 4;
              return (
                <polygon
                  points={`
                    ${xRight},${y}
                    ${xNextLeft},${nextY}
                    ${xNextLeft},${nextY + nextH}
                    ${xRight},${y + h}
                  `}
                  fill={s.color}
                  opacity={0.18}
                />
              );
            })() : null}

            {/* Stage label */}
            <text
              x={x + segW / 2}
              y={chartH + 18}
              textAnchor="middle"
              className="fill-zinc-400 text-[11px] tracking-[0.18em] uppercase"
            >
              {s.label}
            </text>

            {/* Count */}
            <text
              x={x + segW / 2}
              y={chartH + 46}
              textAnchor="middle"
              className="fill-zinc-100 text-2xl font-medium"
            >
              {fmtInt.format(s.count)}
            </text>

            {/* Stage metrics: each metric is two lines (value, then benchmark in grey). */}
            {s.metrics?.map((m, mi) => {
              const blockTop = chartH + 70 + mi * 38;
              const color = bandColor(m.value, m.band);
              const colorClass =
                color === "green"
                  ? "fill-emerald-400"
                  : color === "yellow"
                  ? "fill-amber-400"
                  : "fill-rose-400";
              const valueText = m.label
                ? `${m.label} ${fmtBandValue(m.value, m.band)}`
                : fmtBandValue(m.value, m.band);
              return (
                <g key={mi}>
                  <text
                    x={x + segW / 2}
                    y={blockTop}
                    textAnchor="middle"
                    className={`text-[12px] ${colorClass}`}
                  >
                    {valueText}
                  </text>
                  <text
                    x={x + segW / 2}
                    y={blockTop + 14}
                    textAnchor="middle"
                    className="fill-zinc-500 text-[10px]"
                  >
                    bench {fmtBandRange(m.band)}
                  </text>
                </g>
              );
            })}
          </g>
        );
      });
      })()}
    </svg>
  );
}

// ─── Page ──────────────────────────────────────────────────────────────────

const STAGE_COLORS = ["#60a5fa", "#a78bfa", "#f472b6", "#fb923c", "#34d399"];

function defaultWindow(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export default function AdPerformancePage() {
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [{ start, end }, setRange] = useState(defaultWindow());
  const [campaignFilter, setCampaignFilter] = useState<string>("all");
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  // When set, the funnel chart aggregates only this ad group. Clicking the
  // selected row toggles back to "all".
  const [adGroupFocus, setAdGroupFocus] = useState<string | null>(null);
  // Top-level Paid/Organic tab. Organic is its own self-contained view —
  // separate data fetch, no benchmarks, no cost metrics.
  const [tab, setTab] = useState<"paid" | "organic" | "email">("paid");

  const load = async (live = false) => {
    setLoading(true);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not authenticated");
      const token = await user.getIdToken();
      const params = new URLSearchParams({ start, end });
      if (live) params.set("live", "1");
      const res = await fetch(`/api/admin/ad-performance?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as ApiPayload;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // Only load paid data when the Paid tab is visible — Organic owns its own
    // fetcher inside <OrganicView/>. Reloads when the date range changes.
    if (tab === "paid") void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end, tab]);

  // Filter to campaign before aggregating. (unattributed) and (pending)
  // rows are excluded from the on-screen view — they're stored in Supabase
  // for auditing but don't surface in the admin UI.
  const filteredSnapshots = useMemo(() => {
    if (!data) return [];
    const visible = data.snapshots.filter(
      (s) =>
        s.campaign_id !== "(unattributed)" && s.campaign_id !== "(pending)"
    );
    if (campaignFilter === "all") return visible;
    return visible.filter((s) => s.campaign_id === campaignFilter);
  }, [data, campaignFilter]);

  const rows = useMemo(() => aggregateByAdGroup(filteredSnapshots), [filteredSnapshots]);
  // `total` drives the funnel chart + KPI strip. When an ad group is focused,
  // only that row's metrics roll up — everything else (the ad-group table
  // below) keeps showing all rows.
  const total = useMemo(() => {
    if (adGroupFocus) {
      const r = rows.find((x) => x.ad_group_id === adGroupFocus);
      if (r) return totals([r]);
    }
    return totals(rows);
  }, [rows, adGroupFocus]);
  const focusedRow = useMemo(
    () => (adGroupFocus ? rows.find((r) => r.ad_group_id === adGroupFocus) ?? null : null),
    [rows, adGroupFocus]
  );

  // Get list of campaigns for the dropdown (exclude sentinel buckets)
  const campaigns = useMemo(() => {
    if (!data) return [];
    const seen = new Map<string, string>();
    for (const s of data.snapshots) {
      if (s.campaign_id === "(pending)" || s.campaign_id === "(unattributed)")
        continue;
      if (!seen.has(s.campaign_id)) {
        seen.set(s.campaign_id, s.campaign_name ?? s.campaign_id);
      }
    }
    return Array.from(seen.entries()).map(([id, name]) => ({ id, name }));
  }, [data]);

  const benchmarks = data?.benchmarks;

  // Funnel stages: Impressions → Ad clicks (CTR, CPC) → Profile completed
  // (% of clicks, $/profile) → Checkout started (% of clicks, $/checkout)
  // → Purchase (% of clicks, $/purchase). LP views are intentionally
  // dropped — they're implied by ad clicks, and a separate `lp_views` row
  // confuses the dashboard when redirects or org/direct traffic skew it.
  const dollarSpend = total.cost_cents / 100;
  const checkoutCount = total.checkout_clicked || total.begin_checkout;
  const profileCount = total.quiz_completed;

  const funnelStages: FunnelStage[] = useMemo(() => {
    if (!benchmarks) return [];
    const safeDiv = (n: number, d: number) => (d > 0 ? n / d : 0);
    // Rates are STEP-TO-STEP (each % is of the previous boxed stage), not of
    // ad clicks. Cost-per stays "spend ÷ stage count" since spend is a single
    // pool that funds the entire pipeline.
    return [
      {
        label: "Impressions",
        count: total.impressions,
        color: STAGE_COLORS[0],
        numberOnly: true,
      },
      {
        label: "Ad clicks",
        count: total.clicks,
        color: STAGE_COLORS[1],
        metrics: [
          {
            label: "CTR",
            value: pct(total.clicks, total.impressions),
            band: benchmarks.ctr,
          },
          {
            label: "CPC",
            value: safeDiv(dollarSpend, total.clicks),
            band: benchmarks.cpc,
          },
        ],
      },
      {
        label: "Profile completed",
        count: profileCount,
        color: STAGE_COLORS[2],
        metrics: [
          {
            label: "Profile %",
            value: pct(profileCount, total.clicks),
            band: benchmarks.click_to_profile,
          },
          {
            label: "Cost/profile",
            value: safeDiv(dollarSpend, profileCount),
            band: benchmarks.cost_per_profile,
          },
        ],
      },
      {
        label: "Checkout started",
        count: checkoutCount,
        color: STAGE_COLORS[3],
        metrics: [
          {
            label: "Checkout %",
            value: pct(checkoutCount, profileCount),
            band: benchmarks.click_to_checkout,
          },
          {
            label: "Cost/checkout",
            value: safeDiv(dollarSpend, checkoutCount),
            band: benchmarks.cost_per_checkout,
          },
        ],
      },
      {
        label: "Purchase",
        count: total.new_purchases,
        color: STAGE_COLORS[4],
        metrics: [
          {
            label: "Purchase %",
            value: pct(total.new_purchases, checkoutCount),
            band: benchmarks.click_to_purchase,
          },
          {
            label: "CAC",
            value: safeDiv(dollarSpend, total.new_purchases),
            band: benchmarks.cost_per_purchase,
          },
        ],
      },
    ];
  }, [total, benchmarks, dollarSpend, profileCount, checkoutCount]);

  const ctr = pct(total.clicks, total.impressions);
  const cpc = total.clicks ? total.cost_cents / total.clicks / 100 : 0;
  const cac = total.new_purchases ? total.cost_cents / total.new_purchases / 100 : null;
  const clickToPurchase = pct(total.new_purchases, total.clicks);

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 px-6 py-8">
      {/* Header */}
      <div className="flex items-end justify-between mb-6 max-w-[1400px] mx-auto">
        <div>
          <h1 className="text-2xl font-medium tracking-tight">Ad Performance</h1>
          <p className="text-sm text-zinc-500 mt-1">
            Mully Reserve acquisition funnel · Google Ads &times; PostHog &times; Shopify (headless only)
          </p>
        </div>
        <div className="flex items-center gap-3">
          <DateInput value={start} onChange={(v) => setRange((r) => ({ ...r, start: v }))} />
          <span className="text-zinc-600">→</span>
          <DateInput value={end} onChange={(v) => setRange((r) => ({ ...r, end: v }))} />
          {tab === "paid" ? (
            <button
              onClick={() => load(true)}
              disabled={loading}
              className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 ring-1 ring-zinc-700 transition"
            >
              {loading ? "Refreshing…" : "Refresh now"}
            </button>
          ) : null}
        </div>
      </div>

      {/* Paid / Organic / Email tab toggle */}
      <div className="max-w-[1400px] mx-auto mb-6 flex items-center gap-2">
        <button
          onClick={() => setTab("paid")}
          className={`px-4 py-2 text-xs tracking-[0.16em] uppercase rounded-md transition ${
            tab === "paid"
              ? "bg-zinc-100 text-zinc-900"
              : "bg-zinc-900 text-zinc-400 ring-1 ring-zinc-800 hover:text-zinc-200"
          }`}
        >
          Paid
        </button>
        <button
          onClick={() => setTab("organic")}
          className={`px-4 py-2 text-xs tracking-[0.16em] uppercase rounded-md transition ${
            tab === "organic"
              ? "bg-zinc-100 text-zinc-900"
              : "bg-zinc-900 text-zinc-400 ring-1 ring-zinc-800 hover:text-zinc-200"
          }`}
        >
          Organic
        </button>
        <button
          onClick={() => setTab("email")}
          className={`px-4 py-2 text-xs tracking-[0.16em] uppercase rounded-md transition ${
            tab === "email"
              ? "bg-zinc-100 text-zinc-900"
              : "bg-zinc-900 text-zinc-400 ring-1 ring-zinc-800 hover:text-zinc-200"
          }`}
        >
          Email
        </button>
      </div>

      {tab === "paid" && error ? (
        <div className="max-w-[1400px] mx-auto mb-6 p-4 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-300 text-sm">
          {error}
        </div>
      ) : null}

      {tab === "organic" ? (
        <OrganicView start={start} end={end} />
      ) : null}

      {tab === "email" ? (
        <EmailView start={start} end={end} />
      ) : null}

      {tab === "paid" ? (
        <>
      {/* Campaign filter pills */}
      <div className="max-w-[1400px] mx-auto mb-6 flex items-center gap-2 flex-wrap">
        <FilterPill
          active={campaignFilter === "all"}
          onClick={() => setCampaignFilter("all")}
          label="All campaigns"
        />
        {campaigns.map((c) => (
          <FilterPill
            key={c.id}
            active={campaignFilter === c.id}
            onClick={() => setCampaignFilter(c.id)}
            label={c.name}
          />
        ))}
      </div>

      {/* KPI strip */}
      <div className="max-w-[1400px] mx-auto grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <Kpi label="Spend" value={fmtMoney.format(total.cost_cents / 100)} />
        <Kpi
          label="CTR"
          value={fmtPct(ctr, 2)}
          band={benchmarks?.ctr ? bandColor(ctr, benchmarks.ctr) : undefined}
          sub={benchmarks?.ctr ? `bench ${fmtBandRange(benchmarks.ctr)}` : undefined}
        />
        <Kpi
          label="Avg CPC"
          value={fmtMoney.format(cpc)}
          band={benchmarks?.cpc ? bandColor(cpc, benchmarks.cpc) : undefined}
          sub={benchmarks?.cpc ? `bench ${fmtBandRange(benchmarks.cpc)}` : undefined}
        />
        <Kpi
          label="Click → purchase"
          value={fmtPct(clickToPurchase, 2)}
          band={
            benchmarks?.click_to_purchase
              ? bandColor(clickToPurchase, benchmarks.click_to_purchase)
              : undefined
          }
          sub={
            benchmarks?.click_to_purchase
              ? `bench ${fmtBandRange(benchmarks.click_to_purchase)}`
              : undefined
          }
        />
        <Kpi label="New purchases" value={fmtInt.format(total.new_purchases)} />
        <Kpi
          label="CAC"
          value={cac !== null ? fmtMoneyWhole.format(cac) : "—"}
          sub="cost ÷ new purchases"
        />
      </div>

      {/* Funnel chart */}
      <div className="max-w-[1400px] mx-auto mb-8 p-6 rounded-xl bg-zinc-900 ring-1 ring-zinc-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm tracking-[0.18em] uppercase text-zinc-400">Funnel flow</h2>
            {focusedRow ? (
              <button
                onClick={() => setAdGroupFocus(null)}
                className="flex items-center gap-2 text-xs px-2.5 py-1 rounded-md bg-blue-500/15 ring-1 ring-blue-500/40 text-blue-200 hover:bg-blue-500/25 transition"
                title="Clear ad-group focus"
              >
                <span className="font-medium">{focusedRow.ad_group_name}</span>
                <span className="text-blue-300/80">×</span>
              </button>
            ) : (
              <span className="text-xs text-zinc-600">All ad groups · click a row to focus</span>
            )}
          </div>
          <div className="text-xs text-zinc-500">
            {loading ? "Loading…" : data ? `${data.start} → ${data.end}` : ""}
          </div>
        </div>
        {funnelStages.length > 0 ? (
          <FunnelChart stages={funnelStages} />
        ) : (
          <div className="h-40 flex items-center justify-center text-zinc-600 text-sm">
            No data in range.
          </div>
        )}
      </div>

      {/* Table */}
      <div className="max-w-[1400px] mx-auto rounded-xl bg-zinc-900 ring-1 ring-zinc-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm tracking-[0.18em] uppercase text-zinc-400">By ad group</h2>
          <div className="text-xs text-zinc-500">Click a row to see keywords</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/80 text-[10px] tracking-[0.16em] uppercase text-zinc-500">
              <tr>
                <Th>Campaign / Ad group</Th>
                <Th align="right">Impr</Th>
                <Th align="right">Clicks</Th>
                <Th align="right">Spend</Th>
                <Th align="right">CTR</Th>
                <Th align="right">CPC</Th>
                <Th align="right">Quiz done</Th>
                <Th align="right">Click → Quiz</Th>
                <Th align="right">Checkout</Th>
                <Th align="right">Quiz → CO</Th>
                <Th align="right">Purchases</Th>
                <Th align="right">CAC</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={12} className="text-center py-8 text-zinc-600">
                    {loading ? "Loading…" : "No data."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const rCtr = pct(r.clicks, r.impressions);
                  const rCpc = r.clicks ? r.cost_cents / r.clicks / 100 : 0;
                  const rClickToQuiz = pct(r.quiz_completed, r.clicks);
                  const rQuizToCheckout = pct(
                    r.checkout_clicked || r.begin_checkout,
                    r.quiz_completed
                  );
                  const rCac = r.new_purchases ? r.cost_cents / r.new_purchases / 100 : null;
                  const isOpen = expanded.has(r.ad_group_id);
                  const isFocused = adGroupFocus === r.ad_group_id;
                  return (
                    <>
                      <tr
                        key={r.ad_group_id}
                        onClick={() => {
                          // Two clicks here: (1) focus the funnel chart on this
                          // ad group (or clear focus if it's already focused),
                          // (2) toggle keyword expansion below.
                          setAdGroupFocus((cur) => (cur === r.ad_group_id ? null : r.ad_group_id));
                          setExpanded((s) => {
                            const n = new Set(s);
                            if (n.has(r.ad_group_id)) n.delete(r.ad_group_id);
                            else n.add(r.ad_group_id);
                            return n;
                          });
                        }}
                        className={
                          "border-t border-zinc-800/60 hover:bg-zinc-800/40 cursor-pointer transition-colors" +
                          (isFocused ? " bg-blue-500/10 hover:bg-blue-500/15 ring-1 ring-blue-500/30" : "")
                        }
                      >
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className="text-zinc-500 text-xs w-3 inline-block">
                              {isOpen ? "▾" : "▸"}
                            </span>
                            <div>
                              <div className="text-zinc-100">{r.ad_group_name}</div>
                              <div className="text-xs text-zinc-500">{r.campaign_name}</div>
                            </div>
                          </div>
                        </td>
                        <Td align="right">{fmtInt.format(r.impressions)}</Td>
                        <Td align="right">{fmtInt.format(r.clicks)}</Td>
                        <Td align="right">{fmtMoney.format(r.cost_cents / 100)}</Td>
                        <Td
                          align="right"
                          className={benchmarks ? BAND_CLASS[bandColor(rCtr, benchmarks.ctr)] : undefined}
                        >
                          {fmtPct(rCtr, 2)}
                        </Td>
                        <Td align="right">{fmtMoney.format(rCpc)}</Td>
                        <Td align="right">{fmtInt.format(r.quiz_completed)}</Td>
                        <Td
                          align="right"
                          className={
                            benchmarks
                              ? BAND_CLASS[bandColor(rClickToQuiz, benchmarks.click_to_profile)]
                              : undefined
                          }
                        >
                          {fmtPct(rClickToQuiz, 1)}
                        </Td>
                        <Td align="right">
                          {fmtInt.format(r.checkout_clicked || r.begin_checkout)}
                        </Td>
                        <Td
                          align="right"
                          className={
                            benchmarks
                              ? BAND_CLASS[bandColor(rQuizToCheckout, benchmarks.click_to_checkout)]
                              : undefined
                          }
                        >
                          {fmtPct(rQuizToCheckout, 1)}
                        </Td>
                        <Td align="right">{fmtInt.format(r.new_purchases)}</Td>
                        <Td align="right">{rCac !== null ? fmtMoneyWhole.format(rCac) : "—"}</Td>
                      </tr>
                      {isOpen ? (
                        <KeywordSubrow
                          key={`${r.ad_group_id}-kw`}
                          keywords={(data?.keywords ?? []).filter(
                            (k) => k.ad_group_id === r.ad_group_id
                          )}
                        />
                      ) : null}
                    </>
                  );
                })
              )}
            </tbody>
            {rows.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-zinc-700 bg-zinc-900/80 font-medium">
                  <td className="px-4 py-3 text-zinc-300">Total</td>
                  <Td align="right">{fmtInt.format(total.impressions)}</Td>
                  <Td align="right">{fmtInt.format(total.clicks)}</Td>
                  <Td align="right">{fmtMoney.format(total.cost_cents / 100)}</Td>
                  <Td align="right">{fmtPct(ctr, 2)}</Td>
                  <Td align="right">{fmtMoney.format(cpc)}</Td>
                  <Td align="right">{fmtInt.format(total.quiz_completed)}</Td>
                  <Td align="right">{fmtPct(pct(total.quiz_completed, total.clicks), 1)}</Td>
                  <Td align="right">
                    {fmtInt.format(total.checkout_clicked || total.begin_checkout)}
                  </Td>
                  <Td align="right">
                    {fmtPct(pct(total.checkout_clicked || total.begin_checkout, total.quiz_completed), 1)}
                  </Td>
                  <Td align="right">{fmtInt.format(total.new_purchases)}</Td>
                  <Td align="right">{cac !== null ? fmtMoneyWhole.format(cac) : "—"}</Td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      {/* Benchmarks reference */}
      {benchmarks ? (
        <div className="max-w-[1400px] mx-auto mt-6 p-4 rounded-xl bg-zinc-900/50 ring-1 ring-zinc-800/50 text-xs text-zinc-500">
          <div className="tracking-[0.18em] uppercase text-zinc-400 mb-2">
            Industry benchmarks (e-commerce search, 2026)
          </div>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-x-6 gap-y-1">
            {Object.entries(benchmarks).map(([k, v]) => (
              <div key={k} className="flex items-center justify-between">
                <span>{v.label}</span>
                <span className="text-zinc-400">{fmtBandRange(v)}</span>
              </div>
            ))}
          </div>
          <div className="mt-3 text-zinc-600">
            Green: better than high benchmark · Amber: inside band · Red: worse than low
          </div>
        </div>
      ) : null}
        </>
      ) : null}
    </div>
  );
}

// ─── Small components ──────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  band,
  sub,
}: {
  label: string;
  value: string;
  band?: "green" | "yellow" | "red";
  sub?: string;
}) {
  return (
    <div
      className={`p-3 rounded-xl bg-zinc-900 ring-1 ring-zinc-800 ${
        band ? BAND_BG[band] : ""
      }`}
    >
      <div className="text-[10px] tracking-[0.16em] uppercase text-zinc-500">{label}</div>
      <div className={`text-xl font-medium mt-1 ${band ? BAND_CLASS[band] : "text-zinc-100"}`}>
        {value}
      </div>
      {sub ? <div className="text-[10px] text-zinc-500 mt-0.5">{sub}</div> : null}
    </div>
  );
}

function FilterPill({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 text-xs rounded-full transition ${
        active
          ? "bg-zinc-100 text-zinc-900"
          : "bg-zinc-900 text-zinc-300 ring-1 ring-zinc-800 hover:bg-zinc-800"
      }`}
    >
      {label}
    </button>
  );
}

function DateInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <input
      type="date"
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="bg-zinc-900 ring-1 ring-zinc-800 rounded-md px-3 py-1.5 text-xs text-zinc-200 [color-scheme:dark]"
    />
  );
}

function Th({
  children,
  align = "left",
}: {
  children: React.ReactNode;
  align?: "left" | "right";
}) {
  return (
    <th
      className={`px-4 py-2.5 ${align === "right" ? "text-right" : "text-left"} font-medium`}
    >
      {children}
    </th>
  );
}

function Td({
  children,
  align = "left",
  className,
}: {
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  return (
    <td
      className={`px-4 py-2.5 tabular-nums ${
        align === "right" ? "text-right" : "text-left"
      } text-zinc-200 ${className ?? ""}`}
    >
      {children}
    </td>
  );
}

function KeywordSubrow({ keywords }: { keywords: Keyword[] }) {
  // Aggregate same criterion_id across days
  const map = new Map<string, Keyword>();
  for (const k of keywords) {
    const existing = map.get(k.criterion_id);
    if (existing) {
      existing.impressions += k.impressions;
      existing.clicks += k.clicks;
      existing.cost_micros += k.cost_micros;
      existing.conversions += Number(k.conversions);
    } else {
      map.set(k.criterion_id, { ...k });
    }
  }
  const rows = Array.from(map.values()).sort((a, b) => b.clicks - a.clicks);
  if (rows.length === 0) {
    return (
      <tr className="border-t border-zinc-800/40 bg-zinc-950/60">
        <td colSpan={12} className="px-12 py-4 text-zinc-600 text-xs">
          No keyword data in this range.
        </td>
      </tr>
    );
  }
  return (
    <tr className="border-t border-zinc-800/40 bg-zinc-950/60">
      <td colSpan={12} className="px-12 py-3">
        <table className="w-full text-xs">
          <thead>
            <tr className="text-[10px] tracking-[0.16em] uppercase text-zinc-500">
              <th className="text-left py-1.5 font-medium">Keyword</th>
              <th className="text-left font-medium">Match</th>
              <th className="text-right font-medium">Impr</th>
              <th className="text-right font-medium">Clicks</th>
              <th className="text-right font-medium">Spend</th>
              <th className="text-right font-medium">CTR</th>
              <th className="text-right font-medium">Avg CPC</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((k) => {
              const kCtr = pct(k.clicks, k.impressions);
              const kCpc = k.clicks ? k.cost_micros / k.clicks / 1_000_000 : 0;
              return (
                <tr key={k.criterion_id} className="border-t border-zinc-800/30">
                  <td className="py-1.5 text-zinc-300">{k.keyword_text ?? "—"}</td>
                  <td className="text-zinc-500">{(k.match_type || "").toLowerCase()}</td>
                  <td className="text-right tabular-nums text-zinc-300">
                    {fmtInt.format(k.impressions)}
                  </td>
                  <td className="text-right tabular-nums text-zinc-300">
                    {fmtInt.format(k.clicks)}
                  </td>
                  <td className="text-right tabular-nums text-zinc-300">
                    {fmtMoney.format(k.cost_micros / 1_000_000)}
                  </td>
                  <td className="text-right tabular-nums text-zinc-400">{fmtPct(kCtr, 2)}</td>
                  <td className="text-right tabular-nums text-zinc-400">{fmtMoney.format(kCpc)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </td>
    </tr>
  );
}

// ─── Organic tab ────────────────────────────────────────────────────────────

interface OrganicSnapshot {
  snapshot_date: string;
  source: string;
  source_label: string | null;
  sessions: number;
  lp_views: number;
  quiz_started: number;
  quiz_completed: number;
  quiz_email_captured: number;
  checkout_clicked: number;
  begin_checkout: number;
  new_purchases: number;
  new_revenue_cents: number;
}

interface OrganicSource {
  slug: string;
  label: string;
}

interface OrganicBenchmarks {
  // LP views were intentionally dropped from the organic funnel — sessions
  // now feeds profile completed directly.
  profile_rate: BenchmarkBand;
  checkout_rate: BenchmarkBand;
  purchase_rate: BenchmarkBand;
}

interface OrganicPayload {
  start: string;
  end: string;
  snapshots: OrganicSnapshot[];
  sources: OrganicSource[];
  source_labels: Record<string, string>;
  benchmarks: OrganicBenchmarks;
}

interface OrganicRow {
  source: string;
  source_label: string;
  sessions: number;
  lp_views: number;
  quiz_started: number;
  quiz_completed: number;
  quiz_email_captured: number;
  checkout_clicked: number;
  begin_checkout: number;
  new_purchases: number;
  new_revenue_cents: number;
}

function emptyOrganicRow(source: string, label: string): OrganicRow {
  return {
    source,
    source_label: label,
    sessions: 0,
    lp_views: 0,
    quiz_started: 0,
    quiz_completed: 0,
    quiz_email_captured: 0,
    checkout_clicked: 0,
    begin_checkout: 0,
    new_purchases: 0,
    new_revenue_cents: 0,
  };
}

function aggregateBySource(snapshots: OrganicSnapshot[]): OrganicRow[] {
  const map = new Map<string, OrganicRow>();
  for (const s of snapshots) {
    const key = s.source;
    const row =
      map.get(key) ?? emptyOrganicRow(key, s.source_label ?? key);
    row.sessions += s.sessions;
    row.lp_views += s.lp_views;
    row.quiz_started += s.quiz_started;
    row.quiz_completed += s.quiz_completed;
    row.quiz_email_captured += s.quiz_email_captured;
    row.checkout_clicked += s.checkout_clicked;
    row.begin_checkout += s.begin_checkout;
    row.new_purchases += s.new_purchases;
    row.new_revenue_cents += s.new_revenue_cents;
    map.set(key, row);
  }
  return Array.from(map.values()).sort((a, b) => b.sessions - a.sessions);
}

function totalsOrganic(rows: OrganicRow[]): OrganicRow {
  const t = emptyOrganicRow("__total__", "Total");
  for (const r of rows) {
    t.sessions += r.sessions;
    t.lp_views += r.lp_views;
    t.quiz_started += r.quiz_started;
    t.quiz_completed += r.quiz_completed;
    t.quiz_email_captured += r.quiz_email_captured;
    t.checkout_clicked += r.checkout_clicked;
    t.begin_checkout += r.begin_checkout;
    t.new_purchases += r.new_purchases;
    t.new_revenue_cents += r.new_revenue_cents;
  }
  return t;
}

// Funnel chart for organic — no benchmarks, no color bands, just stage count
// + step-to-step rate below in neutral zinc. Reuses STAGE_COLORS for the bars.
interface OrganicFunnelStage {
  label: string;
  count: number;
  // % advancing from the previous stage. Null for the first stage.
  stepRate: number | null;
  // Optional benchmark to color the step rate against. If undefined, the
  // step rate is rendered in neutral zinc.
  band?: BenchmarkBand;
  color: string;
}

function OrganicFunnelChart({
  stages,
  height = 280,
}: {
  stages: OrganicFunnelStage[];
  height?: number;
}) {
  const width = 1100;
  const padX = 24;
  const segW = (width - 2 * padX) / stages.length;
  // label (18) + count (28) + step-rate value (16) + benchmark line (14) + padding
  const bottomReserve = 110;
  const chartH = height - bottomReserve;
  const yCenter = chartH / 2;
  const visMax = Math.max(1, ...stages.map((s) => s.count));

  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-full h-auto"
      preserveAspectRatio="xMidYMid meet"
    >
      {stages.map((s, i) => {
        const ratio = s.count / visMax;
        const h = Math.max(28, ratio * (chartH - 24));
        const x = padX + i * segW;
        const y = yCenter - h / 2;
        const next = stages[i + 1];
        return (
          <g key={s.label}>
            <rect
              x={x + 4}
              y={y}
              width={segW - 8}
              height={h}
              rx={6}
              fill={s.color}
              opacity={0.9}
            />
            {next ? (() => {
              const nextRatio = next.count / visMax;
              const nextH = Math.max(28, nextRatio * (chartH - 24));
              const nextY = yCenter - nextH / 2;
              const xRight = x + segW - 4;
              const xNextLeft = x + segW + 4;
              return (
                <polygon
                  points={`
                    ${xRight},${y}
                    ${xNextLeft},${nextY}
                    ${xNextLeft},${nextY + nextH}
                    ${xRight},${y + h}
                  `}
                  fill={s.color}
                  opacity={0.18}
                />
              );
            })() : null}

            <text
              x={x + segW / 2}
              y={chartH + 18}
              textAnchor="middle"
              className="fill-zinc-400 text-[11px] tracking-[0.18em] uppercase"
            >
              {s.label}
            </text>
            <text
              x={x + segW / 2}
              y={chartH + 46}
              textAnchor="middle"
              className="fill-zinc-100 text-2xl font-medium"
            >
              {fmtInt.format(s.count)}
            </text>
            {s.stepRate !== null ? (() => {
              const color = s.band ? bandColor(s.stepRate, s.band) : null;
              const colorClass =
                color === "green"
                  ? "fill-emerald-400"
                  : color === "yellow"
                  ? "fill-amber-400"
                  : color === "red"
                  ? "fill-rose-400"
                  : "fill-zinc-400";
              return (
                <>
                  <text
                    x={x + segW / 2}
                    y={chartH + 72}
                    textAnchor="middle"
                    className={`text-[12px] ${colorClass}`}
                  >
                    {fmtPct(s.stepRate, 1)} of prev
                  </text>
                  {s.band ? (
                    <text
                      x={x + segW / 2}
                      y={chartH + 88}
                      textAnchor="middle"
                      className="fill-zinc-500 text-[10px]"
                    >
                      bench {fmtBandRange(s.band)}
                    </text>
                  ) : null}
                </>
              );
            })() : null}
          </g>
        );
      })}
    </svg>
  );
}

function OrganicView({ start, end }: { start: string; end: string }) {
  const [data, setData] = useState<OrganicPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sourceFocus, setSourceFocus] = useState<string | null>(null);

  const load = async (live = false) => {
    setLoading(true);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Not authenticated");
      const token = await user.getIdToken();
      const params = new URLSearchParams({ start, end });
      if (live) params.set("live", "1");
      const res = await fetch(`/api/admin/ad-performance/organic?${params}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(j.error || `HTTP ${res.status}`);
      }
      const payload = (await res.json()) as OrganicPayload;
      setData(payload);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [start, end]);

  const rows = useMemo(
    () => (data ? aggregateBySource(data.snapshots) : []),
    [data]
  );
  const total = useMemo(() => {
    if (sourceFocus) {
      const r = rows.find((x) => x.source === sourceFocus);
      if (r) return totalsOrganic([r]);
    }
    return totalsOrganic(rows);
  }, [rows, sourceFocus]);
  const focusedRow = useMemo(
    () => (sourceFocus ? rows.find((r) => r.source === sourceFocus) ?? null : null),
    [rows, sourceFocus]
  );

  // Funnel is collapsed — session → profile → checkout → purchase. LP views
  // are still stored in Supabase but no longer surface in the UI.
  const profileRate = pct(total.quiz_completed, total.sessions);
  const checkoutCount = total.checkout_clicked || total.begin_checkout;
  const checkoutRate = pct(checkoutCount, total.quiz_completed);
  const purchaseRate = pct(total.new_purchases, checkoutCount);

  const benchmarks = data?.benchmarks;
  // 4-stage funnel: Sessions → Profile completed → Checkout started → Purchase.
  // Colors picked to keep visual parity with the paid funnel (skip the
  // second STAGE_COLORS slot so the bars don't read identically).
  const funnelStages: OrganicFunnelStage[] = [
    {
      label: "Sessions",
      count: total.sessions,
      stepRate: null,
      color: STAGE_COLORS[0],
    },
    {
      label: "Profile completed",
      count: total.quiz_completed,
      stepRate: pct(total.quiz_completed, total.sessions),
      band: benchmarks?.profile_rate,
      color: STAGE_COLORS[2],
    },
    {
      label: "Checkout started",
      count: checkoutCount,
      stepRate: pct(checkoutCount, total.quiz_completed),
      band: benchmarks?.checkout_rate,
      color: STAGE_COLORS[3],
    },
    {
      label: "Purchase",
      count: total.new_purchases,
      stepRate: pct(total.new_purchases, checkoutCount),
      band: benchmarks?.purchase_rate,
      color: STAGE_COLORS[4],
    },
  ];

  return (
    <>
      {error ? (
        <div className="max-w-[1400px] mx-auto mb-6 p-4 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-300 text-sm">
          {error}
        </div>
      ) : null}

      {/* Refresh row */}
      <div className="max-w-[1400px] mx-auto mb-4 flex items-center justify-between">
        <p className="text-xs text-zinc-500">
          Attributed to non-paid referrers. Excludes gclid / utm_medium=cpc / known ad sources.
        </p>
        <button
          onClick={() => load(true)}
          disabled={loading}
          className="px-3 py-1.5 text-xs rounded-md bg-zinc-800 hover:bg-zinc-700 disabled:opacity-50 ring-1 ring-zinc-700 transition"
        >
          {loading ? "Refreshing…" : "Refresh now"}
        </button>
      </div>

      {/* KPI strip */}
      <div className="max-w-[1400px] mx-auto grid grid-cols-2 md:grid-cols-6 gap-3 mb-6">
        <Kpi label="Sessions" value={fmtInt.format(total.sessions)} />
        <Kpi
          label="Profile rate"
          value={fmtPct(profileRate, 1)}
          band={benchmarks?.profile_rate ? bandColor(profileRate, benchmarks.profile_rate) : undefined}
          sub={benchmarks?.profile_rate ? `bench ${fmtBandRange(benchmarks.profile_rate)}` : "of sessions"}
        />
        <Kpi
          label="Checkout rate"
          value={fmtPct(checkoutRate, 1)}
          band={benchmarks?.checkout_rate ? bandColor(checkoutRate, benchmarks.checkout_rate) : undefined}
          sub={benchmarks?.checkout_rate ? `bench ${fmtBandRange(benchmarks.checkout_rate)}` : "of profiles"}
        />
        <Kpi
          label="Purchases"
          value={fmtInt.format(total.new_purchases)}
          band={benchmarks?.purchase_rate ? bandColor(purchaseRate, benchmarks.purchase_rate) : undefined}
          sub={`${fmtPct(purchaseRate, 1)} of checkouts`}
        />
        <Kpi label="Revenue" value={fmtMoney.format(total.new_revenue_cents / 100)} />
        <Kpi label="Sources" value={fmtInt.format(rows.length)} sub="tracked" />
      </div>

      {/* Funnel chart */}
      <div className="max-w-[1400px] mx-auto mb-8 p-6 rounded-xl bg-zinc-900 ring-1 ring-zinc-800">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-3">
            <h2 className="text-sm tracking-[0.18em] uppercase text-zinc-400">Organic funnel</h2>
            {focusedRow ? (
              <button
                onClick={() => setSourceFocus(null)}
                className="flex items-center gap-2 text-xs px-2.5 py-1 rounded-md bg-blue-500/15 ring-1 ring-blue-500/40 text-blue-200 hover:bg-blue-500/25 transition"
                title="Clear source focus"
              >
                <span className="font-medium">{focusedRow.source_label}</span>
                <span className="text-blue-300/80">×</span>
              </button>
            ) : (
              <span className="text-xs text-zinc-600">All sources · click a row to focus</span>
            )}
          </div>
          <div className="text-xs text-zinc-500">
            {loading ? "Loading…" : data ? `${data.start} → ${data.end}` : ""}
          </div>
        </div>
        {total.sessions > 0 ? (
          <OrganicFunnelChart stages={funnelStages} />
        ) : (
          <div className="h-40 flex items-center justify-center text-zinc-600 text-sm">
            {loading ? "Loading…" : "No organic data in range."}
          </div>
        )}
      </div>

      {/* Table */}
      <div className="max-w-[1400px] mx-auto rounded-xl bg-zinc-900 ring-1 ring-zinc-800 overflow-hidden">
        <div className="px-5 py-3 border-b border-zinc-800 flex items-center justify-between">
          <h2 className="text-sm tracking-[0.18em] uppercase text-zinc-400">By source</h2>
          <div className="text-xs text-zinc-500">Click a row to focus the funnel</div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900/80 text-[10px] tracking-[0.16em] uppercase text-zinc-500">
              <tr>
                <Th>Source</Th>
                <Th align="right">Sessions</Th>
                <Th align="right">Profile done</Th>
                <Th align="right">Profile %</Th>
                <Th align="right">Checkout</Th>
                <Th align="right">Checkout %</Th>
                <Th align="right">Purchases</Th>
                <Th align="right">Revenue</Th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-8 text-zinc-600">
                    {loading ? "Loading…" : "No data."}
                  </td>
                </tr>
              ) : (
                rows.map((r) => {
                  const rProfileRate = pct(r.quiz_completed, r.sessions);
                  const rCheckoutCount = r.checkout_clicked || r.begin_checkout;
                  const rCheckoutRate = pct(rCheckoutCount, r.quiz_completed);
                  const isFocused = sourceFocus === r.source;
                  return (
                    <tr
                      key={r.source}
                      onClick={() =>
                        setSourceFocus((cur) => (cur === r.source ? null : r.source))
                      }
                      className={
                        "border-t border-zinc-800/60 hover:bg-zinc-800/40 cursor-pointer transition-colors" +
                        (isFocused ? " bg-blue-500/10 hover:bg-blue-500/15 ring-1 ring-blue-500/30" : "")
                      }
                    >
                      <td className="px-4 py-2.5">
                        <div className="text-zinc-100">{r.source_label}</div>
                      </td>
                      <Td align="right">{fmtInt.format(r.sessions)}</Td>
                      <Td align="right">{fmtInt.format(r.quiz_completed)}</Td>
                      <Td
                        align="right"
                        className={
                          benchmarks?.profile_rate
                            ? BAND_CLASS[bandColor(rProfileRate, benchmarks.profile_rate)]
                            : undefined
                        }
                      >
                        {fmtPct(rProfileRate, 1)}
                      </Td>
                      <Td align="right">{fmtInt.format(rCheckoutCount)}</Td>
                      <Td
                        align="right"
                        className={
                          benchmarks?.checkout_rate
                            ? BAND_CLASS[bandColor(rCheckoutRate, benchmarks.checkout_rate)]
                            : undefined
                        }
                      >
                        {fmtPct(rCheckoutRate, 1)}
                      </Td>
                      <Td align="right">{fmtInt.format(r.new_purchases)}</Td>
                      <Td align="right">{fmtMoney.format(r.new_revenue_cents / 100)}</Td>
                    </tr>
                  );
                })
              )}
            </tbody>
            {rows.length > 0 ? (
              <tfoot>
                <tr className="border-t-2 border-zinc-700 bg-zinc-900/80 font-medium">
                  <td className="px-4 py-3 text-zinc-300">Total</td>
                  <Td align="right">{fmtInt.format(total.sessions)}</Td>
                  <Td align="right">{fmtInt.format(total.quiz_completed)}</Td>
                  <Td align="right">{fmtPct(profileRate, 1)}</Td>
                  <Td align="right">{fmtInt.format(checkoutCount)}</Td>
                  <Td align="right">{fmtPct(checkoutRate, 1)}</Td>
                  <Td align="right">{fmtInt.format(total.new_purchases)}</Td>
                  <Td align="right">{fmtMoney.format(total.new_revenue_cents / 100)}</Td>
                </tr>
              </tfoot>
            ) : null}
          </table>
        </div>
      </div>

      <div className="max-w-[1400px] mx-auto mt-6 p-4 rounded-xl bg-zinc-900/50 ring-1 ring-zinc-800/50 text-xs text-zinc-500">
        <div className="tracking-[0.18em] uppercase text-zinc-400 mb-2">How organic is attributed</div>
        <p>
          Sessions are counted distinct by PostHog $session_id where the referring domain is
          not a known paid source and the URL has no gclid/utm_medium=cpc. Returning visitors
          credit their first organic touch within the prior 60 days. Purchases require an
          organic referrer in PostHog history — paid-attributed buyers are excluded so we
          never double-count them here.
        </p>
        <p className="mt-2 text-zinc-600">
          Step-rate benchmarks reuse the paid funnel’s reverse-engineered bands (anchored at
          CAC $40–$80, 50% checkout→purchase). The funnel runs session → profile directly, with
          the profile rate widened to 5–15% since organic sessions include non-LP entry points
          like the homepage and blog. Direct/untagged traffic is excluded — only tracked
          referrers count here.
        </p>
      </div>
    </>
  );
}
