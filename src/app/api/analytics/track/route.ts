import { randomUUID } from "crypto";
import { NextRequest, NextResponse } from "next/server";
import { getClientIp } from "@/app/api/_lib/clientIp";
import { dispatchAnalyticsEvent } from "@/app/api/_lib/analytics";
import { recordAISalesSignal } from "@/app/api/_lib/aiSalesAgents";
import {
  aggregateKpiDaily,
  aggregateSegmentActivity,
  persistAnalyticsEvent,
} from "@/app/api/_lib/kpiReporting";
import { adminAuth, adminDb } from "@/lib/firebase-admin";
import { checkRateLimit } from "@/lib/rateLimit";

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
  // Google Ads funnel events (PR #22) — must be in this allowlist
  // so dispatchAnalyticsEvent → fireGoogleAds can pick them up.
  "email_submitted",
  "account_created",
  "view_item",
  "choose_plan_view",
  "plan_selected",
  // Landing page A/B tests for Google Ads (PR for /lp/* pages)
  "lp_subscription_view",
  "lp_subscription_checkout_clicked",
  "lp_gift_view",
  "lp_gift_checkout_clicked",
  "gift_redemption_started",
  "gift_redemption_completed",
]);

function getBearerToken(request: NextRequest): string | null {
  const header = request.headers.get("authorization");
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice(7).trim() || null;
}

function sanitizeSegments(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((segment): segment is string => typeof segment === "string")
    .map((segment) => segment.trim())
    .filter(Boolean)
    .slice(0, 10);
}

function sanitizeString(value: unknown, maxLength = 500): string | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim();
  if (!normalized) return undefined;
  return normalized.slice(0, maxLength);
}

function sanitizeEmail(value: unknown): string | undefined {
  const normalized = sanitizeString(value, 320)?.toLowerCase();
  if (!normalized) return undefined;
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalized)
    ? normalized
    : undefined;
}

function sanitizePhone(value: unknown): string | undefined {
  const normalized = sanitizeString(value, 40);
  if (!normalized) return undefined;
  const digits = normalized.replace(/[^\d+]/g, "");
  return digits.length >= 7 ? digits : undefined;
}

function sanitizePageUrl(value: unknown): string | undefined {
  const normalized = sanitizeString(value, 2000);
  if (!normalized) return undefined;

  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return undefined;
    }
    return parsed.toString();
  } catch {
    return undefined;
  }
}

function sanitizeProperties(
  value: unknown
): Record<string, string | number | boolean | null> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }

  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, raw] of Object.entries(value)) {
    const normalizedKey = key.trim().slice(0, 64);
    if (!normalizedKey) continue;

    if (typeof raw === "string") {
      sanitized[normalizedKey] = raw.slice(0, 1000);
      continue;
    }

    if (typeof raw === "number" || typeof raw === "boolean" || raw === null) {
      sanitized[normalizedKey] = raw;
    }
  }

  return sanitized;
}

async function resolveVerifiedUid(
  request: NextRequest,
  claimedUid?: string
): Promise<string | undefined> {
  const token = getBearerToken(request);
  if (!token) {
    if (claimedUid) {
      throw new Error("AUTH_REQUIRED_FOR_USER_ID");
    }
    return undefined;
  }

  let decodedUid: string;
  try {
    const decoded = await adminAuth.verifyIdToken(token, true);
    decodedUid = decoded.uid;
  } catch {
    throw new Error("INVALID_AUTH_TOKEN");
  }

  if (claimedUid && claimedUid !== decodedUid) {
    throw new Error("USER_ID_MISMATCH");
  }

  return claimedUid ?? decodedUid;
}

async function resolveServerSegments(uid?: string): Promise<string[]> {
  if (!uid) return [];

  try {
    const userSnap = await adminDb.collection("users").doc(uid).get();
    if (!userSnap.exists) return [];
    return sanitizeSegments(userSnap.data()?.segments);
  } catch {
    return [];
  }
}

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = (await request.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const eventName = sanitizeString(body.event_name, 100);
  if (!eventName || !VALID_EVENTS.has(eventName)) {
    return NextResponse.json(
      {
        error: `Invalid or missing event_name. Valid values: ${[...VALID_EVENTS].join(", ")}`,
      },
      { status: 400 }
    );
  }

  const claimedUid = sanitizeString(body.user_id, 128);
  let uid: string | undefined;
  try {
    uid = await resolveVerifiedUid(request, claimedUid);
  } catch (error) {
    if (!(error instanceof Error)) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (error.message === "AUTH_REQUIRED_FOR_USER_ID") {
      return NextResponse.json(
        { error: "Authenticated events require a valid bearer token." },
        { status: 401 }
      );
    }

    if (error.message === "USER_ID_MISMATCH") {
      return NextResponse.json(
        { error: "Authenticated user does not match user_id." },
        { status: 403 }
      );
    }

    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const ip = getClientIp(request.headers);
  const rateLimitKey =
    uid ?? ip ?? sanitizeString(body.anonymous_id, 128) ?? "anonymous";
  const rateLimit = checkRateLimit("analytics_track", rateLimitKey, {
    maxHits: 120,
    windowMs: 60 * 1000,
  });
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many analytics events. Please try again later." },
      {
        status: 429,
        headers: {
          "Retry-After": String(rateLimit.retryAfterSeconds),
        },
      }
    );
  }

  const segments = uid
    ? await resolveServerSegments(uid)
    : sanitizeSegments(body.segments);
  const properties = sanitizeProperties(body.properties);
  const event = {
    event_name: eventName,
    user_id: uid,
    anonymous_id: sanitizeString(body.anonymous_id, 128),
    email: sanitizeEmail(body.email),
    phone: sanitizePhone(body.phone),
    ip,
    user_agent: sanitizeString(request.headers.get("user-agent"), 500),
    page_url: sanitizePageUrl(body.page_url),
    segments,
    properties,
    timestamp: Math.floor(Date.now() / 1000),
  };

  const eventId = randomUUID();

  await Promise.allSettled([
    dispatchAnalyticsEvent(event),
    persistAnalyticsEvent(eventId, { ...event, uid }),
    aggregateKpiDaily({ ...event, uid }),
    aggregateSegmentActivity({ ...event, uid }),
    recordAISalesSignal(eventId, {
      user_id: uid ?? "anonymous",
      event_name: eventName,
      properties,
    }),
  ]);

  return NextResponse.json({ ok: true, event_id: eventId });
}
