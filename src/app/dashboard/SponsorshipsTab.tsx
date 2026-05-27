"use client";

/**
 * Sponsorships tab UI.
 *
 * Design intent: lead with the rewards, not the link. The journey to The 18
 * and The Path to Black is the story. The share link is a small utility band
 * up top so it stays accessible without dominating the visual hierarchy.
 *
 * Sections, top to bottom:
 *   1. Slim utility band: code + copy + share triggers + total count
 *   2. The Ladder: four hero cards, one per badge, with the reward as the
 *      headline and progress as the rail underneath
 *   3. Recent sponsorships feed (collapsed by default once it's long)
 *
 * Palette stays on forest/bone/sage/cream/obsidian/ember. Path to Black and
 * The 18 lean dark to feel premium. First Dozen and Foursome lean cream so
 * they read approachable and attainable.
 *
 * Copy rule: no em dashes anywhere.
 */
import { useMemo, useState } from "react";
import { useMembership } from "../context/MembershipContext";
import { useSponsorshipBoard } from "@/lib/sponsorshipClient";
import { trackEvent } from "@/lib/tracking";

type BadgeKey = "first_dozen" | "foursome" | "path_to_black" | "the_18";

/* ─── Visual theme per badge ──────────────────────────────────────────────── */

interface BadgeTheme {
  tone: "light" | "dark";
  /** Background gradient used for the hero card. */
  background: string;
  /** Color of progress fill bar. */
  bar: string;
  /** Color of progress rail. */
  rail: string;
  /** Title color. */
  title: string;
  /** Subtitle color. */
  subtitle: string;
  /** Body text color. */
  body: string;
  /** Color of the "REWARD" eyebrow. */
  eyebrow: string;
  /** Earned chip background. */
  chip: string;
  /** Subtle inner accent. */
  ornament: string;
}

const BADGE_THEME: Record<BadgeKey, BadgeTheme> = {
  first_dozen: {
    tone: "light",
    background: "bg-gradient-to-br from-cream via-cream to-sage/10",
    bar: "bg-sage",
    rail: "bg-sage/15",
    title: "text-obsidian",
    subtitle: "text-forest",
    body: "text-charcoal/65",
    eyebrow: "text-sage",
    chip: "bg-sage/15 text-sage",
    ornament: "text-sage/20",
  },
  foursome: {
    tone: "light",
    background: "bg-gradient-to-br from-cream via-cream to-forest/8",
    bar: "bg-forest",
    rail: "bg-forest/12",
    title: "text-obsidian",
    subtitle: "text-forest",
    body: "text-charcoal/65",
    eyebrow: "text-forest",
    chip: "bg-forest/12 text-forest",
    ornament: "text-forest/15",
  },
  path_to_black: {
    tone: "dark",
    background: "bg-gradient-to-br from-obsidian via-obsidian to-forest-dark",
    bar: "bg-bone",
    rail: "bg-bone/15",
    title: "text-bone",
    subtitle: "text-bone",
    body: "text-bone/70",
    eyebrow: "text-bone/60",
    chip: "bg-bone/15 text-bone",
    ornament: "text-bone/10",
  },
  the_18: {
    tone: "dark",
    background: "bg-gradient-to-br from-forest-dark via-forest to-sage/30",
    bar: "bg-bone",
    rail: "bg-bone/15",
    title: "text-bone",
    subtitle: "text-bone",
    body: "text-bone/75",
    eyebrow: "text-sage",
    chip: "bg-bone/15 text-bone",
    ornament: "text-bone/10",
  },
};

/* ─── Reward visuals: oversized SVG ornaments behind each card ──────────── */

