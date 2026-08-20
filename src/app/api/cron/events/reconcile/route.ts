/**
 * GET /api/cron/events/reconcile
 *
 * Two passes, in this order:
 *
 *   1. RETRY — every inbound_event still `pending` or carrying an `error`, with
 *      attempts < 5, is re-processed from its stored payload. This is what makes
 *      a transient Supabase failure during the front door's deferred resolution
 *      recoverable instead of permanent.
 *
 *   2. LOOP SWEEP — Loop publishes no signature and documents no delivery
 *      retry, so a dropped Loop webhook is invisible. For recently active
 *      customers we ask Loop directly what state its subscriptions are in and
 *      synthesise a `source='reconciler'` event for any terminal state we can
 *      name. The deterministic id `recon:subscription:<id>:<state>` means the
 *      same state only ever produces one row, and a real webhook that arrives
 *      later for the same state collapses onto it.
 *
 * Known gap, deliberately not papered over: Loop's admin API exposes only
 * per-customer and per-subscription reads — there is no "list recent
 * subscriptions" endpoint. So the sweep can only reconcile customers the event
 * log has already seen. A Loop customer we have never received any event for is
 * undiscoverable, and no amount of code here changes that.
 *
 * Adds ZERO outbound customer sends. It writes to inbound_event, customers
 * (via the resolver's documented column contract) and backbone_alert only.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService, withJobRun } from "@/app/api/_lib/supabaseService";
import { getLoopRawSubscriptions } from "@/app/api/_lib/loopAdmin";
import { ingestInboundEvent, processInboundEvent } from "@/lib/events/ingest";
import type { CanonicalEvent, EventName, EventSource } from "@/lib/events/catalog";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** Give up after this many tries so a permanently broken row stops burning budget. */
const MAX_ATTEMPTS = 5;
const RETRY_BATCH = 200;

/** Bounded because each customer costs one Loop round-trip. */
const LOOP_SWEEP_CUSTOMERS = 25;
const LOOP_SWEEP_LOOKBACK_DAYS = 30;

/** Ids at or above this are synthetic — Loop has never heard of them. */
const SYNTHETIC_ID_BASE = BigInt("9000000000000000");

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return (req.headers.get("user-agent") || "").includes("vercel-cron");
}

/**
 * Loop subscription status → canonical event.
 *
 * ACTIVE is deliberately absent: the catalog has no "subscription is fine"
 * event, and inventing one would put a row in the log that no webhook could
 * ever produce.
 */
const LOOP_STATUS_TO_EVENT: Record<string, CanonicalEvent> = {
  CANCELLED: "subscription.cancelled",
  CANCELED: "subscription.cancelled",
  PAUSED: "subscription.paused",
  EXPIRED: "subscription.expired",
  FAILED: "subscription.payment_failed",
};

interface RetryRow {
  id: number;
  source: string;
  event_name: string;
  payload: unknown;
  payload_purged_at: string | null;
  attempts: number;
}

async function retryPass(sb: ReturnType<typeof getSupabaseService>) {
  const select = "id,source,event_name,payload,payload_purged_at,attempts";

  const [pending, errored] = await Promise.all([
    sb
      .from("inbound_event")
      .select(select)
      .eq("resolution", "pending")
      .lt("attempts", MAX_ATTEMPTS)
      .order("received_at", { ascending: true })
      .limit(RETRY_BATCH),
    sb
      .from("inbound_event")
      .select(select)
      .not("error", "is", null)
      .lt("attempts", MAX_ATTEMPTS)
      .order("received_at", { ascending: true })
      .limit(RETRY_BATCH),
  ]);

  const byId = new Map<number, RetryRow>();
  for (const row of [...((pending.data ?? []) as RetryRow[]), ...((errored.data ?? []) as RetryRow[])]) {
    byId.set(row.id, row);
  }

  let retried = 0;
  let unpurgeable = 0;
  const resolutions: Record<string, number> = {};

  for (const row of byId.values()) {
    if (row.payload === null || row.payload_purged_at !== null) {
      // Nothing left to resolve from. Close it out rather than retrying forever.
      await sb
        .from("inbound_event")
        .update({
          resolution: "unresolvable",
          resolution_detail: "payload_unavailable_for_retry",
          processed_at: new Date().toISOString(),
          attempts: MAX_ATTEMPTS,
        })
        .eq("id", row.id);
      unpurgeable += 1;
      continue;
    }

    const result = await processInboundEvent(
      {
        id: row.id,
        source: row.source as EventSource,
        eventName: row.event_name as EventName,
        payload: row.payload,
      },
      sb,
    );
    retried += 1;
    resolutions[result.resolution] = (resolutions[result.resolution] ?? 0) + 1;
  }

  return { candidates: byId.size, retried, closed_payload_unavailable: unpurgeable, resolutions };
}

async function loopSweep(sb: ReturnType<typeof getSupabaseService>) {
  if (!process.env.LOOP_ADMIN_API_TOKEN) {
    return { skipped: "LOOP_ADMIN_API_TOKEN is not set", customers: 0, synthesised: 0, duplicates: 0, errors: [] as string[] };
  }

  const since = new Date(Date.now() - LOOP_SWEEP_LOOKBACK_DAYS * 86400_000).toISOString();
  const { data, error } = await sb
    .from("inbound_event")
    .select("customer_id,received_at")
    .not("customer_id", "is", null)
    .gte("received_at", since)
    .order("received_at", { ascending: false })
    .limit(2000);

  if (error) {
    return { skipped: null, customers: 0, synthesised: 0, duplicates: 0, errors: [error.message] };
  }

  const customerIds: string[] = [];
  const seen = new Set<string>();
  for (const row of (data ?? []) as { customer_id: number | string }[]) {
    const id = String(row.customer_id);
    if (seen.has(id)) continue;
    if (BigInt(id) >= SYNTHETIC_ID_BASE) continue; // Loop only knows Shopify ids.
    seen.add(id);
    customerIds.push(id);
    if (customerIds.length >= LOOP_SWEEP_CUSTOMERS) break;
  }

  let synthesised = 0;
  let duplicates = 0;
  const errors: string[] = [];

  for (const customerId of customerIds) {
    let subs;
    try {
      subs = await getLoopRawSubscriptions(customerId);
    } catch (err) {
      errors.push(`${customerId}: ${err instanceof Error ? err.message : String(err)}`);
      continue;
    }

    for (const sub of subs) {
      const status = String(sub.status ?? "").toUpperCase();
      const eventName = LOOP_STATUS_TO_EVENT[status];
      if (!eventName) continue;

      const result = await ingestInboundEvent(
        {
          source: "reconciler",
          sourceEventId: `recon:subscription:${sub.id}:${status.toLowerCase()}`,
          sourceTopic: `loop:${status.toLowerCase()}`,
          eventName,
          payload: {
            shopify_customer_id: customerId,
            subscription_id: sub.id,
            status,
            observed_by: "events/reconcile",
          },
        },
        sb,
      );

      if (result.duplicate) duplicates += 1;
      else synthesised += 1;
    }
  }

  return { skipped: null, customers: customerIds.length, synthesised, duplicates, errors };
}

export async function GET(request: NextRequest) {
  if (!isAuthorized(request)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const run = await withJobRun("events-reconcile", async ({ bumpRows, setMeta }) => {
    const sb = getSupabaseService();
    const retry = await retryPass(sb);
    const loop = await loopSweep(sb);
    bumpRows(retry.candidates + loop.customers, retry.retried + loop.synthesised);
    setMeta({ retry, loop });
    return { retry, loop };
  });

  return NextResponse.json(run, { status: run.ok ? 200 : 500 });
}
