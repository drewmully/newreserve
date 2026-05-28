"use client";

/**
 * /admin/marketing-funnel  (v4)
 *
 * Session-based funnel with colorful Sankey-style visualization.
 *
 *  - KPI row (new members, new revenue, ad spend, CAC)
 *  - Renewals + pro-shop sub-row
 *  - Landing-page funnel (path buckets: home / lp_subscription / lp_gift /
 *    lp_other / other), with "All paths" toggle
 *  - Per-channel funnel (same 3 stages)
 *  - Ad platforms · Email flows
 */

import { useEffect, useMemo, useState, useCallback } from "react";
import { useMembership } from "@/app/context/MembershipContext";

type Tier = "free" | "access" | "member" | "back9";
type Period = "today" | "week" | "month" | "custom";
type PathView = "buckets" | "all";

interface FunnelStages {
  visits: number;
  checkouts: number;
  purchases: number;
}

interface AdPlatform {
  available: boolean;
  reason?: string;
  spend_cents: number;
  clicks: number;
  conversions: number;
  impressions: number;
}

interface ApiResponse {
  window: { start: string; end: string };
  headline: {
    new_reserve_members: number;
    new_reserve_revenue_cents: number;
    new_reserve_access: number;
    new_reserve_member: number;
    new_reserve_other: number;
    renewals: number;
    renewal_revenue_cents: number;
    pro_shop_orders: number;
    pro_shop_revenue_cents: number;
    ad_spend_cents: number;
    cac_cents: number;
  };
  funnel: {
    totals: FunnelStages;
    path_buckets: Array<
      FunnelStages & {
        bucket: "home" | "lp_subscription" | "lp_gift" | "lp_other" | "other";
        label: string;
      }
    >;
    channels: Array<FunnelStages & { channel: string; label: string }>;
    all_paths: Array<
      FunnelStages & {
        path: string;
        bucket: "home" | "lp_subscription" | "lp_gift" | "lp_other" | "other";
      }
    >;
    unattributed_purchases: number;
    shopify_new_members: number;
  };
  ad_platforms: {
    google_ads: AdPlatform;
    x_ads: AdPlatform;
  };
  email_flows: Record<
    Tier,
    {
      users: { active: number; paused: number; completed: number; total: number };
      steps: Array<{
        step: number;
        delayDays: number;
        sent: number;
        opened: number;
        clicked: number;
        replied: number;
        purchased: number;
      }>;
    }
  >;
  meta: Record<string, number | string[]>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FLOW_ORDER: Tier[] = ["free", "access", "member", "back9"];
const FLOW_LABELS: Record<Tier, string> = {
  free: "Free",
  access: "Reserve Access",
  member: "Reserve Member",
  back9: "Back 9 (Legacy)",
};

function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}
function dollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined) return "$0";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
}
function pctStr(n: number, d: number): string {
  if (!d) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}
function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}
function daysAgoISO(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString().slice(0, 10);
}
function firstOfMonthISO(): string {
  const d = new Date();
  d.setUTCDate(1);
  return d.toISOString().slice(0, 10);
}

// Stage colors — vibrant + meaningful. Inline so Tailwind JIT doesn't drop them.
const STAGE = {
  visits: { bg: "#1F3D2B", text: "#1F3D2B", light: "#E5EBE6" }, // forest
  checkouts: { bg: "#20808D", text: "#20808D", light: "#E1F0F2" }, // teal
  purchases: { bg: "#D4772C", text: "#D4772C", light: "#FBEEDF" }, // ember
} as const;

// CVR severity → coloring
function cvrTone(rate: number, target = 0.02): "good" | "warn" | "bad" {
  if (rate >= target) return "good";
  if (rate >= target * 0.4) return "warn";
  return "bad";
}

// ─── Small UI primitives ──────────────────────────────────────────────────────

function KPICard({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "default" | "positive" | "warning";
}) {
  const accent =
    tone === "positive"
      ? "border-forest/40"
      : tone === "warning"
      ? "border-ember/40"
      : "border-taupe/20";
  return (
    <div className={`bg-white border ${accent} rounded-xl p-5`}>
      <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-2">
        {label}
      </p>
      <p className="font-serif text-3xl text-obsidian">{value}</p>
      {sub && <p className="text-xs text-charcoal/50 mt-1">{sub}</p>}
    </div>
  );
}

