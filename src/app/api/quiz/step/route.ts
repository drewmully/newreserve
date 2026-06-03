/**
 * POST /api/quiz/step
 *
 * Progressively saves a single quiz answer. The client calls this once per
 * step so a partial response is recoverable on reload.
 *
 * Body: {
 *   profileId: string,
 *   step: number,
 *   answer: {
 *     golfStyle?: StyleBucket,
 *     categoryPrefs?: CategoryPref[],
 *     fit?: FitPreference,
 *     topSize?: string,
 *     bottomSize?: string,
 *     favoriteBrands?: string[],
 *     playFrequency?: PlayFrequency,
 *   }
 * }
 * Response: { ok: true }
 */

import { NextRequest, NextResponse } from "next/server";
import {
  getStyleProfile,
  updateStyleProfile,
} from "@/lib/styleProfiles/admin";
import {
  STYLE_BUCKETS,
  type CategoryPref,
  type FitPreference,
  type PlayFrequency,
  type StyleBucket,
  type StyleProfileDoc,
  type StyleProfileInput,
} from "@/lib/styleProfiles/types";
import { dispatchAnalyticsEvent } from "@/app/api/_lib/analytics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const CATEGORY_PREFS: CategoryPref[] = [
  "polos",
  "layers",
  "shorts_pants",
  "outerwear",
  "accessories",
];
const FIT_VALUES: FitPreference[] = ["tailored", "regular", "relaxed"];
const PLAY_VALUES: PlayFrequency[] = [
  "weekly_plus",
  "weekly",
  "monthly",
  "occasional",
];

interface StepBody {
  profileId?: string;
  step?: number;
  answer?: {
    golfStyle?: string;
    categoryPrefs?: unknown;
    fit?: string;
    topSize?: string;
    bottomSize?: string;
    favoriteBrands?: unknown;
    playFrequency?: string;
  };
}

function asStringArray(v: unknown, allowList?: readonly string[], cap = 30): string[] {
  if (!Array.isArray(v)) return [];
  const out: string[] = [];
  for (const item of v) {
    if (typeof item !== "string") continue;
    const t = item.trim();
    if (!t) continue;
    if (allowList && !(allowList as readonly string[]).includes(t)) continue;
    if (t.length > 80) continue;
    out.push(t);
    if (out.length >= cap) break;
  }
  return out;
}

function asShortString(v: unknown, cap = 60): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t) return null;
  return t.slice(0, cap);
}

function buildAnswerPatch(
  answer: NonNullable<StepBody["answer"]>
): { patch: StyleProfileInput; touched: string[] } {
  const touched: string[] = [];
  // Only include fields that were actually provided — partial patch.
  const out: Record<string, unknown> = {};

  if (typeof answer.golfStyle === "string") {
    if ((STYLE_BUCKETS as readonly string[]).includes(answer.golfStyle)) {
      out.golfStyle = answer.golfStyle as StyleBucket;
      touched.push("golfStyle");
    }
  }
  if (answer.categoryPrefs !== undefined) {
    out.categoryPrefs = asStringArray(
      answer.categoryPrefs,
      CATEGORY_PREFS,
      CATEGORY_PREFS.length
    );
    touched.push("categoryPrefs");
  }
  if (typeof answer.fit === "string") {
    if ((FIT_VALUES as readonly string[]).includes(answer.fit)) {
      out.fit = answer.fit as FitPreference;
      touched.push("fit");
    }
  }
  if (answer.topSize !== undefined) {
    out.topSize = asShortString(answer.topSize);
    touched.push("topSize");
  }
  if (answer.bottomSize !== undefined) {
    out.bottomSize = asShortString(answer.bottomSize);
    touched.push("bottomSize");
  }
  if (answer.favoriteBrands !== undefined) {
    out.favoriteBrands = asStringArray(answer.favoriteBrands, undefined, 12);
    touched.push("favoriteBrands");
  }
  if (typeof answer.playFrequency === "string") {
    if ((PLAY_VALUES as readonly string[]).includes(answer.playFrequency)) {
      out.playFrequency = answer.playFrequency as PlayFrequency;
      touched.push("playFrequency");
    }
  }

  const patch: StyleProfileInput = {};
  if (Object.keys(out).length > 0) {
    patch.answers = out as NonNullable<StyleProfileInput["answers"]>;
  }
  // If the golfStyle answer changed, also update top-level styleBucket so
  // the reveal page + emails stay in sync without joining on answers.golfStyle.
  if (touched.includes("golfStyle")) {
    patch.styleBucket = (out.golfStyle as StyleBucket | undefined) ?? null;
  }
  return { patch, touched };
}

export async function POST(req: NextRequest): Promise<NextResponse> {
  let body: StepBody;
  try {
    body = (await req.json()) as StepBody;
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const profileId = typeof body.profileId === "string" ? body.profileId : "";
  const step = typeof body.step === "number" ? body.step : -1;
  if (!profileId || profileId.length < 8 || step < 0 || step > 20) {
    return NextResponse.json({ error: "invalid_args" }, { status: 400 });
  }
  if (!body.answer || typeof body.answer !== "object") {
    return NextResponse.json({ error: "invalid_answer" }, { status: 400 });
  }

  // Don't allow steps to mutate a profile that's already converted / abandoned
  // (defensive — UI shouldn't allow it either).
  const existing = await getStyleProfile(profileId);
  if (!existing) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (existing.status === "converted") {
    return NextResponse.json({ error: "already_converted" }, { status: 409 });
  }

  const { patch, touched } = buildAnswerPatch(body.answer);
  if (touched.length === 0) {
    return NextResponse.json({ error: "no_valid_fields" }, { status: 400 });
  }

  try {
    await updateStyleProfile(profileId, patch);
  } catch (err) {
    console.error("[api/quiz/step] updateStyleProfile failed", err);
    return NextResponse.json({ error: "update_failed" }, { status: 500 });
  }

  dispatchAnalyticsEvent({
    event_name: "quiz_step_completed",
    anonymous_id: existing.anonId,
    user_agent: req.headers.get("user-agent") ?? undefined,
    properties: {
      profileId,
      step,
      touched_fields: touched,
      styleBucket: (patch.styleBucket ?? existing.styleBucket) as
        | StyleBucket
        | null,
    },
  }).catch((err) => {
    console.error("[api/quiz/step] dispatchAnalyticsEvent failed", err);
  });

  return NextResponse.json({ ok: true });
}

// Lightweight GET so the client can resume a partially-completed quiz.
export async function GET(req: NextRequest): Promise<NextResponse> {
  const profileId = req.nextUrl.searchParams.get("profileId");
  if (!profileId) {
    return NextResponse.json({ error: "missing_profileId" }, { status: 400 });
  }
  const doc: StyleProfileDoc | null = await getStyleProfile(profileId);
  if (!doc) return NextResponse.json({ error: "not_found" }, { status: 404 });

  return NextResponse.json({
    profileId: doc.profileId,
    status: doc.status,
    styleBucket: doc.styleBucket,
    answers: doc.answers,
    emailCaptured: doc.emailCaptured,
  });
}
