"use client";

import { useEffect, useState, useCallback } from "react";
import { useMembership } from "@/app/context/MembershipContext";

interface ReviewTask {
  id: string;
  cron: string;
  email: string;
  reason: string;
  status: string;
  createdAt: string;
}

const CRON_LABELS: Record<string, string> = {
  "reservecard-to-member": "Reserve Card",
  "mulligan-to-member": "Mulligan",
};

export default function TasksPage() {
  const { user, authLoading } = useMembership();
  const [tasks, setTasks] = useState<ReviewTask[] | null>(null);
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
    const data = await res.json() as { tasks: ReviewTask[] };
    setTasks(data.tasks);
  }, [authLoading, user, getHeaders]);

  useEffect(() => { void load(); }, [load]);

  async function resolve(id: string) {
    setResolving(id);
    try {
      const headers = await getHeaders();
      await fetch("/api/admin/review-tasks", {
        method: "POST",
        headers,
        body: JSON.stringify({ id }),
      });
      setTasks((prev) => prev?.map((t) => t.id === id ? { ...t, status: "resolved" } : t) ?? null);
    } finally {
      setResolving(null);
    }
  }

  const open = tasks?.filter((t) => t.status === "open") ?? [];
  const resolved = tasks?.filter((t) => t.status === "resolved") ?? [];

  return (
    <div className="max-w-4xl mx-auto px-6 py-10 space-y-8">
      <div>
        <h1 className="font-serif text-3xl text-obsidian">Review Tasks</h1>
        <p className="text-charcoal/50 text-sm mt-1">Edge cases from cron jobs that need manual attention.</p>
      </div>

      {tasks === null ? (
        <p className="text-charcoal/40 text-sm">Loading...</p>
      ) : open.length === 0 ? (
        <div className="bg-white border border-taupe/20 rounded-xl p-8 text-center">
          <p className="text-sm text-forest font-medium">All clear — no open tasks.</p>
        </div>
      ) : (
        <div>
          <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-4">
            Open ({open.length})
          </p>
          <div className="bg-white border border-taupe/20 rounded-xl divide-y divide-taupe/10">
            {open.map((task) => (
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
                  onClick={() => void resolve(task.id)}
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

      {resolved.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-4">
            Resolved ({resolved.length})
          </p>
          <div className="bg-white border border-taupe/20 rounded-xl divide-y divide-taupe/10 opacity-50">
            {resolved.map((task) => (
              <div key={task.id} className="flex items-start gap-4 px-5 py-4">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs font-medium text-charcoal/40 uppercase tracking-wide">
                      {CRON_LABELS[task.cron] ?? task.cron}
                    </span>
                  </div>
                  <p className="text-sm text-obsidian truncate">{task.email}</p>
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
