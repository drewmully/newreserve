"use client";

/**
 * EmailView — Ad Performance dashboard "Email" tab.
 *
 * Unified drip + broadcast email funnel. Powered by /api/admin/email-funnel.
 *
 * Cohort: emails sent in the date range. 14-day purchase attribution.
 * Mapped to two drop-off stages Drew cares about:
 *   - profile→checkout (reserve nurture)
 *   - checkout→purchase (abandon recovery)
 */

import { useEffect, useMemo, useState } from "react";
import { auth } from "@/lib/firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

type EmailFlow = "access" | "member" | "reserve" | "abandon";

interface StepStat {
  step: number;
  delayDays: number;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  purchased: number;
}

interface FlowSummary {
  flow: EmailFlow;
  stage: "profile_to_checkout" | "checkout_to_purchase" | "post_purchase";
  in_flow: { active: number; paused: number; completed: number; total: number };
  steps: StepStat[];
  totals: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    purchased: number;
  };
}

interface BroadcastCampaign {
  campaign_id: string;
  label: string;
  sent: number;
  delivered: number;
  opened: number;
  clicked: number;
  purchased: number;
}

interface EmailFunnelPayload {
  window: { start: string; end: string };
  attribution: { window_days: number; cohort: string };
  flows: FlowSummary[];
  broadcast: {
    sent: number;
    delivered: number;
    opened: number;
    clicked: number;
    purchased: number;
    campaigns: BroadcastCampaign[];
  };
  drop_off_stages: {
    profile_to_checkout: {
      flows: EmailFlow[];
      sent: number;
      clicked: number;
      checkouts_attributed: number;
    };
    checkout_to_purchase: {
      flows: EmailFlow[];
      sent: number;
      clicked: number;
      purchases_attributed: number;
    };
  };
  meta: {
    events_in_window: number;
    sequences_with_send_in_window: number;
    computed_in_ms: number;
    generated_at: string;
  };
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const FLOW_LABELS: Record<EmailFlow, string> = {
  access: "Reserve Access (nurture)",
  member: "Reserve Member (nurture)",
  reserve: "Reserve (Quiz Nurture)",
  abandon: "Reserve (Checkout Abandon)",
};

const STAGE_COLORS = ["#60a5fa", "#a78bfa", "#f472b6", "#fb923c", "#34d399"];
// sent / delivered / opened / clicked / purchased

function num(n: number | null | undefined): string {
  if (n === null || n === undefined) return "—";
  return n.toLocaleString();
}
function pct(n: number, d: number): string {
  if (!d) return "—";
  return `${((n / d) * 100).toFixed(1)}%`;
}

// ─── Drill-in modal ───────────────────────────────────────────────────────────

interface DrillInTarget {
  flow: EmailFlow;
  step: number;
  delayDays: number;
}

interface DrillRecipient {
  email: string;
  sent_at: string | null;
  delivered: boolean;
  opened_at: string | null;
  clicked_at: string | null;
  purchased_at: string | null;
}

interface DrillResponse {
  flow: EmailFlow;
  step: number;
  total: number;
  recipients: DrillRecipient[];
  truncated: boolean;
}

function DrillModal({
  target,
  start,
  end,
  onClose,
}: {
  target: DrillInTarget;
  start: string;
  end: string;
  onClose: () => void;
}) {
  const [data, setData] = useState<DrillResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Not authenticated");
        const token = await user.getIdToken();
        const params = new URLSearchParams({
          start,
          end,
          flow: target.flow,
          step: String(target.step),
        });
        const res = await fetch(`/api/admin/email-funnel/recipients?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        const payload = (await res.json()) as DrillResponse;
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [target, start, end]);

  return (
    <div
      className="fixed inset-0 z-50 bg-black/70 flex items-center justify-center p-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-950 rounded-xl ring-1 ring-zinc-800 max-w-4xl w-full max-h-[80vh] overflow-hidden flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-6 py-4 border-b border-zinc-800 flex items-center justify-between">
          <div>
            <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">
              Drill-in · {FLOW_LABELS[target.flow]}
            </div>
            <div className="text-zinc-100 text-sm mt-1">
              Step {target.step} · day {target.delayDays}
            </div>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-400 hover:text-zinc-100 text-xs px-3 py-1 rounded-md ring-1 ring-zinc-800"
          >
            Close
          </button>
        </div>
        <div className="flex-1 overflow-auto">
          {loading ? (
            <div className="p-8 text-zinc-500 text-sm">Loading recipients…</div>
          ) : error ? (
            <div className="p-8 text-rose-300 text-sm">{error}</div>
          ) : data ? (
            <div>
              <div className="px-6 py-3 text-xs text-zinc-500 border-b border-zinc-900">
                {data.total.toLocaleString()} recipient{data.total === 1 ? "" : "s"}
                {data.truncated ? " (showing first 500)" : ""}
              </div>
              <table className="w-full text-xs">
                <thead className="text-zinc-500 uppercase tracking-[0.14em]">
                  <tr>
                    <th className="text-left px-6 py-2">Email</th>
                    <th className="text-left px-2 py-2">Sent</th>
                    <th className="text-left px-2 py-2">Delivered</th>
                    <th className="text-left px-2 py-2">Opened</th>
                    <th className="text-left px-2 py-2">Clicked</th>
                    <th className="text-left px-2 py-2 pr-6">Purchased (14d)</th>
                  </tr>
                </thead>
                <tbody>
                  {data.recipients.map((r) => (
                    <tr key={r.email} className="border-t border-zinc-900">
                      <td className="px-6 py-2 text-zinc-200">{r.email}</td>
                      <td className="px-2 py-2 text-zinc-400">
                        {r.sent_at ? new Date(r.sent_at).toLocaleString() : "—"}
                      </td>
                      <td className="px-2 py-2 text-zinc-400">
                        {r.delivered ? "✓" : "—"}
                      </td>
                      <td className="px-2 py-2 text-zinc-400">
                        {r.opened_at ? "✓" : "—"}
                      </td>
                      <td className="px-2 py-2 text-zinc-400">
                        {r.clicked_at ? "✓" : "—"}
                      </td>
                      <td className="px-2 py-2 pr-6 text-zinc-400">
                        {r.purchased_at ? "✓" : "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// ─── Main view ────────────────────────────────────────────────────────────────

export default function EmailView({ start, end }: { start: string; end: string }) {
  const [data, setData] = useState<EmailFunnelPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [drillTarget, setDrillTarget] = useState<DrillInTarget | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Not authenticated");
        const token = await user.getIdToken();
        const params = new URLSearchParams({ start, end });
        const res = await fetch(`/api/admin/email-funnel?${params}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          const j = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(j.error || `HTTP ${res.status}`);
        }
        const payload = (await res.json()) as EmailFunnelPayload;
        if (!cancelled) setData(payload);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [start, end]);

