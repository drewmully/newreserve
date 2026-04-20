"use client";

import { useEffect, useState } from "react";
import { getTierLabel } from "@/lib/membershipConfig";

// ─── Types ────────────────────────────────────────────────────────────────────

interface UserProfile {
  uid: string;
  email: string | null;
  username: string | null;
  tier: string;
  isLegacy: boolean;
  legacyPlan: string | null;
  created_at: number | null;
  subscription_status: string;
  store_credit_cents: number;
  emailTags: string[];
  segments: string[];
  onboarding_profile: Record<string, unknown>;
  fit_profile: Record<string, string> | null;
  manage_url: string | null;
}

interface SequenceState {
  flow: string | null;
  status: string | null;
  lastSentStep: number | null;
  nextSendAt: number | null;
  tags: string[];
}

interface UserDetail {
  user: UserProfile;
  sequence: SequenceState | null;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIER_COLORS: Record<string, string> = {
  black: "bg-obsidian text-bone",
  member: "bg-forest text-bone",
  access: "bg-sage/30 text-forest",
  free: "bg-taupe/20 text-charcoal/60",
  legacy: "bg-taupe/40 text-charcoal/70 ring-1 ring-taupe",
};

function formatDate(ms: number | null): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-xs text-charcoal/40">{label}</span>
      <span className="text-xs text-charcoal font-medium text-right">{value}</span>
    </div>
  );
}

// ─── Component ────────────────────────────────────────────────────────────────

export function MemberCard({
  uid,
  getApiHeaders,
}: {
  uid: string;
  getApiHeaders: () => Promise<HeadersInit>;
}) {
  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const headers = await getApiHeaders();
        const res = await fetch(`/api/admin/users/${uid}`, { headers });
        if (res.ok && !cancelled) {
          const json = await res.json() as UserDetail;
          setData(json);
        }
      } catch {
        // non-critical
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [uid, getApiHeaders]);

  if (loading) {
    return (
      <div className="bg-white border border-taupe/20 rounded-xl p-4">
        <p className="text-xs text-charcoal/40">Loading member…</p>
      </div>
    );
  }

  if (!data) return null;

  const { user, sequence } = data;
  const tierLabel = getTierLabel(
    user.tier as "free" | "access" | "member" | "black",
    user.isLegacy,
    user.legacyPlan
  );
  const tierColorKey = user.isLegacy ? "legacy" : user.tier;

  return (
    <div className="bg-white border border-taupe/20 rounded-xl p-4 space-y-4 text-sm">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-obsidian truncate">
            {user.username ?? user.email ?? uid}
          </p>
          {user.username && (
            <p className="text-xs text-charcoal/50 truncate">{user.email}</p>
          )}
        </div>
        <span className={`shrink-0 text-xs px-2 py-0.5 rounded font-medium ${TIER_COLORS[tierColorKey] ?? TIER_COLORS.free}`}>
          {tierLabel}
        </span>
      </div>

      {/* Profile rows */}
      <div className="divide-y divide-taupe/10">
        <Row label="Joined" value={formatDate(user.created_at)} />
        <Row label="Subscription" value={user.subscription_status ?? "—"} />
        {user.store_credit_cents > 0 && (
          <Row label="Store credit" value={`$${(user.store_credit_cents / 100).toFixed(2)}`} />
        )}
        {user.onboarding_profile?.handicap != null && (
          <Row label="Handicap" value={String(user.onboarding_profile.handicap)} />
        )}
        {user.onboarding_profile?.vibe_check != null && (
          <Row label="Vibe" value={String(user.onboarding_profile.vibe_check)} />
        )}
        {user.fit_profile?.shirtSize && (
          <Row label="Shirt" value={user.fit_profile.shirtSize} />
        )}
      </div>

      {/* Sequence */}
      {sequence && (
        <div>
          <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1.5">Sequence</p>
          <div className="divide-y divide-taupe/10">
            <Row label="Flow" value={sequence.flow ?? "—"} />
            <Row label="Status" value={sequence.status ?? "—"} />
            {sequence.lastSentStep !== null && (
              <Row label="Last step" value={`Step ${sequence.lastSentStep + 1}`} />
            )}
          </div>
        </div>
      )}

      {/* Email tags */}
      {user.emailTags.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1.5">Tags</p>
          <div className="flex flex-wrap gap-1">
            {user.emailTags.map((t) => (
              <span key={t} className="text-xs px-2 py-0.5 bg-forest/10 text-forest rounded">
                {t}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Segments */}
      {user.segments.length > 0 && (
        <div>
          <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-1.5">Segments</p>
          <div className="flex flex-wrap gap-1">
            {user.segments.map((s) => (
              <span key={s} className="text-xs px-2 py-0.5 bg-bone rounded text-charcoal/60">
                {s}
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Manage link */}
      {user.manage_url && (
        <a
          href={user.manage_url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-xs text-forest hover:underline block"
        >
          Manage subscription →
        </a>
      )}
    </div>
  );
}
