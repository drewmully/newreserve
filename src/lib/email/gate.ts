/**
 * The send gate — the single chokepoint every outbound email passes through.
 *
 * Enforces, in this order: suppression → consent → frequency cap → flow
 * exclusivity. Every attempt (allowed or denied) is written to
 * `public.send_log`, so the log is a complete record of outbound intent, not
 * just of successful deliveries.
 *
 * Write pattern is claim-then-settle rather than record-after-send:
 *   1. denied            → INSERT status='skipped_suppressed', error=<reason>
 *   2. allowed           → INSERT status='queued' with `dedupe_key`. A unique
 *                          violation means another worker already claimed this
 *                          send, so we return without sending.
 *   3. provider call
 *   4. UPDATE the claimed row to 'sent' (+ provider_message_id) or 'failed'.
 *
 * Claiming before the provider call is what actually prevents duplicate sends:
 * if the process dies mid-send the row survives as evidence.
 */

import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { adminDb } from "@/lib/firebase-admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export type SendClass = "transactional" | "lifecycle" | "campaign";

/**
 * `gate_unavailable` never reaches the database — it is only produced when
 * Supabase itself is unreachable, in which case there is nothing to write to.
 * The other four are the exact strings written to `send_log.error`.
 */
export type DenyReason =
  | "suppressed"
  | "frequency_cap"
  | "wrong_flow"
  | "no_consent"
  | "gate_unavailable";

export interface GateRequest {
  /** Recipient email. Compared case-insensitively everywhere. */
  to: string;
  sendClass: SendClass;
  /** "access" | "member" | "reserve" | "abandon" | ... */
  flow?: string;
  /** Free-form, e.g. "abandon_nudge". */
  category?: string;
  step?: number;
  /** Identifies the template; falls back to `category` / `flow_<flow>`. */
  templateKey?: string;
  /** Set for `campaign` sends so marketing rows stay distinguishable. */
  campaignId?: string;
  /**
   * Explicit duplicate-send key. Callers that already have a natural
   * idempotency key should pass it. When absent we derive one for lifecycle
   * sends and otherwise leave it NULL (no dedupe) rather than inventing a key
   * that could collide.
   */
  dedupeKey?: string;
}

export interface GateDecision {
  allowed: boolean;
  reason?: DenyReason;
  detail?: string;
}

/**
 * Lifecycle flow priority — lower number wins and evicts higher numbers.
 * A person is in exactly one flow at a time.
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

/** An unrecognised incoming flow must never evict an established one. */
const LOWEST_PRIORITY = Number.MAX_SAFE_INTEGER;

const MARKETING_SENDS_PER_WEEK = 3;
const FREQUENCY_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

const SEND_LOG = "send_log";
const PG_UNIQUE_VIOLATION = "23505";

function isMarketing(sendClass: SendClass): boolean {
  return sendClass !== "transactional";
}

/** `send_log.scope` only has two legal values; the TS three-way stays richer. */
function scopeFor(sendClass: SendClass): "marketing" | "transactional" {
  return isMarketing(sendClass) ? "marketing" : "transactional";
}

function normaliseEmail(email: string): string {
  return email.trim().toLowerCase();
}

function templateKeyFor(req: GateRequest): string | null {
  if (req.templateKey) return req.templateKey;
  if (req.category) return req.category;
  if (req.flow) return `flow_${req.flow}`;
  return null;
}

function dedupeKeyFor(req: GateRequest, email: string): string | null {
  if (req.dedupeKey) return req.dedupeKey;
  if (req.sendClass !== "lifecycle") return null;
  const templateKey = templateKeyFor(req);
  if (!templateKey) return null;
  return `${templateKey}:${email}:${req.step ?? "x"}`;
}

interface SuppressionRow {
  email: string | null;
  channel: string | null;
  scope: string | null;
  reason: string | null;
}

interface CustomerRow {
  id: number;
  email: string | null;
  accepts_email_marketing: boolean | null;
}

interface GateContext {
  sb: SupabaseClient;
  email: string;
  customer: CustomerRow | null;
}

/**
 * PostgREST cannot filter on `lower(email)`, and the unique indexes are
 * functional, so stored values are not guaranteed to be lowercase. `ilike`
 * with no added wildcards gets us case-insensitive matching; the caller
 * re-checks equality in JS because `_` and `%` are still LIKE metacharacters
 * and could over-match.
 */
function matchesEmail(row: { email: string | null }, email: string): boolean {
  return (row.email ?? "").trim().toLowerCase() === email;
}

async function loadCustomer(
  sb: SupabaseClient,
  email: string
): Promise<CustomerRow | null> {
  const { data, error } = await sb
    .from("customers")
    .select("id,email,accepts_email_marketing")
    .ilike("email", email)
    .limit(25);
  if (error) throw new Error(`customers lookup failed: ${error.message}`);
  const rows = (data ?? []) as CustomerRow[];
  return rows.find((row) => matchesEmail(row, email)) ?? null;
}

