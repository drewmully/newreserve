/**
 * The Send Gate — the single decision point every outbound message passes
 * through before it reaches a provider.
 *
 * `sendPlainText()` (src/lib/email/resend.ts) is the only caller in normal
 * operation: it asks `checkSend()` before handing the message to Resend and
 * calls `recordSend()` after. Nothing else should talk to Resend directly.
 *
 * Checks run in this order and short-circuit on the first denial:
 *   1. suppression      (all send classes, including transactional)
 *   2. consent          (non-transactional)
 *   3. frequency cap    (non-transactional)
 *   4. flow exclusivity (lifecycle only)
 */

import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { adminDb } from "@/lib/firebase-admin";

export type SendClass = "transactional" | "lifecycle" | "campaign";

export interface GateRequest {
  to: string;
  sendClass: SendClass;
  /** "access" | "member" | "reserve" | "abandon" | ... */
  flow?: string;
  /** Free-form, e.g. "abandon_nudge". */
  category?: string;
  step?: number;
}

export interface GateDecision {
  allowed: boolean;
  reason?: "suppressed" | "frequency_cap" | "wrong_flow" | "no_consent";
  detail?: string;
}

/**
 * Lower number = higher priority. Entering a flow evicts every lower-priority
 * flow, so a person is in exactly one lifecycle flow at a time.
 *
 * `member`/`access`/`reserve`/`abandon` are the four flows the Firestore
 * sequence engine actually writes today (see FLOW_STEPS in ./sequences.ts).
 * The winback/cancelled/reactivation tiers are reserved: no code enrols anyone
 * in them yet, but they are priced in so the ordering does not change when
 * they land.
 */
const FLOW_PRIORITY: Record<string, number> = {
  member: 1,
  access: 1,
  abandon: 2,
  reserve: 3,
  winback: 4,
  cancelled: 4,
  reactivation: 5,
};

/**
 * Flows we do not recognise sort below every known flow, so any active
 * enrolment evicts them. Deny-by-default: an untagged flow must not be able to
 * talk over a purchaser sequence.
 */
const UNKNOWN_FLOW_PRIORITY = Number.MAX_SAFE_INTEGER;

const FREQUENCY_CAP_PER_WEEK = 3;
const FREQUENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;
const SEND_LOG_TABLE = "send_log";
const PROVIDER = "resend";

