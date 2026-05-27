"use client";

/**
 * Sponsorships tab UI.
 *
 * Rendered inside /dashboard?tab=benefits&sub=sponsorships. Pulls live
 * state from /api/account/sponsorship and renders:
 *   1. Your sponsorship link with copy/share affordances
 *   2. A row of four badges, each with its own visual treatment, progress
 *      ring, and earned/locked state
 *   3. A scrolling history of attributed sponsorships
 *
 * Design uses the existing forest/bone/sage/taupe palette. No em dashes
 * are used anywhere in copy, by Drew's rule.
 */
import { useCallback, useEffect, useMemo, useState } from "react";
import { useMembership } from "../context/MembershipContext";
import { trackEvent } from "@/lib/tracking";

interface BadgeState {
  key: "first_dozen" | "foursome" | "path_to_black" | "the_18";
  title: string;
  shortTitle: string;
  tagline: string;
  description: string;
  window: string;
  reward: string;
  threshold: number;
  current: number;
  progress: number;
  earned: boolean;
  earnedCount: number;
}

interface HistoryRow {
  id: number;
  sponsoredEmail: string;
  attributedAt: string;
  orderTotal: number;
  tier: string | null;
}

interface SponsorshipResponse {
  code: string;
  link: string;
  progress: {
    total: number;
    yearCount: number;
    last30: number;
    firstSponsorshipAt: string | null;
    lastSponsorshipAt: string | null;
  };
  badges: BadgeState[];
  history: HistoryRow[];
}

/* ─── Visual treatments per badge ─────────────────────────────────────────── */

const BADGE_VISUAL: Record<
  BadgeState["key"],
  {
    ring: string;
    bg: string;
    accent: string;
    icon: React.ReactNode;
  }
> = {
  first_dozen: {
    ring: "border-sage/40",
    bg: "bg-cream",
    accent: "text-sage",
    icon: (
      // Stylized stack of golf balls
      <svg viewBox="0 0 48 48" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <circle cx="16" cy="32" r="6" />
        <circle cx="24" cy="24" r="6" />
        <circle cx="32" cy="32" r="6" />
        <circle cx="16" cy="32" r="1" fill="currentColor" />
        <circle cx="24" cy="24" r="1" fill="currentColor" />
        <circle cx="32" cy="32" r="1" fill="currentColor" />
      </svg>
    ),
  },
  foursome: {
    ring: "border-forest/40",
    bg: "bg-cream",
    accent: "text-forest",
    icon: (
      // Four small flags arranged in a square
      <svg viewBox="0 0 48 48" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M14 12v12M14 12l6 3-6 3" />
        <path d="M34 12v12M34 12l6 3-6 3" />
        <path d="M14 28v12M14 28l6 3-6 3" />
        <path d="M34 28v12M34 28l6 3-6 3" />
      </svg>
    ),
  },
  path_to_black: {
    ring: "border-obsidian/50",
    bg: "bg-obsidian",
    accent: "text-bone",
    icon: (
      <svg viewBox="0 0 48 48" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M24 6l4.5 9 10 1.5-7.25 7 1.75 10L24 28.5 15 33.5l1.75-10L9.5 16.5 19.5 15z" />
      </svg>
    ),
  },
  the_18: {
    ring: "border-sage/50",
    bg: "bg-forest",
    accent: "text-bone",
    icon: (
      // Flag in a hole
      <svg viewBox="0 0 48 48" className="w-7 h-7" fill="none" stroke="currentColor" strokeWidth={1.5}>
        <path d="M16 8v32" />
        <path d="M16 8h14l-4 5 4 5H16" />
        <ellipse cx="24" cy="40" rx="10" ry="2" />
      </svg>
    ),
  },
};

/* ─── Tab component ───────────────────────────────────────────────────────── */

