"use client";

/**
 * /admin/marketing-funnel
 *
 * Cross-channel marketing dashboard. Data flow:
 *   • signups by tier + channel  ← /api/admin/marketing-funnel.membership_signups
 *   • website funnel              ← .website_funnel
 *   • pro shop by member tier     ← .pro_shop_by_members
 *   • email flow performance      ← .email_flows
 *   • ad spend by channel         ← .ad_spend_by_channel
 *
 * Period defaults to last 7 days; user can pick today/week/month/custom.
 */

import { useEffect, useState, useCallback } from "react";
import { useMembership } from "@/app/context/MembershipContext";

// ─── Types (mirror API response) ──────────────────────────────────────────────

type Tier = "free" | "access" | "member" | "back9";

interface ApiResponse {
  window: { start: string; end: string };
  membership_signups: {
    total_by_tier: Record<Tier, number>;
    by_tier_and_channel: Record<Tier, Record<string, number>>;
  };
  website_funnel: {
    page_views: number;
    wallet_views: number;
    add_to_cart: number;
    checkout_started: number;
    purchases: number;
    revenue_cents: number;
  };
  pro_shop_by_members: Array<{
    tier: Tier | "non_member";
    orders: number;
    units: number;
    revenue_cents: number;
    top_acquisition_channel: string | null;
    channels: Record<string, number>;
  }>;
  email_flows: Record<Tier, {
    users: { active: number; paused: number; completed: number; total: number };
    steps: Array<{ step: number; delayDays: number; sent: number; opened: number; clicked: number; replied: number }>;
  }>;
  ad_spend_by_channel: Array<{ channel: string; spend_cents: number; days: number }>;
  meta: { signups_count: number; orders_count: number; kpi_days_loaded: number; email_events_loaded: number; users_indexed: number };
}

type Period = "week" | "month" | "today" | "custom";

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

