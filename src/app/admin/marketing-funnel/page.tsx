"use client";

/**
 * /admin/marketing-funnel  (v2)
 *
 * Health-first marketing dashboard. Top KPIs reflect NEW customers only.
 * Sections (top → bottom):
 *   1. Headline KPIs (new customers, new revenue, ad spend, CAC)
 *   2. Renewals sub-stat row (separate, not counted in KPIs)
 *   3. Landing-page funnel (flowchart by pathname)
 *   4. Ad platforms (live Google Ads + X placeholder)
 *   5. Channel mix
 *   6. Email flows — click step to preview the email + see purchases
 *   7. Pro shop sales
 */

import { useEffect, useState, useCallback } from "react";
import { useMembership } from "@/app/context/MembershipContext";

type Tier = "free" | "access" | "member" | "back9";
type Period = "today" | "week" | "month" | "custom";

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
    brand_new: number;
    brand_new_revenue_cents: number;
    returning_resub: number;
    returning_resub_revenue_cents: number;
    active_new_sales: number;
    active_new_revenue_cents: number;
    renewals: number;
    renewal_revenue_cents: number;
    pro_shop_orders: number;
    pro_shop_revenue_cents: number;
    ad_spend_cents: number;
    cac_cents: number;
  };
  landing_pages: Array<{
    path: string;
    page_views: number;
    checkout_started: number;
    purchases: number;
    cvr_pv_to_purchase: number;
    cvr_pv_to_checkout: number;
  }>;
  funnel_totals: {
    page_views: number;
    checkout_started: number;
    purchases: number;
  };
  channels: Array<{ channel: string; sessions: number }>;
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
  meta: Record<string, number>;
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

function SectionHeading({ title, hint }: { title: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between mb-4">
      <h2 className="font-serif text-xl text-obsidian">{title}</h2>
      {hint && <p className="text-xs text-charcoal/40">{hint}</p>}
    </div>
  );
}

// ─── Landing-page flowchart ───────────────────────────────────────────────────

