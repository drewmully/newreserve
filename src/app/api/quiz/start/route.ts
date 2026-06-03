/**
 * POST /api/quiz/start
 *
 * Creates a new styleProfile doc with the visitor's first answer (their
 * golf-style bucket) and any captured UTM attribution. Returns the
 * profileId — the client persists it in a cookie + localStorage so quiz
 * reloads can resume.
 *
 * Body: { styleBucket: StyleBucket, utm?: Partial<UtmPayload>, referrer?: string, landingPath?: string }
 * Response: { profileId: string }
 */

import { NextRequest, NextResponse } from "next/server";
import { createStyleProfile } from "@/lib/styleProfiles/admin";
import {
  readAnonId,
  setAnonCookie,
  setProfileCookie,
} from "@/lib/styleProfiles/cookies";
import {
  STYLE_BUCKETS,
  type StyleBucket,
  type StyleProfileDoc,
} from "@/lib/styleProfiles/types";
import { dispatchAnalyticsEvent } from "@/app/api/_lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface StartBody {
  styleBucket?: string;
  utm?: Partial<StyleProfileDoc["utm"]>;
  referrer?: string;
  landingPath?: string;
}

function isStyleBucket(v: unknown): v is StyleBucket {
  return typeof v === "string" && (STYLE_BUCKETS as readonly string[]).includes(v);
}

function sanitizeUtm(
  raw: Partial<StyleProfileDoc["utm"]> | undefined,
  referrer: string | null,
  landingPath: string | null
): StyleProfileDoc["utm"] {
  const v = (k: keyof StyleProfileDoc["utm"]): string | null => {
    const x = raw?.[k];
    if (typeof x !== "string") return null;
    const t = x.trim().slice(0, 200);
    return t.length ? t : null;
  };
  return {
    source: v("source"),
    medium: v("medium"),
    campaign: v("campaign"),
    content: v("content"),
    term: v("term"),
    gclid: v("gclid"),
    referrer: referrer ? referrer.slice(0, 500) : null,
    landingPath: landingPath ? landingPath.slice(0, 500) : null,
  };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: StartBody;
  try {
    body = (await req.json()) as StartBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  if (!isStyleBucket(body.styleBucket)) {
    return NextResponse.json(
      { error: "invalid_style_bucket" },
      { status: 400 }
    );
  }

  const { anonId, minted } = readAnonId(req);
  const utm = sanitizeUtm(
    body.utm,
    typeof body.referrer === "string" ? body.referrer : null,
    typeof body.landingPath === "string" ? body.landingPath : null
  );

  let profileId: string;
  try {
    profileId = await createStyleProfile({
      anonId,
      initialAnswer: body.styleBucket,
      utm,
    });
  } catch (err) {
    console.error("[api/quiz/start] createStyleProfile failed", err);
    return NextResponse.json({ error: "create_failed" }, { status: 500 });
  }

  // Server-side analytics — gives us a definitive funnel start count even if
  // the client SDK is blocked by an extension.
  dispatchAnalyticsEvent({
    event_name: "quiz_started",
    anonymous_id: anonId,
    user_agent: req.headers.get("user-agent") ?? undefined,
    properties: {
      profileId,
      styleBucket: body.styleBucket,
      utm_source: utm.source,
      utm_medium: utm.medium,
      utm_campaign: utm.campaign,
      utm_content: utm.content,
      gclid: utm.gclid,
    },
  }).catch((err) => {
    console.error("[api/quiz/start] dispatchAnalyticsEvent failed", err);
  });

  const res = NextResponse.json({ profileId });
  if (minted) setAnonCookie(res, anonId);
  setProfileCookie(res, profileId);
  return res;
}