function pct(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

function dollars(cents: number | null | undefined): string {
  if (cents === null || cents === undefined || cents === 0) return "$0";
  return `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;
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

function CHANNEL_COLOR(channel: string): string {
  // Stable color per channel
  const palette = [
    "bg-forest", "bg-ember", "bg-taupe", "bg-charcoal",
    "bg-forest/70", "bg-ember/70", "bg-taupe/70", "bg-charcoal/70",
  ];
  let h = 0;
  for (let i = 0; i < channel.length; i++) h = (h * 31 + channel.charCodeAt(i)) | 0;
  return palette[Math.abs(h) % palette.length];
}

// ─── KPI card ─────────────────────────────────────────────────────────────────

function KPICard({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="bg-white border border-taupe/20 rounded-xl p-5">
      <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-2">{label}</p>
      <p className="font-serif text-3xl text-obsidian">{value}</p>
      {sub && <p className="text-xs text-charcoal/40 mt-1">{sub}</p>}
    </div>
  );
}

// ─── Funnel bar ───────────────────────────────────────────────────────────────

function FunnelStep({
  label, count, maxCount, sublabel,
}: { label: string; count: number; maxCount: number; sublabel?: string }) {
  const pctWidth = maxCount > 0 ? (count / maxCount) * 100 : 0;
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-sm">
        <span className="text-charcoal/70">{label}</span>
        <div className="flex items-center gap-3">
          {sublabel && <span className="text-xs text-charcoal/40">{sublabel}</span>}
          <span className="font-medium text-obsidian">{num(count)}</span>
        </div>
      </div>
      <div className="h-2 bg-bone rounded-full overflow-hidden">
        <div
          className="h-full bg-forest rounded-full transition-all duration-500"
          style={{ width: `${pctWidth}%` }}
        />
      </div>
    </div>
  );
}

// ─── Channel mix bar (stacked) ────────────────────────────────────────────────

function ChannelMixBar({ channels }: { channels: Record<string, number> }) {
  const total = Object.values(channels).reduce((a, b) => a + b, 0);
  if (total === 0) return <p className="text-xs text-charcoal/40">No signups in this period.</p>;
  const entries = Object.entries(channels).sort(([, a], [, b]) => b - a);
  return (
    <div className="space-y-2">
      <div className="flex h-2.5 rounded-full overflow-hidden bg-bone">
        {entries.map(([ch, c]) => (
          <div
            key={ch}
            className={`${CHANNEL_COLOR(ch)}`}
            style={{ width: `${(c / total) * 100}%` }}
            title={`${ch}: ${c}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs">
        {entries.map(([ch, c]) => (
          <div key={ch} className="flex items-center gap-1.5">
            <div className={`w-2.5 h-2.5 rounded-sm ${CHANNEL_COLOR(ch)}`} />
            <span className="text-charcoal/70">{ch}</span>
            <span className="text-charcoal/40">·</span>
            <span className="text-obsidian font-medium">{c}</span>
            <span className="text-charcoal/40">({Math.round((c / total) * 100)}%)</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function MarketingFunnelPage() {
  const { user: adminUser, authLoading } = useMembership();
  const [data, setData] = useState<ApiResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [period, setPeriod] = useState<Period>("week");
  const [customStart, setCustomStart] = useState(daysAgoISO(6));
  const [customEnd, setCustomEnd] = useState(todayISO());

  const getHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!adminUser) throw new Error("Not authenticated");
    const token = await adminUser.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }, [adminUser]);

  const load = useCallback(async () => {
    if (authLoading || !adminUser) return;
    setLoading(true);
    setError(null);
    try {
      let start: string;
      let end = todayISO();
      if (period === "today") { start = todayISO(); }
      else if (period === "week") { start = daysAgoISO(6); }
      else if (period === "month") { start = firstOfMonthISO(); }
      else { start = customStart; end = customEnd; }

      const params = new URLSearchParams({ start, end });
      const res = await fetch(`/api/admin/marketing-funnel?${params.toString()}`, {
        headers: await getHeaders(),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || `Request failed (${res.status})`);
      }
      const j = (await res.json()) as ApiResponse;
      setData(j);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [authLoading, adminUser, period, customStart, customEnd, getHeaders]);

  useEffect(() => { void load(); }, [load]);

  // ── Derived ────────────────────────────────────────────────────────────────
  const websiteFunnel = data?.website_funnel;
  const maxFunnel = websiteFunnel
    ? Math.max(websiteFunnel.page_views, websiteFunnel.wallet_views, websiteFunnel.add_to_cart, websiteFunnel.checkout_started, websiteFunnel.purchases, 1)
    : 1;
  const totalSignups = data ? Object.values(data.membership_signups.total_by_tier).reduce((a, b) => a + b, 0) : 0;
  const totalSpendCents = data?.ad_spend_by_channel.reduce((a, c) => a + c.spend_cents, 0) ?? 0;
  const totalRevenueCents = websiteFunnel?.revenue_cents ?? 0;
  const roas = totalSpendCents > 0 ? totalRevenueCents / totalSpendCents : null;

  // CAC = spend / paid signups (access + member)
  const paidSignups = data ? (data.membership_signups.total_by_tier.access + data.membership_signups.total_by_tier.member) : 0;
  const cacCents = paidSignups > 0 ? Math.round(totalSpendCents / paidSignups) : null;

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl text-obsidian">Marketing Funnel</h1>
          <p className="text-charcoal/50 text-sm mt-1">
            {data ? `${data.window.start} → ${data.window.end}` : "Loading…"}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {(["today", "week", "month", "custom"] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`text-sm px-3 py-1.5 rounded-lg border transition-colors ${
                period === p
                  ? "bg-forest text-white border-forest"
                  : "bg-white text-charcoal border-taupe/40 hover:border-forest/40"
              }`}
            >
              {p === "today" ? "Today" : p === "week" ? "7d" : p === "month" ? "MTD" : "Custom"}
            </button>
          ))}
          {period === "custom" && (
            <div className="flex items-center gap-2">
              <input
                type="date"
                value={customStart}
                onChange={(e) => setCustomStart(e.target.value)}
                className="text-sm border border-taupe/40 rounded-lg px-3 py-1.5 bg-white text-charcoal focus:outline-none focus:ring-2 focus:ring-forest/30"
              />
              <span className="text-charcoal/40 text-sm">→</span>
              <input
                type="date"
                value={customEnd}
                onChange={(e) => setCustomEnd(e.target.value)}
                className="text-sm border border-taupe/40 rounded-lg px-3 py-1.5 bg-white text-charcoal focus:outline-none focus:ring-2 focus:ring-forest/30"
              />
            </div>
          )}
          <button
            onClick={() => void load()}
            className="text-sm text-forest hover:underline ml-1"
          >
            Refresh
          </button>
        </div>
      </div>

      {error && (
        <div className="bg-ember/10 border border-ember/20 rounded-xl p-4 text-sm text-ember mb-6">
          {error}
        </div>
      )}

      {loading || !data ? (
        <p className="text-charcoal/40 text-sm">Loading…</p>
      ) : (
        <div className="space-y-6">
          {/* ── Top KPIs ───────────────────────────────────────────────────── */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
            <KPICard
              label="Signups"
              value={num(totalSignups)}
              sub={`${data.membership_signups.total_by_tier.access + data.membership_signups.total_by_tier.member} paid`}
            />
            <KPICard
              label="Revenue"
              value={dollars(totalRevenueCents)}
            />
            <KPICard
              label="Ad spend"
              value={dollars(totalSpendCents)}
            />
            <KPICard
              label="ROAS"
              value={roas !== null ? `${roas.toFixed(1)}x` : "—"}
              sub="revenue / spend"
            />
            <KPICard
              label="CAC"
              value={cacCents !== null ? dollars(cacCents) : "—"}
              sub="spend / paid signup"
            />
          </div>

          {/* ── Section 1: Membership Signups by Channel ───────────────────── */}
          <div className="bg-white border border-taupe/20 rounded-xl p-6">
            <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">
              1. New signups by tier and channel
            </p>
            <p className="text-sm text-charcoal/50 mb-6">
              {totalSignups} total signups in this window.
            </p>
            <div className="grid gap-6 md:grid-cols-2">
              {FLOW_ORDER.map((tier) => {
                const total = data.membership_signups.total_by_tier[tier] ?? 0;
                const channels = data.membership_signups.by_tier_and_channel[tier] ?? {};
                return (
                  <div key={tier} className="space-y-3">
                    <div className="flex items-baseline justify-between">
                      <h3 className="font-serif text-lg text-obsidian">{FLOW_LABELS[tier]}</h3>
                      <span className="font-serif text-2xl text-obsidian">{num(total)}</span>
                    </div>
                    <ChannelMixBar channels={channels} />
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Section 2: Website funnel ──────────────────────────────────── */}
          <div className="bg-white border border-taupe/20 rounded-xl p-6">
            <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">
              2. Website funnel
            </p>
            <p className="text-sm text-charcoal/50 mb-6">
              All events captured server-side via Firestore <code className="text-xs">kpi_daily</code>.
            </p>
            <div className="space-y-5">
              {websiteFunnel && (
                <>
                  <FunnelStep label="Page views" count={websiteFunnel.page_views} maxCount={maxFunnel} />
                  <FunnelStep
                    label="Wallet viewed"
                    count={websiteFunnel.wallet_views}
                    maxCount={maxFunnel}
                    sublabel={websiteFunnel.page_views > 0 ? `${((websiteFunnel.wallet_views / websiteFunnel.page_views) * 100).toFixed(0)}% of views` : undefined}
                  />
                  <FunnelStep
                    label="Added to cart"
                    count={websiteFunnel.add_to_cart}
                    maxCount={maxFunnel}
                    sublabel={websiteFunnel.wallet_views > 0 ? `${((websiteFunnel.add_to_cart / websiteFunnel.wallet_views) * 100).toFixed(0)}% of wallet views` : undefined}
                  />
                  <FunnelStep
                    label="Started checkout"
                    count={websiteFunnel.checkout_started}
                    maxCount={maxFunnel}
                    sublabel={websiteFunnel.add_to_cart > 0 ? `${((websiteFunnel.checkout_started / websiteFunnel.add_to_cart) * 100).toFixed(0)}% of carts` : undefined}
                  />
                  <FunnelStep
                    label="Purchased"
                    count={websiteFunnel.purchases}
                    maxCount={maxFunnel}
                    sublabel={websiteFunnel.checkout_started > 0 ? `${((websiteFunnel.purchases / websiteFunnel.checkout_started) * 100).toFixed(0)}% of checkouts` : undefined}
                  />
                </>
              )}
            </div>
          </div>

          {/* ── Section 3: Pro Shop purchases by member tier ──────────────── */}
          <div className="bg-white border border-taupe/20 rounded-xl p-6">
            <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">
              3. Pro shop orders by member tier
            </p>
            <p className="text-sm text-charcoal/50 mb-6">
              From Shopify orders in window. Membership-billing orders are excluded.
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-charcoal/50 text-xs uppercase tracking-wide border-b border-taupe/20">
                    <th className="text-left py-2 font-medium">Tier</th>
                    <th className="text-right py-2 font-medium">Orders</th>
                    <th className="text-right py-2 font-medium">Units</th>
                    <th className="text-right py-2 font-medium">Revenue</th>
                    <th className="text-right py-2 font-medium">AOV</th>
                    <th className="text-left py-2 font-medium pl-6">Top channel</th>
                  </tr>
                </thead>
                <tbody>
                  {data.pro_shop_by_members.map((row) => {
                    const aov = row.orders > 0 ? row.revenue_cents / row.orders : 0;
                    const label = row.tier === "non_member" ? "Non-member" : FLOW_LABELS[row.tier as Tier];
                    return (
                      <tr key={row.tier} className="border-b border-taupe/10 last:border-0">
                        <td className="py-2.5 text-obsidian">{label}</td>
                        <td className="py-2.5 text-right text-obsidian">{num(row.orders)}</td>
                        <td className="py-2.5 text-right text-charcoal">{num(row.units)}</td>
                        <td className="py-2.5 text-right text-obsidian font-medium">{dollars(row.revenue_cents)}</td>
                        <td className="py-2.5 text-right text-charcoal">{row.orders > 0 ? dollars(aov) : "—"}</td>
                        <td className="py-2.5 pl-6 text-charcoal/70">{row.top_acquisition_channel ?? "—"}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* ── Section 4: Email flow performance ─────────────────────────── */}
          <div className="bg-white border border-taupe/20 rounded-xl p-6">
            <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">
              4. Email flow performance
            </p>
            <p className="text-sm text-charcoal/50 mb-6">
              Sent counts include all current sequence users at-or-past each step; opens/clicks/replies are scoped to the window.
            </p>
            <div className="space-y-8">
              {FLOW_ORDER.map((flow) => {
                const f = data.email_flows[flow];
                if (!f) return null;
                return (
                  <div key={flow}>
                    <div className="flex items-baseline justify-between mb-3">
                      <h3 className="font-serif text-lg text-obsidian">{FLOW_LABELS[flow]}</h3>
                      <span className="text-xs text-charcoal/50">
                        {f.users.active} active · {f.users.paused} paused · {f.users.completed} completed
                      </span>
                    </div>
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="text-charcoal/50 text-xs uppercase tracking-wide border-b border-taupe/20">
                            <th className="text-left py-2 font-medium">Step</th>
                            <th className="text-right py-2 font-medium">Sent</th>
                            <th className="text-right py-2 font-medium">Opened</th>
                            <th className="text-right py-2 font-medium">Open %</th>
                            <th className="text-right py-2 font-medium">Clicked</th>
                            <th className="text-right py-2 font-medium">Click %</th>
                            <th className="text-right py-2 font-medium">Replied</th>
                          </tr>
                        </thead>
                        <tbody>
                          {f.steps.map((s) => {
                            const openRate = s.sent > 0 ? (s.opened / s.sent) * 100 : null;
                            const clickRate = s.sent > 0 ? (s.clicked / s.sent) * 100 : null;
                            return (
                              <tr key={s.step} className="border-b border-taupe/10 last:border-0">
                                <td className="py-2 text-obsidian">#{s.step} <span className="text-charcoal/40">(+{s.delayDays}d)</span></td>
                                <td className="py-2 text-right text-obsidian">{num(s.sent)}</td>
                                <td className="py-2 text-right text-charcoal">{num(s.opened)}</td>
                                <td className="py-2 text-right text-charcoal/70">{pct(openRate)}</td>
                                <td className="py-2 text-right text-charcoal">{num(s.clicked)}</td>
                                <td className="py-2 text-right text-charcoal/70">{pct(clickRate)}</td>
                                <td className="py-2 text-right text-charcoal">{num(s.replied)}</td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>

          {/* ── Section 5: Ad spend by channel ────────────────────────────── */}
          <div className="bg-white border border-taupe/20 rounded-xl p-6">
            <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">
              5. Ad spend by channel
            </p>
            <p className="text-sm text-charcoal/50 mb-6">
              From Supabase <code className="text-xs">marketing_spend_daily</code>. Pulled daily by the Google Ads cron.
            </p>
            {data.ad_spend_by_channel.length === 0 ? (
              <p className="text-sm text-charcoal/40">
                No spend data for this window. Confirm the Google Ads cron has run recently.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-charcoal/50 text-xs uppercase tracking-wide border-b border-taupe/20">
                      <th className="text-left py-2 font-medium">Channel</th>
                      <th className="text-right py-2 font-medium">Spend</th>
                      <th className="text-right py-2 font-medium">Days w/ spend</th>
                      <th className="text-right py-2 font-medium">Avg / day</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...data.ad_spend_by_channel].sort((a, b) => b.spend_cents - a.spend_cents).map((row) => (
                      <tr key={row.channel} className="border-b border-taupe/10 last:border-0">
                        <td className="py-2.5 text-obsidian">{row.channel}</td>
                        <td className="py-2.5 text-right text-obsidian font-medium">{dollars(row.spend_cents)}</td>
                        <td className="py-2.5 text-right text-charcoal">{row.days}</td>
                        <td className="py-2.5 text-right text-charcoal">
                          {row.days > 0 ? dollars(Math.round(row.spend_cents / row.days)) : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Meta footer */}
          <p className="text-xs text-charcoal/30 text-center pt-2">
            {data.meta.signups_count} signups · {data.meta.orders_count} Shopify orders · {data.meta.kpi_days_loaded} KPI days · {data.meta.email_events_loaded} email events · {data.meta.users_indexed} users indexed
          </p>
        </div>
      )}
    </div>
  );
}
