/**
 * GET /api/admin/diagnostics/firestore-inventory
 *
 * Read-only Firestore inventory. Enumerates every root collection, counts the
 * documents in each with a server-side aggregate, and returns one heavily
 * redacted sample document from `users`, `styleProfiles`, and `email_sequences`
 * so the shape can be inspected without exporting data.
 *
 * Why this exists: the external Firebase Admin connector is currently broken
 * (`admin.app is not a function`), so Firestore is unreadable from outside this
 * app. This route reuses the app's own proven credential resolution
 * (`@/lib/firebase-admin`) rather than re-initializing anything.
 *
 * STRICTLY READ-ONLY. This handler performs only `listCollections()`,
 * `count().get()`, projected `select(...).get()` reads, and `limit(1).get()` on
 * Firestore, plus `select()` on Supabase. There is deliberately no `set`, `add`,
 * `update`, `delete`, `create`, `insert`, `upsert`, batch, or transaction
 * anywhere in this file, against either datastore.
 *
 * Not a cron — do NOT add it to vercel.json. Invoke on demand.
 *
 * Auth: CRON_SECRET Bearer, matching the guard used by the admin cron routes
 * (e.g. src/app/api/admin/cron/repair-backfill-onboarding/route.ts:45-49).
 *
 * ── Modes ────────────────────────────────────────────────────────────────────
 *
 * (default) Collection inventory.
 *   ?samples=0   Skip the sample documents; return names + counts only.
 *
 * ?mode=quiz-audit
 *   Scopes the stranded-quiz-respondent backfill. Reports the styleProfiles
 *   status/email breakdown, how many of those emails are absent from
 *   `public.customers`, and the email_sequences ⇄ styleProfiles id gap.
 *
 *   ?emails=1    Include the actual backfill email list. PII — default OFF.
 *   ?chunk=300   Supabase `.in()` batch size (default 300, clamped 50-500).
 *   ?page=500    Firestore page size (default 500, clamped 100-1000).
 */

import { NextRequest, NextResponse } from "next/server";
import { FieldPath, type Query } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// quiz-audit reads ~6,300 projected Firestore docs plus chunked Supabase
// lookups. The default inventory mode finishes in seconds regardless.
export const maxDuration = 300;

const SAMPLE_COLLECTIONS = ["users", "styleProfiles", "email_sequences"];

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

/**
 * Field-name redaction policy.
 *
 * Sample documents exist to reveal SHAPE, never content. Any field whose name
 * suggests identity or credentials is replaced with a type descriptor plus a
 * minimal masked hint — enough to tell "this is a populated email" from "this
 * is null" without exposing the value. Everything else (status enums, style
 * buckets, sizes, booleans, counters, timestamps) is returned in full, because
 * those are the fields a shape audit actually needs and they carry no PII.
 *
 * The check is on the FIELD NAME, not the value, and it is deliberately broad:
 * an unrecognised field is only returned verbatim if it is a primitive, and
 * long strings are truncated regardless. When in doubt this errs toward
 * redacting.
 */
const SENSITIVE_NAME = /(email|phone|mobile|tel|name|address|street|city|zip|postal|token|secret|key|password|auth|ip\b|user_agent|useragent)/i;

/** Enum-ish / structural names that are safe even though they contain "name". */
const SAFE_NAME_EXCEPTIONS = /^(collection_?name|job_?name|event_?name|flow_?name|template_?name|display_?type)$/i;

const MAX_STRING = 64;
const MAX_ARRAY_SAMPLE = 5;
const MAX_DEPTH = 4;

function maskEmail(value: string): string {
  const at = value.indexOf("@");
  if (at <= 0) return `${value.slice(0, 1)}***`;
  const local = value.slice(0, at);
  const domain = value.slice(at + 1);
  const dot = domain.lastIndexOf(".");
  const tld = dot > 0 ? domain.slice(dot) : "";
  return `${local.slice(0, 1)}***@${domain.slice(0, 1)}***${tld}`;
}

