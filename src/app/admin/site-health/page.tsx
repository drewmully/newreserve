"use client";

/**
 * /admin/site-health
 *
 * Autonomous monitoring dashboard. Findings come from the daily sweep
 * (synthetic journey checks + Claude UX judge + PostHog $exception ingest);
 * the Friday digest emails a summary with per-finding PDFs.
 *
 * Sections:
 *   - KPI tiles (P0 / P1 / P2 / new this window)
 *   - Journey heatmap (signup, login, shop, account, upgrade, returns, home)
 *   - Findings table (filter by severity, status; per-row screenshot + actions)
 */

import { useEffect, useState, useMemo, useCallback } from "react";
import { onAuthStateChanged } from "firebase/auth";
import { auth } from "@/lib/firebase";

type Severity = "P0" | "P1" | "P2";
type Journey =
  | "signup"
  | "login"
  | "home"
  | "account"
  | "upgrade"
  | "checkout"
  | "returns"
  | "admin"
  | "shop"
  | "other";
type Status = "new" | "acknowledged" | "fixed" | "ignored";

interface FindingEvidence {
  url: string;
  screenshot_url?: string | null;
  console_excerpt?: string | null;
  network_excerpt?: string | null;
  stack_excerpt?: string | null;
  dom_excerpt?: string | null;
  posthog_event_id?: string | null;
}

interface SiteHealthFinding {
  id: string;
  dedupe_hash: string;
  date: string;
  title: string;
  description: string;
  severity: Severity;
  journey: Journey;
  first_seen_at: number;
  last_seen_at: number;
  occurrence_count: number;
  status: Status;
  source: string;
  suggested_fix?: string | null;
  evidence: FindingEvidence;
}

interface KpiPayload {
  total: number;
  by_severity: Record<Severity, number>;
  by_journey: Record<string, number>;
  new_this_window: number;
  recurring: number;
}

interface ApiPayload {
  window: {
    startMs: number;
    endMs: number;
    startLabel: string;
    endLabel: string;
  };
  kpis: KpiPayload;
  findings: SiteHealthFinding[];
}

const RANGES = [
  { value: "7d", label: "7 days" },
  { value: "14d", label: "14 days" },
  { value: "30d", label: "30 days" },
] as const;

const SEV_BADGE: Record<Severity, string> = {
  P0: "bg-red-600 text-white",
  P1: "bg-orange-500 text-white",
  P2: "bg-yellow-500 text-charcoal",
};

const STATUS_BADGE: Record<Status, string> = {
  new: "bg-blue-100 text-blue-800",
  acknowledged: "bg-gray-100 text-gray-800",
  fixed: "bg-green-100 text-green-800",
  ignored: "bg-gray-100 text-gray-500",
};

function pathOf(url: string | undefined): string {
  if (!url) return "";
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}

