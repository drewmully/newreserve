/**
 * GET /api/reserve/spots-remaining
 *
 * Single source of truth for the Reserve Founders Shortlist v1 LP counter.
 *
 *   remaining = FOUNDERS_TOTAL_SPOTS
 *             − reserved_paid   (subscribers paid during campaign)
 *             − reserved_holds  (active reply-to-reserve holds in customer_facts)
 *
 * Cached for 30s on the edge so the LP can poll cheaply while still feeling live.
 * Returns 200 with the counter even if downstream reads fail (graceful UI fallback).
 */
import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  FOUNDERS_CAMPAIGN_ID,
  FOUNDERS_SHIP_DATE,
  FOUNDERS_TOTAL_SPOTS,
} from "@/lib/foundersCampaign";

// Campaign launch cutoff — only paid Reserve subs whose membership was acquired
// at-or-after this moment count against the Founders pool. ISO UTC.
const FOUNDERS_CAMPAIGN_START =
  process.env.FOUNDERS_CAMPAIGN_START ?? "2026-05-11T00:00:00Z";

export const runtime = "nodejs";
// Revalidate this route every 30s; the LP polls more often but hits the CDN cache.
export const revalidate = 30;

function getSupabase() {
  const url =
    process.env.SUPABASE_URL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    "https://xnfjdbpjuaezxjgargto.supabase.co";
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!key) return null;
  return createClient(url, key, { auth: { persistSession: false } });
}

export async function GET() {
  const total = FOUNDERS_TOTAL_SPOTS;
  const supabase = getSupabase();
  if (!supabase) {
    // No service role available — return total with zero claimed so the LP
    // still renders. We log so prod misconfiguration surfaces immediately.
    console.error(
      "[spots-remaining] SUPABASE_SERVICE_ROLE_KEY missing; returning fallback",
    );
    return NextResponse.json(
      {
        campaign_id: FOUNDERS_CAMPAIGN_ID,
        total_spots: total,
        paid: 0,
        pending: 0,
        remaining: total,
        deadline: FOUNDERS_SHIP_DATE,
        campaign_start: FOUNDERS_CAMPAIGN_START,
        degraded: true,
      },
      {
        headers: {
          "cache-control": "public, max-age=10, s-maxage=30",
        },
      },
    );
  }

  // 1) Paid Founders: active Reserve subscribers acquired at-or-after launch.
  const paidQuery = supabase
    .from("subscribers")
    .select("id", { count: "exact", head: true })
    .eq("plan_type", "reserve_access")
    .eq("status", "active")
    .gte("acquired_at", FOUNDERS_CAMPAIGN_START);

  // 2) Pending reply-to-reserve holds whose 48h window hasn't elapsed
  //    AND haven't already converted (paid_at IS NULL).
  const nowIso = new Date().toISOString();
  const pendingQuery = supabase
    .from("customer_facts")
    .select("customer_id", { count: "exact", head: true })
    .eq("reserve_reservation_source", FOUNDERS_CAMPAIGN_ID)
    .is("reserve_reservation_paid_at", null)
    .gt("reserve_reservation_expires_at", nowIso);

  const [paidRes, pendingRes] = await Promise.all([paidQuery, pendingQuery]);

  if (paidRes.error)
    console.error("[spots-remaining] paid count error", paidRes.error);
  if (pendingRes.error)
    console.error("[spots-remaining] pending count error", pendingRes.error);

  const paid = paidRes.count ?? 0;
  const pending = pendingRes.count ?? 0;
  const remaining = Math.max(0, total - paid - pending);

  return NextResponse.json(
    {
      campaign_id: FOUNDERS_CAMPAIGN_ID,
      total_spots: total,
      paid,
      pending,
      remaining,
      deadline: FOUNDERS_SHIP_DATE,
      campaign_start: FOUNDERS_CAMPAIGN_START,
    },
    {
      headers: {
        // Short TTL — LP polls every ~30s and we want near-live counter.
        "cache-control": "public, max-age=10, s-maxage=30, stale-while-revalidate=60",
      },
    },
  );
}