const BADGE_ORNAMENT: Record<BadgeKey, React.ReactNode> = {
  // Six golf balls clustered as a small dozen.
  first_dozen: (
    <svg viewBox="0 0 200 200" className="absolute -right-10 -bottom-12 w-56 h-56" fill="none" stroke="currentColor" strokeWidth={2}>
      <circle cx="60" cy="100" r="18" />
      <circle cx="100" cy="80" r="18" />
      <circle cx="140" cy="100" r="18" />
      <circle cx="80" cy="130" r="18" />
      <circle cx="120" cy="130" r="18" />
      <circle cx="100" cy="160" r="18" />
      <circle cx="60" cy="100" r="2.5" fill="currentColor" />
      <circle cx="100" cy="80" r="2.5" fill="currentColor" />
      <circle cx="140" cy="100" r="2.5" fill="currentColor" />
    </svg>
  ),
  // Four flags arranged in a square (the foursome).
  foursome: (
    <svg viewBox="0 0 200 200" className="absolute -right-8 -bottom-10 w-56 h-56" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M55 50v50M55 50l18 8-18 8" />
      <path d="M125 50v50M125 50l18 8-18 8" />
      <path d="M55 110v50M55 110l18 8-18 8" />
      <path d="M125 110v50M125 110l18 8-18 8" />
    </svg>
  ),
  // Stylized winding path leading up to a crown / black diamond.
  path_to_black: (
    <svg viewBox="0 0 240 200" className="absolute -right-12 -bottom-16 w-72 h-60" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M30 180 C 60 140, 90 160, 110 120 C 130 80, 160 100, 190 60" strokeDasharray="2 6" />
      <path d="M180 30 L 200 60 L 180 90 L 160 60 Z" fill="currentColor" fillOpacity="0.35" />
      <circle cx="180" cy="60" r="6" fill="currentColor" />
    </svg>
  ),
  // The 18: stylized 18 holes arranged as a winding course, flag at the end.
  the_18: (
    <svg viewBox="0 0 240 200" className="absolute -right-10 -bottom-14 w-72 h-60" fill="none" stroke="currentColor" strokeWidth={2}>
      <path d="M20 170 Q 50 130, 70 150 T 120 130 T 180 100 T 220 50" />
      <path d="M218 50 L 218 20 L 232 30 L 218 38" />
      <circle cx="20" cy="170" r="3.5" fill="currentColor" />
      <circle cx="60" cy="146" r="2.5" fill="currentColor" />
      <circle cx="100" cy="134" r="2.5" fill="currentColor" />
      <circle cx="140" cy="118" r="2.5" fill="currentColor" />
      <circle cx="180" cy="100" r="2.5" fill="currentColor" />
      <circle cx="218" cy="50" r="4" fill="currentColor" />
    </svg>
  ),
};

/* ─── Reward as the headline (this is what they came to see) ──────────────── */

const REWARD_HEADLINE: Record<BadgeKey, { eyebrow: string; reward: string; subline: string }> = {
  first_dozen: {
    eyebrow: "Sponsorship 1",
    reward: "A dozen Pro V1s.",
    subline: "For you, and another dozen for them. Shipped with their first quarterly box.",
  },
  foursome: {
    eyebrow: "Three in 30 days",
    reward: "A private tee time for four.",
    subline: "At a Mully partner course. Custom embroidered patches and a gear drop sized for the group.",
  },
  path_to_black: {
    eyebrow: "10 lifetime",
    reward: "Reserve Black, guaranteed.",
    subline: "The only public road to a Black invitation. Walk it once and the door is open.",
  },
  the_18: {
    eyebrow: "18 in a calendar year",
    reward: "A comped trip. Patron's Wall in Pontiac.",
    subline: "Pebble, Pinehurst, Bandon, or somewhere else. Airfare and golf combined cap at $2,000.",
  },
};

/* ─── Tab component ───────────────────────────────────────────────────────── */

