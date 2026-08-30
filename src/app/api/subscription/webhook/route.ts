/**
 * POST /api/subscription/webhook
 *
 * Shopify webhook handler for the new Partner-app topics:
 *   subscription_contracts/create | update | activate | pause | cancel
 *   subscription_billing_attempts/success | failure | challenged
 *
 * Verifies HMAC using `SHOPIFY_SUBSCRIPTIONS_WEBHOOK_SECRET` (distinct from the
 * existing `SHOPIFY_WEBHOOK_SECRET` because it belongs to the new Partner app).
 * For now, every verified delivery is persisted verbatim to Supabase
 * `subscription_events` and ACKed 200. Downstream processing (Firestore
 * mirror, Resend triggers, membership state) will land in follow-up PRs once
 * Drew flips `SUBSCRIPTIONS_BACKEND=shopify`.
 *
 * This mirrors the pattern PR #107 established for /api/events/[source]:
 *   1. Verify HMAC over the raw body.
 *   2. Persist raw payload before parsing anything beyond the topic.
 *   3. ACK 200 immediately.
 *
 * Duplicate deliveries are deduped by (source_event_id) unique constraint —
 * see migrations/20260830_subscription_events.sql.
 */

import { NextRequest, NextResponse } from "next/server";
import crypto from "crypto";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const HMAC_HEADER = "x-shopify-hmac-sha256";
const TOPIC_HEADER = "x-shopify-topic";
const WEBHOOK_ID_HEADER = "x-shopify-webhook-id";
const SHOP_DOMAIN_HEADER = "x-shopify-shop-domain";

interface HeaderBag {
  get(name: string): string | null;
}

export function verifySubscriptionsHmac(
  headers: HeaderBag,
  rawBody: string,
  secret: string | undefined = process.env.SHOPIFY_SUBSCRIPTIONS_WEBHOOK_SECRET
): boolean {
  if (!secret) return false;

  const hmacHeader = headers.get(HMAC_HEADER);
  if (!hmacHeader) return false;

  const computed = crypto
    .createHmac("sha256", secret)
    .update(rawBody, "utf8")
    .digest("base64");

  try {
    return crypto.timingSafeEqual(
      Buffer.from(computed, "base64"),
      Buffer.from(hmacHeader, "base64")
    );
  } catch {
    return false;
  }
}

function isSupportedTopic(topic: string | null): boolean {
  if (!topic) return false;
  return (
    topic.startsWith("subscription_contracts/") ||
    topic.startsWith("subscription_billing_attempts/")
  );
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();

  const authorised = verifySubscriptionsHmac(request.headers, rawBody);
  if (!authorised) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const topic = request.headers.get(TOPIC_HEADER);
  const webhookId = request.headers.get(WEBHOOK_ID_HEADER);
  const shopDomain = request.headers.get(SHOP_DOMAIN_HEADER);

  if (!isSupportedTopic(topic)) {
    // Verified but not something this route handles. Return 200 so Shopify
    // doesn't retry, but log so we notice misconfigured webhooks.
    console.warn(`[subscription/webhook] unsupported topic: ${topic}`);
    return NextResponse.json({ ok: true, skipped: true });
  }

  let payload: unknown = null;
  try {
    payload = rawBody ? JSON.parse(rawBody) : null;
  } catch {
    payload = null;
  }

  // Deterministic id when Shopify does not send X-Shopify-Webhook-Id (unlikely
  // in production but common in tests).
  const sourceEventId =
    webhookId ||
    crypto
      .createHash("sha256")
      .update(`${topic ?? ""}::${rawBody}`)
      .digest("hex");

  try {
    const supabase = getSupabaseService();
    const { error } = await supabase.from("subscription_events").insert({
      source_event_id: sourceEventId,
      topic,
      shop_domain: shopDomain,
      payload,
      raw_body_bytes: Buffer.byteLength(rawBody, "utf8"),
      received_at: new Date().toISOString(),
    });

    if (error) {
      // Postgres unique-violation code for the dedupe index.
      const isDuplicate = error.code === "23505";
      if (isDuplicate) {
        return NextResponse.json({ ok: true, duplicate: true });
      }
      throw new Error(error.message);
    }
  } catch (err) {
    console.error("[subscription/webhook] persistence failed:", err);
    return NextResponse.json({ error: "Persistence failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true, topic });
}