  // Total roll-up across drip + broadcast.
  const totals = useMemo(() => {
    const t = { sent: 0, delivered: 0, opened: 0, clicked: 0, purchased: 0 };
    if (!data) return t;
    for (const f of data.flows) {
      t.sent += f.totals.sent;
      t.delivered += f.totals.delivered;
      t.opened += f.totals.opened;
      t.clicked += f.totals.clicked;
      t.purchased += f.totals.purchased;
    }
    t.sent += data.broadcast.sent;
    t.delivered += data.broadcast.delivered;
    t.opened += data.broadcast.opened;
    t.clicked += data.broadcast.clicked;
    t.purchased += data.broadcast.purchased;
    return t;
  }, [data]);

  if (loading) {
    return (
      <div className="max-w-[1400px] mx-auto p-6 text-zinc-500 text-sm">
        Loading email funnel…
      </div>
    );
  }
  if (error) {
    return (
      <div className="max-w-[1400px] mx-auto p-4 rounded-lg bg-rose-500/10 ring-1 ring-rose-500/30 text-rose-300 text-sm">
        {error}
      </div>
    );
  }
  if (!data) return null;

  return (
    <div className="max-w-[1400px] mx-auto">
      {/* KPI strip */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <Kpi label="Sent" value={num(totals.sent)} color={STAGE_COLORS[0]} />
        <Kpi
          label="Delivered"
          value={num(totals.delivered)}
          sub={pct(totals.delivered, totals.sent)}
          color={STAGE_COLORS[1]}
        />
        <Kpi
          label="Opened"
          value={num(totals.opened)}
          sub={pct(totals.opened, totals.delivered)}
          color={STAGE_COLORS[2]}
        />
        <Kpi
          label="Clicked"
          value={num(totals.clicked)}
          sub={pct(totals.clicked, totals.opened)}
          color={STAGE_COLORS[3]}
        />
        <Kpi
          label="Purchased (14d)"
          value={num(totals.purchased)}
          sub={pct(totals.purchased, totals.sent)}
          color={STAGE_COLORS[4]}
        />
      </div>

      {/* Drop-off stage rollups */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-6">
        <DropOffCard
          title="Profile → Checkout"
          subtitle="Reserve quiz nurture"
          flows={data.drop_off_stages.profile_to_checkout.flows}
          sent={data.drop_off_stages.profile_to_checkout.sent}
          clicked={data.drop_off_stages.profile_to_checkout.clicked}
          conversion={{
            label: "Checkouts attributed (14d)",
            value: data.drop_off_stages.profile_to_checkout.checkouts_attributed,
          }}
        />
        <DropOffCard
          title="Checkout → Purchase"
          subtitle="Abandon recovery"
          flows={data.drop_off_stages.checkout_to_purchase.flows}
          sent={data.drop_off_stages.checkout_to_purchase.sent}
          clicked={data.drop_off_stages.checkout_to_purchase.clicked}
          conversion={{
            label: "Purchases attributed (14d)",
            value: data.drop_off_stages.checkout_to_purchase.purchases_attributed,
          }}
        />
      </div>

      {/* Per-flow tables */}
      <div className="space-y-4 mb-6">
        {data.flows.map((f) => (
          <FlowCard
            key={f.flow}
            flow={f}
            onDrillIn={(step, delayDays) =>
              setDrillTarget({ flow: f.flow, step, delayDays })
            }
          />
        ))}
      </div>

      {/* Broadcast section */}
      <div className="mb-6 bg-zinc-950 rounded-lg ring-1 ring-zinc-800 overflow-hidden">
        <div className="px-5 py-4 border-b border-zinc-800">
          <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">
            Broadcasts
          </div>
          <div className="text-zinc-100 text-sm mt-1">
            One-off campaigns (mully_campaign_id) — {data.broadcast.campaigns.length}{" "}
            campaign{data.broadcast.campaigns.length === 1 ? "" : "s"} in range
          </div>
        </div>
        {data.broadcast.campaigns.length === 0 ? (
          <div className="p-6 text-zinc-500 text-sm">
            No broadcast events in this window.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead className="text-zinc-500 uppercase tracking-[0.14em]">
              <tr>
                <th className="text-left px-5 py-2">Campaign</th>
                <Th>Sent</Th>
                <Th>Delivered</Th>
                <Th>Opened</Th>
                <Th>Open %</Th>
                <Th>Clicked</Th>
                <Th>CTR</Th>
                <Th>Purchased (14d)</Th>
              </tr>
            </thead>
            <tbody>
              {data.broadcast.campaigns.map((c) => (
                <tr key={c.campaign_id} className="border-t border-zinc-900">
                  <td className="px-5 py-2 text-zinc-200 max-w-[20rem] truncate">
                    {c.label}
                  </td>
                  <Td>{num(c.sent)}</Td>
                  <Td>{num(c.delivered)}</Td>
                  <Td>{num(c.opened)}</Td>
                  <Td>{pct(c.opened, c.delivered)}</Td>
                  <Td>{num(c.clicked)}</Td>
                  <Td>{pct(c.clicked, c.delivered)}</Td>
                  <Td>{num(c.purchased)}</Td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="text-zinc-600 text-[10px] tracking-[0.14em] uppercase">
        Computed in {data.meta.computed_in_ms} ms · {data.meta.events_in_window}{" "}
        events · {data.meta.sequences_with_send_in_window} unique senders ·
        attribution {data.attribution.window_days}d post-send · cohort{" "}
        {data.attribution.cohort}
      </div>

      {drillTarget ? (
        <DrillModal
          target={drillTarget}
          start={start}
          end={end}
          onClose={() => setDrillTarget(null)}
        />
      ) : null}
    </div>
  );
}

// ─── Subcomponents ────────────────────────────────────────────────────────────

function Kpi({
  label,
  value,
  sub,
  color,
}: {
  label: string;
  value: string;
  sub?: string;
  color: string;
}) {
  return (
    <div className="bg-zinc-950 rounded-lg ring-1 ring-zinc-800 px-4 py-3">
      <div className="flex items-center gap-2">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: color }}
        />
        <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
          {label}
        </div>
      </div>
      <div className="text-zinc-100 text-2xl font-light mt-1">{value}</div>
      {sub ? <div className="text-zinc-500 text-xs mt-1">{sub}</div> : null}
    </div>
  );
}

function DropOffCard({
  title,
  subtitle,
  flows,
  sent,
  clicked,
  conversion,
}: {
  title: string;
  subtitle: string;
  flows: EmailFlow[];
  sent: number;
  clicked: number;
  conversion: { label: string; value: number };
}) {
  return (
    <div className="bg-zinc-950 rounded-lg ring-1 ring-zinc-800 p-5">
      <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">
        {title}
      </div>
      <div className="text-zinc-100 text-sm mt-1">{subtitle}</div>
      <div className="text-[10px] text-zinc-600 mt-1">
        Flows: {flows.map((f) => FLOW_LABELS[f]).join(", ") || "—"}
      </div>
      <div className="grid grid-cols-3 gap-4 mt-4">
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            Sent
          </div>
          <div className="text-zinc-100 text-xl font-light mt-1">{num(sent)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            Clicked
          </div>
          <div className="text-zinc-100 text-xl font-light mt-1">
            {num(clicked)}
          </div>
          <div className="text-zinc-500 text-xs mt-1">{pct(clicked, sent)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">
            {conversion.label}
          </div>
          <div className="text-zinc-100 text-xl font-light mt-1">
            {num(conversion.value)}
          </div>
          <div className="text-zinc-500 text-xs mt-1">
            {pct(conversion.value, sent)} of sent
          </div>
        </div>
      </div>
    </div>
  );
}

function FlowCard({
  flow,
  onDrillIn,
}: {
  flow: FlowSummary;
  onDrillIn: (step: number, delayDays: number) => void;
}) {
  return (
    <div className="bg-zinc-950 rounded-lg ring-1 ring-zinc-800 overflow-hidden">
      <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between">
        <div>
          <div className="text-xs uppercase tracking-[0.16em] text-zinc-500">
            {FLOW_LABELS[flow.flow]}
          </div>
          <div className="text-zinc-100 text-sm mt-1">
            {num(flow.in_flow.total)} users in flow ·{" "}
            {num(flow.in_flow.active)} active ·{" "}
            {num(flow.in_flow.paused)} paused ·{" "}
            {num(flow.in_flow.completed)} completed
          </div>
        </div>
        <div className="text-right text-xs text-zinc-500">
          <div>
            {num(flow.totals.sent)} sent · {num(flow.totals.clicked)} clicks
          </div>
          <div className="text-zinc-300 mt-1">
            {num(flow.totals.purchased)} purchased (14d)
          </div>
        </div>
      </div>
      <table className="w-full text-xs">
        <thead className="text-zinc-500 uppercase tracking-[0.14em]">
          <tr>
            <th className="text-left px-5 py-2">Step</th>
            <th className="text-left px-2 py-2">Day</th>
            <Th>Sent</Th>
            <Th>Delivered</Th>
            <Th>Opened</Th>
            <Th>Open %</Th>
            <Th>Clicked</Th>
            <Th>CTR</Th>
            <Th>Purchased</Th>
            <th className="text-left px-2 py-2 pr-5"></th>
          </tr>
        </thead>
        <tbody>
          {flow.steps.map((s) => (
            <tr key={s.step} className="border-t border-zinc-900">
              <td className="px-5 py-2 text-zinc-200">{s.step}</td>
              <td className="px-2 py-2 text-zinc-400">d{s.delayDays}</td>
              <Td>{num(s.sent)}</Td>
              <Td>{num(s.delivered)}</Td>
              <Td>{num(s.opened)}</Td>
              <Td>{pct(s.opened, s.delivered)}</Td>
              <Td>{num(s.clicked)}</Td>
              <Td>{pct(s.clicked, s.delivered)}</Td>
              <Td>{num(s.purchased)}</Td>
              <td className="px-2 py-2 pr-5 text-right">
                <button
                  onClick={() => onDrillIn(s.step, s.delayDays)}
                  className="text-zinc-400 hover:text-zinc-100 text-[10px] uppercase tracking-[0.16em] px-2 py-1 rounded ring-1 ring-zinc-800"
                >
                  Drill in
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return <th className="text-left px-2 py-2">{children}</th>;
}
function Td({ children }: { children: React.ReactNode }) {
  return <td className="px-2 py-2 text-zinc-400">{children}</td>;
}