export function SponsorshipsTab() {
  const { user, isSignedIn } = useMembership();
  const { data, loading, error, reload } = useSponsorshipBoard(user);
  const [copied, setCopied] = useState(false);

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
      window.location.href = `mailto:?subject=${encodeURIComponent("Mully Reserve")}&body=${encodeURIComponent(msg)}`;
    } else if (channel === "x") {
      window.open(
        `https://x.com/intent/tweet?text=${encodeURIComponent(msg)}`,
        "_blank",
        "noopener",
      );
    }
  };

  if (!isSignedIn) {
    return (
      <div className="px-6 md:px-12">
        <div className="max-w-5xl mx-auto text-center text-charcoal/60 py-16">
          Sign in to see your sponsorship board.
        </div>
      </div>
    );
  }

  // Skeleton-state UI while loading. Renders the full layout shape so the
  // page doesn't reflow when data arrives. Much friendlier than a "loading"
  // string for a tab that involves a network round trip.
  if (loading && !data) {
    return <SponsorshipsSkeleton />;
  }

  if (error && !data) {
    return (
      <div className="px-6 md:px-12">
        <div className="max-w-5xl mx-auto py-12">
          <p className="text-sm text-ember mb-3">{error}</p>
          <button
            onClick={reload}
            className="text-xs tracking-wider uppercase text-forest border border-forest/30 rounded-full px-4 py-2 cursor-pointer hover:bg-forest/5 transition-colors"
          >
            Try again
          </button>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const total = data.progress.total;

  return (
    <div className="px-6 md:px-12">
      <div className="max-w-5xl mx-auto">
        {/* Slim utility band, deliberately small */}
        <ShareBand
          link={data.link}
          code={data.code}
          total={total}
          copied={copied}
          onCopy={handleCopy}
          onShare={handleShare}
        />

        {/* Hero eyebrow + headline */}
        <div className="mt-10 mb-6">
          <p className="text-[11px] tracking-[0.35em] uppercase text-sage font-medium mb-3">
            The Ladder
          </p>
          <h2 className="font-serif text-3xl md:text-4xl text-obsidian leading-tight max-w-2xl">
            Four badges. Real rewards.{" "}
            <span className="italic text-forest">Earn them in order.</span>
          </h2>
          <p className="text-sm text-charcoal/55 mt-3 max-w-xl">
            Every paid member you bring in moves you up. The bigger the badge,
            the bigger the moment. Here is what is on the table.
          </p>
        </div>

        {/* The ladder */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5 mb-12">
          {data.badges.map((badge) => (
            <RewardCard key={badge.key} badge={badge} />
          ))}
        </div>

        {/* History feed (collapsed by default) */}
        <RecentSponsorships history={data.history} />
      </div>
    </div>
  );
}

/* ─── Share band: small but useful, always accessible ─────────────────────── */

function ShareBand({
  link,
  code,
  total,
  copied,
  onCopy,
  onShare,
}: {
  link: string;
  code: string;
  total: number;
  copied: boolean;
  onCopy: () => void;
  onShare: (channel: "sms" | "email" | "x") => void;
}) {
  return (
    <section className="rounded-2xl border border-taupe/20 bg-cream/80 backdrop-blur-sm p-4 md:p-5 flex flex-col lg:flex-row lg:items-center gap-4 lg:gap-6">
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-3 mb-1.5">
          <p className="text-[10px] tracking-[0.32em] uppercase text-forest font-medium">
            Your link
          </p>
          <p className="text-[10px] tracking-wider uppercase text-charcoal/45">
            Code {code}
          </p>
        </div>
        <button
          onClick={onCopy}
          className="block w-full text-left text-sm font-mono text-obsidian truncate cursor-pointer hover:text-forest transition-colors"
          title="Click to copy"
        >
          {link}
        </button>
      </div>
      <div className="flex items-center gap-2 flex-wrap">
        <button
          onClick={onCopy}
          className="h-9 px-4 rounded-full bg-forest text-bone text-xs tracking-wider uppercase font-medium hover:bg-forest-dark transition-colors cursor-pointer whitespace-nowrap"
        >
          {copied ? "Copied" : "Copy link"}
        </button>
        <ShareIcon label="Text" onClick={() => onShare("sms")} />
        <ShareIcon label="Email" onClick={() => onShare("email")} />
        <ShareIcon label="X" onClick={() => onShare("x")} />
      </div>
      <div className="lg:border-l lg:border-taupe/20 lg:pl-6">
        <p className="text-[10px] tracking-[0.32em] uppercase text-charcoal/45 mb-0.5">
          To date
        </p>
        <p className="font-serif text-2xl text-forest leading-none">
          {total}
        </p>
        <p className="text-[11px] text-charcoal/55 mt-0.5">
          paid sponsorship{total === 1 ? "" : "s"}
        </p>
      </div>
    </section>
  );
}

function ShareIcon({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="h-9 px-3 rounded-full border border-taupe/30 text-charcoal/65 text-[11px] tracking-wider uppercase hover:text-forest hover:border-forest/30 transition-colors cursor-pointer"
    >
      {label}
    </button>
  );
}

/* ─── The reward card itself: the star of the page ───────────────────────── */

function RewardCard({ badge }: { badge: SponsorshipBadge }) {
  const theme = BADGE_THEME[badge.key];
  const ornament = BADGE_ORNAMENT[badge.key];
  const headline = REWARD_HEADLINE[badge.key];
  const pct = Math.round(badge.progress * 100);
  const isEarned = badge.earned;
  const isClose = !isEarned && pct >= 50;

  return (
    <article
      className={`relative overflow-hidden rounded-2xl ${theme.background} p-6 md:p-7 ${
        isEarned ? "ring-1 ring-sage/40" : ""
      } transition-all duration-500 hover:shadow-md`}
    >
      {/* Background ornament */}
      <div
        className={`pointer-events-none ${theme.ornament}`}
        aria-hidden
      >
        {ornament}
      </div>

      <div className="relative">
        {/* Eyebrow row: badge title + earned chip */}
        <div className="flex items-center justify-between mb-3">
          <p className={`text-[10px] tracking-[0.32em] uppercase font-medium ${theme.eyebrow}`}>
            {badge.title}
          </p>
          {isEarned && (
            <span className={`text-[10px] tracking-wider uppercase font-medium px-2.5 py-1 rounded-full ${theme.chip}`}>
              {badge.earnedCount > 1 ? `Earned ${badge.earnedCount}x` : "Earned"}
            </span>
          )}
          {!isEarned && isClose && (
            <span className={`text-[10px] tracking-wider uppercase font-medium px-2.5 py-1 rounded-full ${theme.chip}`}>
              {badge.threshold - badge.current} to go
            </span>
          )}
        </div>

        {/* The reward headline. THIS is the focal point. */}
        <p className={`text-[11px] tracking-[0.28em] uppercase mb-2 ${theme.eyebrow}`}>
          {headline.eyebrow}
        </p>
        <h3 className={`font-serif text-2xl md:text-[28px] leading-[1.15] mb-3 ${theme.title}`}>
          {headline.reward}
        </h3>
        <p className={`text-sm leading-relaxed max-w-md ${theme.body}`}>
          {headline.subline}
        </p>

        {/* Progress */}
        <div className="mt-7">
          <div className="flex items-baseline justify-between mb-2">
            <span className={`text-[10px] tracking-[0.28em] uppercase ${theme.body}`}>
              {badge.window}
            </span>
            <span className={`text-sm font-medium tabular-nums ${theme.subtitle}`}>
              <span className="text-base">{badge.current}</span>
              <span className={`text-xs ${theme.body}`}> / {badge.threshold}</span>
            </span>
          </div>
          <div className={`h-1.5 rounded-full overflow-hidden ${theme.rail}`}>
            <div
              className={`h-full ${theme.bar} transition-[width] duration-700 ease-out`}
              style={{ width: `${Math.max(pct, badge.current > 0 ? 6 : 0)}%` }}
            />
          </div>
        </div>
      </div>
    </article>
  );
}

/* ─── Recent sponsorships ────────────────────────────────────────────────── */

interface SponsorshipBadge {
  key: BadgeKey;
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

function RecentSponsorships({ history }: { history: HistoryRow[] }) {
  const [expanded, setExpanded] = useState(false);
  const shown = useMemo(
    () => (expanded ? history : history.slice(0, 3)),
    [expanded, history],
  );

  return (
    <div>
      <h3 className="font-serif text-2xl text-obsidian mb-5">Recent Sponsorships</h3>
      {history.length === 0 ? (
        <div className="rounded-xl border border-dashed border-taupe/30 bg-cream/50 p-8 text-center">
          <p className="text-sm text-charcoal/55 mb-1">
            When someone joins through your link, you&apos;ll see them here.
          </p>
          <p className="text-xs text-charcoal/40">
            The first one unlocks The First Dozen.
          </p>
        </div>
      ) : (
        <>
          <div className="rounded-xl border border-taupe/15 bg-cream overflow-hidden">
            {shown.map((row, idx) => (
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
                <div className="text-xs text-forest font-medium tabular-nums">
                  ${row.orderTotal.toFixed(2)}
                </div>
              </div>
            ))}
          </div>
          {history.length > 3 && (
            <button
              onClick={() => setExpanded((v) => !v)}
              className="mt-3 text-xs tracking-wider uppercase text-forest hover:text-forest-dark cursor-pointer transition-colors"
            >
              {expanded ? "Show fewer" : `Show all ${history.length}`}
            </button>
          )}
        </>
      )}
    </div>
  );
}

/* ─── Skeleton ───────────────────────────────────────────────────────────── */

function SponsorshipsSkeleton() {
  return (
    <div className="px-6 md:px-12">
      <div className="max-w-5xl mx-auto animate-pulse">
        <div className="rounded-2xl border border-taupe/20 bg-cream/80 p-5 h-20 mb-10" />
        <div className="h-4 w-32 bg-taupe/20 rounded mb-3" />
        <div className="h-9 w-3/4 bg-taupe/20 rounded mb-2" />
        <div className="h-4 w-2/3 bg-taupe/15 rounded mb-8" />
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-2xl bg-cream border border-taupe/15 h-56" />
          ))}
        </div>
      </div>
    </div>
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