export function SponsorshipsTab() {
  const { user, isSignedIn } = useMembership();
  const [data, setData] = useState<SponsorshipResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setLoading(true);
    setError(null);
    try {
      const token = await user.getIdToken();
      const res = await fetch("/api/account/sponsorship", {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) {
        const payload = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(payload.error ?? `HTTP ${res.status}`);
      }
      const json = (await res.json()) as SponsorshipResponse;
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not load sponsorships.");
    } finally {
      setLoading(false);
    }
  }, [user]);

  useEffect(() => {
    if (isSignedIn) void load();
  }, [isSignedIn, load]);

  const handleCopy = async () => {
    if (!data) return;
    try {
      await navigator.clipboard.writeText(data.link);
      setCopied(true);
      trackEvent("sponsorship_link_copied", { code: data.code });
      setTimeout(() => setCopied(false), 2200);
    } catch {
      /* clipboard blocked */
    }
  };

  const handleShare = (channel: "sms" | "email" | "x") => {
    if (!data) return;
    trackEvent("sponsorship_link_shared", { code: data.code, channel });
    const msg = `Join me at Mully Reserve. Your first quarterly box ships with a dozen Pro V1s on the house: ${data.link}`;
    if (channel === "sms") {
      window.location.href = `sms:?&body=${encodeURIComponent(msg)}`;
    } else if (channel === "email") {
      window.location.href = `mailto:?subject=${encodeURIComponent(
        "Mully Reserve",
      )}&body=${encodeURIComponent(msg)}`;
    } else if (channel === "x") {
      window.open(
        `https://x.com/intent/tweet?text=${encodeURIComponent(msg)}`,
        "_blank",
        "noopener",
      );
    }
  };

  const totalLine = useMemo(() => {
    if (!data) return null;
    const t = data.progress.total;
    if (t === 0) return "No sponsorships yet. Your first one earns The First Dozen.";
    return `${t} paid sponsorship${t === 1 ? "" : "s"} to date.`;
  }, [data]);

  if (!isSignedIn) {
    return (
      <div className="px-6 md:px-12">
        <div className="max-w-5xl mx-auto text-center text-charcoal/60 py-16">
          Sign in to see your sponsorship board.
        </div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="px-6 md:px-12">
        <div className="max-w-5xl mx-auto py-12 text-sm text-charcoal/50">
          Loading your sponsorship board.
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="px-6 md:px-12">
        <div className="max-w-5xl mx-auto py-12">
          <p className="text-sm text-ember mb-3">{error ?? "Could not load."}</p>
          <button
            onClick={() => void load()}
            className="text-xs tracking-wider uppercase text-forest border border-forest/30 rounded-full px-4 py-2"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        {/* Hero with link + share */}
        <section className="rounded-2xl bg-forest text-bone p-7 md:p-10 mb-8 relative overflow-hidden">
          <div
            className="absolute inset-0 opacity-[0.05] pointer-events-none"
            style={{
              backgroundImage: `radial-gradient(circle at 1px 1px, #F5F1E8 0.5px, transparent 0)`,
              backgroundSize: "24px 24px",
            }}
          />
          <div className="relative">
            <p className="text-[11px] tracking-[0.35em] uppercase text-sage font-medium mb-3">
              Sponsorships
            </p>
            <h2 className="font-serif text-3xl md:text-4xl mb-2">
              Bring your foursome in.
            </h2>
            <p className="text-sm text-bone/70 max-w-2xl mb-6">
              Every paid member you bring into Mully Reserve earns you progress
              toward badges with real rewards. Your link is yours alone, the
              tracking is automatic, and your first sponsorship ships a dozen
              Pro V1s to both of you.
            </p>

            <div className="flex flex-col sm:flex-row gap-3 mb-4">
              <div className="flex-1 flex items-center gap-3 bg-bone/10 border border-bone/20 rounded-xl px-4 py-3 font-mono text-sm">
                <span className="truncate">{data.link}</span>
              </div>
              <button
                onClick={() => void handleCopy()}
                className="h-11 px-6 rounded-xl bg-bone text-forest text-sm font-medium tracking-wider uppercase hover:bg-bone-dark transition-colors"
              >
                {copied ? "Copied" : "Copy Link"}
              </button>
            </div>

            <div className="flex gap-2 flex-wrap">
              <ShareButton label="Text" onClick={() => handleShare("sms")} />
              <ShareButton label="Email" onClick={() => handleShare("email")} />
              <ShareButton label="X" onClick={() => handleShare("x")} />
            </div>

            <p className="text-xs text-bone/55 mt-5">{totalLine}</p>
          </div>
        </section>

        {/* Badge grid */}
        <h3 className="font-serif text-2xl text-obsidian mb-5">Your Badges</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-10">
          {data.badges.map((badge) => (
            <BadgeCard key={badge.key} badge={badge} />
          ))}
        </div>

        {/* History */}
        <h3 className="font-serif text-2xl text-obsidian mb-5">Recent Sponsorships</h3>
        {data.history.length === 0 ? (
          <div className="rounded-xl border border-taupe/15 bg-cream p-6 text-sm text-charcoal/55">
            When someone joins through your link, you&apos;ll see them here.
          </div>
        ) : (
          <div className="rounded-xl border border-taupe/15 bg-cream overflow-hidden">
            {data.history.map((row, idx) => (
              <div
                key={row.id}
                className={`flex items-center justify-between px-5 py-4 ${
                  idx > 0 ? "border-t border-taupe/15" : ""
                }`}
              >
                <div>
                  <p className="text-sm text-obsidian font-medium">
                    {maskEmail(row.sponsoredEmail)}
                  </p>
                  <p className="text-xs text-charcoal/50">
                    {formatDate(row.attributedAt)}
                    {row.tier ? ` · Reserve ${capitalize(row.tier)}` : ""}
                  </p>
                </div>
                <div className="text-xs text-forest font-medium">
                  ${row.orderTotal.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── Sub components ─────────────────────────────────────────────────────── */

function ShareButton({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-9 px-4 rounded-full border border-bone/25 text-bone/80 text-xs tracking-wider uppercase hover:bg-bone/10 transition-colors"
    >
      Share via {label}
    </button>
  );
}

function BadgeCard({ badge }: { badge: BadgeState }) {
  const visual = BADGE_VISUAL[badge.key];
  const isEarned = badge.earned;
  const isDark = badge.key === "path_to_black" || badge.key === "the_18";

  return (
    <article
      className={`rounded-2xl border ${visual.ring} ${visual.bg} p-6 relative overflow-hidden transition-all ${
        isEarned ? "shadow-sm" : ""
      }`}
    >
      <div className="flex items-start gap-4">
        <div
          className={`w-12 h-12 rounded-xl flex items-center justify-center shrink-0 ${
            isDark ? "bg-bone/10" : "bg-forest/8"
          } ${visual.accent}`}
        >
          {visual.icon}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <h4
              className={`font-serif text-lg ${
                isDark ? "text-bone" : "text-obsidian"
              }`}
            >
              {badge.title}
            </h4>
            {isEarned && (
              <span className="text-[10px] tracking-wider uppercase font-medium px-2 py-0.5 rounded-full bg-sage/20 text-sage">
                {badge.earnedCount > 1
                  ? `Earned ${badge.earnedCount}x`
                  : "Earned"}
              </span>
            )}
          </div>
          <p
            className={`text-xs italic mb-2 ${
              isDark ? "text-bone/70" : "text-forest/70"
            }`}
          >
            {badge.tagline}
          </p>
          <p
            className={`text-xs leading-relaxed mb-4 ${
              isDark ? "text-bone/55" : "text-charcoal/55"
            }`}
          >
            {badge.description}
          </p>

          {/* Progress */}
          <div className="mb-2">
            <div className="flex items-center justify-between text-[11px] tracking-wider uppercase mb-1.5">
              <span
                className={`${isDark ? "text-bone/55" : "text-charcoal/45"}`}
              >
                {badge.window}
              </span>
              <span
                className={`font-medium ${
                  isDark ? "text-bone" : "text-forest"
                }`}
              >
                {badge.current} / {badge.threshold}
              </span>
            </div>
            <div
              className={`h-1.5 rounded-full overflow-hidden ${
                isDark ? "bg-bone/15" : "bg-taupe/20"
              }`}
            >
              <div
                className={`h-full transition-all duration-500 ${
                  isDark ? "bg-bone" : "bg-forest"
                }`}
                style={{ width: `${Math.round(badge.progress * 100)}%` }}
              />
            </div>
          </div>

          <p
            className={`text-[11px] mt-3 ${
              isDark ? "text-bone/60" : "text-charcoal/55"
            }`}
          >
            <span
              className={`font-medium ${
                isDark ? "text-bone" : "text-forest"
              }`}
            >
              Reward.{" "}
            </span>
            {badge.reward}
          </p>
        </div>
      </div>
    </article>
  );
}

/* ─── Helpers ────────────────────────────────────────────────────────────── */

function maskEmail(email: string): string {
  if (!email.includes("@")) return email;
  const [name, domain] = email.split("@");
  if (!name || !domain) return email;
  if (name.length <= 2) return `${name[0]}***@${domain}`;
  return `${name.slice(0, 2)}${"*".repeat(Math.max(1, name.length - 2))}@${domain}`;
}

function formatDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      year: "numeric",
    });
  } catch {
    return iso;
  }
}

function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