function maskString(field: string, value: string): string {
  if (!value) return "<string, empty>";
  if (value.includes("@")) return `<string, masked: ${maskEmail(value)}>`;
  if (/(phone|mobile|tel)/i.test(field)) {
    const digits = value.replace(/\D/g, "");
    return `<string, masked: ***${digits.slice(-2)}, ${digits.length} digits>`;
  }
  if (/(token|secret|key|password|auth)/i.test(field)) {
    return `<string, redacted, length ${value.length}>`;
  }
  return `<string, masked: ${value.slice(0, 1)}***, length ${value.length}>`;
}

function describe(value: unknown): string {
  if (value === null) return "<null>";
  if (Array.isArray(value)) return `<array, length ${value.length}>`;
  if (value instanceof Date) return "<timestamp>";
  return `<${typeof value}>`;
}

function isTimestampLike(value: unknown): boolean {
  if (value instanceof Date) return true;
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  return typeof v._seconds === "number" || typeof v.seconds === "number";
}

function redactValue(field: string, value: unknown, depth: number): unknown {
  if (value === null || value === undefined) return null;

  const sensitive =
    SENSITIVE_NAME.test(field) && !SAFE_NAME_EXCEPTIONS.test(field);

  if (isTimestampLike(value)) return "<timestamp>";

  if (typeof value === "string") {
    if (sensitive) return maskString(field, value);
    return value.length > MAX_STRING
      ? `<string, length ${value.length}, truncated: ${value.slice(0, MAX_STRING)}…>`
      : value;
  }

  if (typeof value === "boolean" || typeof value === "number") {
    return sensitive ? describe(value) : value;
  }

  if (Array.isArray(value)) {
    if (depth >= MAX_DEPTH) return `<array, length ${value.length}>`;
    return {
      __length: value.length,
      __sample: value
        .slice(0, MAX_ARRAY_SAMPLE)
        .map((item) => redactValue(field, item, depth + 1)),
    };
  }

  if (typeof value === "object") {
    if (depth >= MAX_DEPTH) return "<object>";
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = redactValue(k, v, depth + 1);
    }
    return out;
  }

  return describe(value);
}

function redactDoc(data: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    out[k] = redactValue(k, v, 0);
  }
  return out;
}

interface CollectionReport {
  name: string;
  count: number | null;
  error: string | null;
}

// ─── quiz-audit ───────────────────────────────────────────────────────────────

/**
 * Wall-clock budget. maxDuration is 300s; we stop at 270s so there is room to
 * serialize and return partial results. Every long loop checks this and sets
 * `truncated: true` rather than being killed mid-flight — a silently short list
 * would under-scope the backfill, which is the one failure mode that matters.
 */
const AUDIT_BUDGET_MS = 270_000;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normEmail(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const e = raw.trim().toLowerCase();
  return e.length > 0 ? e : null;
}

function clampInt(raw: string | null, dflt: number, lo: number, hi: number) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
}

function bump(map: Record<string, number>, key: string) {
  map[key] = (map[key] ?? 0) + 1;
}

/**
 * Pages a Firestore query ordered by document id, invoking `onDoc` per doc.
 *
 * Always a PROJECTED read — callers pass the field list, so full documents are
 * never downloaded. Ordering by documentId() gives a stable, index-free cursor.
 */
async function paginateDocs(
  collection: string,
  fields: string[],
  pageSize: number,
  deadline: number,
  onDoc: (id: string, data: Record<string, unknown>) => void
): Promise<{ scanned: number; truncated: boolean }> {
  let scanned = 0;
  let cursor: string | null = null;

  for (;;) {
    if (Date.now() > deadline) return { scanned, truncated: true };

    let q: Query = adminDb
      .collection(collection)
      .orderBy(FieldPath.documentId())
      .limit(pageSize);
    // select() with no arguments returns ids only — no field data at all.
    q = fields.length > 0 ? q.select(...fields) : q.select();
    if (cursor !== null) q = q.startAfter(cursor);

    const snap = await q.get();
    if (snap.empty) return { scanned, truncated: false };

    for (const doc of snap.docs) {
      onDoc(doc.id, doc.data() as Record<string, unknown>);
      scanned++;
    }

    cursor = snap.docs[snap.docs.length - 1].id;
    if (snap.size < pageSize) return { scanned, truncated: false };
  }
}

interface PresenceResult {
  checked: number;
  found: Set<string>;
  truncated: boolean;
  method: string;
  error: string | null;
}

