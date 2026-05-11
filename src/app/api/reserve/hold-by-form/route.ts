/**
 * POST /api/reserve/hold-by-form
 *
 * Public-facing endpoint used by the LP form. Browser-callable (no Bearer
 * required), but we require a valid Founders HMAC token AND a matching email
 * — that's our gate. Without a token we refuse and ask them to pay instead.
 *
 * Internally proxies to /api/reserve/reserve-by-reply with the CRON_SECRET,
 * so all real DB writes go through one auth'd path.
 */
import { NextResponse } from "next/server";
import {
  FOUNDERS_CAMPAIGN_ID,
  verifyFoundersToken,
} from "@/lib/foundersCampaign";
import { createClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function getSupabase() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://xnfjdbpjuaezxjgargto.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function POST(req: Request) {
  let body: { email?: string; token?: string | null; source?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }

  // Gate: require a valid token. Without it the LP shows pay-only CTA.
  if (!body.token) {
    return NextResponse.json({ error: "token_required" }, { status: 401 });
  }
  const payload = verifyFoundersToken(body.token);
  if (!payload) {
    return NextResponse.json({ error: "invalid_token" }, { status: 401 });
  }
  // Token email must match what they typed. Prevents using a friend's token
  // to hold a spot with a different address.
  if (payload.email !== email) {
    return NextResponse.json(
      { error: "token_email_mismatch" },
      { status: 403 },
    );
  }

  // Light per-email rate limit so the form can't be hammered.
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "server_misconfigured" },
      { status: 500 },
    );
  }

  // Call the internal authoritative endpoint via fetch (same-origin) with
  // the CRON_SECRET. Keeps the write logic in one place.
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "server_misconfigured" },
      { status: 500 },
    );
  }
  const origin =
    process.env.NEXT_PUBLIC_SITE_URL ??
    `https://${req.headers.get("host")}`;
  const target = `${origin}/api/reserve/reserve-by-reply`;
  const upstream = await fetch(target, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${secret}`,
    },
    body: JSON.stringify({
      email,
      token: body.token,
      source: body.source ?? "lp_form",
      campaign_id: FOUNDERS_CAMPAIGN_ID,
    }),
  });
  const upstreamJson = await upstream.json().catch(() => ({}));
  return NextResponse.json(upstreamJson, { status: upstream.status });
}
