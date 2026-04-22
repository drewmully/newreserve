"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMembership } from "@/app/context/MembershipContext";
import { auth } from "@/lib/firebase";

// ─── Types ────────────────────────────────────────────────────────────────────

type AppStatus = "pending" | "approved" | "rejected";

interface Application {
  uid: string;
  status: AppStatus;
  metadata: Record<string, unknown>;
  created_at: number | null;
  reviewed_at: number | null;
  user_email: string | null;
  user_name: string | null;
  tier: string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_STYLES: Record<AppStatus, string> = {
  pending: "bg-amber-50 text-amber-700 border border-amber-200",
  approved: "bg-forest/10 text-forest border border-forest/20",
  rejected: "bg-ember/10 text-ember border border-ember/20",
};

const TIER_STYLES: Record<string, string> = {
  black: "bg-obsidian text-bone",
  member: "bg-forest text-bone",
  access: "bg-sage/30 text-forest",
  free: "bg-taupe/20 text-charcoal/60",
};

function formatDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

async function getToken(): Promise<string> {
  const currentUser = auth.currentUser;
  if (!currentUser) throw new Error("Not signed in");
  return currentUser.getIdToken();
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function RegistryAdminPage() {
  const { user, authLoading } = useMembership();
  const router = useRouter();

  const [filter, setFilter] = useState<AppStatus | "all">("pending");
  const [applications, setApplications] = useState<Application[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!authLoading && !user) router.replace("/login");
  }, [authLoading, user, router]);

  const fetchApplications = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const token = await getToken();
      const res = await fetch(`/api/admin/registry/applications?status=${filter}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error(await res.text());
      const data = (await res.json()) as { applications: Application[] };
      setApplications(data.applications);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [filter]);

  useEffect(() => {
    if (user) fetchApplications();
  }, [user, fetchApplications]);

  async function handleAction(uid: string, action: "approve" | "reject") {
    setActionLoading(uid + action);
    try {
      const token = await getToken();
      const res = await fetch("/api/admin/registry/applications", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ uid, action }),
      });
      if (!res.ok) throw new Error(await res.text());
      await fetchApplications();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Action failed");
    } finally {
      setActionLoading(null);
    }
  }

  if (authLoading || !user) {
    return (
      <div className="min-h-screen bg-cream flex items-center justify-center">
        <p className="text-charcoal/40 text-sm">Loading...</p>
      </div>
    );
  }

  const pendingCount = applications.filter((a) => a.status === "pending").length;

  return (
    <div className="max-w-5xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="mb-8">
        <h1 className="font-serif text-2xl text-obsidian mb-1">Club Registry</h1>
        <p className="text-sm text-charcoal/50">Review member club applications</p>
      </div>

      {/* Filter tabs */}
      <div className="flex items-center gap-2 mb-6">
        {(["pending", "approved", "rejected", "all"] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-4 h-8 rounded-full text-xs font-medium transition-colors cursor-pointer ${
              filter === f
                ? "bg-forest text-bone"
                : "bg-white border border-taupe/25 text-charcoal/60 hover:text-charcoal"
            }`}
          >
            {f.charAt(0).toUpperCase() + f.slice(1)}
            {f === "pending" && pendingCount > 0 && filter !== "pending" && (
              <span className="ml-1.5 bg-amber-400 text-white text-[10px] font-bold rounded-full px-1.5 py-0.5">
                {pendingCount}
              </span>
            )}
          </button>
        ))}
        <button
          onClick={fetchApplications}
          className="ml-auto px-3 h-8 rounded-full bg-white border border-taupe/25 text-xs text-charcoal/60 hover:text-charcoal transition-colors cursor-pointer"
        >
          Refresh
        </button>
      </div>

      {/* Error */}
      {error && (
        <div className="mb-4 px-4 py-3 rounded-xl bg-ember/10 border border-ember/20 text-sm text-ember">
          {error}
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-charcoal/40">Loading applications...</p>
        </div>
      ) : applications.length === 0 ? (
        <div className="flex items-center justify-center py-20">
          <p className="text-sm text-charcoal/40">No {filter === "all" ? "" : filter} applications.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {applications.map((app) => {
            const meta = app.metadata;
            const isActing = actionLoading?.startsWith(app.uid);

            return (
              <div
                key={app.uid}
                className="bg-white rounded-2xl border border-taupe/15 p-5 shadow-sm"
              >
                <div className="flex items-start gap-4">
                  {/* Club info */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1 flex-wrap">
                      <span className="font-medium text-obsidian text-sm">
                        {String(meta.club_name ?? "Unknown club")}
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${STATUS_STYLES[app.status]}`}>
                        {app.status}
                      </span>
                      <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full uppercase tracking-wider ${TIER_STYLES[app.tier] ?? TIER_STYLES.free}`}>
                        {app.tier}
                      </span>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-x-6 gap-y-1 mt-3 text-xs text-charcoal/60">
                      <div>
                        <span className="text-charcoal/35 uppercase tracking-wider text-[10px]">Member</span>
                        <p className="text-charcoal/80 font-medium truncate">{app.user_name ?? "—"}</p>
                      </div>
                      <div>
                        <span className="text-charcoal/35 uppercase tracking-wider text-[10px]">Email</span>
                        <p className="text-charcoal/80 truncate">{app.user_email ?? "—"}</p>
                      </div>
                      <div>
                        <span className="text-charcoal/35 uppercase tracking-wider text-[10px]">Location</span>
                        <p className="text-charcoal/80">
                          {[meta.city, meta.state].filter(Boolean).join(", ") || "—"}
                        </p>
                      </div>
                      <div>
                        <span className="text-charcoal/35 uppercase tracking-wider text-[10px]">Holes</span>
                        <p className="text-charcoal/80">{String(meta.holes ?? "—")}</p>
                      </div>
                      <div>
                        <span className="text-charcoal/35 uppercase tracking-wider text-[10px]">Guest policy</span>
                        <p className="text-charcoal/80">{String(meta.guest_policy ?? "—")}</p>
                      </div>
                      <div>
                        <span className="text-charcoal/35 uppercase tracking-wider text-[10px]">Submitted</span>
                        <p className="text-charcoal/80">{formatDate(app.created_at)}</p>
                      </div>
                      {app.reviewed_at && (
                        <div>
                          <span className="text-charcoal/35 uppercase tracking-wider text-[10px]">Reviewed</span>
                          <p className="text-charcoal/80">{formatDate(app.reviewed_at)}</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  {app.status === "pending" && (
                    <div className="flex flex-col gap-2 shrink-0">
                      <button
                        onClick={() => handleAction(app.uid, "approve")}
                        disabled={!!isActing}
                        className="h-8 px-4 rounded-lg bg-forest text-bone text-xs font-medium hover:bg-forest/90 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {actionLoading === app.uid + "approve" ? "..." : "Approve"}
                      </button>
                      <button
                        onClick={() => handleAction(app.uid, "reject")}
                        disabled={!!isActing}
                        className="h-8 px-4 rounded-lg border border-ember/30 text-ember text-xs font-medium hover:bg-ember/5 transition-colors cursor-pointer disabled:opacity-50"
                      >
                        {actionLoading === app.uid + "reject" ? "..." : "Reject"}
                      </button>
                    </div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