async function isSuppressed(
  sb: SupabaseClient,
  email: string,
  marketing: boolean
): Promise<SuppressionRow | null> {
  const { data, error } = await sb
    .from("suppression_list")
    .select("email,channel,scope,reason")
    .ilike("email", email)
    .limit(50);
  if (error) throw new Error(`suppression lookup failed: ${error.message}`);

  const rows = (data ?? []) as SuppressionRow[];
  return (
    rows.find(
      (row) =>
        matchesEmail(row, email) &&
        (row.channel === "email" || row.channel === "both") &&
        (row.scope === "all" || marketing)
    ) ?? null
  );
}

async function countRecentMarketing(
  sb: SupabaseClient,
  email: string
): Promise<number> {
  const since = new Date(Date.now() - FREQUENCY_WINDOW_MS).toISOString();
  const { count, error } = await sb
    .from(SEND_LOG)
    .select("id", { count: "exact", head: true })
    .ilike("email", email)
    .eq("scope", "marketing")
    .eq("status", "sent")
    .gte("sent_at", since);
  if (error) throw new Error(`frequency lookup failed: ${error.message}`);
  return count ?? 0;
}

/**
 * Reads the live enrollment source of truth, Firestore `email_sequences/{uid}`.
 * TODO(phase-6b): move enrollment into Postgres (`outbound_flow_enrollment` is
 * created but empty) and drop the Firestore read.
 */
async function activeFlowsFor(email: string, raw: string): Promise<string[]> {
  const candidates = raw === email ? [email] : [email, raw];
  const snap = await adminDb
    .collection("email_sequences")
    .where("email", "in", candidates)
    .where("status", "==", "active")
    .get();
  return snap.docs
    .map((doc) => (doc.data() as { flow?: unknown }).flow)
    .filter((flow): flow is string => typeof flow === "string");
}

/**
 * Unknown *incoming* flows get the lowest priority so they cannot evict an
 * established enrollment; unknown *established* flows get the highest, so an
 * unrecognised enrollment still blocks. Both directions favour not sending.
 */
async function checkFlowExclusivity(
  req: GateRequest,
  email: string
): Promise<GateDecision | null> {
  const active = await activeFlowsFor(email, req.to.trim());
  const incoming = req.flow ? (FLOW_PRIORITY[req.flow] ?? LOWEST_PRIORITY) : LOWEST_PRIORITY;

  for (const flow of active) {
    if (flow === req.flow) continue;
    const established = FLOW_PRIORITY[flow] ?? 1;
    if (established <= incoming) {
      return {
        allowed: false,
        reason: "wrong_flow",
        detail: `active flow "${flow}" outranks "${req.flow ?? "unknown"}"`,
      };
    }
  }
  return null;
}

/**
 * A broken database must never block a password reset and must never let a
 * blast through. Lifecycle sits with campaign: it is marketing, so it fails
 * closed too.
 */
function failureDecision(req: GateRequest, err: unknown): GateDecision {
  const detail = err instanceof Error ? err.message : String(err);
  if (req.sendClass === "transactional") {
    console.error(
      `[email/gate] FAIL-OPEN: gate unavailable, allowing transactional send to ${req.to}:`,
      detail
    );
    return { allowed: true, detail };
  }
  console.error(
    `[email/gate] FAIL-CLOSED: gate unavailable, blocking ${req.sendClass} send to ${req.to}:`,
    detail
  );
  return { allowed: false, reason: "gate_unavailable", detail };
}

async function evaluate(
  req: GateRequest
): Promise<{ decision: GateDecision; ctx: GateContext | null }> {
  const email = normaliseEmail(req.to ?? "");
  if (!email) {
    return {
      decision: { allowed: false, reason: "suppressed", detail: "empty recipient" },
      ctx: null,
    };
  }

  const marketing = isMarketing(req.sendClass);
  let ctx: GateContext | null = null;

  try {
    const sb = getSupabaseService();

    const suppression = await isSuppressed(sb, email, marketing);
    if (suppression) {
      return {
        decision: {
          allowed: false,
          reason: "suppressed",
          detail: `${suppression.channel}/${suppression.scope}${
            suppression.reason ? `: ${suppression.reason}` : ""
          }`,
        },
        ctx: { sb, email, customer: null },
      };
    }

    const customer = await loadCustomer(sb, email);
    ctx = { sb, email, customer };

    if (marketing) {
      if (customer?.accepts_email_marketing === false) {
        return { decision: { allowed: false, reason: "no_consent" }, ctx };
      }
      if (customer && customer.accepts_email_marketing === null) {
        console.warn(
          `[email/gate] unknown marketing consent for ${email}, treating as allowed`
        );
      }

      const recent = await countRecentMarketing(sb, email);
      if (recent >= MARKETING_SENDS_PER_WEEK) {
        return {
          decision: {
            allowed: false,
            reason: "frequency_cap",
            detail: `${recent} marketing sends in the trailing 7 days`,
          },
          ctx,
        };
      }
    }
  } catch (err) {
    return { decision: failureDecision(req, err), ctx };
  }

  if (req.sendClass === "lifecycle") {
    try {
      const denied = await checkFlowExclusivity(req, email);
      if (denied) return { decision: denied, ctx };
    } catch (err) {
      return { decision: failureDecision(req, err), ctx };
    }
  }

  return { decision: { allowed: true }, ctx };
}

