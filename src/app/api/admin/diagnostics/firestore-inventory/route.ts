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
 * `count().get()`, and `limit(1).get()`. There is deliberately no `set`, `add`,
 * `update`, `delete`, `create`, batch, or transaction anywhere in this file.
 *
 * Not a cron — do NOT add it to vercel.json. Invoke on demand.
 *
 * Auth: CRON_SECRET Bearer, matching the guard used by the admin cron routes
 * (e.g. src/app/api/admin/cron/repair-backfill-onboarding/route.ts:45-49).
 *
 * Query params (all optional):
 *   ?samples=0   Skip the sample documents; return names + counts only.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

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

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
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
