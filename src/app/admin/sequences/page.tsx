"use client";

import { useEffect, useState, useCallback } from "react";
import { useMembership } from "@/app/context/MembershipContext";
import type { Recommendation } from "@/app/api/admin/recommendations/route";

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

interface SeqUser {
  uid: string;
  email: string;
  firstName: string | null;
  flow: string;
  status: "active" | "paused" | "completed";
  nextStep: number;
  lastSentStep: number;
  totalSteps: number;
  nextSendAt: number | null;
  startedAt: number;
  pausedReason: string | null;
}

interface TemplateStep {
  step: number;
  subject: string;
  text: string;
  delayDays: number;
  triggerType: "schedule" | "event";
}

interface TemplatesData {
  flows: Record<string, { steps: TemplateStep[] }>;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const FLOW_LABELS: Record<string, string> = {
  access: "Reserve Access",
  member: "Reserve Member",
  reserve: "Reserve (Quiz Nurture)",
};

const FLOW_ORDER = ["access", "member", "reserve"];

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

function fmtDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function flowBadge(flow: string): string {
  const map: Record<string, string> = {
    free: "bg-bone text-charcoal/60",
    access: "bg-forest/10 text-forest",
    member: "bg-sage/20 text-charcoal",
    back9: "bg-taupe/20 text-charcoal/60",
  };
  return map[flow] ?? "bg-bone text-charcoal/60";
}

function statusBadge(status: string): string {
  const map: Record<string, string> = {
    active: "bg-forest/10 text-forest",
    paused: "bg-ember/10 text-ember",
    completed: "bg-taupe/20 text-charcoal/50",
  };
  return map[status] ?? "bg-bone text-charcoal/60";
}

// ─── Tab bar ──────────────────────────────────────────────────────────────────

type Tab = "performance" | "users" | "templates";

function TabBar({ active, onChange }: { active: Tab; onChange: (t: Tab) => void }) {
  const tabs: { id: Tab; label: string }[] = [
    { id: "performance", label: "Performance" },
    { id: "users", label: "Users" },
    { id: "templates", label: "Templates" },
  ];
  return (
    <div className="flex items-center gap-1 border-b border-taupe/20 mb-8">
      {tabs.map((t) => (
        <button
          key={t.id}
          onClick={() => onChange(t.id)}
          className={`px-4 py-2.5 text-sm font-medium transition-colors border-b-2 -mb-px ${
            active === t.id
              ? "border-forest text-forest"
              : "border-transparent text-charcoal/50 hover:text-charcoal"
          }`}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}

// ─── Recommendations panel ────────────────────────────────────────────────────

const SEVERITY_STYLES: Record<string, { bar: string; badge: string; label: string }> = {
  warning: {
    bar: "bg-ember",
    badge: "bg-ember/10 text-ember",
    label: "Issue",
  },
  opportunity: {
    bar: "bg-forest",
    badge: "bg-forest/10 text-forest",
    label: "Opportunity",
  },
  info: {
    bar: "bg-taupe/50",
    badge: "bg-bone text-charcoal/50",
    label: "Info",
  },
};

function RecommendationsPanel({ recs, loading }: { recs: Recommendation[] | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="mt-3 px-5 py-4 border border-taupe/20 rounded-xl bg-bone/30 text-sm text-charcoal/40 animate-pulse">
        Analyzing flow with Claude…
      </div>
    );
  }
  if (!recs || recs.length === 0) return null;

  return (
    <div className="mt-3 border border-taupe/20 rounded-xl overflow-hidden bg-white">
      <div className="px-5 py-3 border-b border-taupe/10 flex items-center gap-2">
        <span className="text-xs uppercase tracking-widest text-charcoal/40 font-medium">Insights</span>
      </div>
      <div className="divide-y divide-taupe/10">
        {recs.map((r, i) => {
          const styles = SEVERITY_STYLES[r.severity] ?? SEVERITY_STYLES.info;
          return (
            <div key={i} className="flex gap-0">
              <div className={`w-1 flex-shrink-0 ${styles.bar}`} />
              <div className="px-5 py-4 flex-1 min-w-0">
                <div className="flex items-start gap-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium flex-shrink-0 mt-0.5 ${styles.badge}`}>
                    {r.step !== null ? `Step ${r.step + 1}` : styles.label}
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-obsidian">{r.title}</p>
                    <p className="text-xs text-charcoal/60 mt-0.5 leading-relaxed">{r.detail}</p>
                    <p className="text-xs text-forest mt-2 font-medium">→ {r.action}</p>
                  </div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Performance tab ──────────────────────────────────────────────────────────

function StepRow({ s }: { s: StepMetrics }) {
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
        {isEmpty ? "—" : `${s.opened} (${pct(s.opened, s.sent)})`}
      </td>
      <td className={`px-4 py-3 text-sm text-center ${isEmpty ? "text-charcoal/25" : rateClass(s.clicked, s.sent)}`}>
        {isEmpty ? "—" : `${s.clicked} (${pct(s.clicked, s.sent)})`}
      </td>
      <td className={`px-4 py-3 text-sm text-center ${isEmpty ? "text-charcoal/25" : rateClass(s.replied, s.sent)}`}>
        {isEmpty ? "—" : `${s.replied} (${pct(s.replied, s.sent)})`}
      </td>
    </tr>
  );
}

function FlowSection({
  flowName,
  flow,
  recs,
  recsLoading,
}: {
  flowName: string;
  flow: FlowMetrics;
  recs: Recommendation[] | null;
  recsLoading: boolean;
}) {
  const { users } = flow;
  const hasData = flow.steps.some((s) => s.sent > 0);
  return (
    <div>
    <div className="bg-white border border-taupe/20 rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-taupe/10 flex items-center justify-between">
        <h2 className="font-serif text-lg text-obsidian">{FLOW_LABELS[flowName] ?? flowName}</h2>
        <div className="flex items-center gap-4 text-xs text-charcoal/50">
          <span><span className="text-forest font-medium">{users.active}</span> active</span>
          <span><span className="text-ember font-medium">{users.paused}</span> paused</span>
          <span><span className="text-charcoal/40 font-medium">{users.completed}</span> completed</span>
          <span className="text-charcoal/30">·</span>
          <span>{users.total} total</span>
        </div>
      </div>
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
          {flow.steps.map((s) => <StepRow key={s.step} s={s} />)}
        </tbody>
      </table>
      {!hasData && (
        <div className="px-5 py-6 text-center text-xs text-charcoal/30 border-t border-taupe/10">
          No data yet — emails sent from here will appear once the Resend webhook is active.
        </div>
      )}
    </div>
    <RecommendationsPanel recs={recs} loading={recsLoading} />
  </div>
  );
}

function PerformanceTab({
  data,
  loading,
  onRefresh,
  error,
  getHeaders,
}: {
  data: SequenceData | null;
  loading: boolean;
  onRefresh: () => void;
  error: string | null;
  getHeaders: () => Promise<HeadersInit>;
}) {
  const [recs, setRecs] = useState<Record<string, Recommendation[]> | null>(null);
  const [recsLoading, setRecsLoading] = useState(false);
  const [recsError, setRecsError] = useState<string | null>(null);

  const flows = data?.flows ?? {};
  const orderedFlows = [
    ...FLOW_ORDER.filter((f) => f in flows),
    ...Object.keys(flows).filter((f) => !FLOW_ORDER.includes(f)),
  ];

  const loadInsights = useCallback(async () => {
    if (!data || Object.keys(data.flows).length === 0) return;
    setRecsLoading(true);
    setRecsError(null);
    try {
      const res = await fetch("/api/admin/recommendations", {
        method: "POST",
        headers: { ...(await getHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ flows: data.flows }),
      });
      const json = await res.json() as { flows?: Record<string, Recommendation[]>; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load insights");
      setRecs(json.flows ?? null);
    } catch (e) {
      setRecsError((e as Error).message);
    } finally {
      setRecsLoading(false);
    }
  }, [data, getHeaders]);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button
          onClick={() => void loadInsights()}
          disabled={recsLoading || loading || !data}
          className="text-sm bg-obsidian text-cream px-4 py-1.5 rounded-lg hover:bg-charcoal disabled:opacity-40 transition-colors"
        >
          {recsLoading ? "Analyzing…" : recs ? "Refresh insights" : "Get insights"}
        </button>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="text-sm text-forest hover:underline disabled:opacity-50"
        >
          {loading ? "Loading..." : "Refresh"}
        </button>
      </div>
      {recsError && (
        <div className="bg-ember/10 border border-ember/20 rounded-xl p-4 text-sm text-ember mb-4">{recsError}</div>
      )}
      {error && (
        <div className="bg-ember/10 border border-ember/20 rounded-xl p-4 text-sm text-ember mb-6">{error}</div>
      )}
      {loading ? (
        <p className="text-charcoal/40 text-sm">Loading...</p>
      ) : (
        <div className="space-y-6">
          {orderedFlows.map((flowName) => (
            <FlowSection
              key={flowName}
              flowName={flowName}
              flow={flows[flowName]}
              recs={recs?.[flowName] ?? null}
              recsLoading={recsLoading}
            />
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Users tab ────────────────────────────────────────────────────────────────

function UsersTab({ getHeaders }: { getHeaders: () => Promise<HeadersInit> }) {
  const [users, setUsers] = useState<SeqUser[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/sequence-users", { headers: await getHeaders() });
      const json = await res.json() as { users?: SeqUser[]; error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load");
      setUsers(json.users ?? []);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [getHeaders]);

  useEffect(() => { void load(); }, [load]);

  const doAction = useCallback(async (uid: string, action: string) => {
    if (action === "reset" && !confirm("Reset this user's sequence from Step 1? This cannot be undone.")) return;
    setPending((p) => ({ ...p, [uid]: true }));
    try {
      const res = await fetch("/api/admin/sequence-users", {
        method: "POST",
        headers: { ...(await getHeaders()), "Content-Type": "application/json" },
        body: JSON.stringify({ uid, action }),
      });
      if (!res.ok) {
        const j = await res.json() as { error?: string };
        throw new Error(j.error ?? "Action failed");
      }
      await load();
    } catch (e) {
      alert((e as Error).message);
    } finally {
      setPending((p) => ({ ...p, [uid]: false }));
    }
  }, [getHeaders, load]);

  const filtered = (users ?? []).filter((u) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    return u.email.toLowerCase().includes(q) || (u.firstName ?? "").toLowerCase().includes(q);
  });

  if (loading) return <p className="text-charcoal/40 text-sm">Loading...</p>;
  if (error) return <div className="bg-ember/10 border border-ember/20 rounded-xl p-4 text-sm text-ember">{error}</div>;

  return (
    <div>
      <div className="flex items-center justify-between mb-4 gap-4">
        <input
          type="text"
          placeholder="Search by email or name..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="border border-taupe/30 rounded-lg px-3 py-1.5 text-sm text-obsidian placeholder:text-charcoal/30 focus:outline-none focus:ring-1 focus:ring-forest/40 w-64"
        />
        <button onClick={() => void load()} className="text-sm text-forest hover:underline">
          Refresh
        </button>
      </div>

      <div className="bg-white border border-taupe/20 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-taupe/10 bg-bone/40">
              <th className="text-left px-4 py-2.5 text-xs uppercase tracking-widest text-charcoal/40 font-medium">User</th>
              <th className="text-left px-4 py-2.5 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Flow</th>
              <th className="text-center px-4 py-2.5 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Status</th>
              <th className="text-center px-4 py-2.5 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Step</th>
              <th className="text-left px-4 py-2.5 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Next send</th>
              <th className="text-right px-4 py-2.5 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 && (
              <tr>
                <td colSpan={6} className="text-center py-8 text-sm text-charcoal/30">
                  {search ? "No users match your search." : "No users in sequences yet."}
                </td>
              </tr>
            )}
            {filtered.map((u) => (
              <tr key={u.uid} className="border-b border-taupe/10 last:border-0 hover:bg-bone/30">
                <td className="px-4 py-3">
                  <p className="text-sm font-medium text-obsidian">{u.firstName ?? "—"}</p>
                  <p className="text-xs text-charcoal/40">{u.email}</p>
                </td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${flowBadge(u.flow)}`}>
                    {FLOW_LABELS[u.flow] ?? u.flow}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${statusBadge(u.status)}`}>
                    {u.status}
                    {u.status === "paused" && u.pausedReason ? ` (${u.pausedReason})` : ""}
                  </span>
                </td>
                <td className="px-4 py-3 text-center text-sm text-charcoal/70">
                  {u.status === "completed"
                    ? "done"
                    : `${u.nextStep + 1} / ${u.totalSteps}`}
                </td>
                <td className="px-4 py-3 text-xs text-charcoal/50">
                  {u.status === "completed" ? "—" : fmtDate(u.nextSendAt)}
                </td>
                <td className="px-4 py-3 text-right">
                  <div className="flex items-center justify-end gap-2">
                    {u.status === "active" && (
                      <button
                        onClick={() => void doAction(u.uid, "pause")}
                        disabled={pending[u.uid]}
                        className="text-xs text-charcoal/50 hover:text-ember disabled:opacity-40 transition-colors"
                      >
                        Pause
                      </button>
                    )}
                    {u.status === "paused" && (
                      <button
                        onClick={() => void doAction(u.uid, "resume")}
                        disabled={pending[u.uid]}
                        className="text-xs text-forest hover:underline disabled:opacity-40"
                      >
                        Resume
                      </button>
                    )}
                    {u.status !== "active" && (
                      <button
                        onClick={() => void doAction(u.uid, "reset")}
                        disabled={pending[u.uid]}
                        className="text-xs text-charcoal/40 hover:text-obsidian disabled:opacity-40 transition-colors"
                      >
                        Reset
                      </button>
                    )}
                    {u.status === "active" && (
                      <button
                        onClick={() => void doAction(u.uid, "reset")}
                        disabled={pending[u.uid]}
                        className="text-xs text-charcoal/40 hover:text-obsidian disabled:opacity-40 transition-colors"
                      >
                        Reset
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-charcoal/30 mt-3">{filtered.length} user{filtered.length !== 1 ? "s" : ""}</p>
    </div>
  );
}

// ─── Templates tab ────────────────────────────────────────────────────────────

function TemplatesTab({ getHeaders }: { getHeaders: () => Promise<HeadersInit> }) {
  const [data, setData] = useState<TemplatesData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFlow, setActiveFlow] = useState<string>("access");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/admin/email-templates", { headers: await getHeaders() });
        const json = await res.json() as TemplatesData & { error?: string };
        if (!cancelled) {
          if (!res.ok) throw new Error(json.error ?? "Failed to load");
          setData(json);
        }
      } catch (e) {
        if (!cancelled) setError((e as Error).message);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [getHeaders]);

  if (loading) return <p className="text-charcoal/40 text-sm">Loading...</p>;
  if (error) return <div className="bg-ember/10 border border-ember/20 rounded-xl p-4 text-sm text-ember">{error}</div>;
  if (!data) return null;

  const orderedFlows = FLOW_ORDER.filter((f) => f in data.flows);
  const currentFlow = data.flows[activeFlow];

  const toggle = (key: string) => setExpanded((p) => ({ ...p, [key]: !p[key] }));

  return (
    <div>
      {/* Flow selector */}
      <div className="flex items-center gap-2 mb-6 flex-wrap">
        {orderedFlows.map((f) => (
          <button
            key={f}
            onClick={() => setActiveFlow(f)}
            className={`px-4 py-1.5 rounded-full text-sm font-medium transition-colors ${
              activeFlow === f
                ? "bg-obsidian text-cream"
                : "bg-bone text-charcoal/60 hover:text-charcoal"
            }`}
          >
            {FLOW_LABELS[f] ?? f}
          </button>
        ))}
      </div>

      {/* Email list */}
      {currentFlow && (
        <div className="space-y-3">
          {currentFlow.steps.map((s) => {
            const key = `${activeFlow}-${s.step}`;
            const isOpen = expanded[key] ?? false;
            const timing =
              s.triggerType === "event"
                ? "event-triggered"
                : s.delayDays === 0
                ? "immediately"
                : `day ${s.delayDays}`;
            return (
              <div key={key} className="bg-white border border-taupe/20 rounded-xl overflow-hidden">
                <button
                  onClick={() => toggle(key)}
                  className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-bone/30 transition-colors"
                >
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-charcoal/40 w-14 flex-shrink-0">
                      Email {s.step + 1}
                    </span>
                    <span className="text-sm font-medium text-obsidian">{s.subject}</span>
                  </div>
                  <div className="flex items-center gap-3 flex-shrink-0">
                    <span className="text-xs text-charcoal/40">{timing}</span>
                    <span className="text-charcoal/30 text-xs">{isOpen ? "▲" : "▼"}</span>
                  </div>
                </button>
                {isOpen && (
                  <div className="border-t border-taupe/10 px-5 py-4">
                    <p className="text-xs text-charcoal/40 mb-2 uppercase tracking-widest">Subject</p>
                    <p className="text-sm text-obsidian mb-4 font-medium">{s.subject}</p>
                    <p className="text-xs text-charcoal/40 mb-2 uppercase tracking-widest">Body</p>
                    <pre className="text-sm text-charcoal/80 whitespace-pre-wrap font-sans leading-relaxed bg-bone/40 rounded-lg p-4">
                      {s.text}
                    </pre>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminSequencesPage() {
  const { user: adminUser, authLoading } = useMembership();
  const [tab, setTab] = useState<Tab>("performance");
  const [perfData, setPerfData] = useState<SequenceData | null>(null);
  const [perfLoading, setPerfLoading] = useState(true);
  const [perfError, setPerfError] = useState<string | null>(null);

  const getHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!adminUser) throw new Error("Not authenticated");
    const token = await adminUser.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }, [adminUser]);

  const loadPerf = useCallback(async () => {
    if (authLoading || !adminUser) return;
    setPerfLoading(true);
    setPerfError(null);
    try {
      const res = await fetch("/api/admin/sequences", { headers: await getHeaders() });
      const json = await res.json() as SequenceData & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load sequences");
      setPerfData(json);
    } catch (e) {
      setPerfError((e as Error).message);
    } finally {
      setPerfLoading(false);
    }
  }, [authLoading, adminUser, getHeaders]);

  useEffect(() => { void loadPerf(); }, [loadPerf]);

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      <div className="mb-6">
        <h1 className="font-serif text-3xl text-obsidian">Sequences</h1>
        <p className="text-charcoal/50 text-sm mt-1">Email drip management</p>
      </div>

      <TabBar active={tab} onChange={setTab} />

      {tab === "performance" && (
        <PerformanceTab
          data={perfData}
          loading={perfLoading}
          onRefresh={() => void loadPerf()}
          error={perfError}
          getHeaders={getHeaders}
        />
      )}
      {tab === "users" && <UsersTab getHeaders={getHeaders} />}
      {tab === "templates" && <TemplatesTab getHeaders={getHeaders} />}
    </div>
  );
}
