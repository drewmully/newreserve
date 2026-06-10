"use client";

/**
 * Admin > Intercom
 *
 * Customer-support analytics pulled from the mully-hub Intercom mirror
 * (Supabase: hub_thread / hub_message / hub_conversation_analysis).
 *
 * Answers the questions Drew actually asks:
 *   - How much volume? (threads/day, inbound vs outbound)
 *   - What are people writing in about? (top AI topic labels)
 *   - How are we resolving? (outcome breakdown)
 *   - Are we responsive? (median + p90 first-response time)
 *   - Any spike I should know about? (cancellation surge alert)
 *   - What's actually being said? (recent customer intent samples)
 */

import { useEffect, useState, useCallback } from "react";
import { auth } from "@/lib/firebase";

interface VolumeRow {
  day: string;
  new_threads: number;
  inbound_messages: number;
  outbound_messages: number;
}
interface TopicRow {
  topic_label: string | null;
  count: number;
  avg_confidence: number | null;
}
interface OutcomeRow {
  outcome: string | null;
  count: number;
}
interface PainPoint {
  topic_label: string | null;
  outcome: string | null;
  customer_intent_summary: string | null;
  created_at: string;
  customer_email: string | null;
}
interface RefundSample {
  thread_id: number;
  customer_email: string | null;
  topic_label: string | null;
  intent: string | null;
  agent_action: string | null;
  created_at: string;
}

interface Insights {
  window_days: number;
  generated_at: string;
  totals: {
    threads: number;
    analyzed: number;
    messages: number;
    active_awaiting_reply: number;
  };
  volume_by_day: VolumeRow[];
  top_topics: TopicRow[];
  outcome_breakdown: OutcomeRow[];
  response_time: {
    sample_size: number;
    median_minutes: number | null;
    p90_minutes: number | null;
    threads_no_response: number;
  };
  cancellation_surge: {
    cancel_threads_7d: number;
    cancel_threads_window: number;
    rate_7d_per_day: number;
    rate_window_per_day: number;
    surge: boolean;
  };
  refund_intents: {
    count_window: number;
    recent: RefundSample[];
  };
  top_pain_points: PainPoint[];
}

function num(v: number): string {
  return v.toLocaleString();
}

function fmtMinutes(v: number | null): string {
  if (v === null || !Number.isFinite(v)) return "—";
  if (v < 60) return `${v.toFixed(0)}m`;
  if (v < 60 * 24) return `${(v / 60).toFixed(1)}h`;
  return `${(v / (60 * 24)).toFixed(1)}d`;
}

