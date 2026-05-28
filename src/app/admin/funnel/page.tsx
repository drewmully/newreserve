"use client";

import { useEffect, useState, useCallback } from "react";
import { useMembership } from "@/app/context/MembershipContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface DailyKPIs {
  date: string;
  pct_users_with_store_credit: number | null;
  pct_users_with_active_subscription: number | null;
  pro_shop_conversion_rate: number | null;
  cart_abandonment_rate: number | null;
  raw: {
    total_users?: number;
    users_with_active_subscription?: number;
    funnel?: {
      add_to_cart?: number;
      checkout_started?: number;
      purchases?: number;
      wallet_views?: number;
    };
    event_counts?: Record<string, number>;
    revenue?: { total_cents?: number };
  };
}

type Period = "today" | "week" | "month" | "custom";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(1)}%`;
}

function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

function dollars(cents: number | null | undefined): string {
  if (!cents) return "—";
  return `$${(cents / 100).toFixed(2)}`;
}

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function mondayISO(): string {
  const d = new Date();
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1 - day);
  d.setDate(d.getDate() + diff);
  return d.toISOString().slice(0, 10);
}

function firstOfMonthISO(): string {
  const d = new Date();
  d.setDate(1);
  return d.toISOString().slice(0, 10);
}

function periodLabel(period: Period, customStart: string, customEnd: string): string {
  if (period === "today") return "Today";
  if (period === "week") return "This week";
  if (period === "month") return "This month";
  if (customStart && customEnd) return `${customStart} → ${customEnd}`;
  return "Custom";
}

// ─── Funnel bar ───────────────────────────────────────────────────────────────

function FunnelStep({
  label,
  count,
  maxCount,
  sublabel,
}: {
  label: string;
  count: number;
  maxCount: number;
  sublabel?: string;
}) {
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminFunnelPage() {
  const { user: adminUser, authLoading } = useMembership();
  const [kpis, setKpis] = useState<DailyKPIs | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const [period, setPeriod] = useState<Period>("today");
  const [customStart, setCustomStart] = useState(todayISO());
  const [customEnd, setCustomEnd] = useState(todayISO());

  const getHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!adminUser) throw new Error("Not authenticated");
    const token = await adminUser.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }, [adminUser]);

  const loadKPIs = useCallback(
    async (refresh = false) => {
      if (authLoading || !adminUser) return;
      if (refresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams();
        if (period === "today") {
          params.set("date", todayISO());
          if (refresh) params.set("refresh", "1");
        } else {
          const start =
            period === "week" ? mondayISO() :
            period === "month" ? firstOfMonthISO() :
            customStart;
          const end =
            period === "custom" ? customEnd : todayISO();
          params.set("startDate", start);
          params.set("endDate", end);
        }
        const res = await fetch(`/api/admin/funnel?${params.toString()}`, {
          headers: await getHeaders(),
        });
        if (!res.ok) throw new Error("Failed to load KPIs");
        const data = await res.json() as DailyKPIs;
        setKpis(data);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [authLoading, adminUser, period, customStart, customEnd, getHeaders]
  );

  useEffect(() => { void loadKPIs(); }, [loadKPIs]);

  const funnel = kpis?.raw?.funnel ?? {};
  const addToCart = funnel.add_to_cart ?? 0;
  const checkoutStarted = funnel.checkout_started ?? 0;
  const purchases = funnel.purchases ?? 0;
  const walletViews = funnel.wallet_views ?? 0;
  const maxStep = Math.max(addToCart, checkoutStarted, purchases, walletViews, 1);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="flex items-start justify-between mb-8 gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl text-obsidian">Funnel</h1>
          <p className="text-charcoal/50 text-sm mt-1">
            {periodLabel(period, customStart, customEnd)}
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
              {p === "today" ? "Today" : p === "week" ? "Week" : p === "month" ? "Month" : "Custom"}
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
          {period === "today" && (
            <button
              onClick={() => void loadKPIs(true)}
              disabled={refreshing}
              className="text-sm text-forest hover:underline disabled:opacity-50 ml-1"
            >
              {refreshing ? "Refreshing..." : "Refresh"}
            </button>
          )}
        </div>
      </div>

      {error && (
        <div className="bg-ember/10 border border-ember/20 rounded-xl p-4 text-sm text-ember mb-6">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-charcoal/40 text-sm">Loading...</p>
      ) : kpis ? (
        <div className="space-y-6">
          {/* Top KPIs */}
          <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
            <KPICard
              label="Total users"
              value={num(kpis.raw.total_users)}
            />
            <KPICard
              label="Active subs"
              value={num(kpis.raw.users_with_active_subscription)}
              sub={pct(kpis.pct_users_with_active_subscription) + " of users"}
            />
            <KPICard
              label="Revenue"
              value={dollars(kpis.raw.revenue?.total_cents)}
              sub="today"
            />
            <KPICard
              label="Cart abandonment"
              value={pct(kpis.cart_abandonment_rate)}
            />
          </div>

          {/* Funnel */}
          <div className="bg-white border border-taupe/20 rounded-xl p-6">
            <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-6">Purchase funnel</p>
            <div className="space-y-5">
              <FunnelStep
                label="Wallet viewed"
                count={walletViews}
                maxCount={maxStep}
              />
              <FunnelStep
                label="Added to cart"
                count={addToCart}
                maxCount={maxStep}
                sublabel={walletViews > 0 ? `${((addToCart / walletViews) * 100).toFixed(0)}% of views` : undefined}
              />
              <FunnelStep
                label="Started checkout"
                count={checkoutStarted}
                maxCount={maxStep}
                sublabel={addToCart > 0 ? `${((checkoutStarted / addToCart) * 100).toFixed(0)}% of carts` : undefined}
              />
              <FunnelStep
                label="Purchased"
                count={purchases}
                maxCount={maxStep}
                sublabel={checkoutStarted > 0 ? `${((purchases / checkoutStarted) * 100).toFixed(0)}% of checkouts` : undefined}
              />
            </div>
          </div>

          {/* Pro shop conversion */}
          <div className="bg-white border border-taupe/20 rounded-xl p-6">
            <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-4">Pro shop conversion</p>
            <div className="flex items-center gap-4">
              <p className="font-serif text-4xl text-obsidian">{pct(kpis.pro_shop_conversion_rate)}</p>
              <p className="text-sm text-charcoal/50">
                {num(purchases)} purchases / {num(walletViews)} wallet views
              </p>
            </div>
          </div>

          {/* Raw event counts */}
          {kpis.raw.event_counts && Object.keys(kpis.raw.event_counts).length > 0 && (
            <div className="bg-white border border-taupe/20 rounded-xl p-6">
              <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-4">All events today</p>
              <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
                {Object.entries(kpis.raw.event_counts)
                  .filter(([k]) => k !== "total")
                  .sort(([, a], [, b]) => b - a)
                  .map(([key, count]) => (
                    <div key={key} className="flex items-center justify-between bg-bone rounded-lg px-3 py-2">
                      <span className="text-xs text-charcoal/60">{key}</span>
                      <span className="text-sm font-medium text-obsidian">{num(count)}</span>
                    </div>
                  ))}
              </div>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
