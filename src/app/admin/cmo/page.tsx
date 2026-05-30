"use client";

/**
 * /admin/cmo
 *
 * CMO Brain — 6-layer LLM pipeline visualizer + plays board.
 *
 * - Top: executive summary + "Run now" button + run history selector
 * - Plays board (this week / next 30 days / quarterly bet) with bet/math/
 *   evidence/artifact tabs and a "ship it" copy-to-clipboard button per
 *   artifact
 * - Stepper: each of the 6 layers expandable to show raw output
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import { useMembership } from "@/app/context/MembershipContext";

// ─── Types (mirror src/app/api/_lib/cmo/types.ts) ────────────────────────
interface PlayArtifact {
  kind: "ad_copy" | "email" | "page_copy" | "campaign_config" | "experiment";
  title: string;
  body: string;
  meta?: Record<string, string>;
}

// All synthesis-output fields are 'loose' because the LLM occasionally
// paraphrases shapes; rendering uses tolerant accessors below.
interface FinalPlay {
  id: string;
  title: string;
  hypothesis: string;
  funnel_stage: string;
  expected_lift: unknown;
  effort: string;
  ice: unknown;
  depends_on?: string[];
  risks?: string[];
  projection?: unknown;
  roi_score?: number;
  why_now?: string;
  how_to_ship?: string[];
  success_metric?: string;
  rollback_trigger?: string;
  artifacts?: PlayArtifact[];
}

// ─── Tolerant accessors ─────────────────────────────────────────────────
function iceScore(ice: unknown): number {
  if (typeof ice === "number") return ice;
  if (ice && typeof ice === "object") {
    const o = ice as Record<string, unknown>;
    const s = o.score;
    if (typeof s === "number") return s;
  }
  return 0;
}
function iceBreakdown(ice: unknown): { impact: number; confidence: number; ease: number } | null {
  if (ice && typeof ice === "object") {
    const o = ice as Record<string, unknown>;
    if (typeof o.impact === "number" && typeof o.confidence === "number" && typeof o.ease === "number") {
      return { impact: o.impact, confidence: o.confidence, ease: o.ease };
    }
  }
  return null;
}
function liftMetric(lift: unknown): { metric: string; low: number | null; high: number | null } {
  if (typeof lift === "string") {
    // "metric_name +X-Ypp" form
    const m = lift.match(/(\S+)\s*\+?(-?\d+(?:\.\d+)?)-(-?\d+(?:\.\d+)?)/);
    if (m) return { metric: m[1], low: parseFloat(m[2]), high: parseFloat(m[3]) };
    return { metric: lift, low: null, high: null };
  }
  if (lift && typeof lift === "object") {
    const o = lift as Record<string, unknown>;
    return {
      metric: typeof o.metric === "string" ? o.metric : "",
      low: typeof o.low_pct === "number" ? o.low_pct : null,
      high: typeof o.high_pct === "number" ? o.high_pct : null,
    };
  }
  return { metric: "", low: null, high: null };
}
function projectionInc(projection: unknown): { low: number; high: number } {
  if (!projection || typeof projection !== "object") return { low: 0, high: 0 };
  const o = projection as Record<string, unknown>;
  // canonical shape
  const inc = o.incremental_revenue_90d_cents;
  if (inc && typeof inc === "object") {
    const i = inc as Record<string, unknown>;
    return {
      low: typeof i.low === "number" ? i.low : 0,
      high: typeof i.high === "number" ? i.high : 0,
    };
  }
  // alternative flat shape
  if (typeof o.low_cents === "number" || typeof o.high_cents === "number") {
    return {
      low: typeof o.low_cents === "number" ? o.low_cents : 0,
      high: typeof o.high_cents === "number" ? o.high_cents : 0,
    };
  }
  return { low: 0, high: 0 };
}
function projectionNotes(projection: unknown): string {
  if (projection && typeof projection === "object") {
    const o = projection as Record<string, unknown>;
    if (typeof o.notes === "string") return o.notes;
  }
  return "";
}
function projectionBaseline(projection: unknown): number | null {
  if (projection && typeof projection === "object") {
    const o = projection as Record<string, unknown>;
    if (typeof o.baseline_value === "number") return o.baseline_value;
  }
  return null;
}

interface CMOOutput {
  executive_summary: string;
  this_week: FinalPlay[];
  next_30_days: FinalPlay[];
  quarterly_bet: FinalPlay | null;
}

interface RunRow {
  id: number;
  status: "running" | "complete" | "failed";
  source: string;
  window_start: string;
  window_end: string;
  sensors: unknown;
  analysts: unknown;
  research: unknown;
  strategist: unknown;
  simulator: unknown;
  cmo: CMOOutput | null;
  plays: FinalPlay[] | null;
  error: string | null;
  started_at: string;
  completed_at: string | null;
  duration_ms: number | null;
  tokens_in: number;
  tokens_out: number;
  cost_usd_cents: number;
}

interface RunSummary {
  id: number;
  status: string;
  started_at: string;
  completed_at: string | null;
  cost_usd_cents: number;
  error: string | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────
const dollars = (cents: number) =>
  `$${(cents / 100).toLocaleString(undefined, { maximumFractionDigits: 0 })}`;

const stageColor = (stage: string): string => {
  const map: Record<string, string> = {
    acquisition: "bg-rose-100 text-rose-900 border-rose-200",
    activation: "bg-amber-100 text-amber-900 border-amber-200",
    retention: "bg-emerald-100 text-emerald-900 border-emerald-200",
    monetization: "bg-violet-100 text-violet-900 border-violet-200",
    site: "bg-sky-100 text-sky-900 border-sky-200",
  };
  return map[stage] ?? "bg-stone-100 text-stone-900 border-stone-200";
};

function timeAgo(iso: string): string {
  const d = new Date(iso).getTime();
  const now = Date.now();
  const ms = now - d;
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}

// ─── Play Card ────────────────────────────────────────────────────────────
function PlayCard({ play, index }: { play: FinalPlay; index: number }) {
  const [tab, setTab] = useState<"bet" | "math" | "evidence" | "artifacts">("bet");
  const [copied, setCopied] = useState<string | null>(null);

  const inc = projectionInc(play.projection);
  const mid = (inc.low + inc.high) / 2;
  const lift = liftMetric(play.expected_lift);
  const iceVal = iceScore(play.ice);
  const iceParts = iceBreakdown(play.ice);
  const artifacts = play.artifacts ?? [];
  const baseline = projectionBaseline(play.projection);

  const copy = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      // ignore
    }
  };

  return (
    <div className="rounded-2xl border border-taupe/20 bg-white shadow-sm overflow-hidden">
      {/* Colored header strip */}
      <div className={`px-5 py-3 border-b ${stageColor(play.funnel_stage)}`}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs font-medium uppercase tracking-wider opacity-70">
                #{index + 1} · {play.funnel_stage}
              </span>
              <span className="text-xs px-2 py-0.5 bg-white/60 rounded-full font-medium">
                effort {play.effort}
              </span>
              <span className="text-xs px-2 py-0.5 bg-white/60 rounded-full font-medium">
                ICE {iceVal}
              </span>
            </div>
            <h3 className="font-serif text-lg font-medium leading-tight">
              {play.title}
            </h3>
          </div>
          <div className="text-right">
            <div className="text-2xl font-medium tabular-nums">
              {dollars(mid)}
            </div>
            <div className="text-[10px] uppercase opacity-70">90d incremental</div>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-5 pt-3 flex gap-4 border-b border-taupe/10 text-sm">
        {(["bet", "math", "evidence", "artifacts"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`pb-2 -mb-px transition-colors ${
              tab === t
                ? "border-b-2 border-forest text-forest font-medium"
                : "text-charcoal/50 hover:text-charcoal"
            }`}
          >
            {t === "bet"
              ? "The bet"
              : t === "math"
              ? "Math"
              : t === "evidence"
              ? "Evidence"
              : `Ship it (${artifacts.length})`}
          </button>
        ))}
      </div>

      <div className="px-5 py-4 space-y-3 text-sm text-charcoal">
        {tab === "bet" && (
          <>
            <p className="leading-relaxed">{play.hypothesis}</p>
            <div className="rounded-lg bg-cream p-3 space-y-1">
              <div className="text-xs uppercase tracking-wider text-charcoal/60">
                Why now
              </div>
              <p className="leading-relaxed">{play.why_now}</p>
            </div>
            {play.success_metric && (
              <div>
                <div className="text-xs uppercase tracking-wider text-charcoal/60 mb-1">
                  Success metric
                </div>
                <p>{play.success_metric}</p>
              </div>
            )}
            {play.rollback_trigger && (
              <div>
                <div className="text-xs uppercase tracking-wider text-charcoal/60 mb-1">
                  Rollback if
                </div>
                <p className="text-rose-700">{play.rollback_trigger}</p>
              </div>
            )}
          </>
        )}

        {tab === "math" && (
          <>
            <div className="grid grid-cols-3 gap-3 text-center">
              <div className="rounded-lg bg-emerald-50 p-3">
                <div className="text-xs uppercase text-emerald-700 mb-1">Low</div>
                <div className="text-lg font-medium tabular-nums">{dollars(inc.low)}</div>
              </div>
              <div className="rounded-lg bg-emerald-100 p-3">
                <div className="text-xs uppercase text-emerald-800 mb-1">Mid</div>
                <div className="text-lg font-medium tabular-nums">{dollars(mid)}</div>
              </div>
              <div className="rounded-lg bg-emerald-200 p-3">
                <div className="text-xs uppercase text-emerald-900 mb-1">High</div>
                <div className="text-lg font-medium tabular-nums">{dollars(inc.high)}</div>
              </div>
            </div>
            {projectionNotes(play.projection) && (
              <div className="text-xs text-charcoal/60 italic">{projectionNotes(play.projection)}</div>
            )}
            <div className="text-xs grid grid-cols-2 gap-2 text-charcoal/70">
              <div>
                <span className="uppercase mr-1">Metric:</span>{lift.metric || "—"}
              </div>
              <div>
                <span className="uppercase mr-1">Lift:</span>
                {lift.low !== null && lift.high !== null ? `+${lift.low}–${lift.high} pp` : "—"}
              </div>
              {baseline !== null && (
                <div>
                  <span className="uppercase mr-1">Baseline:</span>{baseline.toFixed(2)}
                </div>
              )}
              {typeof play.roi_score === "number" && (
                <div>
                  <span className="uppercase mr-1">ROI:</span>{play.roi_score}x
                </div>
              )}
            </div>
          </>
        )}

        {tab === "evidence" && (
          <>
            {(play.depends_on?.length ?? 0) > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-charcoal/60 mb-1">
                  Depends on
                </div>
                <ul className="list-disc pl-5 space-y-1">
                  {(play.depends_on ?? []).map((d, i) => (
                    <li key={i}>{d}</li>
                  ))}
                </ul>
              </div>
            )}
            {(play.risks?.length ?? 0) > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-charcoal/60 mb-1">
                  Risks
                </div>
                <ul className="list-disc pl-5 space-y-1 text-rose-700">
                  {(play.risks ?? []).map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </div>
            )}
            {iceParts && (
              <div>
                <div className="text-xs uppercase tracking-wider text-charcoal/60 mb-1">
                  ICE breakdown
                </div>
                <div className="grid grid-cols-3 gap-2 text-center text-xs">
                  <div className="rounded bg-stone-100 p-2">
                    <div className="opacity-60">Impact</div>
                    <div className="text-base font-medium">{iceParts.impact}</div>
                  </div>
                  <div className="rounded bg-stone-100 p-2">
                    <div className="opacity-60">Confidence</div>
                    <div className="text-base font-medium">{iceParts.confidence}</div>
                  </div>
                  <div className="rounded bg-stone-100 p-2">
                    <div className="opacity-60">Ease</div>
                    <div className="text-base font-medium">{iceParts.ease}</div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}

        {tab === "artifacts" && (
          <>
            {(play.how_to_ship?.length ?? 0) > 0 && (
              <div>
                <div className="text-xs uppercase tracking-wider text-charcoal/60 mb-2">
                  How to ship
                </div>
                <ol className="list-decimal pl-5 space-y-1">
                  {(play.how_to_ship ?? []).map((s, i) => (
                    <li key={i}>{s}</li>
                  ))}
                </ol>
              </div>
            )}
            <div className="space-y-3 pt-2">
              {artifacts.map((a, i) => {
                const key = `${play.id}-${i}`;
                return (
                  <div
                    key={key}
                    className="rounded-lg border border-taupe/20 bg-cream/40 p-3"
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div>
                        <span className="text-xs uppercase tracking-wider text-charcoal/60 mr-2">
                          {a.kind.replace("_", " ")}
                        </span>
                        <span className="font-medium">{a.title}</span>
                      </div>
                      <button
                        onClick={() => copy(key, a.body)}
                        className="text-xs px-3 py-1 rounded-full bg-forest text-white hover:bg-forest/90 transition-colors"
                      >
                        {copied === key ? "Copied" : "Ship it"}
                      </button>
                    </div>
                    {a.meta && Object.keys(a.meta).length > 0 && (
                      <div className="text-xs text-charcoal/60 mb-2 grid grid-cols-2 gap-1">
                        {Object.entries(a.meta).map(([k, v]) => (
                          <div key={k}>
                            <span className="uppercase mr-1">{k}:</span>
                            {v}
                          </div>
                        ))}
                      </div>
                    )}
                    <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed bg-white rounded p-3 max-h-72 overflow-auto">
                      {a.body}
                    </pre>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ─── Layer stepper ────────────────────────────────────────────────────────
const LAYERS: Array<{ key: keyof RunRow; label: string; description: string }> = [
  { key: "sensors", label: "Sensors", description: "Pulls funnel + retention + site + ads + sessions" },
  { key: "analysts", label: "Analysts", description: "5 specialists score findings" },
  { key: "research", label: "Research", description: "Web-grounded benchmarks & tactics" },
  { key: "strategist", label: "Strategist", description: "ICE-ranks candidate plays" },
  { key: "simulator", label: "Simulator", description: "Deterministic 90-day projections" },
  { key: "cmo", label: "CMO", description: "Drafts final plays + artifacts" },
];

function LayerStepper({ run }: { run: RunRow }) {
  const [openKey, setOpenKey] = useState<string | null>(null);
  return (
    <div className="rounded-2xl border border-taupe/20 bg-white overflow-hidden">
      <div className="px-5 py-3 border-b border-taupe/10">
        <h2 className="font-serif text-base font-medium text-obsidian">
          Pipeline
        </h2>
      </div>
      <div className="divide-y divide-taupe/10">
        {LAYERS.map((layer, i) => {
          const payload = run[layer.key];
          const done = payload !== null && payload !== undefined;
          const open = openKey === layer.label;
          return (
            <div key={layer.label}>
              <button
                onClick={() => setOpenKey(open ? null : layer.label)}
                className="w-full px-5 py-3 flex items-center gap-4 hover:bg-cream/50 text-left transition-colors"
              >
                <div
                  className={`shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                    done
                      ? "bg-forest text-white"
                      : run.status === "running"
                      ? "bg-amber-100 text-amber-700 animate-pulse"
                      : "bg-stone-200 text-stone-500"
                  }`}
                >
                  {i + 1}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-sm">{layer.label}</div>
                  <div className="text-xs text-charcoal/60">{layer.description}</div>
                </div>
                <div className="text-xs text-charcoal/40">
                  {done ? "✓" : run.status === "running" ? "..." : "—"}
                </div>
              </button>
              {open && done && (
                <div className="px-5 pb-4 -mt-1">
                  <pre className="text-xs bg-cream/40 rounded p-3 max-h-96 overflow-auto whitespace-pre-wrap">
                    {JSON.stringify(payload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Main page ────────────────────────────────────────────────────────────
export default function CMOPage() {
  const { user: adminUser, authLoading } = useMembership();
  const [run, setRun] = useState<RunRow | null>(null);
  const [history, setHistory] = useState<RunSummary[]>([]);
  const [loading, setLoading] = useState(true); // start loading so we don't flash the empty state
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authHeaders = useCallback(async (): Promise<HeadersInit | null> => {
    if (!adminUser) return null;
    const token = await adminUser.getIdToken();
    return { Authorization: `Bearer ${token}` };
  }, [adminUser]);

  const fetchLatest = useCallback(
    async (id?: number) => {
      if (authLoading) return; // wait for auth state to resolve
      if (!adminUser) {
        setLoading(false);
        setError("Not signed in — refresh the page");
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const headers = await authHeaders();
        if (!headers) throw new Error("Not signed in");
        const url = id
          ? `/api/admin/cmo/latest?id=${id}`
          : "/api/admin/cmo/latest";
        const r = await fetch(url, { headers });
        if (!r.ok) {
          const body = await r.text().catch(() => "");
          throw new Error(`Fetch failed (${r.status}): ${body.slice(0, 200)}`);
        }
        const j = (await r.json()) as { run: RunRow | null };
        setRun(j.run);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setLoading(false);
      }
    },
    [authLoading, adminUser, authHeaders]
  );

  const fetchHistory = useCallback(async () => {
    if (authLoading || !adminUser) return;
    try {
      const headers = await authHeaders();
      if (!headers) return;
      const r = await fetch("/api/admin/cmo/latest?limit=10", { headers });
      if (!r.ok) return;
      const j = (await r.json()) as { runs: RunSummary[] };
      setHistory(j.runs);
    } catch {
      // non-fatal
    }
  }, [authLoading, adminUser, authHeaders]);

  useEffect(() => {
    void fetchLatest();
    void fetchHistory();
  }, [fetchLatest, fetchHistory]);

  const triggerRun = async () => {
    if (running) return;
    setRunning(true);
    setError(null);
    try {
      const headers = await authHeaders();
      if (!headers) throw new Error("Not signed in");
      const r = await fetch("/api/admin/cmo/run", {
        method: "POST",
        headers: { ...headers, "Content-Type": "application/json" },
        body: JSON.stringify({ windowDays: 14 }),
      });
      const j = (await r.json()) as { id?: number; error?: string };
      if (!r.ok) throw new Error(j.error ?? `Run failed: ${r.status}`);
      await fetchLatest(j.id);
      await fetchHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  const cmo = run?.cmo ?? null;
  const allPlays = useMemo(() => {
    if (!cmo) return [];
    return [
      ...cmo.this_week.map((p) => ({ p, group: "This week" })),
      ...cmo.next_30_days.map((p) => ({ p, group: "Next 30 days" })),
      ...(cmo.quarterly_bet ? [{ p: cmo.quarterly_bet, group: "Quarterly bet" }] : []),
    ];
  }, [cmo]);

  return (
    <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
      {/* Header */}
      <header className="flex items-end justify-between gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl text-obsidian font-medium">CMO Brain</h1>
          <p className="text-sm text-charcoal/60 mt-1">
            Sensors → Analysts → Research → Strategist → Simulator → CMO. One pass per run.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {history.length > 0 && (
            <select
              className="text-sm border border-taupe/30 rounded-lg px-3 py-2 bg-white"
              value={run?.id ?? ""}
              onChange={(e) => void fetchLatest(parseInt(e.target.value, 10))}
            >
              {history.map((h) => (
                <option key={h.id} value={h.id}>
                  #{h.id} · {h.status} · {timeAgo(h.started_at)}
                </option>
              ))}
            </select>
          )}
          <button
            onClick={() => void triggerRun()}
            disabled={running || authLoading}
            className="px-5 py-2 rounded-full bg-forest text-white text-sm font-medium hover:bg-forest/90 disabled:opacity-50 transition-colors"
          >
            {running ? "Running (~3–8 min)..." : "Run now"}
          </button>
        </div>
      </header>

      {/* Status banner */}
      {error && (
        <div className="rounded-lg bg-rose-50 border border-rose-200 text-rose-900 text-sm px-4 py-3">
          {error}
        </div>
      )}

      {loading && !run && (
        <div className="rounded-2xl border border-taupe/20 bg-white p-10 text-center text-sm text-charcoal/50">
          Loading latest run…
        </div>
      )}

      {!loading && !run && !error && (
        <div className="rounded-2xl border border-dashed border-taupe/40 bg-white p-10 text-center">
          <p className="text-charcoal/70 mb-4">
            No runs yet. Hit &quot;Run now&quot; to fire the first pass.
          </p>
          <p className="text-xs text-charcoal/40">
            Pipeline takes ~3–8 minutes and costs typically $0.30–$1.20 in Claude credits.
          </p>
        </div>
      )}

      {run && (
        <>
          {/* Executive summary */}
          {cmo && (
            <section className="rounded-2xl bg-gradient-to-br from-forest via-forest/90 to-emerald-700 text-white p-6 shadow-lg">
              <div className="text-xs uppercase tracking-wider opacity-80 mb-2">
                Executive summary · Run #{run.id} · {timeAgo(run.started_at)}
              </div>
              <p className="leading-relaxed text-base">{cmo.executive_summary}</p>
              <div className="mt-4 flex flex-wrap gap-4 text-xs opacity-90">
                <div>
                  Window: {run.window_start} → {run.window_end}
                </div>
                <div>
                  Cost: {dollars(run.cost_usd_cents)}
                </div>
                <div>
                  Tokens: {run.tokens_in.toLocaleString()} in / {run.tokens_out.toLocaleString()} out
                </div>
                <div>
                  Duration: {run.duration_ms ? `${Math.round(run.duration_ms / 1000)}s` : "—"}
                </div>
              </div>
            </section>
          )}

          {/* Running / failed states */}
          {run.status === "running" && (
            <div className="rounded-2xl bg-amber-50 border border-amber-200 p-4 text-sm text-amber-900">
              Pipeline is running — refresh in a few minutes to see plays.
            </div>
          )}
          {run.status === "failed" && (
            <div className="rounded-2xl bg-rose-50 border border-rose-200 p-4 text-sm text-rose-900">
              <div className="font-medium mb-1">Run failed</div>
              <div className="text-xs">{run.error ?? "Unknown error"}</div>
            </div>
          )}

          {/* Plays */}
          {cmo && allPlays.length > 0 && (
            <section className="space-y-6">
              {["This week", "Next 30 days", "Quarterly bet"].map((group) => {
                const plays = allPlays.filter((x) => x.group === group);
                if (plays.length === 0) return null;
                return (
                  <div key={group}>
                    <h2 className="font-serif text-xl text-obsidian font-medium mb-3">
                      {group}
                    </h2>
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                      {plays.map(({ p }, i) => (
                        <PlayCard key={p.id} play={p} index={i} />
                      ))}
                    </div>
                  </div>
                );
              })}
            </section>
          )}

          {/* Stepper */}
          <LayerStepper run={run} />
        </>
      )}
    </main>
  );
}
