/**
 * Daily membership-state sync to Klaviyo profile properties.
 *
 * Source of truth: Supabase `loop_subscriptions` (refreshed from Loop every
 * night) plus `subscribers` for member-since and cancellation dates. Klaviyo's
 * old "Active Subscribers" segment relied on Shopify tags that go stale; these
 * properties replace that test with live data:
 *
 *   mully_member_status            active | paused | cancelled
 *   mully_member_plan              reserve_member | reserve_access | back9_legacy | other
 *   mully_member_since             ISO date (first acquisition)
 *   mully_member_cancelled_at      ISO date (cancelled only)
 *   mully_member_completed_orders  number of completed subscription orders
 *   mully_member_next_billing_at   ISO date (active only)
 *   mully_member_payment_status    last Loop payment status
 *   mully_member_last_order_at     ISO date of the last Loop order
 *   mully_member_synced_at         ISO timestamp of this sync
 *
 * Properties only: this never subscribes, unsubscribes or suppresses anyone.
 */

import { klaviyoRequest, KlaviyoError } from "./client";

export interface LoopRow {
  email: string | null;
  status: string | null;
  sku: string | null;
  completed_orders: number | null;
  next_billing_at: string | null;
  last_payment_status: string | null;
  last_loop_order_at: string | null;
}

export interface SubscriberRow {
  email: string | null;
  status: string | null;
  acquired_at: string | null;
  churned_at: string | null;
  plan_code: string | null;
}

export type MemberStatus = "active" | "paused" | "cancelled";

export interface MemberProfile {
  email: string;
  properties: Record<string, string | number>;
}

const SKU_PLAN: Record<string, string> = {
  "RES-MEM": "reserve_member",
  "RES-ACC": "reserve_access",
  "BCK-9": "back9_legacy",
};

const RANK: Record<MemberStatus, number> = { active: 3, paused: 2, cancelled: 1 };

function loopStatus(value: string | null): MemberStatus {
  const s = (value ?? "").toLowerCase();
  if (s === "active") return "active";
  if (s === "paused") return "paused";
  return "cancelled";
}

const iso = (v: string | null | undefined) => {
  if (!v) return undefined;
  const t = Date.parse(v);
  return Number.isNaN(t) ? undefined : new Date(t).toISOString();
};

const normalize = (email: string | null) => {
  const e = (email ?? "").trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e) ? e : null;
};

/**
 * Collapse rows to one profile per email. Loop rows win; subscriber rows
 * only add dates, or mark someone cancelled who no longer has a Loop row
 * (when `cancelledHistory` is given).
 */
export function buildMemberProfiles(
  loopRows: LoopRow[],
  subscriberRows: SubscriberRow[],
  opts: {
    now?: Date;
    /** Also emit "cancelled" for subscriber rows with no Loop row that pass this test. */
    cancelledHistory?: (row: SubscriberRow & { updated_at?: string | null }) => boolean;
  } = {},
): MemberProfile[] {
  const syncedAt = (opts.now ?? new Date()).toISOString();
  const subs = new Map<string, SubscriberRow>();
  for (const row of subscriberRows) {
    const email = normalize(row.email);
    if (email && !subs.has(email)) subs.set(email, row);
  }

  type Acc = { status: MemberStatus; best: LoopRow; completed: number; lastOrder?: string };
  const byEmail = new Map<string, Acc>();
  for (const row of loopRows) {
    const email = normalize(row.email);
    if (!email) continue;
    const status = loopStatus(row.status);
    const completed = Math.max(0, Number(row.completed_orders) || 0);
    const lastOrder = iso(row.last_loop_order_at);
    const prev = byEmail.get(email);
    if (!prev) {
      byEmail.set(email, { status, best: row, completed, lastOrder });
      continue;
    }
    if (RANK[status] > RANK[prev.status]) {
      prev.status = status;
      prev.best = row;
    }
    prev.completed += completed;
    if (lastOrder && (!prev.lastOrder || lastOrder > prev.lastOrder)) prev.lastOrder = lastOrder;
  }

  const out: MemberProfile[] = [];
  const clean = (o: Record<string, string | number | undefined>) =>
    Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as Record<string, string | number>;

  for (const [email, acc] of byEmail) {
    const sub = subs.get(email);
    out.push({
      email,
      properties: clean({
        mully_member_status: acc.status,
        mully_member_plan: SKU_PLAN[acc.best.sku ?? ""] ?? sub?.plan_code ?? "other",
        mully_member_since: iso(sub?.acquired_at),
        mully_member_cancelled_at: acc.status === "cancelled" ? iso(sub?.churned_at) : undefined,
        mully_member_completed_orders: acc.completed,
        mully_member_next_billing_at: acc.status === "active" ? iso(acc.best.next_billing_at) : undefined,
        mully_member_payment_status: acc.best.last_payment_status ?? undefined,
        mully_member_last_order_at: acc.lastOrder,
        mully_member_synced_at: syncedAt,
      }),
    });
  }

  if (opts.cancelledHistory) {
    for (const [email, sub] of subs) {
      if (byEmail.has(email) || !opts.cancelledHistory(sub)) continue;
      if ((sub.status ?? "").toLowerCase() !== "inactive" || !sub.churned_at) continue;
      out.push({
        email,
        properties: clean({
          mully_member_status: "cancelled",
          mully_member_plan: sub.plan_code ?? undefined,
          mully_member_since: iso(sub.acquired_at),
          mully_member_cancelled_at: iso(sub.churned_at),
          mully_member_synced_at: syncedAt,
        }),
      });
    }
  }
  return out;
}

export interface PushSummary {
  profiles: number;
  jobs: number;
  failedJobs: number;
  errorCodes: string[];
}

/** Klaviyo bulk profile import accepts up to 10,000 profiles per job. */
const CHUNK = 5_000;

export async function pushMemberProfiles(profiles: MemberProfile[]): Promise<PushSummary> {
  const summary: PushSummary = { profiles: profiles.length, jobs: 0, failedJobs: 0, errorCodes: [] };
  for (let i = 0; i < profiles.length; i += CHUNK) {
    const chunk = profiles.slice(i, i + CHUNK);
    try {
      await klaviyoRequest("/api/profile-bulk-import-jobs", {
        body: {
          data: {
            type: "profile-bulk-import-job",
            attributes: {
              profiles: {
                data: chunk.map((p) => ({ type: "profile", attributes: { email: p.email, properties: p.properties } })),
              },
            },
          },
        },
      });
      summary.jobs += 1;
    } catch (err) {
      summary.failedJobs += 1;
      summary.errorCodes.push(err instanceof KlaviyoError ? err.message : "unexpected");
    }
  }
  return summary;
}

export function countByStatus(profiles: MemberProfile[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const p of profiles) {
    const s = String(p.properties.mully_member_status);
    counts[s] = (counts[s] ?? 0) + 1;
  }
  return counts;
}