function LandingPageFlowchart({ rows }: { rows: ApiResponse["landing_pages"] }) {
  if (!rows.length) {
    return (
      <p className="text-sm text-charcoal/40">
        No landing-page traffic in this window.
      </p>
    );
  }
  // Max page_views for proportional bar widths
  const maxPV = Math.max(...rows.map((r) => r.page_views), 1);
  return (
    <div className="space-y-3">
      {rows.map((r) => {
        const widthPV = (r.page_views / maxPV) * 100;
        const widthCO = r.page_views > 0 ? (r.checkout_started / r.page_views) * widthPV : 0;
        const widthPurch = r.page_views > 0 ? (r.purchases / r.page_views) * widthPV : 0;
        return (
          <div
            key={r.path}
            className="border border-taupe/15 rounded-lg p-4 bg-bone/40"
          >
            <div className="flex items-baseline justify-between mb-3">
              <p className="font-mono text-sm text-obsidian">{r.path}</p>
              <p className="text-xs text-charcoal/50">
                {pctStr(r.purchases, r.page_views)} overall CVR
              </p>
            </div>
            <div className="space-y-1.5">
              {/* Landing */}
              <div className="flex items-center gap-3 text-xs">
                <span className="w-24 text-charcoal/60">Landing</span>
                <div className="flex-1 h-5 bg-taupe/10 rounded overflow-hidden">
                  <div
                    className="h-full bg-forest/80 rounded"
                    style={{ width: `${widthPV}%` }}
                  />
                </div>
                <span className="w-16 text-right text-obsidian">
                  {num(r.page_views)}
                </span>
              </div>
              {/* Checkout started */}
              <div className="flex items-center gap-3 text-xs">
                <span className="w-24 text-charcoal/60">Checkout</span>
                <div className="flex-1 h-5 bg-taupe/10 rounded overflow-hidden">
                  <div
                    className="h-full bg-forest rounded"
                    style={{ width: `${widthCO}%` }}
                  />
                </div>
                <span className="w-16 text-right text-obsidian">
                  {num(r.checkout_started)}
                  <span className="text-charcoal/40 ml-1">
                    {pctStr(r.checkout_started, r.page_views)}
                  </span>
                </span>
              </div>
              {/* Purchase */}
              <div className="flex items-center gap-3 text-xs">
                <span className="w-24 text-charcoal/60">Purchase</span>
                <div className="flex-1 h-5 bg-taupe/10 rounded overflow-hidden">
                  <div
                    className="h-full bg-ember rounded"
                    style={{ width: `${widthPurch}%` }}
                  />
                </div>
                <span className="w-16 text-right text-obsidian font-medium">
                  {num(r.purchases)}
                  <span className="text-charcoal/40 ml-1">
                    {pctStr(r.purchases, r.checkout_started)}
                  </span>
                </span>
              </div>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Channel bar ──────────────────────────────────────────────────────────────

function ChannelBar({ rows }: { rows: ApiResponse["channels"] }) {
  const total = rows.reduce((acc, r) => acc + r.sessions, 0);
  if (!total) {
    return <p className="text-sm text-charcoal/40">No channel data.</p>;
  }
  const palette = [
    "bg-forest",
    "bg-ember",
    "bg-taupe",
    "bg-charcoal",
    "bg-forest/70",
    "bg-ember/70",
    "bg-taupe/70",
    "bg-charcoal/70",
  ];
  return (
    <div className="space-y-2">
      <div className="flex w-full h-3 rounded overflow-hidden">
        {rows.slice(0, 8).map((r, i) => {
          const w = (r.sessions / total) * 100;
          return (
            <div
              key={r.channel}
              className={palette[i % palette.length]}
              style={{ width: `${w}%` }}
              title={`${r.channel}: ${r.sessions}`}
            />
          );
        })}
      </div>
      <div className="grid grid-cols-2 md:grid-cols-4 gap-x-4 gap-y-1 text-xs">
        {rows.slice(0, 8).map((r, i) => (
          <div key={r.channel} className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-sm ${palette[i % palette.length]}`}
            />
            <span className="text-charcoal/70 truncate">{r.channel}</span>
            <span className="text-charcoal/40 ml-auto">{r.sessions}</span>
          </div>
        ))}
      </div>
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
          {/* ── Headline KPIs (active new sales) ─────────────────────────── */}
          <section className="mb-3">
            <SectionHeading
              title="Active new sales"
              hint="Auto-renewals excluded"
            />
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              <KPICard
                label="Brand new"
                value={num(data.headline.brand_new)}
                sub={dollars(data.headline.brand_new_revenue_cents)}
                tone="positive"
              />
              <KPICard
                label="Returning resub"
                value={num(data.headline.returning_resub)}
                sub={dollars(data.headline.returning_resub_revenue_cents)}
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
                  data.headline.active_new_sales > 0
                    ? `${data.headline.active_new_sales} active sales`
                    : "No active sales"
                }
              />
            </div>
          </section>

          {/* Renewals + pro-shop sub-row */}
          <section className="mb-10">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <div className="bg-cream border border-taupe/20 rounded-xl p-4">
                <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">
                  Auto-renewals
                </p>
                <p className="font-serif text-xl text-obsidian">
                  {num(data.headline.renewals)}
                </p>
                <p className="text-xs text-charcoal/50">
                  {dollars(data.headline.renewal_revenue_cents)}
                </p>
              </div>
              <div className="bg-cream border border-taupe/20 rounded-xl p-4">
                <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">
                  Total new revenue
                </p>
                <p className="font-serif text-xl text-obsidian">
                  {dollars(data.headline.active_new_revenue_cents)}
                </p>
                <p className="text-xs text-charcoal/50">
                  Brand new + resubs
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

          {/* ── Landing-page funnel ──────────────────────────────────────── */}
          <section className="mb-10">
            <SectionHeading
              title="Landing-page funnel"
              hint={`${num(data.funnel_totals.page_views)} page views → ${num(
                data.funnel_totals.purchases
              )} purchases`}
            />
            <div className="bg-white border border-taupe/20 rounded-xl p-5">
              <LandingPageFlowchart rows={data.landing_pages} />
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

          {/* ── Channel mix ──────────────────────────────────────────────── */}
          <section className="mb-10">
            <SectionHeading
              title="Channel mix"
              hint="From analytics events in window"
            />
            <div className="bg-white border border-taupe/20 rounded-xl p-5">
              <ChannelBar rows={data.channels} />
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