function formatRelative(ms: number): string {
  const diff = Date.now() - ms;
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return `${min}m ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}

export default function SiteHealthPage() {
  const [token, setToken] = useState<string | null>(null);
  const [data, setData] = useState<ApiPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [range, setRange] = useState<"7d" | "14d" | "30d">("7d");
  const [sevFilter, setSevFilter] = useState<"all" | Severity>("all");
  const [statusFilter, setStatusFilter] = useState<"active" | "all">("active");
  const [running, setRunning] = useState(false);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, async (user) => {
      if (user) {
        const t = await user.getIdToken();
        setToken(t);
      }
    });
    return unsub;
  }, []);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/admin/site-health?range=${range}&status=${statusFilter}`,
        { headers: { Authorization: `Bearer ${token}` } },
      );
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as ApiPayload;
      setData(json);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [token, range, statusFilter]);

  useEffect(() => {
    void load();
  }, [load]);

  const filteredFindings = useMemo(() => {
    if (!data) return [];
    if (sevFilter === "all") return data.findings;
    return data.findings.filter((f) => f.severity === sevFilter);
  }, [data, sevFilter]);

  const updateStatus = async (id: string, status: Status) => {
    if (!token) return;
    try {
      const res = await fetch("/api/admin/site-health", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id, status }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const runSweep = async () => {
    if (!token) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch("/api/admin/cron/site-health-sweep?manual=1", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <header className="flex items-baseline justify-between mb-6 gap-4 flex-wrap">
        <div>
          <h1 className="font-serif text-3xl text-obsidian">Site Health</h1>
          <p className="text-sm text-charcoal/60 mt-1">
            Autonomous monitoring · daily sweep · Friday 6 AM digest to
            drew@ and jack@
            {data && (
              <span className="ml-2 text-charcoal/40">
                · {data.window.startLabel} – {data.window.endLabel}
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <select
            value={range}
            onChange={(e) => setRange(e.target.value as "7d" | "14d" | "30d")}
            className="border border-charcoal/20 rounded-lg px-3 py-1.5 text-sm bg-white"
          >
            {RANGES.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <button
            onClick={runSweep}
            disabled={running}
            className="px-3 py-1.5 text-sm rounded-lg bg-forest text-white disabled:opacity-50"
          >
            {running ? "Sweeping…" : "Run sweep now"}
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
          {error}
        </div>
      )}

      {/* KPI tiles */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-3 mb-6">
        <KpiTile
          label="P0 critical"
          value={data?.kpis.by_severity.P0 ?? 0}
          accent="border-red-300"
          textColor="text-red-700"
          loading={loading}
        />
        <KpiTile
          label="P1 high"
          value={data?.kpis.by_severity.P1 ?? 0}
          accent="border-orange-300"
          textColor="text-orange-700"
          loading={loading}
        />
        <KpiTile
          label="P2 low"
          value={data?.kpis.by_severity.P2 ?? 0}
          accent="border-yellow-300"
          textColor="text-yellow-700"
          loading={loading}
        />
        <KpiTile
          label="New this window"
          value={data?.kpis.new_this_window ?? 0}
          accent="border-charcoal/20"
          textColor="text-obsidian"
          loading={loading}
        />
        <KpiTile
          label="Recurring"
          value={data?.kpis.recurring ?? 0}
          accent="border-charcoal/20"
          textColor="text-obsidian"
          loading={loading}
        />
      </div>

      {/* Journey grid */}
      <section className="mb-6">
        <h2 className="font-serif text-lg text-obsidian mb-3">By journey</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-8 gap-2">
          {(
            [
              "home",
              "signup",
              "login",
              "shop",
              "account",
              "upgrade",
              "checkout",
              "returns",
            ] as Journey[]
          ).map((j) => {
            const count = data?.kpis.by_journey[j] ?? 0;
            return (
              <div
                key={j}
                className={`rounded-lg p-3 border ${
                  count > 0
                    ? "bg-red-50 border-red-200"
                    : "bg-white border-charcoal/10"
                }`}
              >
                <p className="text-xs uppercase tracking-widest text-charcoal/50">
                  {j}
                </p>
                <p
                  className={`font-serif text-2xl ${
                    count > 0 ? "text-red-700" : "text-charcoal/40"
                  }`}
                >
                  {count}
                </p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Findings list */}
      <section>
        <div className="flex items-baseline justify-between mb-3 gap-4 flex-wrap">
          <h2 className="font-serif text-lg text-obsidian">
            Findings ({filteredFindings.length})
          </h2>
          <div className="flex items-center gap-2 text-sm">
            <span className="text-charcoal/40">Severity:</span>
            {(["all", "P0", "P1", "P2"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setSevFilter(s)}
                className={`px-2 py-0.5 rounded text-xs ${
                  sevFilter === s
                    ? "bg-obsidian text-white"
                    : "bg-white border border-charcoal/20"
                }`}
              >
                {s}
              </button>
            ))}
            <span className="text-charcoal/40 ml-3">Status:</span>
            {(["active", "all"] as const).map((s) => (
              <button
                key={s}
                onClick={() => setStatusFilter(s)}
                className={`px-2 py-0.5 rounded text-xs ${
                  statusFilter === s
                    ? "bg-obsidian text-white"
                    : "bg-white border border-charcoal/20"
                }`}
              >
                {s}
              </button>
            ))}
          </div>
        </div>

        {loading && (
          <p className="text-sm text-charcoal/50 py-8 text-center">Loading…</p>
        )}

        {!loading && filteredFindings.length === 0 && (
          <div className="bg-white border border-charcoal/10 rounded-xl p-8 text-center">
            <p className="font-serif text-xl text-obsidian">All clear</p>
            <p className="text-sm text-charcoal/60 mt-1">
              No findings in this window.
            </p>
          </div>
        )}

        <div className="space-y-2">
          {filteredFindings.map((f) => (
            <FindingRow
              key={f.id}
              finding={f}
              onUpdate={(status) => updateStatus(f.id, status)}
            />
          ))}
        </div>
      </section>
    </div>
  );
}

function KpiTile({
  label,
  value,
  accent,
  textColor,
  loading,
}: {
  label: string;
  value: number;
  accent: string;
  textColor: string;
  loading: boolean;
}) {
  return (
    <div className={`bg-white border ${accent} rounded-xl p-5`}>
      <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-2">
        {label}
      </p>
      <p className={`font-serif text-3xl ${textColor}`}>
        {loading ? "…" : value}
      </p>
    </div>
  );
}

function FindingRow({
  finding,
  onUpdate,
}: {
  finding: SiteHealthFinding;
  onUpdate: (status: Status) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div className="bg-white border border-charcoal/10 rounded-xl overflow-hidden">
      <div
        className="flex items-start gap-3 p-4 cursor-pointer hover:bg-charcoal/[0.02]"
        onClick={() => setExpanded(!expanded)}
      >
        <span
          className={`px-2 py-0.5 rounded text-xs font-medium ${SEV_BADGE[finding.severity]}`}
        >
          {finding.severity}
        </span>
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2 flex-wrap">
            <p className="font-medium text-obsidian">{finding.title}</p>
            <span className="text-xs text-charcoal/50">
              {finding.journey} · {pathOf(finding.evidence?.url)}
            </span>
          </div>
          <p className="text-sm text-charcoal/60 mt-1 line-clamp-2">
            {finding.description}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1 shrink-0">
          <span
            className={`px-2 py-0.5 rounded-full text-[10px] ${STATUS_BADGE[finding.status]}`}
          >
            {finding.status}
          </span>
          <span className="text-[10px] text-charcoal/40">
            {finding.occurrence_count}× · {formatRelative(finding.last_seen_at)}
          </span>
        </div>
      </div>

      {expanded && (
        <div className="border-t border-charcoal/10 p-4 bg-charcoal/[0.02] space-y-3 text-sm">
          {finding.suggested_fix && (
            <div>
              <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">
                Suggested fix
              </p>
              <p>{finding.suggested_fix}</p>
            </div>
          )}

          {finding.evidence?.screenshot_url && (
            <div>
              <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">
                Screenshot
              </p>
              <a
                href={finding.evidence.screenshot_url}
                target="_blank"
                rel="noreferrer"
                className="inline-block"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={finding.evidence.screenshot_url}
                  alt="Finding screenshot"
                  className="max-w-md border border-charcoal/10 rounded-lg"
                />
              </a>
            </div>
          )}

          {finding.evidence?.console_excerpt && (
            <div>
              <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">
                Console
              </p>
              <pre className="bg-obsidian text-cream/90 text-xs p-3 rounded overflow-x-auto whitespace-pre-wrap">
                {finding.evidence.console_excerpt}
              </pre>
            </div>
          )}

          {finding.evidence?.network_excerpt && (
            <div>
              <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">
                Network excerpt
              </p>
              <pre className="bg-obsidian text-cream/90 text-xs p-3 rounded overflow-x-auto whitespace-pre-wrap">
                {finding.evidence.network_excerpt}
              </pre>
            </div>
          )}

          {finding.evidence?.stack_excerpt && (
            <div>
              <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1">
                Stack trace
              </p>
              <pre className="bg-obsidian text-cream/90 text-xs p-3 rounded overflow-x-auto whitespace-pre-wrap">
                {finding.evidence.stack_excerpt}
              </pre>
            </div>
          )}

          <div className="flex gap-2 pt-2 border-t border-charcoal/10">
            {finding.status !== "acknowledged" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate("acknowledged");
                }}
                className="px-3 py-1 text-xs rounded bg-white border border-charcoal/20 hover:bg-charcoal/5"
              >
                Acknowledge
              </button>
            )}
            {finding.status !== "fixed" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate("fixed");
                }}
                className="px-3 py-1 text-xs rounded bg-green-600 text-white"
              >
                Mark fixed
              </button>
            )}
            {finding.status !== "ignored" && (
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onUpdate("ignored");
                }}
                className="px-3 py-1 text-xs rounded bg-white border border-charcoal/20 hover:bg-charcoal/5 text-charcoal/60"
              >
                Ignore
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
