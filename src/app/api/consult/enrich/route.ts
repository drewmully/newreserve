/**
 * POST /api/consult/enrich
 *
 * Client-safe proxy in front of the mully-sms-agent enrich endpoint. We
 * do the work on our own edge so we never leak the INTERNAL_SHARED_SECRET
 * into the browser bundle.
 *
 * Called from the /lp/consult quiz completion handler (see QuizModal's
 * finishQuiz) to push the visitor's style-quiz answers into their
 * SendBlue contact record as custom variables, so Martine sees the full
 * style profile inside her SendBlue dashboard the moment she opens the
 * conversation.
 *
 * Request:
 *   {
 *     "phone": "+15551234567",      // E.164, from ConsultOnboardingLauncher Step 0
 *     "answers": {
 *       "style": "modern",
 *       "categories": ["polos","layers"],
 *       "fit": "tailored",
 *       "top_size": "L",
 *       "bottom_size": "32x32",
 *       "favorite_brands": ["Peter Millar"],
 *       "play_frequency": "weekly",
 *       "style_profile_id": "sp_abc123"
 *     }
 *   }
 *
 * Response: { ok: true } on success, { ok: false, error } otherwise.
 * We always return 200 to the browser so the reveal navigation never
 * stalls waiting on a background enrichment call — the server logs the
 * agent error for follow-up but the customer experience isn't blocked.
 */

import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface EnrichBody {
  phone?: unknown;
  answers?: unknown;
}

const PHONE_RE = /^\+[1-9][0-9]{7,14}$/;

export async function POST(req: Request): Promise<Response> {
  let body: EnrichBody;
  try {
    body = (await req.json()) as EnrichBody;
  } catch {
    return NextResponse.json({ ok: false, error: "invalid_json" }, { status: 400 });
  }

  const phone = typeof body.phone === "string" ? body.phone : null;
  if (!phone || !PHONE_RE.test(phone)) {
    return NextResponse.json({ ok: false, error: "invalid_phone" }, { status: 400 });
  }
  if (!body.answers || typeof body.answers !== "object") {
    return NextResponse.json({ ok: false, error: "invalid_answers" }, { status: 400 });
  }

  const agentUrl = process.env.MULLY_SMS_AGENT_URL;
  const sharedSecret = process.env.INTERNAL_SHARED_SECRET;
  if (!agentUrl || !sharedSecret) {
    // Surface this in server logs so ops can see a misconfiguration, but
    // return 200 to the browser — the visitor's reveal shouldn't fail
    // because of a missing env var here.
    console.error(
      "[/api/consult/enrich] MULLY_SMS_AGENT_URL or INTERNAL_SHARED_SECRET missing",
    );
    return NextResponse.json({ ok: false, error: "server_misconfigured" }, { status: 200 });
  }

  const endpoint = `${agentUrl.replace(/\/$/, "")}/api/agent/enrich`;

  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-mully-secret": sharedSecret,
      },
      body: JSON.stringify({ phone, answers: body.answers }),
      signal: ctrl.signal,
      cache: "no-store",
    });
    const bodyText = await res.text().catch(() => "");
    if (!res.ok) {
      console.warn("[/api/consult/enrich] agent error", res.status, bodyText.slice(0, 200));
      // Still return 200 to the browser — SendBlue enrichment is a
      // background nicety and the quiz completion path must not stall.
      return NextResponse.json(
        { ok: false, error: `agent_${res.status}` },
        { status: 200 },
      );
    }
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.warn("[/api/consult/enrich] network error", msg);
    return NextResponse.json({ ok: false, error: "network" }, { status: 200 });
  } finally {
    clearTimeout(t);
  }
}
