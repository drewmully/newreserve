"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { useMembership } from "@/app/context/MembershipContext";

// ─── Types ────────────────────────────────────────────────────────────────────

interface AdminUser {
  uid: string;
  email: string | null;
  username: string | null;
  tier: string;
  created_at: number | null;
  last_login: number | null;
  onboarding_completed: boolean;
  subscription_status: string;
  mullybox_active: boolean;
  store_credit_cents: number;
  segments: string[];
  sequence_flow: string | null;
  sequence_status: string | null;
  sequence_last_step: number | null;
  sequence_next_send_at: number | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIER_COLORS: Record<string, string> = {
  black: "bg-obsidian text-bone",
  member: "bg-forest text-bone",
  access: "bg-sage/30 text-forest",
  free: "bg-taupe/20 text-charcoal/60",
};

const STATUS_COLORS: Record<string, string> = {
  active: "bg-forest/10 text-forest",
  paused: "bg-ember/10 text-ember",
  cancelled: "bg-taupe/20 text-charcoal/50",
  none: "bg-taupe/10 text-charcoal/40",
};

function formatDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminUsersPage() {
  const { user, authLoading } = useMembership();
  const router = useRouter();

  const [users, setUsers] = useState<AdminUser[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tierFilter, setTierFilter] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);

  const getHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!user) throw new Error("Not authenticated");
    const token = await user.getIdToken();
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }, [user]);

  const load = useCallback(
    async (replace = true) => {
      if (authLoading || !user) return;
      setLoading(true);
      setError(null);
      try {
        const params = new URLSearchParams({ limit: "50" });
        if (tierFilter) params.set("tier", tierFilter);
        if (statusFilter) params.set("status", statusFilter);
        if (!replace && cursor) params.set("after", cursor);

        const res = await fetch(`/api/admin/users?${params.toString()}`, {
          headers: await getHeaders(),
        });
        if (!res.ok) throw new Error("Failed to load users");
        const data = (await res.json()) as {
          users: AdminUser[];
          hasMore: boolean;
          nextCursor: string | null;
        };

        setUsers((prev) => (replace ? data.users : [...prev, ...data.users]));
        setHasMore(data.hasMore);
        setCursor(data.nextCursor);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setLoading(false);
      }
    },
    [authLoading, user, tierFilter, statusFilter, cursor, getHeaders]
  );

  useEffect(() => {
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authLoading, user, tierFilter, statusFilter]);

  return (
    <div className="max-w-6xl mx-auto px-6 py-10">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl text-obsidian">Users</h1>
          <p className="text-charcoal/50 text-sm mt-1">
            {loading ? "Loading..." : `${users.length}${hasMore ? "+" : ""} users`}
          </p>
        </div>
        <button
          onClick={() => void load(true)}
          className="text-sm text-forest hover:underline"
        >
          Refresh
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 mb-6">
        <select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="text-sm border border-taupe/40 rounded-lg px-3 py-2 bg-white text-charcoal focus:outline-none focus:ring-2 focus:ring-forest/30"
        >
          <option value="">All tiers</option>
          <option value="free">Free</option>
          <option value="access">Reserve Access</option>
          <option value="member">Reserve Member</option>
          <option value="black">Reserve Black</option>
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-sm border border-taupe/40 rounded-lg px-3 py-2 bg-white text-charcoal focus:outline-none focus:ring-2 focus:ring-forest/30"
        >
          <option value="">All statuses</option>
          <option value="active">Active subscription</option>
          <option value="paused">Paused</option>
          <option value="cancelled">Cancelled</option>
          <option value="none">No subscription</option>
        </select>
        {(tierFilter || statusFilter) && (
          <button
            onClick={() => { setTierFilter(""); setStatusFilter(""); }}
            className="text-xs text-charcoal/40 hover:text-charcoal/70 transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Error */}
      {error && (
        <div className="bg-ember/10 border border-ember/20 rounded-xl p-4 text-sm text-ember mb-6">
          {error}
        </div>
      )}

      {/* Table */}
      <div className="bg-white border border-taupe/20 rounded-xl overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-taupe/15 bg-bone/50">
              <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-charcoal/40 font-medium">User</th>
              <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Tier</th>
              <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Subscription</th>
              <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Credit</th>
              <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Sequence</th>
              <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Joined</th>
              <th className="text-left px-5 py-3 text-xs uppercase tracking-widest text-charcoal/40 font-medium">Last login</th>
            </tr>
          </thead>
          <tbody>
            {loading && users.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-charcoal/40 text-sm">
                  Loading...
                </td>
              </tr>
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-5 py-10 text-center text-charcoal/40 text-sm">
                  No users found.
                </td>
              </tr>
            ) : (
              users.map((u) => (
                <tr
                  key={u.uid}
                  onClick={() => router.push(`/admin/users/${u.uid}`)}
                  className="border-b border-taupe/10 last:border-0 hover:bg-bone/40 cursor-pointer transition-colors duration-100"
                >
                  <td className="px-5 py-3.5">
                    <p className="text-obsidian font-medium">{u.username ?? "—"}</p>
                    <p className="text-charcoal/50 text-xs">{u.email ?? "—"}</p>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${TIER_COLORS[u.tier] ?? TIER_COLORS.free}`}>
                      {capitalize(u.tier)}
                    </span>
                  </td>
                  <td className="px-5 py-3.5">
                    <span className={`inline-block px-2 py-0.5 rounded text-xs font-medium ${STATUS_COLORS[u.subscription_status] ?? STATUS_COLORS.none}`}>
                      {capitalize(u.subscription_status)}
                    </span>
                  </td>
                  <td className="px-5 py-3.5 text-charcoal/70">
                    {u.store_credit_cents > 0
                      ? `$${(u.store_credit_cents / 100).toFixed(2)}`
                      : "—"}
                  </td>
                  <td className="px-5 py-3.5">
                    {u.sequence_flow ? (
                      <div>
                        <p className="text-xs text-charcoal/70">
                          {u.sequence_flow} · step {(u.sequence_last_step ?? -1) + 1}
                        </p>
                        <p className={`text-xs mt-0.5 ${u.sequence_status === "paused" ? "text-ember/70" : u.sequence_status === "completed" ? "text-charcoal/30" : "text-charcoal/40"}`}>
                          {u.sequence_status === "active" && u.sequence_next_send_at
                            ? `next ${formatDate(u.sequence_next_send_at)}`
                            : u.sequence_status ?? "—"}
                        </p>
                      </div>
                    ) : (
                      <span className="text-xs text-charcoal/30">—</span>
                    )}
                  </td>
                  <td className="px-5 py-3.5 text-charcoal/60">{formatDate(u.created_at)}</td>
                  <td className="px-5 py-3.5 text-charcoal/60">{formatDate(u.last_login)}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Load more */}
      {hasMore && !loading && (
        <div className="mt-6 text-center">
          <button
            onClick={() => void load(false)}
            className="px-5 py-2.5 rounded-lg border border-taupe/40 text-sm text-charcoal hover:bg-taupe/10 transition-colors"
          >
            Load more
          </button>
        </div>
      )}
    </div>
  );
}
