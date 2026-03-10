/**
 * POST /api/analytics/track
 *
 * Ingests a client-side analytics event, enriches it with server-side
 * segments, and fans out to all configured analytics providers + KPI layer.
 *
 * Body (JSON):
 *   event_name   — required, one of VALID_EVENTS
 *   user_id      — optional Firebase UID (used to look up segments)
 *   email        — optional (hashed before forwarding to Meta)
 *   phone        — optional (hashed before forwarding to Meta)
 *   page_url     — optional
 *   segments     — optional string[]; overridden by Firestore if user_id given
 *   properties   — optional Record<string, unknown>
 *
 * Response:
 *   { ok: true, event_id: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { randomUUID } from "crypto";
import { adminDb } from "@/lib/firebase-admin";
import { dispatchAnalyticsEvent } from "@/app/api/_lib/analytics";
import {
  persistAnalyticsEvent,
  aggregateKpiDaily,
  aggregateSegmentActivity,
} from "@/app/api/_lib/kpiReporting";
import { recordAISalesSignal } from "@/app/api/_lib/aiSalesAgents";

const VALID_EVENTS = new Set([
  "page_view",
  "add_to_cart",
  "initiate_checkout",
  "checkout_clicked",
  "purchase",
  "login",
  "wallet_viewed",
  "subscription_state",
  "registry_applied",
]);

export async function POST(request: NextRequest) {
  // ── Parse body ────────────────────────────────────────────────────────────
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // ── Validate event name ───────────────────────────────────────────────────
  const eventName = body.event_name as string | undefined;
  if (!eventName || !VALID_EVENTS.has(eventName)) {
    return NextResponse.json(
      {
        error: `Invalid or missing event_name. Valid values: ${[...VALID_EVENTS].join(", ")}`,
      },
      { status: 400 }
    );
  }

  const uid = body.user_id as string | undefined;

  // ── Enrich segments from Firestore ────────────────────────────────────────
  let segments = (body.segments as string[] | undefined) ?? [];
  if (uid && segments.length === 0) {
    try {
      const userSnap = await adminDb.collection("users").doc(uid).get();
      if (userSnap.exists) {
        segments = (userSnap.data()?.segments as string[]) ?? [];
      }
    } catch {
      // Non-fatal — proceed without server segments
    }
  }

  // ── Resolve client IP ─────────────────────────────────────────────────────
  const ip =
    request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
    request.headers.get("x-real-ip") ??
    undefined;

  // ── Build normalized event ────────────────────────────────────────────────
  const event = {
    event_name: eventName,
    user_id: uid,
    anonymous_id: body.anonymous_id as string | undefined,
    email: body.email as string | undefined,
    phone: body.phone as string | undefined,
    ip,
    user_agent: request.headers.get("user-agent") ?? undefined,
    page_url: body.page_url as string | undefined,
    segments,
    properties: (body.properties as Record<string, unknown>) ?? {},
    timestamp: Math.floor(Date.now() / 1000),
  };

  const eventId = randomUUID();

  // ── Fan out to all pipelines (all failures are isolated) ─────────────────
  await Promise.allSettled([
    dispatchAnalyticsEvent(event),
    persistAnalyticsEvent(eventId, { ...event, uid }),
    aggregateKpiDaily({ ...event, uid }),
    aggregateSegmentActivity({ ...event, uid }),
    recordAISalesSignal(eventId, {
      user_id: uid ?? "anonymous",
      event_name: eventName,
      properties: event.properties,
    }),
  ]);

  return NextResponse.json({ ok: true, event_id: eventId });
}
