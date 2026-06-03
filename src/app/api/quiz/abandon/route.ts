/**
 * POST /api/quiz/abandon
 *
 * Fire-and-forget beacon called from the quiz UI when a partial finisher
 * navigates away. We don't actually flip status here — the abandon-nudge
 * cron does that on a real time window (24h since updatedAt + email captured
 * but not completed). This endpoint just records the analytics event so we
 * have a clean drop-off funnel in PostHog without waiting for the cron.
 *
 * Body: { profileId: string, step: number, reason?: 'unload' | 'visibility' | 'manual' }
 * Response: { ok: true }
 */

import { NextRequest, NextResponse } from "next/server";
import { getStyleProfile } from "@/lib/styleProfiles/admin";
import { dispatchAnalyticsEvent } from "@/app/api/_lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface AbandonBody {
  profileId?: string;
  step?: number;
  reason?: string;
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: AbandonBody;
  try {
    body = (await req.json()) as AbandonBody;
  } catch {
    // Beacon sends may omit a body in some browsers — treat as no-op.
    return NextResponse.json({ ok: true });
  }

  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  if (!profileId || profileId.length < 8) {
    return NextResponse.json({ ok: true });
  }

  const profile = await getStyleProfile(profileId).catch(() => null);
  if (!profile) return NextResponse.json({ ok: true });
  // No need to alter Firestore — `updatedAt` is the cron's signal.

  dispatchAnalyticsEvent({
    event_name: "quiz_abandoned",
    email: profile.email ?? undefined,
    anonymous_id: profile.anonId,
    user_agent: req.headers.get("user-agent") ?? undefined,
    properties: {
      profileId,
      step: typeof body.step === "number" ? body.step : null,
      reason: typeof body.reason === "string" ? body.reason : null,
      styleBucket: profile.styleBucket,
      emailCaptured: profile.emailCaptured,
    },
  }).catch((err) =>
    console.error("[api/quiz/abandon] dispatch failed", err)
  );

  return NextResponse.json({ ok: true });
}