/**
 * Partitions `emails` (already lowercased + deduped) by presence in
 * `public.customers`, matching case-insensitively.
 *
 * SCHEMA QUALIFICATION IS DELIBERATE. `.schema("public")` is explicit because
 * this database also has an `analytics_analytics.customers`; conflating the two
 * has already produced a phantom-column bug in this project.
 *
 * Two strategies:
 *
 *   chunked (default) — `.in()` over the lowercased value AND the original
 *     as-typed variant. Exact equality only: no ilike, because `_` and `%` are
 *     ilike wildcards and a stored `a_b@x.com` would spuriously match `axb@x.com`,
 *     reporting someone as PRESENT who is not. That under-scopes the backfill,
 *     which is the dangerous direction. Exact matching can only err the other
 *     way — reporting an odd-cased row as absent — and over-scoping is safe.
 *
 *   fullscan (?fullscan=1) — pages the entire customers.email column and
 *     compares lowercased sets in memory. Authoritative and immune to the case
 *     caveat above; costs one full column read.
 *
 * Both paths SELECT ONLY the email column and perform no writes.
 */
async function partitionByCustomers(
  emails: string[],
  originalCase: Map<string, string>,
  chunkSize: number,
  deadline: number,
  fullscan: boolean
): Promise<PresenceResult> {
  const found = new Set<string>();
  let sb: ReturnType<typeof getSupabaseService>;
  try {
    sb = getSupabaseService();
  } catch (err) {
    return {
      checked: emails.length,
      found,
      truncated: false,
      method: "none",
      error: err instanceof Error ? err.message : String(err),
    };
  }

  const table = () => sb.schema("public").from("customers");

  if (fullscan) {
    const PAGE = 1000;
    for (let offset = 0; ; offset += PAGE) {
      if (Date.now() > deadline) {
        return {
          checked: emails.length,
          found,
          truncated: true,
          method: "fullscan",
          error: null,
        };
      }
      const { data, error } = await table()
        .select("email")
        .range(offset, offset + PAGE - 1);
      if (error) {
        return {
          checked: emails.length,
          found,
          truncated: true,
          method: "fullscan",
          error: error.message,
        };
      }
      if (!data || data.length === 0) break;
      for (const row of data) {
        const e = normEmail((row as { email: unknown }).email);
        if (e) found.add(e);
      }
      if (data.length < PAGE) break;
    }
    // Intersect the full customer set down to just the emails we asked about.
    const relevant = new Set<string>();
    for (const e of emails) if (found.has(e)) relevant.add(e);
    return {
      checked: emails.length,
      found: relevant,
      truncated: false,
      method: "fullscan",
      error: null,
    };
  }

  for (let i = 0; i < emails.length; i += chunkSize) {
    if (Date.now() > deadline) {
      return {
        checked: i,
        found,
        truncated: true,
        method: "chunked",
        error: null,
      };
    }
    const slice = emails.slice(i, i + chunkSize);
    const variants = new Set<string>();
    for (const e of slice) {
      variants.add(e);
      const orig = originalCase.get(e);
      if (orig && orig !== e) variants.add(orig);
    }

    const { data, error } = await table()
      .select("email")
      .in("email", [...variants]);

    if (error) {
      return {
        checked: i,
        found,
        truncated: true,
        method: "chunked",
        error: error.message,
      };
    }
    for (const row of data ?? []) {
      const e = normEmail((row as { email: unknown }).email);
      if (e) found.add(e);
    }
  }

  return {
    checked: emails.length,
    found,
    truncated: false,
    method: "chunked",
    error: null,
  };
}

interface BackfillEntry {
  email: string;
  firstName: string | null;
  profileId: string;
  source: "styleProfiles" | "email_sequences";
  profileIdIsUuid: boolean;
}

