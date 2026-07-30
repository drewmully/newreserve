/**
 * The persistence core of the event backbone.
 *
 * Every path into `public.inbound_event` goes through here: the front door, the
 * mirror calls bolted onto the three legacy Shopify routes, the reconciler and
 * manual replay. Persist first, resolve second — always in that order, so that
 * an event we cannot understand is still an event we can replay.
 */

import crypto from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { raiseAlert } from "./alert";
import { resolveIdentity, type Resolution } from "./resolve-identity";
import { canonicalEventFor, UNKNOWN_EVENT, type EventName, type EventSource } from "./catalog";

export interface PersistInput {
  source: EventSource;
  sourceEventId: string;
  sourceTopic: string | null;
  eventName: EventName;
  payload: unknown;
  /** Byte length of the raw body, recorded so the metric survives payload purge. */
  payloadBytes?: number;
}

export interface PersistResult {
  id: number | null;
  duplicate: boolean;
}

/** Postgres unique_violation. */
const UNIQUE_VIOLATION = "23505";

/**
 * Deterministic id for providers that do not supply one. The same logical
 * event hashes to the same value, so a reconciler-synthesised row and a real
 * webhook that arrives later collapse onto one row via the unique index.
 */
export function deterministicEventId(...parts: (string | number | null | undefined)[]): string {
  const material = parts.map((p) => (p === null || p === undefined ? "" : String(p))).join("|");
  return crypto.createHash("sha256").update(material, "utf8").digest("hex").slice(0, 40);
}

export function byteLength(raw: string): number {
  return Buffer.byteLength(raw, "utf8");
}

/**
 * Inserts the raw event. A duplicate delivery hits
 * inbound_event_source_dedupe_idx and is reported as `duplicate`, which the
 * caller treats as success — that is the whole idempotency mechanism, and it is
 * database-enforced rather than read-then-write.
 */
export async function persistInboundEvent(
  input: PersistInput,
  client?: SupabaseClient,
): Promise<PersistResult> {
  const sb = client ?? getSupabaseService();

  const { data, error } = await sb
    .from("inbound_event")
    .insert({
      source: input.source,
      source_event_id: input.sourceEventId,
      source_topic: input.sourceTopic,
      event_name: input.eventName,
      payload: input.payload ?? null,
      payload_bytes: input.payloadBytes ?? null,
      resolution: "pending",
    })
    .select("id")
    .single();

  if (error) {
    if ((error as { code?: string }).code === UNIQUE_VIOLATION) {
      return { id: null, duplicate: true };
    }
    throw new Error(`inbound_event insert failed: ${error.message}`);
  }

  return { id: (data as { id: number }).id, duplicate: false };
}

interface ProcessInput {
  id: number;
  source: EventSource;
  eventName: EventName;
  payload: unknown;
}

/**
 * Resolves identity for an already-persisted row and writes the outcome back.
 *
 * Never throws: a failure is recorded on the row (error + attempts) so the
 * reconciler can retry it, because a thrown error here would be a silent drop.
 */
export async function processInboundEvent(
  input: ProcessInput,
  client?: SupabaseClient,
): Promise<{ resolution: Resolution; customerId: string | null }> {
  const sb = client ?? getSupabaseService();

  try {
    if (input.eventName === UNKNOWN_EVENT) {
      await sb
        .from("inbound_event")
        .update({
          resolution: "unresolvable",
          resolution_detail: "unknown_topic",
          processed_at: new Date().toISOString(),
          attempts: await bumpAttempts(sb, input.id),
        })
        .eq("id", input.id);
      return { resolution: "unresolvable", customerId: null };
    }

    const result = await resolveIdentity({
      source: input.source,
      eventName: input.eventName,
      payload: input.payload,
      inboundEventId: input.id,
    }, sb);

    await sb
      .from("inbound_event")
      .update({
        customer_id: result.customerId,
        resolution: result.resolution,
        resolution_detail: result.detail,
        identity_hint: result.identityHint,
        processed_at: new Date().toISOString(),
        error: null,
        attempts: await bumpAttempts(sb, input.id),
      })
      .eq("id", input.id);

    return { resolution: result.resolution, customerId: result.customerId };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[events/ingest] processing failed for inbound_event ${input.id}:`, message);
    try {
      await sb
        .from("inbound_event")
        .update({
          error: message,
          processed_at: new Date().toISOString(),
          attempts: await bumpAttempts(sb, input.id),
        })
        .eq("id", input.id);
    } catch (updateErr) {
      console.error("[events/ingest] could not record processing error:", updateErr);
    }
    return { resolution: "pending", customerId: null };
  }
}

/**
 * Reads the current attempt count and returns it incremented.
 *
 * Two round-trips rather than one because PostgREST cannot express
 * `attempts = attempts + 1` in an update. A lost increment under concurrency
 * only costs an extra retry, so this is deliberately not worth a lock.
 */
async function bumpAttempts(sb: SupabaseClient, id: number): Promise<number> {
  const { data } = await sb.from("inbound_event").select("attempts").eq("id", id).maybeSingle();
  const current = (data as { attempts?: number } | null)?.attempts ?? 0;
  return current + 1;
}

/**
 * Persist + resolve, for callers that own the whole lifecycle (the reconciler
 * and replay). The front door splits these two so it can ACK between them.
 */
export async function ingestInboundEvent(
  input: PersistInput,
  client?: SupabaseClient,
): Promise<PersistResult & { resolution: Resolution | null; customerId: string | null }> {
  const persisted = await persistInboundEvent(input, client);
  if (persisted.duplicate || persisted.id === null) {
    return { ...persisted, resolution: null, customerId: null };
  }

  if (input.eventName === UNKNOWN_EVENT) {
    await raiseAlert({
      kind: "unknown_topic",
      severity: "warning",
      inboundEventId: persisted.id,
      summary: `Unrecognised ${input.source} topic "${input.sourceTopic ?? "(none)"}" recorded as unknown.`,
      detail: { source: input.source, source_topic: input.sourceTopic },
    });
  }

  const processed = await processInboundEvent(
    {
      id: persisted.id,
      source: input.source,
      eventName: input.eventName,
      payload: input.payload,
    },
    client,
  );

  return { ...persisted, ...processed };
}

/**
 * Log-only mirror for the three pre-existing Shopify webhook routes.
 *
 * Those routes keep their own behaviour exactly as it was; this call only makes
 * the event log complete from day one. It records the delivery and does not
 * resolve identity — the front door owns that.
 *
 * It swallows everything. Mirroring must never be able to break a live
 * delivery path.
 */
export async function mirrorLegacyShopifyDelivery(
  headers: { get(name: string): string | null },
  rawBody: string,
  defaultTopic: string,
): Promise<void> {
  try {
    const topic = headers.get("x-shopify-topic") ?? defaultTopic;

    let payload: unknown = null;
    try {
      payload = rawBody ? JSON.parse(rawBody) : null;
    } catch {
      payload = null;
    }

    await persistInboundEvent({
      source: "shopify",
      sourceEventId:
        headers.get("x-shopify-webhook-id") ?? deterministicEventId(topic, rawBody),
      sourceTopic: topic,
      eventName: canonicalEventFor("shopify", topic, payload),
      payload,
      payloadBytes: byteLength(rawBody),
    });
  } catch (err) {
    console.error(`[events/mirror] ${defaultTopic} mirror failed (ignored):`, err);
  }
}
