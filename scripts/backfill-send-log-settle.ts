/**
 * scripts/backfill-send-log-settle.ts
 *
 * Reconciles `public.send_log` rows stuck at status='queued' (the settle
 * step never wrote back — see src/lib/email/gate.ts settleSend for the root
 * cause: `service_role` lacked UPDATE on send_log, see
 * db/2026-08-04-grant-send-log-update.sql) against the Resend delivery
 * events Firestore mirrors at `email_events/{auto_id}` (written by
 * src/app/api/email/events/route.ts, the Resend webhook handler).
 *
 * Matching rule: a queued send_log row is considered "confirmed sent" when
 * there exists an `email_events` doc with:
 *   - event_type === "sent"
 *   - email === send_log.email (case-insensitive)
 *   - resend_timestamp within ±30 minutes of send_log.created_at
 * When multiple candidates match, the closest by time is chosen and its
 * `email_id` becomes `send_log.provider_message_id`.
 *
 * Rows with no matching sent event after the window are left untouched by
 * default (they are NOT marked 'failed' automatically — that requires a
 * human/ops judgment call outside Phase 0 scope). Use --mark-unmatched-failed
 * to opt into that if you have already confirmed those addresses never
 * received mail.
 *
 * Safety:
 *   DRY RUN BY DEFAULT. Prints before/after counts and a sample of planned
 *   changes. Add --commit to actually write. Never run --commit as part of
 *   this Phase 0 change — a human operator must review the printed plan and
 *   run it deliberately, and only after db/2026-08-04-grant-send-log-update.sql
 *   has been applied (otherwise the writes will fail with the exact same
 *   permission-denied error this backfill exists to clean up after).
 *
 * Usage:
 *   pnpm tsx scripts/backfill-send-log-settle.ts                  # dry run
 *   pnpm tsx scripts/backfill-send-log-settle.ts --since=2026-07-30
 *   pnpm tsx scripts/backfill-send-log-settle.ts --commit          # writes
 *   pnpm tsx scripts/backfill-send-log-settle.ts --limit=50 --commit
 */

import { getSupabaseService } from "../src/app/api/_lib/supabaseService";
import { adminDb } from "../src/lib/firebase-admin";

const COMMIT = process.argv.includes("--commit");
const sinceArg = process.argv.find((a) => a.startsWith("--since="));
const SINCE = sinceArg?.split("=")[1]?.trim() || "2026-07-30";
const limitArg = process.argv.find((a) => a.startsWith("--limit="));
const LIMIT = limitArg ? parseInt(limitArg.split("=")[1], 10) : 10000;
const MARK_UNMATCHED_FAILED = process.argv.includes("--mark-unmatched-failed");

const MATCH_WINDOW_MS = 30 * 60 * 1000; // ±30 minutes

interface SendLogRow {
  id: number;
  email: string | null;
  status: string;
  error: string | null;
  provider_message_id: string | null;
  dedupe_key: string | null;
  created_at: string;
}

interface SentEvent {
  emailId: string;
  email: string;
  resendTimestampMs: number;
}

async function loadQueuedRows(): Promise<SendLogRow[]> {
  const sb = getSupabaseService();
  const { data, error } = await sb
    .from("send_log")
    .select("id,email,status,error,provider_message_id,dedupe_key,created_at")
    .eq("status", "queued")
    .gte("created_at", SINCE)
    .order("created_at", { ascending: true })
    .limit(LIMIT);
  if (error) throw new Error(`failed to load send_log rows: ${error.message}`);
  return (data ?? []) as SendLogRow[];
}

/**
 * Pulls all `sent` events from Firestore `email_events` in the relevant
 * window and indexes them by lowercased email. One Firestore query per
 * distinct email would be simpler but far slower and rate-limit-prone for
 * hundreds of rows; instead we page through everything once.
 */
