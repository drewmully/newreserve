/**
 * POST /api/unsubscribe
 *
 * Writes an opt-out to public.suppression_list, scoped by request:
 *   scope: "marketing" — opt out of marketing sends only (transactional mail
 *                         — receipts, password resets, shipping notices —
 *                         still goes out; src/lib/email/gate.ts already
 *                         treats "transactional" sendClass independently).
 *   scope: "all"        — opt out of every email (channel = "email").
 *
 * Auth: a valid signed unsubscribe token (src/lib/email/unsubscribe-tokens.ts)
 * is required — this is a public, unauthenticated endpoint reachable from
 * email, so the token is what proves the request is tied to a real send
 * rather than allowing arbitrary emails to be suppressed by a third party.
 *
 * Idempotent: re-submitting the same (email, scope) is a no-op if a matching
 * row already exists (checked case-insensitively).
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { verifyUnsubscribeToken } from "@/lib/email/unsubscribe-tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Scope = "marketing" | "all";

function isScope(v: unknown): v is Scope {
  return v === "marketing" || v === "all";
}

export async function POST(req: NextRequest) {
  let body: { token?: unknown; scope?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const token = typeof body.token === "string" ? body.token : null;
  if (!token) return NextResponse.json({ error: "missing_token" }, { status: 400 });

  const payload = verifyUnsubscribeToken(token);
  if (!payload) return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 401 });

  const scope: Scope = isScope(body.scope) ? body.scope : "marketing";
  const email = payload.email;

  try {
    const sb = getSupabaseService();

    const { data: existing, error: lookupError } = await sb
      .from("suppression_list")
      .select("id,email,channel,scope")
      .ilike("email", email)
      .limit(50);

    if (lookupError) {
      console.error(`[unsubscribe] suppression_list lookup failed for ${email}:`, lookupError.message);
      return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
    }

    const alreadySuppressed = (existing ?? []).some(
      (row: { email: string | null; channel: string | null; scope: string | null }) =>
        (row.email ?? "").trim().toLowerCase() === email &&
        (row.channel === "email" || row.channel === "both") &&
        (row.scope === scope || row.scope === "all")
    );

    if (alreadySuppressed) {
      return NextResponse.json({ ok: true, alreadySuppressed: true, scope });
    }

    const { error: insertError } = await sb.from("suppression_list").insert({
      email,
      channel: "email",
      scope,
      reason: "unsubscribe_link",
      source_campaign_id: null,
      source_flow_id: null,
      notes: payload.rid ? `rid=${payload.rid}` : null,
    });

    if (insertError) {
      console.error(`[unsubscribe] SUPPRESSION_INSERT_FAILED for ${email}:`, insertError.message);
      return NextResponse.json({ error: "write_failed" }, { status: 500 });
    }

    return NextResponse.json({ ok: true, alreadySuppressed: false, scope });
  } catch (err) {
    console.error(`[unsubscribe] unexpected error for ${email}:`, err);
    return NextResponse.json({ error: "unexpected_error" }, { status: 500 });
  }
}

/**
 * GET is used by the preference page to display the current suppression
 * state for a token's email before the user picks an action.
 */
export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get("token");
  if (!token) return NextResponse.json({ error: "missing_token" }, { status: 400 });

  const payload = verifyUnsubscribeToken(token);
  if (!payload) return NextResponse.json({ error: "invalid_or_expired_token" }, { status: 401 });

  try {
    const sb = getSupabaseService();
    const { data, error } = await sb
      .from("suppression_list")
      .select("channel,scope")
      .ilike("email", payload.email)
      .limit(50);

    if (error) {
      console.error(`[unsubscribe] status lookup failed for ${payload.email}:`, error.message);
      return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
    }

    const rows = (data ?? []) as { channel: string | null; scope: string | null }[];
    const emailRows = rows.filter((r) => r.channel === "email" || r.channel === "both");
    const suppressedAll = emailRows.some((r) => r.scope === "all");
    const suppressedMarketing = suppressedAll || emailRows.some((r) => r.scope === "marketing");

    return NextResponse.json({
      email: payload.email,
      suppressedMarketing,
      suppressedAll,
    });
  } catch (err) {
    console.error(`[unsubscribe] unexpected status error for ${payload.email}:`, err);
    return NextResponse.json({ error: "unexpected_error" }, { status: 500 });
  }
}
