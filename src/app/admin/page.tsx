"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
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
    revenue?: { total_cents?: number };
  };
}

interface OverviewData {
  today: DailyKPIs;
  last_week: DailyKPIs;
  activation: {
    total_paid: number;
    onboarding_completed: number;
    onboarding_pct: number | null;
    at_risk: number;
  };
  new_users_today: number;
  new_users_last_week: number;
  recommendation: {
    type: "warning" | "info" | "success";
    title: string;
    body: string;
    action: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}

function dollars(cents: number | null | undefined): string {
  if (!cents) return "$0";
  return `$${(cents / 100).toFixed(0)}`;
}

function pct(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return `${n.toFixed(1)}%`;
}

function deltaVsLastWeek(
  today: number | null | undefined,
  lastWeek: number | null | undefined
): { sign: string; text: string; positive: boolean } | null {
  if (today == null || lastWeek == null || lastWeek === 0) return null;
  const diff = today - lastWeek;
  const p = Math.round((diff / lastWeek) * 100);
  if (Math.abs(p) < 1) return null;
  return { sign: diff > 0 ? "↑" : "↓", text: `${Math.abs(p)}% vs last week`, positive: diff > 0 };
}

// ─── Components ───────────────────────────────────────────────────────────────

function PulseCard({
  label,
  value,
  d,
  sub,
  invertDelta,
}: {
  label: string;
  value: string;
  d?: ReturnType<typeof deltaVsLastWeek>;
  sub?: string;
  invertDelta?: boolean;
}) {
  const isPositive = d ? (invertDelta ? !d.positive : d.positive) : false;
  return (
    <div className="bg-white border border-taupe/20 rounded-xl p-5">
      <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-2">{label}</p>
      <div className="flex items-end gap-2 flex-wrap">
        <p className="font-serif text-3xl text-obsidian">{value}</p>
        {d && (
          <span className={`text-xs font-medium mb-1 ${isPositive ? "text-forest" : "text-ember"}`}>
            {d.sign} {d.text}
          </span>
        )}
      </div>
      {sub && <p className="text-xs text-charcoal/40 mt-1">{sub}</p>}
    </div>
  );
}

function RecommendationCard({
  rec,
}: {
  rec: OverviewData["recommendation"];
}) {
  const styles = {
    warning: { border: "border-ember/30 bg-ember/5", dot: "bg-ember" },
    info: { border: "border-taupe/30 bg-bone", dot: "bg-sage" },
    success: { border: "border-forest/20 bg-forest/5", dot: "bg-forest" },
  };
  const s = styles[rec.type];
  return (
    <div className={`border rounded-xl p-6 ${s.border}`}>
      <div className="flex items-start gap-3">
        <div className={`w-2 h-2 rounded-full mt-1.5 flex-shrink-0 ${s.dot}`} />
        <div>
          <p className="font-medium text-obsidian text-sm">{rec.title}</p>
          <p className="text-charcoal/60 text-sm mt-1 leading-relaxed">{rec.body}</p>
          <p className="text-xs text-charcoal/40 mt-3 font-medium">→ {rec.action}</p>
        </div>
      </div>
    </div>
  );
}

// ─── Cron logs ────────────────────────────────────────────────────────────────

interface CronLog {
  id: string;
  cron: string;
  ran_at: string;
  total: number;
  processed: number;
  skipped: number;
  failed: number;
}

const CRON_LABELS: Record<string, string> = {
  "reservecard-to-member": "Reserve Card → Member",
  "mulligan-to-member": "Mulligan → Member",
};

function CronLogsSection({ getHeaders }: { getHeaders: () => Promise<HeadersInit> }) {
  const [logs, setLogs] = useState<CronLog[] | null>(null);

  useEffect(() => {
    getHeaders()
      .then((h) => fetch("/api/admin/cron-logs", { headers: h }))
      .then((r) => r.json())
      .then((d: { logs: CronLog[] }) => setLogs(d.logs))
      .catch(() => setLogs([]));
  }, [getHeaders]);

  if (!logs) return null;
  if (logs.length === 0) {
    return (
      <div>
        <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-4">Cron jobs</p>
        <p className="text-sm text-charcoal/40">No runs logged yet.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-4">Cron jobs</p>
      <div className="bg-white border border-taupe/20 rounded-xl divide-y divide-taupe/10">
        {logs.map((log) => (
          <div key={log.id} className="flex items-center justify-between px-5 py-3">
            <div>
              <p className="text-sm font-medium text-obsidian">
                {CRON_LABELS[log.cron] ?? log.cron}
              </p>
              <p className="text-xs text-charcoal/40 mt-0.5">
                {new Date(log.ran_at).toLocaleString("en-US", {
                  month: "short",
                  day: "numeric",
                  hour: "numeric",
                  minute: "2-digit",
                })}
              </p>
            </div>
            <div className="flex items-center gap-4 text-xs text-right">
              <div>
                <p className="text-charcoal/40">processed</p>
                <p className="font-medium text-obsidian">{log.processed}</p>
              </div>
              <div>
                <p className="text-charcoal/40">skipped</p>
                <p className="font-medium text-obsidian">{log.skipped}</p>
              </div>
              <div>
                <p className="text-charcoal/40">failed</p>
                <p className={`font-medium ${log.failed > 0 ? "text-ember" : "text-obsidian"}`}>
                  {log.failed}
                </p>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminOverviewPage() {
  const { user, authLoading } = useMembership();
  const [data, setData] = useState<OverviewData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  const getHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!user) throw new Error("Not authenticated");
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }, [user]);

  const load = useCallback(
    async (isRefresh = false) => {
      if (authLoading || !user) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/admin/overview", { headers: await getHeaders() });
        if (!res.ok) throw new Error("Failed to load overview");
        setData(await res.json() as OverviewData);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [authLoading, user, getHeaders]
  );

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10">
        <p className="text-charcoal/40 text-sm">Loading...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10">
        <p className="text-ember text-sm">{error ?? "No data available."}</p>
      </div>
    );
  }

  const tf = data.today.raw.funnel ?? {};
  const lf = data.last_week.raw.funnel ?? {};
  const todayRevenue = data.today.raw.revenue?.total_cents ?? 0;
  const lastWeekRevenue = data.last_week.raw.revenue?.total_cents ?? 0;

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-serif text-3xl text-obsidian">Overview</h1>
          <p className="text-charcoal/50 text-sm mt-1">
            {new Date().toLocaleDateString("en-US", {
              weekday: "long",
              month: "long",
              day: "numeric",
            })}
          </p>
        </div>
        <button
          onClick={() => void load(true)}
          disabled={refreshing}
          className="text-sm text-forest hover:underline disabled:opacity-50"
        >
          {refreshing ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {/* Section 1 — Today's pulse */}
      <div>
        <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-4">Today&apos;s pulse</p>
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
          <PulseCard
            label="New signups"
            value={num(data.new_users_today)}
            d={deltaVsLastWeek(data.new_users_today, data.new_users_last_week)}
          />
          <PulseCard
            label="Paid conversions"
            value={num(tf.purchases ?? 0)}
            d={deltaVsLastWeek(tf.purchases, lf.purchases)}
          />
          <PulseCard
            label="Revenue"
            value={dollars(todayRevenue)}
            d={deltaVsLastWeek(todayRevenue, lastWeekRevenue)}
          />
          <PulseCard
            label="Cart abandonment"
            value={pct(data.today.cart_abandonment_rate)}
            d={deltaVsLastWeek(
              data.today.cart_abandonment_rate ?? undefined,
              data.last_week.cart_abandonment_rate ?? undefined
            )}
            sub="lower is better"
            invertDelta
          />
        </div>
      </div>

      {/* Section 2 — Member activation */}
      <div>
        <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-4">Member activation</p>
        <div className="bg-white border border-taupe/20 rounded-xl p-6 space-y-6">
          <div className="grid grid-cols-3 gap-6">
            <div>
              <p className="text-xs text-charcoal/40 mb-1">Paid members</p>
              <p className="font-serif text-3xl text-obsidian">{num(data.activation.total_paid)}</p>
              <p className="text-xs text-charcoal/30 mt-1">access + member + black</p>
            </div>
            <div>
              <p className="text-xs text-charcoal/40 mb-1">Onboarding completed</p>
              <div className="flex items-end gap-2">
                <p className="font-serif text-3xl text-obsidian">{pct(data.activation.onboarding_pct)}</p>
                <p className="text-xs text-charcoal/40 mb-1">target 75%</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-charcoal/40 mb-1">At risk</p>
              <div className="flex items-end gap-2">
                <p className={`font-serif text-3xl ${data.activation.at_risk > 0 ? "text-ember" : "text-obsidian"}`}>
                  {num(data.activation.at_risk)}
                </p>
                <p className="text-xs text-charcoal/40 mb-1">paid &gt;7d, not activated</p>
              </div>
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between text-xs text-charcoal/40">
              <span>Onboarding completion rate</span>
              <span>{num(data.activation.onboarding_completed)} / {num(data.activation.total_paid)}</span>
            </div>
            <div className="h-2 bg-bone rounded-full overflow-hidden">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  (data.activation.onboarding_pct ?? 0) >= 75 ? "bg-forest" : "bg-ember"
                }`}
                style={{ width: `${Math.min(data.activation.onboarding_pct ?? 0, 100)}%` }}
              />
            </div>
            <p className="text-xs text-charcoal/30">
              Portal access + meaningful action tracking coming — pending activation definition
            </p>
          </div>
        </div>
      </div>

      {/* Section 3 — Recommendation */}
      <div>
        <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-4">What to focus on</p>
        <RecommendationCard rec={data.recommendation} />
      </div>

      {/* Cron logs */}
      <CronLogsSection getHeaders={getHeaders} />

      {/* Quick links */}
      <div className="border-t border-taupe/10 pt-6">
        <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-4">Quick access</p>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[
            { href: "/admin/users", label: "Users", sub: `${num(data.today.raw.total_users)} total` },
            { href: "/admin/funnel", label: "Funnel", sub: "Daily breakdown" },
            { href: "/admin/sequences", label: "Sequences", sub: "Email performance" },
            { href: "/admin/email-replies", label: "Reply queue", sub: "Pending approvals" },
          ].map((link) => (
            <Link
              key={link.href}
              href={link.href}
              className="bg-white border border-taupe/20 rounded-xl p-4 hover:border-forest/30 transition-colors"
            >
              <p className="text-sm font-medium text-obsidian">{link.label}</p>
              <p className="text-xs text-charcoal/40 mt-0.5">{link.sub}</p>
            </Link>
          ))}
        </div>
      </div>

    </div>
  );
}