function SectionHeading({
  title,
  hint,
  right,
}: {
  title: string;
  hint?: string;
  right?: React.ReactNode;
}) {
  return (
    <div className="flex items-baseline justify-between mb-4 gap-4">
      <div className="flex items-baseline gap-3">
        <h2 className="font-serif text-xl text-obsidian">{title}</h2>
        {hint && <p className="text-xs text-charcoal/40">{hint}</p>}
      </div>
      {right}
    </div>
  );
}

// ─── Funnel row — Sankey-style 3-stage with absolute drop-off ─────────────────

function FunnelRow({
  label,
  stages,
  maxVisits,
  highlight = false,
}: {
  label: string;
  stages: FunnelStages;
  maxVisits: number;
  highlight?: boolean;
}) {
  const { visits, checkouts, purchases } = stages;

  // proportional widths relative to global max
  const wV = maxVisits > 0 ? (visits / maxVisits) * 100 : 0;
  const wC = maxVisits > 0 ? (checkouts / maxVisits) * 100 : 0;
  const wP = maxVisits > 0 ? (purchases / maxVisits) * 100 : 0;

  const cvrCo = visits > 0 ? checkouts / visits : 0;
  const cvrPu = visits > 0 ? purchases / visits : 0;

  const overallTone = cvrTone(cvrPu, 0.005); // ≥ 0.5% overall is "ok"

  return (
    <div
      className={`rounded-xl p-4 border transition-colors ${
        highlight
          ? "border-ember/40 bg-ember/5"
          : "border-taupe/15 bg-white"
      }`}
    >
      <div className="flex items-baseline justify-between mb-3 gap-3">
        <p className="font-mono text-sm text-obsidian truncate">{label}</p>
        <div className="flex items-center gap-2">
          <span
            className={`text-[10px] uppercase tracking-widest font-medium px-2 py-0.5 rounded-full ${
              overallTone === "good"
                ? "bg-forest/10 text-forest"
                : overallTone === "warn"
                ? "bg-ember/10 text-ember"
                : "bg-charcoal/5 text-charcoal/40"
            }`}
          >
            {pctStr(purchases, visits)} CVR
          </span>
        </div>
      </div>

      <div className="space-y-1.5">
        {/* Visits */}
        <FunnelBar
          stageLabel="Visits"
          count={visits}
          widthPct={wV}
          color={STAGE.visits}
          rightLabel={null}
        />
        {/* Checkouts */}
        <FunnelBar
          stageLabel="Checkout"
          count={checkouts}
          widthPct={wC}
          color={STAGE.checkouts}
          rightLabel={`${pctStr(checkouts, visits)} of visits`}
          rightTone={cvrTone(cvrCo, 0.01)}
        />
        {/* Purchases */}
        <FunnelBar
          stageLabel="Purchase"
          count={purchases}
          widthPct={wP}
          color={STAGE.purchases}
          rightLabel={
            checkouts > 0
              ? `${pctStr(purchases, checkouts)} of checkouts`
              : null
          }
          rightTone={cvrTone(checkouts > 0 ? purchases / checkouts : 0, 0.2)}
          bold
        />
      </div>
    </div>
  );
}

