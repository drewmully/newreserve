/**
 * POST /api/reserve/reserve-by-reply
 *
 * Server-to-server endpoint. Records a 48h reply-to-reserve hold for a
 * Founders campaign invitee. Called from mully-hub when the analyzer
 * (or a keyword trigger) sees an inbound reply matching RESERVE intent,
 * and also from a one-click landing page button.
 *
 * Auth: Bearer ${CRON_SECRET}. Never expose this to the browser.
 *
 * Body:
 *   {
 *     email: string                   // required, lowercased server-side
 *     token?: string                  // optional Founders HMAC token; if provided we verify it
 *     source?: string                 // 'reply_email' | 'reply_sms' | 'lp_button' | etc.
 *     campaign_id?: string            // defaults to FOUNDERS_CAMPAIGN_ID
 *     skip_spot_check?: boolean       // admin override; defaults false
 *   }
 *
 * Behavior:
 *   1. Reject if no spots remaining (unless override) — surfaces 409.
 *   2. Resolve email -> customers.id (case-insensitive). 404 if not found.
 *   3. Upsert customer_facts row with reserve_reservation_at = NOW(),
 *      reserve_reservation_expires_at = NOW() + 48h, source = ...,
 *      paid_at = NULL. Idempotent: existing active holds extend the window.
 *
 * Returns: { ok, customer_id, reserved_at, expires_at, remaining }
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  FOUNDERS_CAMPAIGN_ID,
  FOUNDERS_COUNTER_BASELINE_CLAIMED,
  FOUNDERS_RESERVATION_HOLD_HOURS,
  FOUNDERS_TOTAL_SPOTS,
  verifyFoundersToken,
} from "@/lib/foundersCampaign";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const FOUNDERS_CAMPAIGN_START =
  process.env.FOUNDERS_CAMPAIGN_START ?? "2026-05-11T00:00:00Z";

function getSupabase() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://xnfjdbpjuaezxjgargto.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

function authorize(req: Request): boolean {
  const auth = req.headers.get("authorization") ?? "";
  const secret = process.env.CRON_SECRET ?? "";
  if (!secret) return false;
  return auth === `Bearer ${secret}`;
}

export async function POST(req: Request) {
  if (!authorize(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json(
      { error: "server_misconfigured" },
      { status: 500 },
    );
  }

  let body: {
    email?: string;
    token?: string;
    source?: string;
    campaign_id?: string;
    skip_spot_check?: boolean;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const email = body.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const campaignId = body.campaign_id ?? FOUNDERS_CAMPAIGN_ID;
  const source = body.source ?? "reply_email";

  // Optional token verification — if provided we require it to be valid AND
  // its email to match the body. Defense in depth for any future
  // browser-callable path that proxies through this endpoint.
  if (body.token) {
    const payload = verifyFoundersToken(body.token);
    if (!payload) {
      return NextResponse.json({ error: "invalid_token" }, { status: 400 });
    }
    if (payload.email !== email) {
      return NextResponse.json({ error: "token_email_mismatch" }, { status: 400 });
    }
  }

  // ---- 1. Spot availability gate -----------------------------------------
  // NOTE: baseline is included so the gate stays consistent with the public
  // counter in /api/reserve/spots-remaining. Adjust both via env in lockstep.
  const nowIso = new Date().toISOString();
  const baseline = FOUNDERS_COUNTER_BASELINE_CLAIMED;
  let remaining = Math.max(0, FOUNDERS_TOTAL_SPOTS - baseline);
  if (!body.skip_spot_check) {
    const [paidRes, pendingRes] = await Promise.all([
      supabase
        .from("subscribers")
        .select("id", { count: "exact", head: true })
        .eq("plan_type", "reserve_access")
        .eq("status", "active")
        .gte("acquired_at", FOUNDERS_CAMPAIGN_START),
      supabase
        .from("customer_facts")
        .select("customer_id", { count: "exact", head: true })
        .eq("reserve_reservation_source", campaignId)
        .is("reserve_reservation_paid_at", null)
        .gt("reserve_reservation_expires_at", nowIso),
    ]);
    const paid = paidRes.count ?? 0;
    const pending = pendingRes.count ?? 0;
    remaining = Math.max(0, FOUNDERS_TOTAL_SPOTS - baseline - paid - pending);
    if (remaining <= 0) {
      return NextResponse.json(
        {
          error: "no_spots_remaining",
          remaining: 0,
          baseline,
          paid,
          pending,
        },
        { status: 409 },
      );
    }
  }

  // ---- 2. Resolve customer ------------------------------------------------
  const { data: customerRow, error: customerErr } = await supabase
    .from("customers")
    .select("id, email, first_name")
    .ilike("email", email)
    .limit(1)
    .maybeSingle();
  if (customerErr) {
    console.error("[reserve-by-reply] customer lookup failed", customerErr);
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }
  if (!customerRow) {
    return NextResponse.json(
      { error: "customer_not_found", email },
      { status: 404 },
    );
  }

  // ---- 3. Upsert reservation ---------------------------------------------
  const reservedAt = new Date();
  const expiresAt = new Date(
    reservedAt.getTime() + FOUNDERS_RESERVATION_HOLD_HOURS * 60 * 60 * 1000,
  );

  // Use upsert on customer_id (PK). If a paid_at already exists we DO NOT
  // overwrite — they're a real subscriber now.
  const { data: existing, error: existingErr } = await supabase
    .from("customer_facts")
    .select("customer_id, reserve_reservation_paid_at")
    .eq("customer_id", customerRow.id)
    .maybeSingle();
  if (existingErr) {
    console.error("[reserve-by-reply] facts lookup failed", existingErr);
    return NextResponse.json({ error: "facts_lookup_failed" }, { status: 500 });
  }
  if (existing?.reserve_reservation_paid_at) {
    return NextResponse.json(
      {
        ok: true,
        already_paid: true,
        customer_id: customerRow.id,
        message: "already_subscribed",
      },
      { status: 200 },
    );
  }

  const upsertPayload = {
    customer_id: customerRow.id,
    reserve_reservation_at: reservedAt.toISOString(),
    reserve_reservation_expires_at: expiresAt.toISOString(),
    reserve_reservation_source: campaignId,
    // Explicitly leave reserve_reservation_paid_at NULL — it's set by webhook
    // when the actual Shopify subscription order completes.
    reserve_reservation_paid_at: null,
    updated_at: reservedAt.toISOString(),
  };

  const { error: upsertErr } = await supabase
    .from("customer_facts")
    .upsert(upsertPayload, { onConflict: "customer_id" });
  if (upsertErr) {
    console.error("[reserve-by-reply] upsert failed", upsertErr);
    return NextResponse.json({ error: "upsert_failed" }, { status: 500 });
  }

  return NextResponse.json(
    {
      ok: true,
      customer_id: customerRow.id,
      first_name: customerRow.first_name,
      email,
      campaign_id: campaignId,
      source,
      reserved_at: reservedAt.toISOString(),
      expires_at: expiresAt.toISOString(),
      hold_hours: FOUNDERS_RESERVATION_HOLD_HOURS,
      remaining_before: remaining,
      remaining_after: Math.max(0, remaining - 1),
    },
    { status: 200 },
  );
}
