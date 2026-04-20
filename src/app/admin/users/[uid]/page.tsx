"use client";

import { useEffect, useState, useCallback } from "react";
import { useParams, useRouter } from "next/navigation";
import { useMembership } from "@/app/context/MembershipContext";
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
  last_login: number | null;
  onboarding_completed: boolean;
  onboarding_profile: Record<string, unknown>;
  fit_profile: Record<string, string> | null;
  emailTags: string[];
  subscription_status: string;
  mullybox_active: boolean;
  manage_url: string | null;
  active_subscription_ids: string[];
  store_credit_cents: number;
  segments: string[];
  messaging_preferences: Record<string, boolean>;
  shopify_customer_id: string | null;
}

interface SequenceState {
  flow: string | null;
  status: string | null;
  nextStep: number | null;
  lastSentStep: number | null;
  startedAt: number | null;
  nextSendAt: number | null;
  tags: string[];
  pausedReason: string | null;
  skippedSteps: number[];
}

interface EmailEvent {
  id: string;
  event_type: string | null;
  email_id: string | null;
  subject: string | null;
  link_url: string | null;
  created_at: number | null;
}

interface AnalyticsEvent {
  id: string;
  event_name: string | null;
  page_url: string | null;
  properties: Record<string, unknown>;
  stored_at: number | null;
}

interface EmailReply {
  id: string;
  subject: string | null;
  replyText: string | null;
  status: string | null;
  toolCalls: Array<{ name: string; input: Record<string, unknown> }>;
  flow: string | null;
  lastSentStep: number | null;
  createdAt: number | null;
}

interface UserDetail {
  user: UserProfile;
  sequence: SequenceState | null;
  emailEvents: EmailEvent[];
  analyticsEvents: AnalyticsEvent[];
  replies: EmailReply[];
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const TIER_COLORS: Record<string, string> = {
  black: "bg-obsidian text-bone",
  member: "bg-forest text-bone",
  access: "bg-sage/30 text-forest",
  free: "bg-taupe/20 text-charcoal/60",
  legacy: "bg-taupe/40 text-charcoal/70 ring-1 ring-taupe",
};

const EMAIL_EVENT_COLORS: Record<string, string> = {
  opened: "text-forest bg-forest/10",
  clicked: "text-forest bg-forest/15",
  sent: "text-charcoal/50 bg-taupe/15",
  bounced: "text-ember bg-ember/10",
  complained: "text-ember bg-ember/15",
  delivery_delayed: "text-ember/70 bg-ember/5",
};

const ANALYTICS_EVENT_ICONS: Record<string, string> = {
  purchase: "💳",
  add_to_cart: "🛒",
  checkout_clicked: "→",
  login: "🔑",
  wallet_viewed: "👜",
  page_view: "·",
  subscription_state: "🔄",
  registry_applied: "📋",
};

function formatDate(ms: number | null, withTime = true): string {
  if (!ms) return "—";
  return new Date(ms).toLocaleString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    ...(withTime ? { hour: "numeric", minute: "2-digit" } : {}),
  });
}

