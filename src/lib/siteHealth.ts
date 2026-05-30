/**
 * Site Health — shared types + Firestore helpers.
 *
 * Findings represent anything the autonomous site-health bot picked up:
 *   - Synthetic Playwright/JSDOM checks   (source: "synthetic")
 *   - Claude UX/visual review              (source: "llm-ux")
 *   - PostHog $exception ingest            (source: "posthog")
 *   - Vercel runtime/build errors          (source: "vercel")
 *   - Loop / Shopify / Firebase failures   (source: "loop" | "shopify" | "firebase")
 *
 * Findings are deduped on a content hash so the same broken modal showing
 * up day-after-day increments occurrence_count instead of creating noise.
 *
 * Schema is intentionally write-once-then-update; the digest cron reads
 * docs scoped to the prior Fri→Thu window.
 */

import { adminDb } from "@/lib/firebase-admin";
import { createHash } from "crypto";

export type Severity = "P0" | "P1" | "P2";

export type FindingSource =
  | "synthetic"
  | "llm-ux"
  | "posthog"
  | "vercel"
  | "loop"
  | "shopify"
  | "firebase";

export type Journey =
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

export type FindingStatus = "new" | "acknowledged" | "fixed" | "ignored";

export interface FindingEvidence {
  url: string;
  screenshot_url?: string | null;
  console_excerpt?: string | null;
  network_excerpt?: string | null;
  posthog_event_id?: string | null;
  stack_excerpt?: string | null;
  dom_excerpt?: string | null;
}

export interface SiteHealthFinding {
  id: string;
  dedupe_hash: string;
  date: string; // ISO YYYY-MM-DD (the sweep that found it most recently)
  severity: Severity;
  source: FindingSource;
  journey: Journey;
  title: string;
  description: string;
  evidence: FindingEvidence;
  suggested_fix?: string | null;
  status: FindingStatus;
  first_seen_at: number;
  last_seen_at: number;
  occurrence_count: number;
  related_pr?: string | null;
  /** Sweep run id that last touched this finding. */
  last_sweep_id: string;
}

export interface NewFinding {
  severity: Severity;
  source: FindingSource;
  journey: Journey;
  title: string;
  description: string;
  evidence: FindingEvidence;
  suggested_fix?: string | null;
}

/**
 * Stable dedupe hash. We hash the parts of the finding that should make
 * two reports "the same issue" — title + journey + URL pathname + source.
 * Volatile fields (screenshot URL, timestamps, occurrence counts) are not
 * included so a recurring issue lands on the same Firestore doc.
 */