async function runQuizAudit(req: NextRequest, startedAt: number) {
  const sp = req.nextUrl.searchParams;
  const includeEmails = sp.get("emails") === "1";
  const chunkSize = clampInt(sp.get("chunk"), 300, 50, 500);
  const pageSize = clampInt(sp.get("page"), 500, 100, 1000);
  const fullscan = sp.get("fullscan") === "1";
  const deadline = startedAt + AUDIT_BUDGET_MS;

  const errors: Record<string, string> = {};
  let truncated = false;
  const stoppedAt: string[] = [];

  // ── (a) styleProfiles breakdown ────────────────────────────────────────────
  const statusDistribution: Record<string, number> = {};
  const spEmails = new Map<string, string>(); // lowercased -> as-stored
  const spEmailToProfileId = new Map<string, string>();
  const spIds = new Set<string>();
  let spWithEmail = 0;
  let spWithoutEmail = 0;
  let spCompletedWithEmail = 0;
  let spTotalAggregate: number | null = null;

  try {
    const agg = await adminDb.collection("styleProfiles").count().get();
    spTotalAggregate = agg.data().count;
  } catch (err) {
    errors.styleProfilesCount = err instanceof Error ? err.message : String(err);
  }

  let spScan = { scanned: 0, truncated: false };
  try {
    spScan = await paginateDocs(
      "styleProfiles",
      ["status", "email"],
      pageSize,
      deadline,
      (id, data) => {
        spIds.add(id);
        const status =
          typeof data.status === "string" ? data.status : "<missing>";
        bump(statusDistribution, status);

        const email = normEmail(data.email);
        if (email) {
          spWithEmail++;
          if (status === "completed") spCompletedWithEmail++;
          if (!spEmails.has(email)) {
            spEmails.set(email, String(data.email));
            spEmailToProfileId.set(email, id);
          }
        } else {
          spWithoutEmail++;
        }
      }
    );
  } catch (err) {
    errors.styleProfilesScan = err instanceof Error ? err.message : String(err);
    truncated = true;
    stoppedAt.push("styleProfiles scan threw");
  }
  if (spScan.truncated) {
    truncated = true;
    stoppedAt.push(`styleProfiles scan hit the time budget after ${spScan.scanned} docs`);
  }

  // ── (c) email_sequences ⇄ styleProfiles id gap ─────────────────────────────
  // Projected read of 4 small fields rather than two passes. Firestore bills a
  // document read either way, so a projection costs the same as ids-only while
  // supplying everything the sequence-only analysis needs in a single pass.
  const seqOnly: Array<{
    id: string;
    email: string | null;
    firstName: string | null;
    flow: string;
    status: string;
  }> = [];
  const seqIds = new Set<string>();
  const seqFirstNameByEmail = new Map<string, string>();
  let seqTotalAggregate: number | null = null;

  try {
    const agg = await adminDb.collection("email_sequences").count().get();
    seqTotalAggregate = agg.data().count;
  } catch (err) {
    errors.emailSequencesCount = err instanceof Error ? err.message : String(err);
  }

  let seqScan = { scanned: 0, truncated: false };
  try {
    seqScan = await paginateDocs(
      "email_sequences",
      ["email", "firstName", "flow", "status"],
      pageSize,
      deadline,
      (id, data) => {
        seqIds.add(id);
        const email = normEmail(data.email);
        const firstName =
          typeof data.firstName === "string" && data.firstName.trim()
            ? data.firstName.trim()
            : null;
        if (email && firstName && !seqFirstNameByEmail.has(email)) {
          seqFirstNameByEmail.set(email, firstName);
        }
        if (!spIds.has(id)) {
          seqOnly.push({
            id,
            email,
            firstName,
            flow: typeof data.flow === "string" ? data.flow : "<missing>",
            status: typeof data.status === "string" ? data.status : "<missing>",
          });
        }
      }
    );
  } catch (err) {
    errors.emailSequencesScan = err instanceof Error ? err.message : String(err);
    truncated = true;
    stoppedAt.push("email_sequences scan threw");
  }
  if (seqScan.truncated) {
    truncated = true;
    stoppedAt.push(`email_sequences scan hit the time budget after ${seqScan.scanned} docs`);
  }

  let profileOnlyCount = 0;
  for (const id of spIds) if (!seqIds.has(id)) profileOnlyCount++;

  const seqOnlyFlow: Record<string, number> = {};
  const seqOnlyStatus: Record<string, number> = {};
  const seqOnlyIdShape: Record<string, number> = {};
  const seqOnlyFlowByIdShape: Record<string, Record<string, number>> = {};
  const seqOnlyEmails = new Map<string, string>();
  const seqOnlyEmailToId = new Map<string, string>();
  let seqOnlyWithEmail = 0;

  for (const s of seqOnly) {
    bump(seqOnlyFlow, s.flow);
    bump(seqOnlyStatus, s.status);
    // The discriminator for Part 2: a 36-char UUID id means the doc was keyed
    // by a styleProfiles profileId (quiz path); anything else means it was
    // keyed by a Firebase Auth uid (paid-member path), which never creates a
    // styleProfiles doc at all.
    const shape = UUID_RE.test(s.id) ? "uuid" : `other(len=${s.id.length})`;
    bump(seqOnlyIdShape, shape);
    (seqOnlyFlowByIdShape[shape] ??= {});
    bump(seqOnlyFlowByIdShape[shape], s.flow);

    if (s.email) {
      seqOnlyWithEmail++;
      if (!seqOnlyEmails.has(s.email)) {
        seqOnlyEmails.set(s.email, s.email);
        seqOnlyEmailToId.set(s.email, s.id);
      }
    }
  }

  let seqOnlyEmailsNotInProfiles = 0;
  for (const e of seqOnlyEmails.keys()) if (!spEmails.has(e)) seqOnlyEmailsNotInProfiles++;

  // ── (b) + (d) Postgres presence ────────────────────────────────────────────
  const unionOriginal = new Map<string, string>();
  for (const [lower, orig] of spEmails) unionOriginal.set(lower, orig);
  for (const [lower, orig] of seqOnlyEmails) if (!unionOriginal.has(lower)) unionOriginal.set(lower, orig);

  const unionEmails = [...unionOriginal.keys()].sort();
  const presence = await partitionByCustomers(
    unionEmails,
    unionOriginal,
    chunkSize,
    deadline,
    fullscan
  );
  if (presence.error) errors.supabase = presence.error;
  if (presence.truncated) {
    truncated = true;
    stoppedAt.push(`Supabase presence check stopped after ${presence.checked} of ${unionEmails.length} emails`);
  }

  const spEmailList = [...spEmails.keys()];
  const spFound = spEmailList.filter((e) => presence.found.has(e)).length;
  const seqOnlyEmailList = [...seqOnlyEmails.keys()];
  const seqOnlyAbsent = seqOnlyEmailList.filter((e) => !presence.found.has(e)).length;

  const unionAbsent: BackfillEntry[] = [];
  for (const email of unionEmails) {
    if (presence.found.has(email)) continue;
    const fromProfile = spEmailToProfileId.get(email);
    const profileId = fromProfile ?? seqOnlyEmailToId.get(email) ?? "";
    unionAbsent.push({
      email,
      firstName: seqFirstNameByEmail.get(email) ?? null,
      profileId,
      source: fromProfile ? "styleProfiles" : "email_sequences",
      profileIdIsUuid: UUID_RE.test(profileId),
    });
  }

  return NextResponse.json({
    diagnostic: "firestore-inventory",
    mode: "quiz-audit",
    readOnly: true,
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    truncated,
    stoppedAt: stoppedAt.length > 0 ? stoppedAt : null,
    errors: Object.keys(errors).length > 0 ? errors : null,
    params: { includeEmails, chunkSize, pageSize, fullscan },

    styleProfiles: {
      totalFromAggregate: spTotalAggregate,
      totalScanned: spScan.scanned,
      completedWithEmail: spCompletedWithEmail,
      withEmailAnyStatus: spWithEmail,
      withoutEmail: spWithoutEmail,
      distinctEmails: spEmails.size,
      statusDistribution,
    },

    absentFromCustomers: {
      matchMethod: presence.method,
      distinctEmailsChecked: spEmailList.length,
      foundInCustomers: spFound,
      absentFromCustomers: spEmailList.length - spFound,
    },

    sequenceGap: {
      emailSequencesTotal: seqTotalAggregate,
      emailSequencesScanned: seqScan.scanned,
      styleProfilesScanned: spScan.scanned,
      sequenceOnlyCount: seqOnly.length,
      profileOnlyCount,
      sequenceOnlyEquals977: seqOnly.length === 977,
      sequenceOnlyWithEmail: seqOnlyWithEmail,
      sequenceOnlyDistinctEmails: seqOnlyEmails.size,
      sequenceOnlyEmailsNotInStyleProfiles: seqOnlyEmailsNotInProfiles,
      sequenceOnlyAbsentFromCustomers: seqOnlyAbsent,
      flowDistribution: seqOnlyFlow,
      statusDistribution: seqOnlyStatus,
      docIdShapeDistribution: seqOnlyIdShape,
      flowByDocIdShape: seqOnlyFlowByIdShape,
    },

    // Always present so the backfill can be sized without exposing addresses.
    unionAbsentCount: unionAbsent.length,
    unionAbsent: includeEmails ? unionAbsent : null,

    notes: [
      "READ-ONLY. Firestore: count() aggregates and projected select() reads. Supabase: select() only.",
      "public.customers is schema-qualified explicitly — analytics_analytics.customers is a different table.",
      includeEmails
        ? "unionAbsent CONTAINS RAW EMAIL ADDRESSES because ?emails=1 was passed. Handle as PII."
        : "unionAbsent is withheld. Pass ?emails=1 to include the raw address list (PII).",
      "profileId is the styleProfiles doc id when source=styleProfiles, otherwise the email_sequences doc id. Check profileIdIsUuid before writing it to customer_style_profile.source_profile_id — a non-UUID id is a Firebase Auth uid, not a profile id.",
      presence.method === "chunked"
        ? "Chunked exact matching on lowercased + as-typed variants. A customers row stored in some third casing would be reported absent; that over-scopes rather than under-scopes. Pass ?fullscan=1 for an authoritative case-insensitive comparison."
        : "Full-column scan of customers.email, compared as lowercased sets. Authoritative for case-insensitivity.",
      truncated
        ? "TRUNCATED — results are partial and WILL under-scope the backfill. See stoppedAt. Do not use this run as the backfill source."
        : "Complete run: both collections fully scanned and every email checked.",
    ],
  });
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAtGlobal = Date.now();
  if (req.nextUrl.searchParams.get("mode") === "quiz-audit") {
    try {
      return await runQuizAudit(req, startedAtGlobal);
    } catch (err) {
      return NextResponse.json(
        {
          diagnostic: "firestore-inventory",
          mode: "quiz-audit",
          readOnly: true,
          truncated: true,
          error: "quiz-audit failed",
          detail: err instanceof Error ? err.message : String(err),
          elapsedMs: Date.now() - startedAtGlobal,
        },
        { status: 500 }
      );
    }
  }

  const includeSamples = req.nextUrl.searchParams.get("samples") !== "0";
  const startedAt = Date.now();

  let collectionNames: string[];
  try {
    const refs = await adminDb.listCollections();
    collectionNames = refs.map((c) => c.id).sort();
  } catch (err) {
    return NextResponse.json(
      {
        error: "listCollections failed",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 }
    );
  }

  // One try/catch per collection: a single failing count must not abort the
  // report. On failure we record null + the error string and move on — we
  // never fall back to reading every document, which would be slow and costly.
  const collections: CollectionReport[] = [];
  for (const name of collectionNames) {
    try {
      const agg = await adminDb.collection(name).count().get();
      collections.push({ name, count: agg.data().count, error: null });
    } catch (err) {
      collections.push({
        name,
        count: null,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const samples: Record<string, unknown> = {};
  if (includeSamples) {
    for (const name of SAMPLE_COLLECTIONS) {
      try {
        const snap = await adminDb.collection(name).limit(1).get();
        if (snap.empty) {
          samples[name] = { present: false, note: "collection empty or absent" };
          continue;
        }
        const doc = snap.docs[0];
        samples[name] = {
          present: true,
          docIdShape: {
            length: doc.id.length,
            looksLikeUuid:
              /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
                doc.id
              ),
            looksLikeEmail: doc.id.includes("@"),
          },
          fields: redactDoc(doc.data() as Record<string, unknown>),
        };
      } catch (err) {
        samples[name] = {
          present: false,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  return NextResponse.json({
    diagnostic: "firestore-inventory",
    readOnly: true,
    generatedAt: new Date().toISOString(),
    elapsedMs: Date.now() - startedAt,
    collectionCount: collections.length,
    collections,
    samples: includeSamples ? samples : null,
    notes: [
      "Counts come from Firestore count() aggregates, not document reads.",
      "Sample documents are field-name redacted; identity fields are masked.",
      "listCollections() returns root collections only — subcollections such as communityPosts/{id}/comments are not enumerated here.",
    ],
  });
}
