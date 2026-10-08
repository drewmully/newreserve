/**
 * Daily membership-state sync to Klaviyo profile properties.
 *
 * Source of truth: Supabase `loop_subscriptions` (refreshed from Loop every
 * night) plus `subscribers` for member-since and cancellation dates. Klaviyo's
 * old "Active Subscribers" segment relied on Shopify tags that go stale; these
 * properties replace that test with live data:
 *
 *   mully_member_status            active | paused | cancelled | unknown
 *   mully_member_plan              reserve_member | reserve_access | back9_legacy | other
 *   mully_member_since             ISO date (first acquisition)
 *   mully_member_cancelled_at      ISO date (cancelled only)
 *   mully_member_completed_orders  number of completed subscription orders
 *   mully_member_next_billing_at   ISO date (active only)
 *   mully_member_payment_status    last Loop payment status
 *   mully_member_last_order_at     ISO date of the last Loop order
 *   mully_member_synced_at         ISO timestamp of this sync
 *
 * Source freshness is separate from delivery time. Fresh active Loop contracts
 * establish positive membership, but absence/cancellation in Loop does not prove
 * absence of a native Shopify contract. No Wave 1 launch holds are changed here.
 * Completed orders are NOT certified completed billing cycles / VIP eligibility.
 * Properties only: this never subscribes, unsubscribes or suppresses anyone.
 */

import { klaviyoRequest, KlaviyoError } from "./client";

export interface LoopRow {
  loop_subscription_id?: string | null;
  synced_at?: string | null;
  email: string | null;
  status: string | null;
  sku: string | null;
  completed_orders: number | null;
  next_billing_at: string | null;
  last_payment_status: string | null;
  last_loop_order_at: string | null;
}

export interface SubscriberRow {
  updated_at?: string | null;
  email: string | null;
  status: string | null;
  acquired_at: string | null;
  churned_at: string | null;
  plan_code: string | null;
}

export type MemberStatus = "active" | "paused" | "cancelled" | "unknown";

export interface MemberProfile {
  email: string;
  properties: Record<string, string | number | boolean | null>;
}

const SKU_PLAN: Record<string, string> = {
  "RES-MEM": "reserve_member",
  "RES-ACC": "reserve_access",
  "BCK-9": "back9_legacy",
};

const RANK: Record<MemberStatus, number> = { active: 3, paused: 2, cancelled: 1, unknown: 0 };

