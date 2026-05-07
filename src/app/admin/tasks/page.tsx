"use client";

import { useEffect, useState, useCallback } from "react";
import Link from "next/link";
import { useMembership } from "@/app/context/MembershipContext";

interface ReviewTask {
  id: string;
  cron: string;
  email: string;
  reason: string;
  status: string;
  createdAt: string;
}

interface EmailReviewTask {
  id: string;
  uid: string;
  replyId: string;
  email: string;
  reason: string;
  note: string;
  status: string;
  createdAt: string;
}

const CRON_LABELS: Record<string, string> = {
  "reservecard-to-member": "Reserve Card",
  "mulligan-to-member": "Mulligan",
};

const EMAIL_REASON_LABELS: Record<string, { label: string; color: string }> = {
  "upgrade-opportunity": { label: "Upgrade opportunity", color: "text-forest bg-forest/8 border-forest/20" },
  "churn-risk":          { label: "Churn risk",          color: "text-ember bg-ember/8 border-ember/20" },
  "complaint":           { label: "Complaint",           color: "text-ember bg-ember/8 border-ember/20" },
  "concierge-request":   { label: "Concierge request",   color: "text-sage bg-sage/8 border-sage/20" },
  "other":               { label: "Review needed",       color: "text-charcoal/60 bg-taupe/10 border-taupe/20" },
};