function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}`;
}

export default function IntercomAdminPage() {
  const [days, setDays] = useState(30);
  const [data, setData] = useState<Insights | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("not signed in");
      const token = await user.getIdToken();
      const res = await fetch(`/api/admin/intercom-insights?days=${days}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(j.error ?? "failed");
      }
      const j = (await res.json()) as Insights;
      setData(j);
    } catch (err) {
      setError(err instanceof Error ? err.message : "unknown");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    void load();
  }, [load]);

  const maxVolume =
    data && data.volume_by_day.length > 0
      ? Math.max(...data.volume_by_day.map((r) => r.new_threads), 1)
      : 1;

  return (
    <div className="max-w-6xl mx-auto px-6 py-8">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="font-serif text-2xl text-obsidian">Intercom</h1>
          <p className="text-xs text-charcoal/50">
            Customer support volume, topics, outcomes, and response time over the last {days} days.
          </p>
        </div>
        <div className="flex gap-2">
          {[7, 30, 90].map((d) => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-3 py-1.5 text-xs rounded-md border ${
                days === d
                  ? "border-forest text-forest bg-forest/5"
                  : "border-taupe/30 text-charcoal/60 hover:border-forest/40"
              }`}
            >
              {d}d
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="text-sm text-charcoal/50">Loading…</p>}
      {error && (
        <p className="text-sm text-ember bg-ember/10 px-3 py-2 rounded-md">{error}</p>
      )}

      {data && !loading && (
        <>
          {/* Surge alert */}
          {data.cancellation_surge.surge && (
            <div className="mb-6 bg-ember/10 border border-ember/30 rounded-lg px-4 py-3">
              <p className="text-sm text-ember font-medium">
                Cancellation surge detected
              </p>
              <p className="text-xs text-charcoal/70 mt-1">
                {data.cancellation_surge.cancel_threads_7d} cancel-intent threads in
                the last 7 days ({data.cancellation_surge.rate_7d_per_day.toFixed(1)}/day)
                vs window baseline {data.cancellation_surge.rate_window_per_day.toFixed(1)}/day.
              </p>
            </div>
          )}

          {/* Totals */}
          <section className="mb-8">
            <h2 className="text-[11px] tracking-[0.25em] uppercase text-charcoal/40 mb-3">
              Volume
            </h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              <Stat label="New threads" value={num(data.totals.threads)} />
              <Stat label="Messages" value={num(data.totals.messages)} />
              <Stat label="AI analyzed" value={num(data.totals.analyzed)} />
              <Stat label="Awaiting reply" value={num(data.totals.active_awaiting_reply)} />
              <Stat
                label="Median first reply"
                value={fmtMinutes(data.response_time.median_minutes)}
              />
              <Stat
                label="P90 first reply"
                value={fmtMinutes(data.response_time.p90_minutes)}
              />
              <Stat
                label="No-response threads"
                value={num(data.response_time.threads_no_response)}
              />
              <Stat
                label="Refunds issued"
                value={num(data.refund_intents.count_window)}
              />
            </div>
          </section>

          {/* Volume chart */}
          <section className="mb-8">
            <h2 className="text-[11px] tracking-[0.25em] uppercase text-charcoal/40 mb-3">
              New threads per day
            </h2>
            <div className="bg-white rounded-lg border border-taupe/20 p-4">
              <div className="flex items-end gap-1 h-32">
                {data.volume_by_day.map((r) => {
                  const h = Math.max(2, Math.round((r.new_threads / maxVolume) * 100));
                  return (
                    <div
                      key={r.day}
                      className="flex-1 group relative flex flex-col justify-end"
                    >
                      <div
                        className="bg-forest/70 group-hover:bg-forest rounded-t-sm transition-colors"
                        style={{ height: `${h}%` }}
                      />
                      <span className="absolute -top-6 left-1/2 -translate-x-1/2 opacity-0 group-hover:opacity-100 text-[10px] text-charcoal/70 whitespace-nowrap bg-white px-1.5 py-0.5 rounded border border-taupe/20">
                        {shortDate(r.day)}: {r.new_threads}
                      </span>
                    </div>
                  );
                })}
              </div>
              <div className="flex justify-between mt-2 text-[10px] text-charcoal/40">
                <span>{shortDate(data.volume_by_day[0]?.day ?? "")}</span>
                <span>
                  {shortDate(data.volume_by_day[data.volume_by_day.length - 1]?.day ?? "")}
                </span>
              </div>
            </div>
          </section>

          {/* Topics + Outcomes side by side */}
          <div className="grid md:grid-cols-2 gap-6 mb-8">
            <section>
              <h2 className="text-[11px] tracking-[0.25em] uppercase text-charcoal/40 mb-3">
                Top topics
              </h2>
              <div className="bg-white rounded-lg border border-taupe/20 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-cream text-charcoal/50 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-4 py-2">Topic</th>
                      <th className="text-right px-4 py-2">Count</th>
                      <th className="text-right px-4 py-2">Conf</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.top_topics.length === 0 && (
                      <tr>
                        <td colSpan={3} className="text-center text-charcoal/40 px-4 py-6">
                          No analyzed conversations in window.
                        </td>
                      </tr>
                    )}
                    {data.top_topics.map((t, i) => (
                      <tr key={i} className="border-t border-taupe/10">
                        <td className="px-4 py-2 text-obsidian">
                          {t.topic_label ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-right text-obsidian">
                          {num(t.count)}
                        </td>
                        <td className="px-4 py-2 text-right text-charcoal/50">
                          {t.avg_confidence !== null
                            ? `${(t.avg_confidence * 100).toFixed(0)}%`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>

            <section>
              <h2 className="text-[11px] tracking-[0.25em] uppercase text-charcoal/40 mb-3">
                Outcomes
              </h2>
              <div className="bg-white rounded-lg border border-taupe/20 p-4">
                {data.outcome_breakdown.length === 0 && (
                  <p className="text-xs text-charcoal/40">No outcomes in window.</p>
                )}
                {data.outcome_breakdown.map((o) => {
                  const total = data.outcome_breakdown.reduce((s, x) => s + x.count, 0);
                  const w = total > 0 ? (o.count / total) * 100 : 0;
                  return (
                    <div key={o.outcome ?? "none"} className="py-1.5">
                      <div className="flex items-center justify-between text-sm">
                        <span className="text-obsidian">{o.outcome ?? "—"}</span>
                        <span className="text-charcoal/60">
                          {num(o.count)}{" "}
                          <span className="text-xs text-charcoal/35">({w.toFixed(0)}%)</span>
                        </span>
                      </div>
                      <div className="h-1 bg-cream mt-1 rounded-full overflow-hidden">
                        <div
                          className="h-full bg-forest/60"
                          style={{ width: `${w}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </section>
          </div>

          {/* Recent refunds */}
          {data.refund_intents.recent.length > 0 && (
            <section className="mb-8">
              <h2 className="text-[11px] tracking-[0.25em] uppercase text-charcoal/40 mb-3">
                Recent refunds
              </h2>
              <div className="bg-white rounded-lg border border-taupe/20 overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-cream text-charcoal/50 text-xs uppercase tracking-wider">
                    <tr>
                      <th className="text-left px-4 py-2">When</th>
                      <th className="text-left px-4 py-2">Customer</th>
                      <th className="text-left px-4 py-2">Topic</th>
                      <th className="text-left px-4 py-2">Intent</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.refund_intents.recent.map((r) => (
                      <tr key={r.thread_id} className="border-t border-taupe/10 align-top">
                        <td className="px-4 py-2 text-charcoal/60 whitespace-nowrap">
                          {shortDate(r.created_at)}
                        </td>
                        <td className="px-4 py-2 text-obsidian whitespace-nowrap">
                          {r.customer_email ?? "—"}
                        </td>
                        <td className="px-4 py-2 text-charcoal/70">{r.topic_label ?? "—"}</td>
                        <td className="px-4 py-2 text-charcoal/70 text-xs">
                          {r.intent ?? "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Pain points */}
          <section className="mb-8">
            <h2 className="text-[11px] tracking-[0.25em] uppercase text-charcoal/40 mb-3">
              What customers are saying
            </h2>
            <div className="space-y-3">
              {data.top_pain_points.length === 0 && (
                <p className="text-xs text-charcoal/40">No analyzed intents in window.</p>
              )}
              {data.top_pain_points.map((p, i) => (
                <div
                  key={i}
                  className="bg-white rounded-lg border border-taupe/20 px-4 py-3"
                >
                  <div className="flex items-center justify-between text-xs text-charcoal/50 mb-1">
                    <span>
                      {p.topic_label ?? "—"} · {p.outcome ?? "—"}
                    </span>
                    <span>{shortDate(p.created_at)}</span>
                  </div>
                  <p className="text-sm text-obsidian">
                    {p.customer_intent_summary ?? "—"}
                  </p>
                  {p.customer_email && (
                    <p className="text-[11px] text-charcoal/40 mt-1">{p.customer_email}</p>
                  )}
                </div>
              ))}
            </div>
          </section>

          <p className="text-[10px] text-charcoal/30">
            Generated {new Date(data.generated_at).toLocaleString()} · source: mully-hub Intercom mirror
          </p>
        </>
      )}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-white rounded-lg border border-taupe/20 px-4 py-3">
      <p className="text-[10px] tracking-[0.2em] uppercase text-charcoal/40 mb-1">
        {label}
      </p>
      <p className="text-lg font-serif text-obsidian">{value}</p>
    </div>
  );
}
