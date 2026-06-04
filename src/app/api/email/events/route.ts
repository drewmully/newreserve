/**
 * POST /api/email/events
 *
 * Resend webhook for outbound email engagement events.
 * Captures: email.sent, email.opened, email.clicked, email.bounced, email.complained
 *
 * Stores to Firestore: email_events/{auto_id}
 * Auth: Svix signature with RESEND_WEBHOOK_SECRET (same secret as inbound webhook)
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { adminDb } from "@/lib/firebase-admin";
import { FieldValue } from "firebase-admin/firestore";

let resendClient: Resend | null = null;
function getResendClient(): Resend {
  resendClient ??= new Resend(process.env.RESEND_API_KEY);
  return resendClient;
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ResendEventType =
  | "email.sent"
  | "email.opened"
  | "email.clicked"
  | "email.bounced"
  | "email.complained"
  | "email.delivery_delayed";

interface ResendEventPayload {
  type: ResendEventType;
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    click?: { link: string; timestamp: string; userAgent: string; ipAddress: string };
    bounce?: { message: string };
    tags?: Record<string, string>;
  };
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function verifyDevFallback(req: NextRequest): boolean {
  if (process.env.NODE_ENV === "production") return false;
  const devSecret = process.env.INTERNAL_API_SECRET;
  if (!devSecret) return false;
  return req.headers.get("authorization") === `Bearer ${devSecret}`;
}

function verifyAndParse(req: NextRequest, payload: string): ResendEventPayload {
  const secret = process.env.RESEND_EVENT_WEBHOOK_SECRET ?? process.env.RESEND_WEBHOOK_SECRET;

  if (!secret) {
    if (!verifyDevFallback(req)) throw new Error("Webhook secret not configured");
    return JSON.parse(payload) as ResendEventPayload;
  }

  return getResendClient().webhooks.verify({
    payload,
    headers: {
      id: req.headers.get("svix-id") ?? "",
      timestamp: req.headers.get("svix-timestamp") ?? "",
      signature: req.headers.get("svix-signature") ?? "",
    },
    webhookSecret: secret,
  }) as ResendEventPayload;
}

// ─── Handler ──────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  let rawPayload: string;
  try {
    rawPayload = await req.text();
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  let event: ResendEventPayload;
  try {
    event = verifyAndParse(req, rawPayload);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Unauthorized";
    const status = msg === "Webhook secret not configured" ? 500 : 401;
    return NextResponse.json({ error: status === 500 ? msg : "Unauthorized" }, { status });
  }

  const recipientEmail = event.data.to?.[0] ?? null;
  if (!recipientEmail) {
    return NextResponse.json({ ok: true, skipped: "no_recipient" });
  }

  // Broadcast events belong to mully-hub (Supabase outbound_campaign_recipient),
  // not the per-user drip system stored in Firestore. We share the Resend
  // webhook subscription with mully-hub, so we just ACK without writing — the
  // hub's /api/resend/webhook is the source of truth for broadcast engagement.
  const incomingTags = event.data.tags;
  if (incomingTags && typeof incomingTags === "object" && "mully_campaign_id" in incomingTags) {
    return NextResponse.json({ ok: true, skipped: "broadcast_event" });
  }

  // Map event type to short label
  const eventType = event.type.replace("email.", "") as
    | "sent"
    | "opened"
    | "clicked"
    | "bounced"
    | "complained"
    | "delivery_delayed";

  // Resolve uid from email — best-effort, not blocking
  let uid: string | null = null;
  try {
    const snap = await adminDb
      .collection("users")
      .where("email", "==", recipientEmail)
      .limit(1)
      .get();
    if (!snap.empty) uid = snap.docs[0].id;
  } catch {
    // Non-blocking — we store the event even without uid
  }

  const doc: Record<string, unknown> = {
    event_type: eventType,
    email_id: event.data.email_id,
    email: recipientEmail,
    subject: event.data.subject ?? null,
    from: event.data.from ?? null,
    uid,
    created_at: FieldValue.serverTimestamp(),
    resend_timestamp: event.created_at ?? null,
  };

  if (eventType === "clicked" && event.data.click?.link) {
    doc.link_url = event.data.click.link;
  }
  if (eventType === "bounced" && event.data.bounce?.message) {
    doc.bounce_message = event.data.bounce.message;
  }
  let tags: Record<string, string> | null = event.data.tags ?? null;

  // Resend omits tags from click/open payloads — inherit from the sent event
  if (!tags && (eventType === "clicked" || eventType === "opened") && event.data.email_id) {
    try {
      const sentSnap = await adminDb
        .collection("email_events")
        .where("email_id", "==", event.data.email_id)
        .where("event_type", "==", "sent")
        .limit(1)
        .get();
      if (!sentSnap.empty) {
        const sentTags = sentSnap.docs[0].data().tags as Record<string, string> | undefined;
        if (sentTags) tags = sentTags;
      }
    } catch {
      // Non-blocking — proceed without tags
    }
  }

  if (tags) doc.tags = tags;

  try {
    await adminDb.collection("email_events").add(doc);
    console.log(`[email/events] ${eventType} — ${recipientEmail} (uid: ${uid ?? "unknown"})`);
  } catch (err) {
    console.error("[email/events] Firestore write failed:", err);
    return NextResponse.json({ error: "Storage failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