function FunnelBar({
  stageLabel,
  count,
  widthPct,
  color,
  rightLabel,
  rightTone,
  bold = false,
}: {
  stageLabel: string;
  count: number;
  widthPct: number;
  color: { bg: string; text: string; light: string };
  rightLabel: string | null;
  rightTone?: "good" | "warn" | "bad";
  bold?: boolean;
}) {
  // Ensure tiny bars are still visible
  const visualWidth = count > 0 ? Math.max(widthPct, 1.5) : 0;
  return (
    <div className="flex items-center gap-3 text-xs">
      <span className="w-20 shrink-0" style={{ color: color.text }}>
        {stageLabel}
      </span>
      <div className="flex-1 h-6 rounded-md overflow-hidden relative">
        <div
          className="absolute inset-0 rounded-md"
          style={{ background: color.light }}
        />
        <div
          className="h-full rounded-md transition-all duration-500 ease-out"
          style={{
            width: `${visualWidth}%`,
            background: `linear-gradient(90deg, ${color.bg} 0%, ${color.bg}E0 100%)`,
          }}
        />
      </div>
      <span
        className={`w-12 text-right tabular-nums ${
          bold ? "font-semibold text-obsidian" : "text-obsidian"
        }`}
      >
        {num(count)}
      </span>
      <span
        className={`w-28 text-right text-[10px] ${
          rightTone === "good"
            ? "text-forest"
            : rightTone === "warn"
            ? "text-ember"
            : rightTone === "bad"
            ? "text-charcoal/40"
            : "text-charcoal/40"
        }`}
      >
        {rightLabel ?? ""}
      </span>
    </div>
  );
}

// ─── Top-level funnel summary (3 stacked horizontal mega-bars) ────────────────

function FunnelSummary({ totals }: { totals: FunnelStages }) {
  const { visits, checkouts, purchases } = totals;
  const cvrV2C = visits > 0 ? checkouts / visits : 0;
  const cvrC2P = checkouts > 0 ? purchases / checkouts : 0;
  const cvrOverall = visits > 0 ? purchases / visits : 0;

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-6">
      <StageTile
        label="Visits"
        value={num(visits)}
        sub="Tracked sessions"
        color={STAGE.visits}
        cvr={null}
      />
      <StageTile
        label="Checkout"
        value={num(checkouts)}
        sub={`${pctStr(checkouts, visits)} of visits`}
        color={STAGE.checkouts}
        cvr={cvrV2C}
        cvrTarget={0.02}
        arrow
      />
      <StageTile
        label="Purchase"
        value={num(purchases)}
        sub={`${pctStr(purchases, checkouts)} of checkouts · ${pctStr(
          purchases,
          visits
        )} overall`}
        color={STAGE.purchases}
        cvr={cvrC2P}
        cvrTarget={0.3}
        arrow
      />
    </div>
  );
}