export default function TasksPage() {
  const { user, authLoading } = useMembership();
  const [tasks, setTasks] = useState<ReviewTask[] | null>(null);
  const [emailTasks, setEmailTasks] = useState<EmailReviewTask[] | null>(null);
  const [resolving, setResolving] = useState<string | null>(null);

  const getHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!user) throw new Error("Not authenticated");
    const token = await user.getIdToken();
    return { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };
  }, [user]);

  const load = useCallback(async () => {
    if (authLoading || !user) return;
    const headers = await getHeaders();
    const res = await fetch("/api/admin/review-tasks", { headers });
    const data = await res.json() as { tasks: ReviewTask[]; emailTasks: EmailReviewTask[] };
    setTasks(data.tasks ?? []);
    setEmailTasks(data.emailTasks ?? []);
  }, [authLoading, user, getHeaders]);

  useEffect(() => { void load(); }, [load]);

  async function resolve(id: string, isEmailTask: boolean) {
    setResolving(id);
    try {
      const headers = await getHeaders();
      await fetch("/api/admin/review-tasks", {
        method: "POST",
        headers,
        body: JSON.stringify({ id }),
      });
      if (isEmailTask) {
        setEmailTasks((prev) => prev?.map((t) => t.id === id ? { ...t, status: "resolved" } : t) ?? null);
      } else {
        setTasks((prev) => prev?.map((t) => t.id === id ? { ...t, status: "resolved" } : t) ?? null);
      }
    } finally {
      setResolving(null);
    }
  }

  const openCron = tasks?.filter((t) => t.status === "open") ?? [];
  const resolvedCron = tasks?.filter((t) => t.status === "resolved") ?? [];
  const openEmail = emailTasks?.filter((t) => t.status === "open") ?? [];
  const resolvedEmail = emailTasks?.filter((t) => t.status === "resolved") ?? [];

  const isLoading = tasks === null || emailTasks === null;
  const totalOpen = openCron.length + openEmail.length;

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-10">
      <div>
        <h1 className="font-serif text-3xl text-obsidian">Review Tasks</h1>
        <p className="text-charcoal/50 text-sm mt-1">Manual actions flagged by cron jobs and the AI reply system.</p>
      </div>

      {isLoading ? (
        <p className="text-charcoal/40 text-sm">Loading...</p>
      ) : totalOpen === 0 ? (
        <div className="bg-white border border-taupe/20 rounded-xl p-8 text-center">
          <p className="text-sm text-forest font-medium">All clear — no open tasks.</p>
        </div>
      ) : (
        <>
          {/* ── Email reply tasks ── */}
          {openEmail.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-4">
                Email replies — open ({openEmail.length})
              </p>
              <div className="bg-white border border-taupe/20 rounded-xl divide-y divide-taupe/10">
                {openEmail.map((task) => {
                  const meta = EMAIL_REASON_LABELS[task.reason] ?? EMAIL_REASON_LABELS["other"];
                  return (
                    <div key={task.id} className="flex items-start justify-between gap-4 px-5 py-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2 mb-1.5 flex-wrap">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${meta.color}`}>
                            {meta.label}
                          </span>
                          <span className="text-charcoal/20">·</span>
                          <span className="text-xs text-charcoal/40">
                            {new Date(task.createdAt).toLocaleString("en-US", {
                              month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="text-sm font-medium text-obsidian">{task.email}</p>
                        {task.note && (
                          <p className="text-xs text-charcoal/50 mt-1 leading-relaxed">{task.note}</p>
                        )}
                        <Link
                          href="/admin/email-replies"
                          className="inline-block text-xs text-forest hover:underline mt-1.5"
                        >
                          View reply thread →
                        </Link>
                      </div>
                      <button
                        onClick={() => void resolve(task.id, true)}
                        disabled={resolving === task.id}
                        className="shrink-0 text-xs font-medium text-forest border border-forest/30 rounded-lg px-3 py-1.5 hover:bg-forest/5 disabled:opacity-50 transition-colors"
                      >
                        {resolving === task.id ? "Resolving..." : "Resolve"}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* ── Cron tasks ── */}
          {openCron.length > 0 && (
            <div>
              <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-4">
                Cron jobs — open ({openCron.length})
              </p>
              <div className="bg-white border border-taupe/20 rounded-xl divide-y divide-taupe/10">
                {openCron.map((task) => (
                  <div key={task.id} className="flex items-start justify-between gap-4 px-5 py-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xs font-medium text-charcoal/40 uppercase tracking-wide">
                          {CRON_LABELS[task.cron] ?? task.cron}
                        </span>
                        <span className="text-charcoal/20">·</span>
                        <span className="text-xs text-charcoal/40">
                          {new Date(task.createdAt).toLocaleString("en-US", {
                            month: "short", day: "numeric", hour: "numeric", minute: "2-digit",
                          })}
                        </span>
                      </div>
                      <p className="text-sm font-medium text-obsidian truncate">{task.email}</p>
                      <p className="text-xs text-charcoal/50 mt-0.5">{task.reason}</p>
                    </div>
                    <button
                      onClick={() => void resolve(task.id, false)}
                      disabled={resolving === task.id}
                      className="shrink-0 text-xs font-medium text-forest border border-forest/30 rounded-lg px-3 py-1.5 hover:bg-forest/5 disabled:opacity-50 transition-colors"
                    >
                      {resolving === task.id ? "Resolving..." : "Resolve"}
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}

      {/* ── Resolved ── */}
      {(resolvedCron.length > 0 || resolvedEmail.length > 0) && (
        <div>
          <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-4">
            Resolved ({resolvedCron.length + resolvedEmail.length})
          </p>
          <div className="bg-white border border-taupe/20 rounded-xl divide-y divide-taupe/10 opacity-50">
            {resolvedEmail.map((task) => {
              const meta = EMAIL_REASON_LABELS[task.reason] ?? EMAIL_REASON_LABELS["other"];
              return (
                <div key={task.id} className="flex items-start gap-4 px-5 py-4">
                  <div className="min-w-0">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full border ${meta.color}`}>
                      {meta.label}
                    </span>
                    <p className="text-sm text-obsidian mt-1">{task.email}</p>
                    {task.note && <p className="text-xs text-charcoal/50 mt-0.5">{task.note}</p>}
                  </div>
                </div>
              );
            })}
            {resolvedCron.map((task) => (
              <div key={task.id} className="flex items-start gap-4 px-5 py-4">
                <div className="min-w-0">
                  <span className="text-xs font-medium text-charcoal/40 uppercase tracking-wide">
                    {CRON_LABELS[task.cron] ?? task.cron}
                  </span>
                  <p className="text-sm text-obsidian mt-0.5">{task.email}</p>
                  <p className="text-xs text-charcoal/50 mt-0.5">{task.reason}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