function capitalize(s: string | null | undefined): string {
  if (!s) return "—";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ─── Timeline item ─────────────────────────────────────────────────────────────

function TimelineItem({
  time,
  label,
  badge,
  badgeClass,
  detail,
}: {
  time: number | null;
  label: string;
  badge?: string;
  badgeClass?: string;
  detail?: string;
}) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-taupe/10 last:border-0">
      <div className="w-32 shrink-0 text-xs text-charcoal/40 pt-0.5">{formatDate(time)}</div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-charcoal">{label}</span>
          {badge && (
            <span className={`text-xs px-2 py-0.5 rounded font-medium ${badgeClass ?? "bg-taupe/20 text-charcoal/50"}`}>
              {badge}
            </span>
          )}
        </div>
        {detail && <p className="text-xs text-charcoal/40 mt-0.5 truncate">{detail}</p>}
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AdminUserDetailPage() {
  const { user: adminUser, authLoading } = useMembership();
  const params = useParams();
  const router = useRouter();
  const uid = params.uid as string;

  const [data, setData] = useState<UserDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const getHeaders = useCallback(async (): Promise<HeadersInit> => {
    if (!adminUser) throw new Error("Not authenticated");
    const token = await adminUser.getIdToken();
    return { "Content-Type": "application/json", Authorization: `Bearer ${token}` };
  }, [adminUser]);

  const load = useCallback(async () => {
    if (authLoading || !adminUser) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${uid}`, {
        headers: await getHeaders(),
      });
      const json = await res.json() as UserDetail & { error?: string };
      if (!res.ok) throw new Error(json.error ?? "Failed to load user");
      setData(json);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [authLoading, adminUser, uid, getHeaders]);

  useEffect(() => { void load(); }, [load]);

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10">
        <p className="text-charcoal/40 text-sm">Loading...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="max-w-4xl mx-auto px-6 py-10">
        <div className="bg-ember/10 border border-ember/20 rounded-xl p-4 text-sm text-ember">
          {error ?? "User not found"}
        </div>
      </div>
    );
  }

  const { user, sequence, emailEvents, analyticsEvents, replies } = data;

  // Build unified timeline
  type TimelineEntry = {
    ts: number;
    type: "email_event" | "analytics" | "reply";
    data: EmailEvent | AnalyticsEvent | EmailReply;
  };

  const timeline: TimelineEntry[] = [
    ...emailEvents.map((e) => ({ ts: e.created_at ?? 0, type: "email_event" as const, data: e })),
    ...analyticsEvents.map((e) => ({ ts: e.stored_at ?? 0, type: "analytics" as const, data: e })),
    ...replies.map((e) => ({ ts: e.createdAt ?? 0, type: "reply" as const, data: e })),
  ].sort((a, b) => b.ts - a.ts);

  return (
    <div className="max-w-4xl mx-auto px-6 py-10">
      {/* Back */}
      <button
        onClick={() => router.back()}
        className="text-sm text-charcoal/50 hover:text-charcoal mb-6 flex items-center gap-1"
      >
        ← Users
      </button>

      {/* Header */}
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="font-serif text-3xl text-obsidian">{user.username ?? user.email ?? uid}</h1>
          {user.username && <p className="text-charcoal/50 text-sm mt-0.5">{user.email}</p>}
        </div>
        <span className={`px-3 py-1 rounded text-sm font-medium ${user.isLegacy ? TIER_COLORS.legacy : (TIER_COLORS[user.tier] ?? TIER_COLORS.free)}`}>
          {getTierLabel(user.tier as "free" | "access" | "member" | "black", user.isLegacy, user.legacyPlan)}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {/* Left column: profile + sequence */}
        <div className="space-y-5">
          {/* Profile card */}
          <div className="bg-white border border-taupe/20 rounded-xl p-5 space-y-3">
            <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-3">Profile</p>
            <Row label="Joined" value={formatDate(user.created_at, false)} />
            <Row label="Last login" value={formatDate(user.last_login, false)} />
            <Row label="Onboarding" value={user.onboarding_completed ? "Complete" : "Incomplete"} />
            <Row label="Subscription" value={capitalize(user.subscription_status)} />
            {user.isLegacy && (
              <Row label="Plan" value="Back 9 (Legacy)" />
            )}
            <Row
              label="Store credit"
              value={user.store_credit_cents > 0 ? `$${(user.store_credit_cents / 100).toFixed(2)}` : "—"}
            />
            {user.onboarding_profile.handicap != null && (
              <Row label="Handicap" value={String(user.onboarding_profile.handicap)} />
            )}
            {user.onboarding_profile.vibe_check != null && (
              <Row label="Vibe" value={String(user.onboarding_profile.vibe_check)} />
            )}
            {user.fit_profile?.shirtSize && (
              <Row label="Shirt size" value={user.fit_profile.shirtSize} />
            )}
            {user.manage_url && (
              <a
                href={user.manage_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-forest hover:underline block pt-1"
              >
                Manage subscription →
              </a>
            )}
          </div>
          {user.emailTags.length > 0 && (
            <div className="bg-white border border-taupe/20 rounded-xl p-5">
              <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-3">Email tags</p>
              <div className="flex flex-wrap gap-1.5">
                {user.emailTags.map((t) => (
                  <span key={t} className="text-xs px-2 py-0.5 bg-forest/10 text-forest rounded">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Segments */}
          {(user.segments as string[]).length > 0 && (
            <div className="bg-white border border-taupe/20 rounded-xl p-5">
              <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-3">Segments</p>
              <div className="flex flex-wrap gap-1.5">
                {(user.segments as string[]).map((s) => (
                  <span key={s} className="text-xs px-2 py-0.5 bg-bone rounded text-charcoal/60">
                    {s}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Email sequence */}
          {sequence && (
            <div className="bg-white border border-taupe/20 rounded-xl p-5 space-y-3">
              <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-3">Email sequence</p>
              <Row label="Flow" value={capitalize(sequence.flow)} />
              <Row label="Status" value={capitalize(sequence.status)} />
              <Row label="Last step" value={sequence.lastSentStep !== null ? `Step ${sequence.lastSentStep + 1}` : "—"} />
              <Row label="Next send" value={formatDate(sequence.nextSendAt)} />
              {sequence.pausedReason && (
                <Row label="Paused" value={capitalize(sequence.pausedReason)} />
              )}
              {sequence.tags.length > 0 && (
                <div className="pt-1">
                  <p className="text-xs text-charcoal/40 mb-1.5">Tags</p>
                  <div className="flex flex-wrap gap-1.5">
                    {sequence.tags.map((t) => (
                      <span key={t} className="text-xs px-2 py-0.5 bg-forest/10 text-forest rounded">
                        {t}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Right column: timeline */}
        <div className="lg:col-span-2">
          <div className="bg-white border border-taupe/20 rounded-xl p-5">
            <p className="text-xs uppercase tracking-widest text-charcoal/40 mb-4">Activity timeline</p>

            {timeline.length === 0 ? (
              <p className="text-sm text-charcoal/40 py-6 text-center">No activity recorded yet.</p>
            ) : (
              <div>
                {timeline.map((entry) => {
                  if (entry.type === "email_event") {
                    const e = entry.data as EmailEvent;
                    return (
                      <TimelineItem
                        key={`email-${e.id}`}
                        time={e.created_at}
                        label={`Email ${e.event_type ?? "event"}`}
                        badge={capitalize(e.event_type)}
                        badgeClass={EMAIL_EVENT_COLORS[e.event_type ?? ""] ?? "bg-taupe/15 text-charcoal/50"}
                        detail={e.subject ?? e.link_url ?? undefined}
                      />
                    );
                  }
                  if (entry.type === "analytics") {
                    const e = entry.data as AnalyticsEvent;
                    const icon = ANALYTICS_EVENT_ICONS[e.event_name ?? ""] ?? "·";
                    return (
                      <TimelineItem
                        key={`analytics-${e.id}`}
                        time={entry.ts}
                        label={`${icon} ${e.event_name ?? "event"}`}
                        detail={e.page_url ?? undefined}
                      />
                    );
                  }
                  if (entry.type === "reply") {
                    const e = entry.data as EmailReply;
                    return (
                      <TimelineItem
                        key={`reply-${e.id}`}
                        time={e.createdAt}
                        label="Replied to email"
                        badge={e.status ?? undefined}
                        badgeClass="bg-taupe/20 text-charcoal/50"
                        detail={e.replyText?.slice(0, 80) ?? e.subject ?? undefined}
                      />
                    );
                  }
                  return null;
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-charcoal/40">{label}</span>
      <span className="text-xs text-charcoal font-medium text-right">{value}</span>
    </div>
  );
}