function priorityOf(flow: string | undefined): number {
  if (!flow) return UNKNOWN_FLOW_PRIORITY;
  return FLOW_PRIORITY[flow] ?? UNKNOWN_FLOW_PRIORITY;
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/**
 * What to do when a dependency (Supabase / Firestore) is unreachable.
 *
 * A broken database must never block a password reset and must never let a
 * blast through, so transactional fails OPEN and campaign fails CLOSED.
 * Lifecycle is not specified either way; it fails CLOSED with campaign because
 * a missed drip step is recoverable and an unwanted one is not.
 */
function dependencyFailure(
  req: GateRequest,
  stage: string,
  err: unknown
): GateDecision {
  const message = err instanceof Error ? err.message : String(err);
  const failOpen = req.sendClass === "transactional";
  console.error(
    `[send-gate] ${stage} unavailable — failing ${failOpen ? "OPEN" : "CLOSED"} ` +
      `for sendClass=${req.sendClass} to=${req.to}: ${message}`
  );
  if (failOpen) return { allowed: true, detail: `${stage}_unavailable_fail_open` };
  return { allowed: false, detail: `${stage}_unavailable_fail_closed: ${message}` };
}

/**
 * Any row scoped `all` or `email` blocks the send. Transactional is NOT exempt:
 * a hard bounce or a spam complaint means we stop mailing the address, full
 * stop.
 */
async function checkSuppression(email: string): Promise<GateDecision> {
  const sb = getSupabaseService();
  const { data, error } = await sb
    .from("suppression_list")
    .select("email,scope,reason")
    .eq("email", email)
    .in("scope", ["all", "email"])
    .limit(1);

  if (error) throw new Error(error.message);
  if (!data || data.length === 0) return { allowed: true };

  const hit = data[0] as { scope?: string | null; reason?: string | null };
  return {
    allowed: false,
    reason: "suppressed",
    detail: `scope=${hit.scope ?? "unknown"} reason=${hit.reason ?? "unknown"}`,
  };
}

/**
 * `false` denies. `null` and "no customer row at all" both mean we never asked,
 * which the spec treats as allowed — logged so the unknown-consent population
 * stays visible.
 *
 * Deliberately reads every row for the address rather than `.single()`:
 * `customers` is a Shopify mirror and does not guarantee one row per email, and
 * a single explicit `false` should win over any number of nulls.
 */
async function checkConsent(email: string): Promise<GateDecision> {
  const sb = getSupabaseService();
  const { data, error } = await sb
    .from("customers")
    .select("accepts_email_marketing")
    .eq("email", email);

  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { accepts_email_marketing: boolean | null }[];
  if (rows.some((r) => r.accepts_email_marketing === false)) {
    return {
      allowed: false,
      reason: "no_consent",
      detail: "customers.accepts_email_marketing=false",
    };
  }

  if (rows.length === 0 || rows.every((r) => r.accepts_email_marketing === null)) {
    console.warn(
      `[send-gate] unknown email-marketing consent for ${email} ` +
        `(${rows.length} customer row(s)) — allowing`
    );
  }

  return { allowed: true };
}

/**
 * Counts every logged send in the trailing 7 days regardless of class.
 * Transactional sends are exempt from being *blocked* by the cap but still
 * count toward it, so a week of receipts throttles the marketing on top.
 */
async function checkFrequencyCap(email: string): Promise<GateDecision> {
  const sb = getSupabaseService();
  const since = new Date(Date.now() - FREQUENCY_WINDOW_MS).toISOString();
  const { count, error } = await sb
    .from(SEND_LOG_TABLE)
    .select("id", { count: "exact", head: true })
    .eq("email", email)
    .gte("sent_at", since);

  if (error) throw new Error(error.message);

  const sent = count ?? 0;
  if (sent >= FREQUENCY_CAP_PER_WEEK) {
    return {
      allowed: false,
      reason: "frequency_cap",
      detail: `${sent} sends in trailing 7d (cap ${FREQUENCY_CAP_PER_WEEK})`,
    };
  }
  return { allowed: true };
}

/**
 * Enrolment state lives in Firestore `email_sequences/{uid}`, keyed by Firebase
 * uid or styleProfile id — not by email — so we query on the denormalized
 * `email` field. Case is not normalized at write time (startFlow stores
 * whatever the caller passed), hence the two-value `in`.
 *
 * TODO(phase-6b): move enrolment into Postgres so the gate reads one database.
 * Until then Firestore is the source of truth and must not be mirrored.
 */
async function checkFlowExclusivity(
  normalizedEmail: string,
  rawEmail: string,
  flow: string | undefined
): Promise<GateDecision> {
  const candidates =
    rawEmail.trim() === normalizedEmail
      ? [normalizedEmail]
      : [normalizedEmail, rawEmail.trim()];

  const snap = await adminDb
    .collection("email_sequences")
    .where("email", "in", candidates)
    .where("status", "==", "active")
    .get();

  const requested = priorityOf(flow);
  for (const doc of snap.docs) {
    const enrolled = (doc.data() as { flow?: string } | undefined)?.flow;
    if (!enrolled || enrolled === flow) continue;
    if (priorityOf(enrolled) <= requested) {
      return {
        allowed: false,
        reason: "wrong_flow",
        detail: `active enrollment in "${enrolled}" outranks "${flow ?? "untagged"}"`,
      };
    }
  }

  return { allowed: true };
}

export async function checkSend(req: GateRequest): Promise<GateDecision> {
  const email = normalizeEmail(req.to);
  if (!email) {
    return { allowed: false, detail: "empty recipient" };
  }

  const isTransactional = req.sendClass === "transactional";

  try {
    const suppression = await checkSuppression(email);
    if (!suppression.allowed) return suppression;
  } catch (err) {
    return dependencyFailure(req, "suppression_list", err);
  }

  if (!isTransactional) {
    try {
      const consent = await checkConsent(email);
      if (!consent.allowed) return consent;
    } catch (err) {
      return dependencyFailure(req, "customers", err);
    }

    try {
      const cap = await checkFrequencyCap(email);
      if (!cap.allowed) return cap;
    } catch (err) {
      return dependencyFailure(req, SEND_LOG_TABLE, err);
    }
  }

  if (req.sendClass === "lifecycle") {
    try {
      const exclusivity = await checkFlowExclusivity(email, req.to, req.flow);
      if (!exclusivity.allowed) return exclusivity;
    } catch (err) {
      return dependencyFailure(req, "email_sequences", err);
    }
  }

  return { allowed: true };
}

/**
 * Appends to `send_log` after the provider accepted the message. Never throws:
 * the email is already gone, so a logging failure must not surface as a send
 * failure. It is logged loudly instead — a silent gap here would quietly lift
 * the frequency cap.
 */
export async function recordSend(
  req: GateRequest,
  providerMessageId: string | null
): Promise<void> {
  try {
    const sb = getSupabaseService();
    const { error } = await sb.from(SEND_LOG_TABLE).insert({
      email: normalizeEmail(req.to),
      phone_e164: null,
      send_class: req.sendClass,
      flow: req.flow ?? null,
      category: req.category ?? null,
      step: req.step ?? null,
      provider: PROVIDER,
      provider_message_id: providerMessageId,
    });
    if (error) throw new Error(error.message);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(
      `[send-gate] FAILED to record send to=${req.to} class=${req.sendClass} ` +
        `providerMessageId=${providerMessageId}: ${message}`
    );
  }
}