export function computeDedupeHash(input: NewFinding): string {
  let pathname = "";
  try {
    pathname = new URL(input.evidence.url).pathname;
  } catch {
    pathname = input.evidence.url;
  }
  const material = [
    input.source,
    input.journey,
    pathname,
    input.title.toLowerCase().trim(),
  ].join("|");
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

const COLLECTION = "site_health_findings";

function toIsoDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * Upsert a finding. Returns whether the finding was new (true) or
 * an occurrence of an existing one (false).
 */
export async function upsertFinding(
  finding: NewFinding,
  sweepId: string,
  now: number = Date.now()
): Promise<{ id: string; created: boolean }> {
  const dedupeHash = computeDedupeHash(finding);
  const ref = adminDb.collection(COLLECTION).doc(dedupeHash);
  const snap = await ref.get();

  if (snap.exists) {
    const prev = snap.data() as SiteHealthFinding;
    await ref.update({
      last_seen_at: now,
      occurrence_count: (prev.occurrence_count ?? 1) + 1,
      // Refresh evidence to the most recent capture so the digest PDF shows
      // the *latest* screenshot/network excerpt, not a stale one.
      evidence: finding.evidence,
      description: finding.description,
      severity: finding.severity,
      suggested_fix: finding.suggested_fix ?? prev.suggested_fix ?? null,
      date: toIsoDate(now),
      last_sweep_id: sweepId,
    });
    return { id: dedupeHash, created: false };
  }

  const doc: SiteHealthFinding = {
    id: dedupeHash,
    dedupe_hash: dedupeHash,
    date: toIsoDate(now),
    severity: finding.severity,
    source: finding.source,
    journey: finding.journey,
    title: finding.title,
    description: finding.description,
    evidence: finding.evidence,
    suggested_fix: finding.suggested_fix ?? null,
    status: "new",
    first_seen_at: now,
    last_seen_at: now,
    occurrence_count: 1,
    related_pr: null,
    last_sweep_id: sweepId,
  };
  await ref.set(doc);
  return { id: dedupeHash, created: true };
}

/**
 * Findings whose last_seen_at falls inside [start, end). Used by both the
 * /admin/site-health page and the Friday digest cron.
 */
export async function getFindingsInWindow(
  startMs: number,
  endMs: number
): Promise<SiteHealthFinding[]> {
  const snap = await adminDb
    .collection(COLLECTION)
    .where("last_seen_at", ">=", startMs)
    .where("last_seen_at", "<", endMs)
    .orderBy("last_seen_at", "desc")
    .get();
  return snap.docs.map((d) => d.data() as SiteHealthFinding);
}

/**
 * Boundaries of the digest's coverage window: the prior Friday 00:00 ET
 * through the following Thursday 23:59:59.999 ET (inclusive).
 *
 * Called at the moment the Friday cron fires; if the cron fires at
 * Friday 06:00 ET, the window covers a-week-ago-Friday through yesterday.
 *
 * We compute in America/Detroit by using the IANA timezone offset trick:
 * format `now` in Detroit, then parse back to a UTC ms epoch.
 */
export function getPriorFridayThursdayWindow(now: Date = new Date()): {
  startMs: number;
  endMs: number;
  startLabel: string;
  endLabel: string;
} {
  // Resolve "what is the Detroit-local date right now"
  const detroitDateParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(now);

  const partMap: Record<string, string> = {};
  for (const p of detroitDateParts) partMap[p.type] = p.value;
  const todayWeekday = partMap.weekday; // e.g. "Fri"

  // Days since most recent Friday (inclusive: if today is Friday, that's 0)
  const WEEKDAY_INDEX: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };
  const today = WEEKDAY_INDEX[todayWeekday];
  // Want the *prior* Friday: if today is Friday, prior Friday is 7 days back.
  const daysBackToFriday = ((today - 5 + 7) % 7) || 7;

  // Build the start: Detroit midnight on prior-Friday.
  // Trick: take Detroit "today midnight" (Y-M-D from partMap) interpreted as UTC,
  // then shift back by daysBackToFriday and correct for the Detroit offset.
  const todayUtcMidnight = Date.UTC(
    Number(partMap.year),
    Number(partMap.month) - 1,
    Number(partMap.day),
    0, 0, 0, 0
  );
  const priorFridayUtcMidnightNaive =
    todayUtcMidnight - daysBackToFriday * 86_400_000;

  // Detroit is UTC-4 (EDT) or UTC-5 (EST). Pull the actual offset for that date.
  const offsetMinutes = detroitOffsetMinutes(
    new Date(priorFridayUtcMidnightNaive)
  );
  const startMs = priorFridayUtcMidnightNaive + offsetMinutes * 60_000;
  const endMs = startMs + 7 * 86_400_000; // Fri 00:00 → next Fri 00:00 (exclusive)

  const fmt = (ms: number) =>
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/Detroit",
      month: "short",
      day: "numeric",
      year: "numeric",
    }).format(new Date(ms));

  return {
    startMs,
    endMs,
    startLabel: fmt(startMs),
    endLabel: fmt(endMs - 1),
  };
}

/** Detroit UTC offset in minutes (positive when UTC is *ahead* of Detroit). */
function detroitOffsetMinutes(date: Date): number {
  // Compare Detroit-local clock vs UTC clock for the same instant.
  const dtf = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Detroit",
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  const parts: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) parts[p.type] = p.value;
  const detroitAsUtc = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second)
  );
  return Math.round((date.getTime() - detroitAsUtc) / 60_000);
}
