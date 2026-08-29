/**
 * POST /api/stylegame/played
 *
 * Called by the game's injected adapter at `sg_finale` — once the user has
 * seen their profile card and BEFORE they click the deposit CTA.
 *
 * Writes a `stylegame_lead` row with the full quiz result. That row is what
 * the orders-paid webhook updates when (and if) they check out. It's also
 * what the stylist UI reads to decide who to review.
 *
 * Body (JSON):
 *   {
 *     "quiz_result": { profile, name, confidence, pcts, color, fit, gift },
 *     "utms": { utm_source, utm_medium, utm_campaign, utm_content, utm_term }
 *   }
 *
 * The `mully_anon_id` cookie is read from the request headers — not from the
 * body — so it can't be spoofed by a client that dropped its own cookie.
 *
 * Idempotent: identical anon_id fires within a 5-minute window reuse the
 * previous row instead of creating duplicates.
 */

import { NextRequest, NextResponse } from "next/server";
import { insertPlayedLead, QuizResult } from "@/lib/stylegame/lead";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RequestBody {
  quiz_result?: QuizResult;
  utms?: {
    utm_source?: string;
    utm_medium?: string;
    utm_campaign?: string;
    utm_content?: string;
    utm_term?: string;
  };
}

function readCookie(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(/;\s*/);
  for (const p of parts) {
    const [k, ...rest] = p.split("=");
    if (k === name) return decodeURIComponent(rest.join("="));
  }
  return null;
}

export async function POST(req: NextRequest) {
  let body: RequestBody = {};
  try {
    body = (await req.json()) as RequestBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid json" }, { status: 400 });
  }

  const quiz = body.quiz_result;
  if (!quiz || typeof quiz !== "object") {
    return NextResponse.json(
      { ok: false, error: "quiz_result required" },
      { status: 400 }
    );
  }

  const cookieHeader = req.headers.get("cookie");
  const anon = readCookie(cookieHeader, "mully_anon_id");
  const utms = body.utms ?? {};

  try {
    const { id, created } = await insertPlayedLead({
      mully_anon_id: anon,
      quiz_result: quiz,
      utm_source: utms.utm_source ?? null,
      utm_medium: utms.utm_medium ?? null,
      utm_campaign: utms.utm_campaign ?? null,
      utm_content: utms.utm_content ?? null,
      utm_term: utms.utm_term ?? null,
      referer: req.headers.get("referer"),
      user_agent: req.headers.get("user-agent"),
    });

    return NextResponse.json({ ok: true, id, created });
  } catch (err) {
    console.error("[stylegame/played] insert failed", err);
    return NextResponse.json(
      { ok: false, error: (err as Error).message ?? "insert failed" },
      { status: 500 }
    );
  }
}