/**
 * Evaluates the gate without sending or logging anything. Callers that want
 * the enforcement and the audit trail should use {@link gatedSend}.
 */
export async function checkSend(req: GateRequest): Promise<GateDecision> {
  return (await evaluate(req)).decision;
}

function baseRow(req: GateRequest, ctx: GateContext) {
  // `id` is GENERATED ALWAYS AS IDENTITY on both send_log and send_event —
  // supplying it (even as null) makes Postgres reject the insert.
  return {
    entity: "mully",
    channel: "email",
    provider: "resend",
    scope: scopeFor(req.sendClass),
    email: ctx.email,
    customer_id: ctx.customer?.id ?? null,
    template_key: templateKeyFor(req),
    step_index: req.step ?? null,
    campaign_id: req.campaignId ?? null,
  };
}

async function logDenial(
  req: GateRequest,
  ctx: GateContext,
  decision: GateDecision
): Promise<void> {
  const { error } = await ctx.sb.from(SEND_LOG).insert({
    ...baseRow(req, ctx),
    // send_log.status has no value for a consent or cap denial and widening
    // the CHECK needs a migration, so every denial lands here and the real
    // reason goes in `error`.
    status: "skipped_suppressed",
    error: decision.reason,
    sent_at: null,
  });
  if (error) {
    console.error(`[email/gate] failed to log denial for ${ctx.email}:`, error.message);
  }
}

type Claim =
  | { status: "claimed"; sendLogId: number }
  | { status: "duplicate" }
  | { status: "unlogged" };

async function claimSend(req: GateRequest, ctx: GateContext): Promise<Claim> {
  const { data, error } = await ctx.sb
    .from(SEND_LOG)
    .insert({
      ...baseRow(req, ctx),
      status: "queued",
      sent_at: null,
      dedupe_key: dedupeKeyFor(req, ctx.email),
    })
    .select("id")
    .single();

  if (error) {
    if (error.code === PG_UNIQUE_VIOLATION) return { status: "duplicate" };
    console.error(`[email/gate] failed to claim send for ${ctx.email}:`, error.message);
    return { status: "unlogged" };
  }
  return { status: "claimed", sendLogId: (data as { id: number }).id };
}

async function settleSend(
  ctx: GateContext,
  sendLogId: number,
  outcome:
    | { status: "sent"; providerMessageId: string | null }
    | { status: "failed"; error: string }
): Promise<void> {
  const patch =
    outcome.status === "sent"
      ? {
          status: "sent",
          sent_at: new Date().toISOString(),
          provider_message_id: outcome.providerMessageId,
        }
      : {
          status: "failed",
          error: outcome.error.slice(0, 500),
          // Release the claim so a later retry can take it again.
          dedupe_key: null,
        };

  const { error } = await ctx.sb.from(SEND_LOG).update(patch).eq("id", sendLogId);
  if (error) {
    console.error(
      `[email/gate] failed to settle send_log ${sendLogId} as ${outcome.status}:`,
      error.message
    );
  }
}

/**
 * Runs `send` only if the gate allows it and this process wins the claim on
 * `dedupe_key`. Returns the provider message id, or null when the send was
 * denied or already claimed elsewhere. Provider errors are settled as
 * `failed` and rethrown so existing callers keep their error handling.
 */
export async function gatedSend(
  req: GateRequest,
  send: () => Promise<string | null>
): Promise<string | null> {
  const { decision, ctx } = await evaluate(req);

  if (!decision.allowed) {
    console.warn(
      `[email/gate] denied ${req.sendClass} send to ${req.to}: ${decision.reason}` +
        (decision.detail ? ` (${decision.detail})` : "")
    );
    if (ctx && decision.reason !== "gate_unavailable") {
      await logDenial(req, ctx, decision);
    }
    return null;
  }

  if (!ctx) {
    // Fail-open transactional send with no usable database connection.
    console.error(
      `[email/gate] sending to ${req.to} WITHOUT a send_log record — database unavailable`
    );
    return send();
  }

  const claim = await claimSend(req, ctx);
  if (claim.status === "duplicate") {
    console.warn(
      `[email/gate] duplicate send suppressed for ${ctx.email} (dedupe_key already claimed)`
    );
    return null;
  }
  if (claim.status === "unlogged") {
    if (req.sendClass !== "transactional") {
      console.error(
        `[email/gate] FAIL-CLOSED: could not claim send_log row for ${req.sendClass} send to ${ctx.email}`
      );
      return null;
    }
    console.error(
      `[email/gate] sending to ${ctx.email} WITHOUT a send_log record — claim insert failed`
    );
    return send();
  }

  let providerMessageId: string | null;
  try {
    providerMessageId = await send();
  } catch (err) {
    await settleSend(ctx, claim.sendLogId, {
      status: "failed",
      error: err instanceof Error ? err.message : String(err),
    });
    throw err;
  }

  await settleSend(ctx, claim.sendLogId, { status: "sent", providerMessageId });
  return providerMessageId;
}
