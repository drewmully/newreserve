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

import { useEffect, useMemo, useState, useCallback, useId } from "react";
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

// ─── Sankey chart — multi-source horizontal flow ─────────────────────────────
//
// One compact SVG with N source rows on the left, ribbons flowing rightward
// through 3 stages (Visits → Checkout → Purchase). Each row's vertical height
// is proportional to its visits, and the ribbon narrows as users drop off
// between stages. Drop-off fades into a faint gutter on the right of each
// stage so the loss is visible without dominating the chart.

interface SankeySource {
  key: string;
  label: string;
  stages: FunnelStages;
  highlight?: boolean;
}

function Sankey({
  sources,
  height = 280,
}: {
  sources: SankeySource[];
  height?: number;
}) {
  // Layout constants
  const W = 600;
  const H = height;
  const PAD_T = 18;
  const PAD_B = 24;
  const LABEL_W = 130;
  const NODE_W = 10;
  // The three stage "slots" sit to the right of the label column. The
  // remaining horizontal space is split into 3 equal-width ribbon segments.
  const chartLeft = LABEL_W;
  const chartRight = W - 16;
  const chartW = chartRight - chartLeft;
  const stageW = (chartW - NODE_W * 4) / 3; // 4 node columns, 3 ribbons between
  const stageX = [
    chartLeft, // visits node
    chartLeft + NODE_W + stageW, // checkout node
    chartLeft + (NODE_W + stageW) * 2, // purchase node
    chartLeft + (NODE_W + stageW) * 3 - NODE_W, // (unused trailing)
  ];

  // Filter out totally empty sources, sort by visits desc
  const rows = sources
    .filter((s) => s.stages.visits > 0)
    .slice()
    .sort((a, b) => b.stages.visits - a.stages.visits);

  const totalVisits = rows.reduce((s, r) => s + r.stages.visits, 0) || 1;
  const innerH = H - PAD_T - PAD_B;
  const rowGap = Math.min(8, innerH / Math.max(rows.length * 4, 8));
  const usableH = innerH - rowGap * Math.max(rows.length - 1, 0);

  // Compute y-positions per row (height ∝ visits share of total)
  const placed = rows.reduce<
    Array<SankeySource & { y: number; h: number }>
  >((acc, r) => {
    const h = Math.max(4, (r.stages.visits / totalVisits) * usableH);
    const prev = acc[acc.length - 1];
    const y = prev ? prev.y + prev.h + rowGap : PAD_T;
    acc.push({ ...r, y, h });
    return acc;
  }, []);

  const STAGE_COLOR = {
    visits: STAGE.visits.bg,
    checkouts: STAGE.checkouts.bg,
    purchases: STAGE.purchases.bg,
  };

  // Gradient ID prefix — unique per chart instance so multiple Sankeys on
  // one page don't collide. useId() gives a stable, SSR-safe unique id.
  const rawId = useId();
  const gradId = `sk${rawId.replace(/[^a-zA-Z0-9]/g, "")}`;

  if (placed.length === 0) {
    return (
      <p className="text-sm text-charcoal/40 px-2 py-8 text-center">
        No traffic in window.
      </p>
    );
  }

  return (
    <div className="w-full overflow-x-auto">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width="100%"
        height={H}
        role="img"
        style={{ display: "block" }}
      >
        <defs>
          {/* Gradients per segment, so ribbons feel "flowy" */}
          <linearGradient id={`${gradId}-vc`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={STAGE_COLOR.visits} stopOpacity="0.85" />
            <stop offset="100%" stopColor={STAGE_COLOR.checkouts} stopOpacity="0.85" />
          </linearGradient>
          <linearGradient id={`${gradId}-cp`} x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor={STAGE_COLOR.checkouts} stopOpacity="0.85" />
            <stop offset="100%" stopColor={STAGE_COLOR.purchases} stopOpacity="0.9" />
          </linearGradient>
        </defs>

        {/* Stage column headers */}
        <g fontSize="9" fontFamily="ui-monospace, monospace" fill="#9A958A">
          <text x={stageX[0] + NODE_W / 2} y={10} textAnchor="middle">VISITS</text>
          <text x={stageX[1] + NODE_W / 2} y={10} textAnchor="middle">CHECKOUT</text>
          <text x={stageX[2] + NODE_W / 2} y={10} textAnchor="middle">PURCHASE</text>
        </g>

        {placed.map((r) => {
          const v = r.stages.visits;
          const c = r.stages.checkouts;
          const p = r.stages.purchases;

          // Heights at each stage (proportional to count within this row,
          // anchored at the top of the row's band).
          const hV = r.h;
          const hC = v > 0 ? (c / v) * r.h : 0;
          const hP = v > 0 ? (p / v) * r.h : 0;

          // Visual minimums so non-zero stages are visible.
          const visHC = c > 0 ? Math.max(hC, 2) : 0;
          const visHP = p > 0 ? Math.max(hP, 2) : 0;

          // Vertical centers for ribbon endpoints
          const y0 = r.y; // row top
          const yV = y0;
          const yC = y0;
          const yP = y0;

          // Ribbon path: cubic bezier from (x1, top) curving to (x2, top), with
          // bottom edge connecting back from (x2, top+hRight) to (x1, top+hLeft).
          const ribbon = (
            x1: number,
            x2: number,
            yL: number,
            yR: number,
            hL: number,
            hR: number
          ) => {
            const mid = (x1 + x2) / 2;
            return (
              `M ${x1} ${yL} ` +
              `C ${mid} ${yL}, ${mid} ${yR}, ${x2} ${yR} ` +
              `L ${x2} ${yR + hR} ` +
              `C ${mid} ${yR + hR}, ${mid} ${yL + hL}, ${x1} ${yL + hL} Z`
            );
          };

          // Stage 1 → 2 ribbon (visits → checkouts)
          const x1 = stageX[0] + NODE_W;
          const x2 = stageX[1];
          // Stage 2 → 3 ribbon (checkouts → purchases)
          const x3 = stageX[1] + NODE_W;
          const x4 = stageX[2];

          return (
            <g key={r.key}>
              {/* Label (left) */}
              <text
                x={chartLeft - 10}
                y={r.y + r.h / 2 + 3}
                textAnchor="end"
                fontSize="10"
                fontFamily="ui-monospace, monospace"
                fill={r.highlight ? "#D4772C" : "#111111"}
              >
                <title>{`${r.label}\n${num(v)} visits · ${num(c)} checkout · ${num(p)} purchase · ${pctStr(p, v)} CVR`}</title>
                {r.label.length > 18 ? r.label.slice(0, 17) + "…" : r.label}
              </text>
              <text
                x={chartLeft - 10}
                y={r.y + r.h / 2 + 14}
                textAnchor="end"
                fontSize="8"
                fontFamily="ui-monospace, monospace"
                fill="#9A958A"
              >
                {num(v)} · {pctStr(p, v)}
              </text>

              {/* Visit node */}
              <rect
                x={stageX[0]}
                y={yV}
                width={NODE_W}
                height={hV}
                fill={STAGE_COLOR.visits}
                opacity={r.highlight ? 0.95 : 0.85}
                rx="2"
              >
                <title>{`${r.label} — ${num(v)} visits`}</title>
              </rect>
              {/* Checkout node */}
              <rect
                x={stageX[1]}
                y={yC}
                width={NODE_W}
                height={visHC}
                fill={STAGE_COLOR.checkouts}
                opacity="0.9"
                rx="2"
              >
                <title>{`${r.label} — ${num(c)} checkout (${pctStr(c, v)})`}</title>
              </rect>
              {/* Purchase node */}
              <rect
                x={stageX[2]}
                y={yP}
                width={NODE_W}
                height={visHP}
                fill={STAGE_COLOR.purchases}
                opacity="0.95"
                rx="2"
              >
                <title>{`${r.label} — ${num(p)} purchase (${pctStr(p, v)} of visits)`}</title>
              </rect>

              {/* Visits → Checkout ribbon */}
              <path
                d={ribbon(x1, x2, yV, yC, hV, visHC)}
                fill={`url(#${gradId}-vc)`}
                opacity="0.55"
              />
              {/* Checkout → Purchase ribbon */}
              <path
                d={ribbon(x3, x4, yC, yP, visHC, visHP)}
                fill={`url(#${gradId}-cp)`}
                opacity="0.7"
              />
            </g>
          );
        })}

        {/* Footer legend */}
        <g fontSize="8" fontFamily="ui-monospace, monospace" fill="#9A958A">
          <text x={chartLeft - 10} y={H - 6} textAnchor="end">source</text>
          <text x={chartRight} y={H - 6} textAnchor="end">{num(totalVisits)} total visits</text>
        </g>
      </svg>
    </div>
  );
}

// ─── Top-level funnel summary (3 stacked horizontal mega-bars) ────────────────

function FunnelSummary({ totals }: { totals: FunnelStages }) {
  const { visits, checkouts, purchases } = totals;
  const cvrV2C = visits > 0 ? checkouts / visits : 0;
  const cvrC2P = checkouts > 0 ? purchases / checkouts : 0;

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
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
              {/* Landing-page Sankey */}
              <div className="bg-white border border-taupe/20 rounded-xl p-4">
                <div className="flex items-baseline justify-between mb-3 gap-3">
                  <div>
                    <h3 className="font-serif text-base text-obsidian">By landing page</h3>
                    <p className="text-[10px] text-charcoal/40 mt-0.5">
                      First page → checkout → purchase
                    </p>
                  </div>
                  <div className="flex items-center gap-1 bg-bone rounded-md p-0.5">
                    <button
                      onClick={() => setPathView("buckets")}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                        pathView === "buckets"
                          ? "bg-white text-obsidian shadow-sm"
                          : "text-charcoal/50 hover:text-obsidian"
                      }`}
                    >
                      Buckets
                    </button>
                    <button
                      onClick={() => setPathView("all")}
                      className={`text-[10px] px-2 py-0.5 rounded transition-colors ${
                        pathView === "all"
                          ? "bg-white text-obsidian shadow-sm"
                          : "text-charcoal/50 hover:text-obsidian"
                      }`}
                    >
                      All paths
                    </button>
                  </div>
                </div>
                <Sankey
                  sources={pathRows.map((r) => ({
                    key: r.key,
                    label: r.label,
                    stages: r.stages,
                    highlight: r.highlight,
                  }))}
                  height={pathView === "all" ? 340 : 240}
                />
              </div>

              {/* Channel Sankey */}
              <div className="bg-white border border-taupe/20 rounded-xl p-4">
                <div className="flex items-baseline justify-between mb-3 gap-3">
                  <div>
                    <h3 className="font-serif text-base text-obsidian">By channel</h3>
                    <p className="text-[10px] text-charcoal/40 mt-0.5">
                      Acquisition channel → checkout → purchase
                    </p>
                  </div>
                </div>
                <Sankey
                  sources={data.funnel.channels.map((c) => ({
                    key: c.channel,
                    label: c.label,
                    stages: {
                      visits: c.visits,
                      checkouts: c.checkouts,
                      purchases: c.purchases,
                    },
                    highlight: c.visits > 100 && c.purchases === 0,
                  }))}
                  height={240}
                />
              </div>
            </div>

            {/* Shared legend below both charts */}
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
                Hover ribbons for details · Orange label = needs attention
              </span>
            </div>
          </section>

          {/* ── Channel funnel ───────────────────────────────────────────── */}

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