async function loadSentEventsByEmail(): Promise<Map<string, SentEvent[]>> {
  const byEmail = new Map<string, SentEvent[]>();
  const snap = await adminDb
    .collection("email_events")
    .where("event_type", "==", "sent")
    .get();

  for (const doc of snap.docs) {
    const data = doc.data() as {
      email?: unknown;
      email_id?: unknown;
      resend_timestamp?: unknown;
    };
    const email = typeof data.email === "string" ? data.email.trim().toLowerCase() : null;
    const emailId = typeof data.email_id === "string" ? data.email_id : null;
    const ts =
      typeof data.resend_timestamp === "string" ? Date.parse(data.resend_timestamp) : NaN;
    if (!email || !emailId || Number.isNaN(ts)) continue;
    const list = byEmail.get(email) ?? [];
    list.push({ emailId, email, resendTimestampMs: ts });
    byEmail.set(email, list);
  }
  return byEmail;
}

function findBestMatch(
  row: SendLogRow,
  eventsByEmail: Map<string, SentEvent[]>
): SentEvent | null {
  if (!row.email) return null;
  const candidates = eventsByEmail.get(row.email.trim().toLowerCase());
  if (!candidates || candidates.length === 0) return null;

  const createdMs = Date.parse(row.created_at);
  if (Number.isNaN(createdMs)) return null;

  let best: SentEvent | null = null;
  let bestDelta = Infinity;
  for (const candidate of candidates) {
    const delta = Math.abs(candidate.resendTimestampMs - createdMs);
    if (delta <= MATCH_WINDOW_MS && delta < bestDelta) {
      best = candidate;
      bestDelta = delta;
    }
  }
  return best;
}

interface Plan {
  toSettleSent: { row: SendLogRow; match: SentEvent }[];
  toMarkFailed: SendLogRow[];
  unmatchedLeftAlone: SendLogRow[];
}

function buildPlan(rows: SendLogRow[], eventsByEmail: Map<string, SentEvent[]>): Plan {
  const toSettleSent: { row: SendLogRow; match: SentEvent }[] = [];
  const toMarkFailed: SendLogRow[] = [];
  const unmatchedLeftAlone: SendLogRow[] = [];

  for (const row of rows) {
    const match = findBestMatch(row, eventsByEmail);
    if (match) {
      toSettleSent.push({ row, match });
    } else if (MARK_UNMATCHED_FAILED) {
      toMarkFailed.push(row);
    } else {
      unmatchedLeftAlone.push(row);
    }
  }
  return { toSettleSent, toMarkFailed, unmatchedLeftAlone };
}

async function printBeforeCounts(): Promise<void> {
  const sb = getSupabaseService();
  const { count: queuedCount } = await sb
    .from("send_log")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .gte("created_at", SINCE);
  const { count: sentCount } = await sb
    .from("send_log")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("created_at", SINCE);
  const { count: failedCount } = await sb
    .from("send_log")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("created_at", SINCE);
  const { count: withMessageId } = await sb
    .from("send_log")
    .select("id", { count: "exact", head: true })
    .not("provider_message_id", "is", null)
    .gte("created_at", SINCE);

  console.log("── BEFORE (send_log, created_at >= " + SINCE + ") ──");
  console.log(`  queued:               ${queuedCount ?? 0}`);
  console.log(`  sent:                 ${sentCount ?? 0}`);
  console.log(`  failed:               ${failedCount ?? 0}`);
  console.log(`  with provider_message_id: ${withMessageId ?? 0}`);
}

async function printAfterCounts(): Promise<void> {
  const sb = getSupabaseService();
  const { count: queuedCount } = await sb
    .from("send_log")
    .select("id", { count: "exact", head: true })
    .eq("status", "queued")
    .gte("created_at", SINCE);
  const { count: sentCount } = await sb
    .from("send_log")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("created_at", SINCE);
  const { count: failedCount } = await sb
    .from("send_log")
    .select("id", { count: "exact", head: true })
    .eq("status", "failed")
    .gte("created_at", SINCE);
  const { count: withMessageId } = await sb
    .from("send_log")
    .select("id", { count: "exact", head: true })
    .not("provider_message_id", "is", null)
    .gte("created_at", SINCE);

  console.log("── AFTER (send_log, created_at >= " + SINCE + ") ──");
  console.log(`  queued:               ${queuedCount ?? 0}`);
  console.log(`  sent:                 ${sentCount ?? 0}`);
  console.log(`  failed:               ${failedCount ?? 0}`);
  console.log(`  with provider_message_id: ${withMessageId ?? 0}`);
}

