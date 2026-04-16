"use client";

import { useEffect, useState, useCallback } from "react";
import { useMembership } from "@/app/context/MembershipContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface StepMetrics {
  step: number;
  delayDays: number;
  triggerType: "schedule" | "event";
  sent: number;
  opened: number;
  clicked: number;
  replied: number;
}

interface FlowMetrics {
  users: { active: number; paused: number; completed: number; total: number };
  steps: StepMetrics[];
}

interface SequenceData {
  flows: Record<string, FlowMetrics>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function pct(n: number, d: number): string {
  if (!d) return "—";
  return `${((n / d) * 100).toFixed(0)}%`;
}

function rateClass(n: number, d: number): string {
  if (!d) return "text-charcoal/30";
  const r = n / d;
  if (r >= 0.4) return "text-forest font-medium";
  if (r >= 0.2) return "text-charcoal/70";
  return "text-ember/70";
}

const FLOW_LABELS: Record<string, string> = {
  free: "Free",
  access: "Reserve Access",
  member: "Reserve Member",
};

const FLOW_ORDER = ["free", "access", "member"];

// ─── Step row ─────────────────────────────────────────────────────────────────

function StepRow({ s }: { s: StepMetrics }) {
  const openRate = pct(s.opened, s.sent);
  const clickRate = pct(s.clicked, s.sent);
  const replyRate = pct(s.replied, s.sent);
  const isEmpty = s.sent === 0;

  return (
    <tr className="border-b border-taupe/10 last:border-0">
      <td className="px-4 py-3 text-sm text-charcoal/70">
        <span className="font-medium text-obsidian">Step {s.step + 1}</span>
        <span className="ml-2 text-xs text-charcoal/40">
          {s.triggerType === "event" ? "event-triggered" : `day ${s.delayDays}`}
        </span>
      </td>
      <td className="px-4 py-3 text-sm text-center">
        {isEmpty ? <span className="text-charcoal/25">—</span> : s.sent}
      </td>
      <td className={`px-4 py-3 text-sm text-center ${isEmpty ? "text-charcoal/25" : rateClass(s.opened, s.sent)}`}>
        {isEmpty ? "—" : `${s.opened} (${openRate})`}
      </td>
      <td className={`px-4 py-3 text-sm text-center ${isEmpty ? "text-charcoal/25" : rateClass(s.clicked, s.sent)}`}>
        {isEmpty ? "—" : `${s.clicked} (${clickRate})`}
      </td>
      <td className={`px-4 py-3 text-sm text-center ${isEmpty ? "text-charcoal/25" : rateClass(s.replied, s.sent)}`}>
        {isEmpty ? "—" : `${s.replied} (${replyRate})`}
      </td>
    </tr>
  );
}

// ─── Flow section ─────────────────────────────────────────────────────────────

function FlowSection({ flowName, flow }: { flowName: string; flow: FlowMetrics }) {
  const label = FLOW_LABELS[flowName] ?? flowName;
  const { users } = flow;
  const hasData = flow.steps.some((s) => s.sent > 0);

  return (
    <div className="bg-white border border-taupe/20 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-5 py-4 border-b border-taupe/10 flex items-center justify-between">
        <h2 className="font-serif text-lg text-obsidian">{label}</h2>
        <div className="flex items-center gap-4 text-xs text-charcoal/50">
          <span>
            <span className="text-forest font-medium">{users.active}</span> active
          </span>
          <span>
            <span className="text-ember font-medium">{users.paused}</span> paused
          </span>
          <span>
            <span className="text-charcoal/40 font-medium">{users.completed}</span> completed
          </span>
          <span className="text-charcoal/30">·</span>
          <span>{users.total} total</span>
        </div>
      </div>

      {/* Table */}
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-taupe/10 bg-bone/40">
            <th className="text-left px-4 py-2.5 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Step</th>
            <th className="text-center px-4 py-2.5 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Sent</th>
            <th className="text-center px-4 py-2.5 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Opened</th>
            <th className="text-center px-4 py-2.5 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Clicked</th>
            <th className="text-center px-4 py-2.5 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Replied</th>
          </tr>
        </thead>
        <tbody>
          {flow.steps.map((s) => (
            <StepRow key={s.step} s={s} />
          ))}
        </tbody>
      </table>

      {!hasData && (
        <div className="px-5 py-6 text-center text-xs text-charcoal/30 border-t border-taupe/10">
          No data yet — emails sent from here will appear once the Resend webhook is active.
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminSequencesPage() {
  const { user: adminUser, authLoading } = useMembership();
  const [data, setData] = useState<SequenceData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

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
      const res = await fetch("/api/admin/sequences", {
        headers: await getHeaders(),
      });
      const json = await res.json() as SequenceData & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load sequences");
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [authLoading, adminUser, getHeaders]);

  useEffect(() => { void load(); }, [load]);

  const flows = data?.flows ?? {};
  const orderedFlows = [
    ...FLOW_ORDER.filter((f) => f in flows),
    ...Object.keys(flows).filter((f) => !FLOW_ORDER.includes(f)),
  ];

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl text-obsidian">Sequences</h1>
          <p className="text-charcoal/50 text-sm mt-1">Email drip performance by flow and step</p>
        </div>
        <button
          onClick={() => void load()}
          disabled={loading}
          className="text-sm text-forest hover:underline disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="bg-ember/10 border border-ember/20 rounded-xl p-4 text-sm text-ember mb-6">
          {error}
        </div>
      )}

      {loading ? (
        <p className="text-charcoal/40 text-sm">Loading...</p>
      ) : (
        <div className="space-y-6">
          {orderedFlows.map((flowName) => (
            <FlowSection key={flowName} flowName={flowName} flow={flows[flowName]} />
          ))}
        </div>
      )}
    </div>
  );
}
