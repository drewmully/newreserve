/**
 * GET /api/admin/cron/klaviyo-member-sync
 *
 * Daily (after the nightly Loop refresh): writes membership state from
 * Supabase onto Klaviyo profile properties (see src/lib/klaviyo/memberSync.ts).
 *
 *   ?dry=1   counts only, nothing sent to Klaviyo
 *   ?full=1  also marks every historical cancelled subscriber (one-time backfill)
 *
 * Auth: Bearer CRON_SECRET. Off unless KLAVIYO_MEMBER_SYNC_ENABLED=true.
 * Returns counts only; never emails.
 */

import { NextResponse } from "next/server";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import { isCronAuthorized } from "@/lib/klaviyo/worker";
import { isLifecycleEnabled } from "@/lib/klaviyo/lifecycleConfig";
import {
  buildMemberProfiles,
  countByStatus,
  pushMemberProfiles,
  type LoopRow,
  type SubscriberRow,
} from "@/lib/klaviyo/memberSync";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const PAGE = 1000;
const RECENT_MS = 3 * 24 * 60 * 60 * 1000;

async function readAll<T>(table: string, columns: string, apply?: (q: any) => any): Promise<T[]> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const sb = getSupabaseService();
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE) {
    let q = sb.from(table).select(columns).order("email", { ascending: true }).range(from, from + PAGE - 1);
    if (apply) q = apply(q);
    const { data, error } = await q;
    if (error) throw new Error(`read_${table}_failed`);
    rows.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return rows;
}

export async function GET(req: Request) {
  if (!isCronAuthorized(req)) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const url = new URL(req.url);
  const dry = url.searchParams.get("dry") === "1";
  const full = url.searchParams.get("full") === "1";
  if (!dry && !isLifecycleEnabled("member_sync")) {
    return NextResponse.json({ ok: true, skipped: true, reason: "disabled" });
  }

  try {
    const [loopRows, subscriberRows] = await Promise.all([
      readAll<LoopRow>(
        "loop_subscriptions",
        "email,status,sku,completed_orders,next_billing_at,last_payment_status,last_loop_order_at",
      ),
      readAll<SubscriberRow & { updated_at: string | null }>(
        "subscribers",
        "email,status,acquired_at,churned_at,plan_code,updated_at",
        (q) => q.neq("status", "never"),
      ),
    ]);

    const since = Date.now() - RECENT_MS;
    const profiles = buildMemberProfiles(loopRows, subscriberRows, {
      cancelledHistory: (row) => full || Date.parse(row.updated_at ?? "") >= since,
    });

    const counts = countByStatus(profiles);
    if (dry) return NextResponse.json({ ok: true, dry: true, full, counts, profiles: profiles.length });

    const summary = await pushMemberProfiles(profiles);
    const ok = summary.failedJobs === 0;
    if (!ok) console.error(`[klaviyo-member-sync] ${summary.failedJobs} job(s) failed: ${summary.errorCodes.join(",")}`);
    return NextResponse.json({ ok, full, counts, ...summary }, { status: ok ? 200 : 502 });
  } catch (err) {
    console.error(`[klaviyo-member-sync] failed: ${err instanceof Error ? err.message : "unexpected"}`);
    return NextResponse.json({ ok: false, error: "sync_failed" }, { status: 500 });
  }
}