function loopStatus(value: string | null): MemberStatus {
  const s = (value ?? "").trim().toLowerCase();
  if (s === "active") return "active";
  if (s === "paused") return "paused";
  if (["inactive", "cancelled", "canceled", "expired"].includes(s)) return "cancelled";
  return "unknown";
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
 * Collapse contracts by ID before email, newest source snapshot first.
 * Unknown/stale negative evidence cannot certify non-membership. Historical
 * subscriber-only records are emitted as unknown to clear old active fields.
 */
export function buildMemberProfiles(
  loopRows: LoopRow[],
  subscriberRows: SubscriberRow[],
  opts: {
    now?: Date;
    /** Also emit unverified historical records with no Loop row that pass this test. */
    cancelledHistory?: (row: SubscriberRow & { updated_at?: string | null }) => boolean;
  } = {},
): MemberProfile[] {
  const now = opts.now ?? new Date();
  const syncedAt = now.toISOString();
  const fresh = (row: LoopRow) => {
    const age = now.getTime() - Date.parse(row.synced_at ?? "");
    return Number.isFinite(age) && age >= -5 * 60_000 && age <= 48 * 60 * 60_000;
  };
  const subs = new Map<string, SubscriberRow>();
  for (const row of [...subscriberRows].sort((a, b) =>
    (iso(b.updated_at) ?? "").localeCompare(iso(a.updated_at) ?? "") ||
    JSON.stringify(a).localeCompare(JSON.stringify(b)))) {
    const email = normalize(row.email);
    if (email && !subs.has(email)) subs.set(email, row);
  }

  const identities = new Map<string, Set<string>>();
  for (const row of loopRows) {
    const email = normalize(row.email);
    if (!email || !row.loop_subscription_id) continue;
    const emails = identities.get(row.loop_subscription_id) ?? new Set<string>();
    emails.add(email);
    identities.set(row.loop_subscription_id, emails);
  }
  const conflictedEmails = new Set<string>();
  for (const emails of identities.values()) if (emails.size > 1) {
    for (const email of emails) conflictedEmails.add(email);
  }
  const contracts = new Set<string>();
  const byEmail = new Map<string, LoopRow[]>();
  const sorted = [...loopRows].sort((a, b) =>
    (iso(b.synced_at) ?? "").localeCompare(iso(a.synced_at) ?? "") ||
    JSON.stringify(a).localeCompare(JSON.stringify(b)));
  for (const row of sorted) {
    const email = normalize(row.email);
    if (!email) continue;
    // Include every conflicted identity, but never let it verify membership.
    const key = row.loop_subscription_id ? `${row.loop_subscription_id}:${email}` : null;
    if (key && contracts.has(key)) continue;
    if (key) contracts.add(key);
    byEmail.set(email, [...(byEmail.get(email) ?? []), row]);
  }

  const out: MemberProfile[] = [];
  for (const [email, rows] of byEmail) {
    const sub = subs.get(email);
    const uncertain = rows.some(r => !r.loop_subscription_id || !fresh(r) || loopStatus(r.status) === "unknown");
    const active = rows.find(r => r.loop_subscription_id && fresh(r) && loopStatus(r.status) === "active");
    const ranked = [...rows].sort((a, b) => RANK[loopStatus(b.status)] - RANK[loopStatus(a.status)]);
    const best = active ?? ranked[0];
    const conflict = conflictedEmails.has(email);
    const status: MemberStatus = conflict ? "unknown" : active ? "active" : uncertain ? "unknown" : loopStatus(best.status);
    const verified = !conflict && !!active;
    const completed = rows.reduce((n, r) => n + Math.max(0, Math.floor(Number(r.completed_orders) || 0)), 0);
    const lastOrder = rows.map(r => iso(r.last_loop_order_at)).filter(Boolean).sort().at(-1);
    out.push({
      email,
      properties: {
        mully_member_status: status,
        mully_member_plan: SKU_PLAN[best.sku ?? ""] ?? sub?.plan_code ?? "other",
        mully_member_since: iso(sub?.acquired_at) ?? null,
        mully_member_cancelled_at: status === "cancelled" ? iso(sub?.churned_at) ?? null : null,
        mully_member_completed_orders: completed,
        mully_member_next_billing_at: verified ? iso(best.next_billing_at) ?? null : null,
        mully_member_payment_status: fresh(best) && !conflict ? best.last_payment_status : null,
        mully_member_last_order_at: lastOrder ?? null,
        mully_member_source_synced_at: iso(best.synced_at) ?? null,
        mully_member_source_fresh: fresh(best) && !conflict,
        mully_member_status_verified: verified,
        mully_member_verification_reason: conflict ? "contract_identity_conflict" :
          verified ? "fresh_active_loop_contract" : uncertain ? "stale_or_unknown_loop_contract" : "native_contract_coverage_unverified",
        // Orders can be free/replacements. Never advertise this as VIP status.
        mully_member_billing_cycles_verified: false,
        mully_member_synced_at: syncedAt,
      },
    });
  }

  if (opts.cancelledHistory) {
    for (const [email, sub] of subs) {
      if (byEmail.has(email) || !opts.cancelledHistory(sub)) continue;
      if ((sub.status ?? "").toLowerCase() !== "inactive" || !sub.churned_at) continue;
      out.push({
        email,
        properties: {
          mully_member_status: "unknown",
          mully_member_plan: sub.plan_code ?? null,
          mully_member_since: iso(sub.acquired_at) ?? null,
          mully_member_cancelled_at: null,
          mully_member_completed_orders: null,
          mully_member_next_billing_at: null,
          mully_member_payment_status: null,
          mully_member_last_order_at: null,
          mully_member_source_synced_at: null,
          mully_member_source_fresh: false,
          mully_member_status_verified: false,
          mully_member_verification_reason: "historical_subscriber_only",
          mully_member_billing_cycles_verified: false,
          mully_member_synced_at: syncedAt,
        },
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
