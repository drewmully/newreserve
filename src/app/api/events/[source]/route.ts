/**
 * POST /api/events/[source] — the single front door for inbound provider events.
 *
 * source ∈ shopify | loop
 *
 * Strict order of operations:
 *   1. Verify the sender. A failed check records nothing and returns 401.
 *   2. Persist the raw body before parsing anything beyond the topic.
 *   3. ACK 200 immediately — resolution runs after the response is committed,
 *      so a slow resolver can never cause a provider retry storm.
 *   4. Resolve identity and write the outcome back to the row.
 *
 * A duplicate delivery is a unique violation on
 * inbound_event_source_dedupe_idx and returns 200 without a second row. That is
 * atomic and database-enforced, unlike the read-then-write Firestore check used
 * by the legacy Shopify routes.
 *
 * This route sends nothing to anybody. It writes rows.
 *
 * Required env vars:
 *   SHOPIFY_WEBHOOK_SECRET — HMAC secret, for source=shopify
 *   LOOP_WEBHOOK_TOKEN     — shared secret, for source=loop
 */

import { NextRequest, NextResponse, after } from "next/server";
import {
  canonicalEventFor,
  isFrontDoorSource,
  UNKNOWN_EVENT,
  type EventName,
  type FrontDoorSource,
} from "@/lib/events/catalog";
import { raiseAlert } from "@/lib/events/alert";
import {
  byteLength,
  deterministicEventId,
  persistInboundEvent,
  processInboundEvent,
} from "@/lib/events/ingest";
import {
  SHOPIFY_TOPIC_HEADER,
  SHOPIFY_WEBHOOK_ID_HEADER,
  verifyLoopToken,
  verifyShopifyHmac,
} from "@/lib/events/verify";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function firstString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value)) return String(value);
  }
  return undefined;
}

/**
 * Loop's docs publish no canonical envelope, so the topic is read from the
 * handful of fields and the header it could plausibly arrive in. An
 * unrecognised shape lands as `unknown` and alerts rather than being dropped.
 */
function loopTopic(request: NextRequest, payload: unknown): string | null {
  const root = asRecord(payload);
  return (
    request.headers.get("x-loop-topic") ??
    firstString(root.topic, root.event, root.eventType, root.event_type, root.type) ??
    null
  );
}

function loopEventId(payload: unknown, topic: string | null): string {
  const root = asRecord(payload);
  const explicit = firstString(root.id, root.eventId, root.event_id);
  if (explicit) return explicit;

  const subscription = asRecord(root.subscription);
  const order = asRecord(root.order);
  return deterministicEventId(
    topic,
    firstString(root.subscriptionId, subscription.id, root.orderId, order.id),
    firstString(root.timestamp, root.occurredAt, root.createdAt, root.created_at),
  );
}

interface Verified {
  sourceEventId: string;
  topic: string | null;
}

export async function POST(
  request: NextRequest,
  ctx: { params: Promise<{ source: string }> },
) {
  const { source: rawSource } = await ctx.params;

  if (!isFrontDoorSource(rawSource)) {
    return NextResponse.json({ error: "Unknown source" }, { status: 404 });
  }
  const source: FrontDoorSource = rawSource;

  const rawBody = await request.text();

  // ─── 1. Verify ─────────────────────────────────────────────────────────────
  const authorised =
    source === "shopify"
      ? verifyShopifyHmac(request.headers, rawBody)
      : verifyLoopToken(request.headers, request.url);

  if (!authorised) {
    // Deliberately does not persist: an unverified body is not an event.
    await raiseAlert({
      kind: "verification_failed",
      severity: "warning",
      summary: `Rejected an unverified ${source} delivery at the event front door.`,
      detail: {
        source,
        topic: request.headers.get(SHOPIFY_TOPIC_HEADER) ?? request.headers.get("x-loop-topic"),
      },
    }).catch(() => undefined);

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // ─── 2. Identify the topic, then persist raw ───────────────────────────────
  let payload: unknown = null;
  let payloadValid = true;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    payloadValid = false;
  }

  let verified: Verified;
  if (source === "shopify") {
    const topic = request.headers.get(SHOPIFY_TOPIC_HEADER);
    verified = {
      topic,
      sourceEventId:
        request.headers.get(SHOPIFY_WEBHOOK_ID_HEADER) ??
        deterministicEventId(topic, rawBody),
    };
  } else {
    const topic = payloadValid ? loopTopic(request, payload) : null;
    verified = { topic, sourceEventId: loopEventId(payload, topic) };
  }

  const eventName: EventName = payloadValid
    ? canonicalEventFor(source, verified.topic, payload)
    : UNKNOWN_EVENT;

  let inboundEventId: number | null = null;
  try {
    const persisted = await persistInboundEvent({
      source,
      sourceEventId: verified.sourceEventId,
      sourceTopic: verified.topic,
      eventName,
      payload: payloadValid ? payload : null,
      payloadBytes: byteLength(rawBody),
    });

    if (persisted.duplicate) {
      // A redelivery. Success, and no second row.
      return NextResponse.json({ ok: true, duplicate: true });
    }
    inboundEventId = persisted.id;
  } catch (err) {
    // Persistence itself failed — this is the only case worth a 500, because
    // it is the only case where a provider retry would actually help us.
    console.error(`[events/${source}] persistence failed:`, err);
    return NextResponse.json({ error: "Persistence failed" }, { status: 500 });
  }

  if (eventName === UNKNOWN_EVENT) {
    await raiseAlert({
      kind: "unknown_topic",
      severity: "warning",
      inboundEventId,
      summary: payloadValid
        ? `Unrecognised ${source} topic "${verified.topic ?? "(none)"}" recorded as unknown.`
        : `Unparseable ${source} body recorded as unknown.`,
      detail: {
        source,
        source_topic: verified.topic,
        payload_valid: payloadValid,
      },
    }).catch(() => undefined);
  }

  // ─── 3. ACK now, resolve after the response is committed ───────────────────
  const resolve = async () => {
    if (inboundEventId === null || !payloadValid) return;
    await processInboundEvent({
      id: inboundEventId,
      source,
      eventName,
      payload,
    });
  };

  let deferred = true;
  try {
    after(resolve);
  } catch {
    // `after` needs a request scope. Outside one (direct invocation, tests),
    // resolve inline rather than losing the work.
    deferred = false;
  }
  if (!deferred) await resolve();

  return NextResponse.json({ ok: true, id: inboundEventId, event_name: eventName });
}