function StageTile({
  label,
  value,
  sub,
  color,
  cvr,
  cvrTarget = 0.02,
  arrow = false,
}: {
  label: string;
  value: string;
  sub: string;
  color: { bg: string; text: string; light: string };
  cvr: number | null;
  cvrTarget?: number;
  arrow?: boolean;
}) {
  const tone = cvr !== null ? cvrTone(cvr, cvrTarget) : "good";
  return (
    <div
      className="rounded-xl p-5 border relative overflow-hidden"
      style={{ borderColor: `${color.bg}33`, background: color.light }}
    >
      {arrow && (
        <div
          className="hidden md:block absolute -left-3 top-1/2 -translate-y-1/2 w-6 h-6 rotate-45 bg-cream border-r border-b"
          style={{ borderColor: `${color.bg}33` }}
        />
      )}
      <div className="flex items-baseline justify-between">
        <p
          className="text-xs uppercase tracking-widest font-medium"
          style={{ color: color.text }}
        >
          {label}
        </p>
        {cvr !== null && (
          <span
            className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${
              tone === "good"
                ? "bg-forest text-white"
                : tone === "warn"
                ? "bg-ember text-white"
                : "bg-charcoal/30 text-white"
            }`}
          >
            {(cvr * 100).toFixed(1)}%
          </span>
        )}
      </div>
      <p className="font-serif text-3xl text-obsidian mt-2" style={{ color: color.text }}>
        {value}
      </p>
      <p className="text-xs text-charcoal/60 mt-1">{sub}</p>
    </div>
  );
}

// ─── Ad platform card ─────────────────────────────────────────────────────────

function AdPlatformCard({
  name,
  platform,
}: {
  name: string;
  platform: AdPlatform;
}) {
  if (!platform.available) {
    return (
      <div className="bg-white border border-ember/30 rounded-xl p-5">
        <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-2">
          {name}
        </p>
        <p className="font-serif text-lg text-ember">Needs config</p>
        {platform.reason && (
          <p className="text-xs text-charcoal/50 mt-1">{platform.reason}</p>
        )}
      </div>
    );
  }
  return (
    <div className="bg-white border border-taupe/20 rounded-xl p-5">
      <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-2">
        {name}
      </p>
      <p className="font-serif text-3xl text-obsidian">
        {dollars(platform.spend_cents)}
      </p>
      <div className="grid grid-cols-3 gap-2 mt-3 text-xs">
        <div>
          <p className="text-charcoal/40">Clicks</p>
          <p className="text-obsidian">{num(platform.clicks)}</p>
        </div>
        <div>
          <p className="text-charcoal/40">Conv.</p>
          <p className="text-obsidian">{num(Math.round(platform.conversions))}</p>
        </div>
        <div>
          <p className="text-charcoal/40">Impr.</p>
          <p className="text-obsidian">{num(platform.impressions)}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Email flow table + drill-in modal ────────────────────────────────────────

interface PreviewState {
  flow: Tier;
  step: number;
  loading: boolean;
  subject?: string;
  text?: string;
  error?: string;
}

function EmailFlowTable({
  flow,
  data,
  onStepClick,
}: {
  flow: Tier;
  data: ApiResponse["email_flows"][Tier];
  onStepClick: (flow: Tier, step: number) => void;
}) {
  const totalSent = data.steps[0]?.sent ?? 0;
  return (
    <div className="bg-white border border-taupe/20 rounded-xl p-5">
      <div className="flex items-baseline justify-between mb-3">
        <h3 className="font-serif text-lg text-obsidian">{FLOW_LABELS[flow]}</h3>
        <p className="text-xs text-charcoal/40">
          {data.users.total} users · {data.users.active} active
        </p>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-widest text-charcoal/40 border-b border-taupe/20">
              <th className="py-2 font-normal">Step</th>
              <th className="py-2 font-normal text-right">Sent</th>
              <th className="py-2 font-normal text-right">Open%</th>
              <th className="py-2 font-normal text-right">Click%</th>
              <th className="py-2 font-normal text-right">Replies</th>
              <th className="py-2 font-normal text-right">Purchased</th>
            </tr>
          </thead>
          <tbody>
            {data.steps.map((s) => {
              const openPct = s.sent > 0 ? (s.opened / s.sent) * 100 : 0;
              const clickPct = s.sent > 0 ? (s.clicked / s.sent) * 100 : 0;
              const lowEngagement =
                s.sent > 0 && s.opened === 0 && s.clicked === 0;
              return (
                <tr
                  key={s.step}
                  className="border-b border-taupe/10 hover:bg-cream/50 cursor-pointer"
                  onClick={() => onStepClick(flow, s.step)}
                >
                  <td className="py-2">
                    <span className="text-obsidian">Day {s.delayDays}</span>
                    <span className="text-charcoal/40 text-xs ml-2">
                      #{s.step}
                    </span>
                  </td>
                  <td className="py-2 text-right">{num(s.sent)}</td>
                  <td
                    className={`py-2 text-right ${
                      lowEngagement ? "text-ember" : "text-charcoal/70"
                    }`}
                  >
                    {openPct.toFixed(0)}%
                  </td>
                  <td
                    className={`py-2 text-right ${
                      lowEngagement ? "text-ember" : "text-charcoal/70"
                    }`}
                  >
                    {clickPct.toFixed(0)}%
                  </td>
                  <td className="py-2 text-right text-charcoal/70">
                    {num(s.replied)}
                  </td>
                  <td className="py-2 text-right text-forest font-medium">
                    {num(s.purchased)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {totalSent > 0 &&
        data.steps.length >= 4 &&
        data.steps.slice(2).every((s) => s.sent === 0 || s.opened + s.clicked === 0) && (
          <p className="text-xs text-ember mt-3">
            Engagement drops to zero after day {data.steps[2]?.delayDays}. Consider
            pausing later sends.
          </p>
        )}
    </div>
  );
}

function EmailPreviewModal({
  preview,
  onClose,
}: {
  preview: PreviewState | null;
  onClose: () => void;
}) {
  if (!preview) return null;
  return (
    <div
      className="fixed inset-0 bg-obsidian/60 z-50 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-taupe/20 p-5 flex items-center justify-between">
          <div>
            <p className="text-xs uppercase tracking-widest text-charcoal/40">
              {FLOW_LABELS[preview.flow]} · Step {preview.step}
            </p>
            <p className="font-serif text-lg text-obsidian mt-1">
              {preview.loading
                ? "Loading…"
                : preview.error
                ? "Failed to load"
                : preview.subject}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-charcoal/40 hover:text-obsidian text-sm"
          >
            Close
          </button>
        </div>
        <div className="p-5 overflow-y-auto">
          {preview.loading && (
            <p className="text-sm text-charcoal/40">Rendering email…</p>
          )}
          {preview.error && (
            <p className="text-sm text-ember">{preview.error}</p>
          )}
          {preview.text && (
            <pre className="whitespace-pre-wrap text-sm text-obsidian font-sans leading-relaxed">
              {preview.text}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function MarketingFunnelPage() {
  const { user: adminUser, authLoading } = useMembership();
  const [period, setPeriod] = useState<Period>("week");
  const [customStart, setCustomStart] = useState<string>(daysAgoISO(6));
  const [customEnd, setCustomEnd] = useState<string>(todayISO());
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const [pathView, setPathView] = useState<PathView>("buckets");

  const computeWindow = useCallback((): { start: string; end: string } => {
    if (period === "today") return { start: todayISO(), end: todayISO() };
    if (period === "week") return { start: daysAgoISO(6), end: todayISO() };
    if (period === "month") return { start: firstOfMonthISO(), end: todayISO() };
    return { start: customStart, end: customEnd };
  }, [period, customStart, customEnd]);

  const authHeaders = useCallback(async (): Promise<HeadersInit | null> => {
    if (!adminUser) return null;
    const token = await adminUser.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }, [adminUser]);

  const fetchData = useCallback(async () => {
    if (authLoading || !adminUser) return;
    setLoading(true);
    setError(null);
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error("Not signed in");
      const { start, end } = computeWindow();
      const res = await fetch(
        `/api/admin/marketing-funnel?start=${start}&end=${end}`,
        { headers }
      );
      if (!res.ok) {
        const e = await res.json().catch(() => ({}));
        throw new Error(e.error || `HTTP ${res.status}`);
      }
      const json = (await res.json()) as ApiResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [adminUser, authLoading, authHeaders, computeWindow]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const openPreview = useCallback(
    async (flow: Tier, step: number) => {
      if (!adminUser) return;
      setPreview({ flow, step, loading: true });
      try {
        const headers = await authHeaders();
        if (!headers) throw new Error("Not signed in");
        const res = await fetch(
          `/api/admin/marketing-funnel/email-preview?flow=${flow}&step=${step}`,
          { headers }
        );
        if (!res.ok) {
          const e = await res.json().catch(() => ({}));
          throw new Error(e.error || `HTTP ${res.status}`);
        }
        const json = (await res.json()) as {
          flow: Tier;
          step: number;
          subject: string;
          text: string;
        };
        setPreview({
          flow,
          step,
          loading: false,
          subject: json.subject,
          text: json.text,
        });
      } catch (err) {
        setPreview({
          flow,
          step,
          loading: false,
          error: err instanceof Error ? err.message : "Failed",
        });
      }
    },
    [adminUser, authHeaders]
  );

  // ── Compute maxes for proportional bars (across all funnel rows shown) ───
  const pathRows = useMemo(() => {
    if (!data) return [] as Array<{ key: string; label: string; stages: FunnelStages; highlight: boolean }>;
    if (pathView === "buckets") {
      return data.funnel.path_buckets.map((b) => ({
        key: b.bucket,
        label: b.label,
        stages: { visits: b.visits, checkouts: b.checkouts, purchases: b.purchases },
        highlight:
          b.visits > 100 && b.purchases === 0 && b.checkouts < 2,
      }));
    }
    return data.funnel.all_paths.map((p) => ({
      key: p.path,
      label: p.path,
      stages: { visits: p.visits, checkouts: p.checkouts, purchases: p.purchases },
      highlight: false,
    }));
  }, [data, pathView]);

  const maxPathVisits = useMemo(
    () => Math.max(1, ...pathRows.map((r) => r.stages.visits)),
    [pathRows]
  );

  const maxChannelVisits = useMemo(() => {
    if (!data) return 1;
    return Math.max(1, ...data.funnel.channels.map((c) => c.visits));
  }, [data]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      {/* Header + period picker */}
      <div className="flex items-end justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl text-obsidian">Marketing</h1>
          {data && (
            <p className="text-xs text-charcoal/40 mt-1">
              {data.window.start} → {data.window.end}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(["today", "week", "month", "custom"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-xs px-3 py-1.5 rounded border transition-colors ${
                period === p
                  ? "bg-forest text-white border-forest"
                  : "bg-white text-charcoal/70 border-taupe/30 hover:border-charcoal/40"
              }`}
            >
              {p === "today"
                ? "Today"
                : p === "week"
                ? "7 days"
                : p === "month"
                ? "Month"
                : "Custom"}
            </button>
          ))}
          {period === "custom" && (
            <>
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="text-xs border border-taupe/30 rounded px-2 py-1"
              />
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="text-xs border border-taupe/30 rounded px-2 py-1"
              />
            </>
          )}
          <button
            onClick={fetchData}
            className="text-xs px-3 py-1.5 rounded bg-obsidian text-white"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-ember/10 border border-ember/30 rounded-lg p-4 mb-6">
          <p className="text-sm text-ember">{error}</p>
        </div>
      )}

      {data && (
        <>
          {/* ── Headline KPIs ─────────────────────────────────────────────── */}
          <section className="mb-3">
            <SectionHeading
              title="New reserve members"
              hint="Loop auto-renewals excluded"
            />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KPICard
                label="New members"
                value={num(data.headline.new_reserve_members)}
                sub={
                  [
                    data.headline.new_reserve_access > 0 &&
                      `${data.headline.new_reserve_access} Access`,
                    data.headline.new_reserve_member > 0 &&
                      `${data.headline.new_reserve_member} Member`,
                    data.headline.new_reserve_other > 0 &&
                      `${data.headline.new_reserve_other} other`,
                  ]
                    .filter(Boolean)
                    .join(" · ") || "—"
                }
                tone="positive"
              />
              <KPICard
                label="New revenue"
                value={dollars(data.headline.new_reserve_revenue_cents)}
                sub="From new sign-ups only"
                tone="positive"
              />
              <KPICard
                label="Ad spend"
                value={dollars(data.headline.ad_spend_cents)}
                sub={
                  data.ad_platforms.google_ads.available
                    ? "Live from Google Ads"
                    : "Google Ads needs config"
                }
                tone={
                  data.ad_platforms.google_ads.available ? "default" : "warning"
                }
              />
              <KPICard
                label="CAC"
                value={
                  data.headline.cac_cents > 0
                    ? dollars(data.headline.cac_cents)
                    : "—"
                }
                sub={
                  data.headline.new_reserve_members > 0
                    ? `${data.headline.new_reserve_members} new members`
                    : "No new members"
                }
              />
            </div>
          </section>

          {/* Renewals + pro-shop sub-row */}
          <section className="mb-10">
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-cream border border-taupe/20 rounded-xl p-4">
                <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">
                  Auto-renewals (Loop)
                </p>
                <p className="font-serif text-xl text-obsidian">
                  {num(data.headline.renewals)}
                </p>
                <p className="text-xs text-charcoal/50">
                  {dollars(data.headline.renewal_revenue_cents)} · boring, not
                  new sales
                </p>
              </div>
              <div className="bg-cream border border-taupe/20 rounded-xl p-4">
                <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">
                  Pro shop orders
                </p>
                <p className="font-serif text-xl text-obsidian">
                  {num(data.headline.pro_shop_orders)}
                </p>
                <p className="text-xs text-charcoal/50">
                  {dollars(data.headline.pro_shop_revenue_cents)}
                </p>
              </div>
            </div>
          </section>

          {/* ── Funnel summary ──────────────────────────────────────────── */}
          <section className="mb-10">
            <SectionHeading
              title="Funnel"
              hint={`${num(data.funnel.totals.visits)} tracked sessions · ${num(
                data.funnel.shopify_new_members
              )} Shopify new members${
                data.funnel.unattributed_purchases > 0
                  ? ` (${data.funnel.unattributed_purchases} not yet matched to a session)`
                  : ""
              }`}
            />
            <FunnelSummary totals={data.funnel.totals} />
          </section>

          {/* ── Landing-page funnel ─────────────────────────────────────── */}
          <section className="mb-10">
            <SectionHeading
              title="By landing page"
              hint="First page of session → checkout click → matched Shopify purchase"
              right={
                <div className="flex items-center gap-1 bg-bone rounded-md p-0.5">
                  <button
                    onClick={() => setPathView("buckets")}
                    className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
                      pathView === "buckets"
                        ? "bg-white text-obsidian shadow-sm"
                        : "text-charcoal/50 hover:text-obsidian"
                    }`}
                  >
                    Buckets
                  </button>
                  <button
                    onClick={() => setPathView("all")}
                    className={`text-[11px] px-2.5 py-1 rounded transition-colors ${
                      pathView === "all"
                        ? "bg-white text-obsidian shadow-sm"
                        : "text-charcoal/50 hover:text-obsidian"
                    }`}
                  >
                    All paths
                  </button>
                </div>
              }
            />
            <div className="space-y-3">
              {pathRows.length === 0 ? (
                <p className="text-sm text-charcoal/40">No traffic in window.</p>
              ) : (
                pathRows.map((r) => (
                  <FunnelRow
                    key={r.key}
                    label={r.label}
                    stages={r.stages}
                    maxVisits={maxPathVisits}
                    highlight={r.highlight}
                  />
                ))
              )}
            </div>
            <div className="mt-3 flex items-center gap-4 text-[10px] text-charcoal/40">
              <span className="flex items-center gap-1.5">
                <span
                  className="w-3 h-2 rounded-sm"
                  style={{ background: STAGE.visits.bg }}
                />
                Visits
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="w-3 h-2 rounded-sm"
                  style={{ background: STAGE.checkouts.bg }}
                />
                Checkout
              </span>
              <span className="flex items-center gap-1.5">
                <span
                  className="w-3 h-2 rounded-sm"
                  style={{ background: STAGE.purchases.bg }}
                />
                Purchase
              </span>
              <span className="ml-auto text-ember">
                Highlighted = needs attention
              </span>
            </div>
          </section>

          {/* ── Channel funnel ───────────────────────────────────────────── */}
          <section className="mb-10">
            <SectionHeading
              title="By channel"
              hint="Same 3 stages — see which acquisition channel actually converts"
            />
            <div className="space-y-3">
              {data.funnel.channels.length === 0 ? (
                <p className="text-sm text-charcoal/40">No channel data.</p>
              ) : (
                data.funnel.channels.map((c) => (
                  <FunnelRow
                    key={c.channel}
                    label={c.label}
                    stages={{
                      visits: c.visits,
                      checkouts: c.checkouts,
                      purchases: c.purchases,
                    }}
                    maxVisits={maxChannelVisits}
                    highlight={c.visits > 100 && c.purchases === 0}
                  />
                ))
              )}
            </div>
          </section>

          {/* ── Ad platforms ─────────────────────────────────────────────── */}
          <section className="mb-10">
            <SectionHeading title="Ad platforms" hint="Live data" />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <AdPlatformCard
                name="Google Ads"
                platform={data.ad_platforms.google_ads}
              />
              <AdPlatformCard name="X Ads" platform={data.ad_platforms.x_ads} />
            </div>
          </section>

          {/* ── Email flows ──────────────────────────────────────────────── */}
          <section className="mb-10">
            <SectionHeading
              title="Email flows"
              hint="Click any step to preview"
            />
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {FLOW_ORDER.map((flow) => (
                <EmailFlowTable
                  key={flow}
                  flow={flow}
                  data={data.email_flows[flow]}
                  onStepClick={openPreview}
                />
              ))}
            </div>
          </section>
        </>
      )}

      <EmailPreviewModal
        preview={preview}
        onClose={() => setPreview(null)}
      />
    </div>
  );
}
