/**
 * Durable, order-scoped lifecycle dispatch. OFF by default.
 *
 * Order of safety checks for every row:
 *   1. Global kill switch LIFECYCLE_DISPATCH_ENABLED must be exactly "true".
 *   2. The row's program must be in LIFECYCLE_DISPATCH_PROGRAMS (allowlist).
 *   3. A FRESH recheck (live order, membership, consent, service) must pass.
 *   4. The Klaviyo event uses the dedupe key as `unique_id`, so a retry after
 *      an ambiguous network failure cannot create a second event.
 * When disabled, nothing is claimed and no row changes state.
 */
import type { OrderLifecycle } from "@/lib/klaviyo/eligibility";

export const PROGRAMS: readonly OrderLifecycle[] = ["shop_purchase", "shop_delivery", "member_start", "member_first_delivery"];
export const METRIC_NAMES: Readonly<Record<OrderLifecycle, string>> = Object.freeze({
  shop_purchase: "Mully Lifecycle Shop Purchase Verified",
  shop_delivery: "Mully Lifecycle Shop Delivery Verified",
  member_start: "Mully Lifecycle Member Start Verified",
  member_first_delivery: "Mully Lifecycle Member First Delivery Verified",
});
const MAX_ATTEMPTS = 5;

export interface OutboxRow {
  id: number;
  dedupe_key: string;
  program: OrderLifecycle;
  shopify_customer_id: string;
  shopify_order_id: string;
  attempts: number;
  lease_token: string;
}
export type Finish =
  | { state: "sent" }
  | { state: "held"; holds: string[] }
  | { state: "failed"; error: string; retryAt: string }
  | { state: "dead"; error: string };

export interface OutboxRepo {
  enqueue(row: { dedupe_key: string; program: OrderLifecycle; shopify_customer_id: string; shopify_order_id: string }): Promise<"inserted" | "duplicate">;
  claim(limit: number, leaseSeconds: number): Promise<OutboxRow[]>;
  finish(id: number, leaseToken: string, result: Finish): Promise<boolean>;
}
export interface Recheck {
  eligible: boolean;
  holds: string[];
  /** Fresh profile identifier from the live order read. Never persisted. */
  email: string | null;
}
export interface DispatchConfig { enabled: boolean; programs: Set<OrderLifecycle> }

export function readDispatchConfig(env: Record<string, string | undefined> = process.env): DispatchConfig {
  const programs = new Set<OrderLifecycle>();
  for (const p of (env.LIFECYCLE_DISPATCH_PROGRAMS ?? "").split(",").map((s) => s.trim())) {
    if ((PROGRAMS as readonly string[]).includes(p)) programs.add(p as OrderLifecycle);
  }
  return { enabled: env.LIFECYCLE_DISPATCH_ENABLED === "true" && programs.size > 0, programs };
}

/** Enqueue only fully verified audit candidates with a stable key. */
export async function enqueueCandidate(repo: OutboxRepo, decision: {
  auditCandidate: boolean; dedupeKey: string | null; orderId: string | null; kind: OrderLifecycle;
}, customerId: string) {
  if (!decision.auditCandidate || !decision.dedupeKey || !decision.orderId) return "not_candidate" as const;
  if (!/^mully-lifecycle-v1:[0-9a-f]{64}$/.test(decision.dedupeKey)) return "not_candidate" as const;
  if (!/^[1-9]\d*$/.test(customerId)) return "not_candidate" as const;
  return repo.enqueue({ dedupe_key: decision.dedupeKey, program: decision.kind,
    shopify_customer_id: customerId, shopify_order_id: decision.orderId });
}

export function klaviyoEventBody(row: OutboxRow, email: string, now: Date) {
  return {
    data: {
      type: "event",
      attributes: {
        unique_id: row.dedupe_key,
        time: now.toISOString(),
        metric: { data: { type: "metric", attributes: { name: METRIC_NAMES[row.program] } } },
        profile: { data: { type: "profile", attributes: { email } } },
        // IDs only. Personalization comes from Klaviyo's own Shopify data.
        properties: { Program: row.program, OrderId: row.shopify_order_id, DedupeKey: row.dedupe_key, Source: "mully_lifecycle_outbox" },
      },
    },
  };
}

export interface SendError { retryable: boolean; code: string }
export interface DispatchDeps {
  repo: OutboxRepo;
  recheck: (row: OutboxRow) => Promise<Recheck>;
  send: (body: ReturnType<typeof klaviyoEventBody>) => Promise<void>;
  config?: DispatchConfig;
  now?: () => Date;
  limit?: number;
}

export async function runDispatchBatch(deps: DispatchDeps) {
  const config = deps.config ?? readDispatchConfig();
  const now = deps.now ?? (() => new Date());
  const summary = { enabled: config.enabled, claimed: 0, sent: 0, held: 0, failed: 0, dead: 0, lost_lease: 0 };
  if (!config.enabled) return summary; // Nothing is claimed or changed.
  const rows = await deps.repo.claim(Math.min(deps.limit ?? 25, 100), 120);
  summary.claimed = rows.length;
  for (const row of rows) {
    let result: Finish;
    if (!config.programs.has(row.program)) {
      result = { state: "held", holds: ["program_not_enabled"] };
    } else {
      let check: Recheck;
      try { check = await deps.recheck(row); } catch { check = { eligible: false, holds: ["recheck_failed"], email: null }; }
      const email = check.email?.trim() ?? "";
      if (check.holds.includes("recheck_failed")) {
        result = retry(row, "recheck_failed", now());
      } else if (!check.eligible || check.holds.length || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        result = { state: "held", holds: check.holds.length ? [...new Set(check.holds)].sort() : ["recheck_identity_unverified"] };
      } else {
        try {
          await deps.send(klaviyoEventBody(row, email, now()));
          result = { state: "sent" };
        } catch (err) {
          const e = err as Partial<SendError>;
          result = e?.retryable ? retry(row, String(e.code ?? "send_failed").slice(0, 80), now())
            : { state: "dead", error: String(e?.code ?? "send_rejected").slice(0, 80) };
        }
      }
    }
    const kept = await deps.repo.finish(row.id, row.lease_token, result);
    if (!kept) { summary.lost_lease++; continue; }
    summary[result.state]++;
  }
  return summary;
}

function retry(row: OutboxRow, error: string, now: Date): Finish {
  if (row.attempts >= MAX_ATTEMPTS) return { state: "dead", error };
  const delayMs = Math.min(6 * 3_600_000, 60_000 * 2 ** row.attempts);
  return { state: "failed", error, retryAt: new Date(now.getTime() + delayMs).toISOString() };
}