async function commitPlan(plan: Plan): Promise<{ settled: number; failed: number; errors: number }> {
  const sb = getSupabaseService();
  let settled = 0;
  let failed = 0;
  let errors = 0;

  for (const { row, match } of plan.toSettleSent) {
    // Idempotent: only touches rows still in 'queued', mirroring the fixed
    // settleSend() in src/lib/email/gate.ts.
    const { error, data } = await sb
      .from("send_log")
      .update({
        status: "sent",
        sent_at: new Date(match.resendTimestampMs).toISOString(),
        provider_message_id: match.emailId,
      })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("id");
    if (error) {
      errors++;
      console.error(`[backfill] FAILED to settle send_log ${row.id} as sent:`, error.message);
      continue;
    }
    if (data && data.length > 0) settled++;
  }

  for (const row of plan.toMarkFailed) {
    const { error, data } = await sb
      .from("send_log")
      .update({
        status: "failed",
        error: "BACKFILL: no matching Resend sent event found within +/-30min window",
        dedupe_key: null,
      })
      .eq("id", row.id)
      .eq("status", "queued")
      .select("id");
    if (error) {
      errors++;
      console.error(`[backfill] FAILED to mark send_log ${row.id} as failed:`, error.message);
      continue;
    }
    if (data && data.length > 0) failed++;
  }

  return { settled, failed, errors };
}

async function main(): Promise<void> {
  console.log(`[backfill-send-log-settle] mode=${COMMIT ? "COMMIT" : "DRY-RUN"} since=${SINCE} limit=${LIMIT} markUnmatchedFailed=${MARK_UNMATCHED_FAILED}`);

  await printBeforeCounts();

  const rows = await loadQueuedRows();
  console.log(`\nLoaded ${rows.length} queued send_log row(s) since ${SINCE}.`);

  const eventsByEmail = await loadSentEventsByEmail();
  const totalSentEvents = [...eventsByEmail.values()].reduce((a, l) => a + l.length, 0);
  console.log(`Loaded ${totalSentEvents} Firestore "sent" event(s) across ${eventsByEmail.size} distinct email(s).`);

  const plan = buildPlan(rows, eventsByEmail);
  console.log(`\n── PLAN ──`);
  console.log(`  would settle as 'sent':   ${plan.toSettleSent.length}`);
  console.log(`  would mark as 'failed':   ${plan.toMarkFailed.length} (only with --mark-unmatched-failed)`);
  console.log(`  left unmatched, untouched: ${plan.unmatchedLeftAlone.length}`);

  console.log(`\n  Sample of rows to settle as 'sent' (up to 10):`);
  for (const { row, match } of plan.toSettleSent.slice(0, 10)) {
    console.log(
      `    id=${row.id} email=${row.email} created_at=${row.created_at} -> provider_message_id=${match.emailId} sent_at=${new Date(match.resendTimestampMs).toISOString()}`
    );
  }

  if (!COMMIT) {
    console.log(`\nDRY RUN — no writes made. Re-run with --commit to apply.`);
    console.log(`NOTE: writes will fail with permission-denied until db/2026-08-04-grant-send-log-update.sql is applied.`);
    return;
  }

  console.log(`\nCommitting...`);
  const result = await commitPlan(plan);
  console.log(`Committed: settled=${result.settled} failed=${result.failed} errors=${result.errors}`);

  await printAfterCounts();
}

main().catch((err) => {
  console.error("[backfill-send-log-settle] fatal error:", err);
  process.exit(1);
});
