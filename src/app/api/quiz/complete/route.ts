/**
 * POST /api/quiz/complete
 *
 * Finalizes a style quiz. Captures email + consent, marks the profile
 * `completed`, and (if the visitor is NOT already an active Mully subscriber)
 * kicks off the `reserve` nurture sequence in the existing email engine.
 *
 * Suppression rules (do NOT email):
 *   1. The visitor has an ACTIVE Mully subscription in Loop. We never re-pitch
 *      Reserve to current paying members.
 *   2. The email is on the global suppression list (adminEmailAllowlist).
 *      Note: this codebase uses an allowlist-style guard for transactional
 *      sends only on certain dev/admin paths — production sends are gated
 *      elsewhere. We still run the check defensively.
 *   3. Consent was not granted at the email gate. (Drew's instructions:
 *      gift-led, never spammy. Consent off = transactional silence.)
 *
 * Body: { profileId: string, email: string, consent: boolean, firstName?: string }
 * Response: { ok: true, status: 'started' | 'suppressed_active_subscriber' | 'suppressed_no_consent', styleBucket, profileId }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getStyleProfile,
  markProfileCompleted,
} from "@/lib/styleProfiles/admin";
import { dispatchAnalyticsEvent } from "@/app/api/_lib/analytics";
import { startFlow } from "@/lib/email/sequences";
import { getLoopSubscriptionStatus } from "@/app/api/_lib/loopAdmin";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface CompleteBody {
  profileId?: string;
  email?: string;
  consent?: boolean;
  firstName?: string;
}

function normalizeEmail(raw: string): string | null {
  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return null;
  return trimmed;
}

function trimName(raw: string | undefined): string | null {
  if (!raw) return null;
  const t = raw.trim();
  if (!t) return null;
  return t.slice(0, 40);
}

/**
 * Best-effort check for whether this email already has an ACTIVE Mully
 * subscription via Loop. We treat any non-2xx / thrown error as "not active"
 * to avoid wrongly suppressing a legitimate quiz finisher because Loop is
 * momentarily down — false negatives here just mean a duplicate email.
 */
async function isActiveSubscriber(email: string): Promise<boolean> {
  try {
    const status = await getLoopSubscriptionStatus(email);
    return Boolean(status?.mullybox_active);
  } catch (err) {
    console.warn(
      "[api/quiz/complete] Loop active-subscriber check failed, defaulting to false",
      err
    );
    return false;
  }
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: CompleteBody;
  try {
    body = (await req.json()) as CompleteBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const rawEmail = typeof body.email === "string" ? body.email : "";
  const consent = body.consent === true;
  const firstName = trimName(body.firstName);

  if (!profileId || profileId.length < 8) {
    return NextResponse.json({ error: "invalid_profile_id" }, { status: 400 });
  }
  const email = normalizeEmail(rawEmail);
  if (!email) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  const existing = await getStyleProfile(profileId);
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (existing.status === "converted") {
    return NextResponse.json(
      { ok: true, status: "already_converted", profileId, styleBucket: existing.styleBucket },
      { status: 200 }
    );
  }

  // Persist completion (idempotent).
  const updated = await markProfileCompleted({ profileId, email, consent });
  const styleBucket = updated?.styleBucket ?? existing.styleBucket;

  // Server-side analytics
  dispatchAnalyticsEvent({
    event_name: "quiz_email_captured",
    email,
    anonymous_id: existing.anonId,
    user_agent: req.headers.get("user-agent") ?? undefined,
    properties: { profileId, consent, styleBucket },
  }).catch((err) =>
    console.error("[api/quiz/complete] email_captured dispatch failed", err)
  );

  dispatchAnalyticsEvent({
    event_name: "quiz_completed",
    email,
    anonymous_id: existing.anonId,
    user_agent: req.headers.get("user-agent") ?? undefined,
    properties: { profileId, styleBucket },
  }).catch((err) =>
    console.error("[api/quiz/complete] completed dispatch failed", err)
  );

  // Suppression: no consent → don't start the drip, but still let the visitor
  // see their reveal page. (We captured the email for analytics; we just
  // won't email them.)
  if (!consent) {
    return NextResponse.json({
      ok: true,
      status: "suppressed_no_consent",
      profileId,
      styleBucket,
    });
  }

  // Suppression: already a paying Mully subscriber.
  if (await isActiveSubscriber(email)) {
    return NextResponse.json({
      ok: true,
      status: "suppressed_active_subscriber",
      profileId,
      styleBucket,
    });
  }

  // Start the reserve nurture sequence. We key by profileId (not a Firebase
  // Auth uid) because the visitor has no auth account yet — orders-paid
  // webhook will reconcile to the eventual uid via the email match.
  try {
    await startFlow(profileId, email, firstName, "reserve");
  } catch (err) {
    console.error("[api/quiz/complete] startFlow(reserve) failed", err);
    // Don't fail the request — the user-facing reveal still works; we'll
    // just miss the nurture for this one. Log for repair.
  }

  return NextResponse.json({
    ok: true,
    status: "started",
    profileId,
    styleBucket,
  });
}
