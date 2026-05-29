/**
 * Loop-backed "Rocks" counters for /admin/marketing-funnel.
 *
 *   Rock 1 — New Reserve signups
 *     A Reserve Access or Reserve Member subscription that was created
 *     on/after the cutoff date (default 2026-04-22). Any current status
 *     counts (ACTIVE, CANCELLED, PAUSED) — the signup itself counts.
 *
 *   Rock 2 — Reserve Swaps
 *     A subscription that was created BEFORE the cutoff but is currently
 *     ACTIVE on Reserve Access or Reserve Member. This captures customers
 *     who came in on an older plan and are now on Reserve.
 *
 * Both counters require enumerating subscriptions across pages on Loop's
 * `/subscription` endpoint:
 *   - Rock 1 needs ACTIVE + CANCELLED + PAUSED with createdAt >= cutoff.
 *   - Rock 2 needs ACTIVE with createdAt < cutoff.
 *
 * Loop has no created-date filter, but it does sort by createdAt DESC by
 * default — which means once we walk into a page where every row has
 * createdAt < cutoff, we can stop early for Rock 1. (Rock 2 needs all
 * ACTIVE subs but that's only ~30 pages at ~50/page.)
 *
 * Loop rate limit: 3 req/sec, so we sleep ~400 ms between page fetches.
 *
 * Results are cached in-process for 5 minutes to avoid hammering Loop on
 * every dashboard refresh.
 */
import { resolveMemberTierFromVariantId } from "@/lib/membershipConfig";

const BASE_URL =
  process.env.LOOP_API_BASE_URL ??
  "https://api.loopsubscriptions.com/admin/2023-10";

const DEFAULT_CUTOFF_ISO = "2026-04-22T00:00:00.000Z";

const ROCK_NEW_SIGNUPS_GOAL = 300;
const ROCK_SWAPS_GOAL = 300;

const LOOP_STATUSES_FOR_SIGNUPS = ["ACTIVE", "CANCELLED", "PAUSED"] as const;
type LoopStatus = (typeof LOOP_STATUSES_FOR_SIGNUPS)[number];

interface LoopSubLine {
  variantShopifyId?: number | string | null;
  productTitle?: string | null;
}

interface LoopSubRow {
  id: number | string;
  status: string;
  createdAt: string; // ISO
  lines?: LoopSubLine[];
  customer?: { id?: number | string; email?: string | null } | null;
}

interface LoopPage {
  data: LoopSubRow[];
  pageInfo: { hasNextPage?: boolean; hasPreviousPage?: boolean };
}

export interface RocksData {
  cutoff_iso: string;
  generated_at: string;
  // Rock 1: new signups (any state) created >= cutoff on Reserve tier
  new_signups: {
    goal: number;
    total: number;
    access: number;
    member: number;
    by_status: Record<LoopStatus, number>;
    first_signup_iso: string | null;
    latest_signup_iso: string | null;
  };
  // Rock 2: swaps (active on Reserve, sub created < cutoff)
  swaps: {
    goal: number;
    total: number;
    access: number;
    member: number;
    earliest_active_iso: string | null;
  };
  warnings: string[];
}

function getHeaders(): Record<string, string> {
  const token = process.env.LOOP_ADMIN_API_TOKEN;
  if (!token) throw new Error("Missing LOOP_ADMIN_API_TOKEN");
  return { "X-Loop-Token": token, "Content-Type": "application/json" };
}

async function fetchLoopPage(
  status: LoopStatus,
  pageNo: number,
  attempt = 0
): Promise<LoopPage> {
  const url = `${BASE_URL}/subscription?status=${status}&pageNo=${pageNo}`;
  const res = await fetch(url, { headers: getHeaders() });
  if (res.status === 429 && attempt < 5) {
    const backoff = 1500 * (attempt + 1);
    await new Promise((r) => setTimeout(r, backoff));
    return fetchLoopPage(status, pageNo, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(
      `Loop /subscription ${status} pageNo=${pageNo} → ${res.status}: ${await res.text()}`
    );
  }
  return (await res.json()) as LoopPage;
}

/**
 * Walk all pages of a given status, calling `handle` for each subscription.
 * `handle` may return `false` to stop early.
 */
async function walkStatus(
  status: LoopStatus,
  handle: (sub: LoopSubRow) => boolean | void
): Promise<void> {
  let pageNo = 1;
  // Safety cap — Loop has well under 10k subs total today; 500 pages * 50 = 25k.
  while (pageNo <= 500) {
    const page = await fetchLoopPage(status, pageNo);
    for (const sub of page.data) {
      const cont = handle(sub);
      if (cont === false) return;
    }
    if (!page.pageInfo?.hasNextPage) return;
    pageNo++;
    // ~3 req/sec ceiling
    await new Promise((r) => setTimeout(r, 380));
  }
}

function subTier(sub: LoopSubRow): "access" | "member" | null {
  const line = sub.lines?.[0];
  if (!line) return null;
  const tier = resolveMemberTierFromVariantId(line.variantShopifyId);
  return tier ?? null;
}

// ─── In-process cache ─────────────────────────────────────────────────────────
let CACHED: { at: number; data: RocksData } | null = null;
const TTL_MS = 5 * 60 * 1000;

/**
 * Compute current Rock progress. Cached for 5 minutes.
 */
export async function getRocksProgress(
  cutoffIso: string = DEFAULT_CUTOFF_ISO
): Promise<RocksData> {
  const now = Date.now();
  if (CACHED && now - CACHED.at < TTL_MS && CACHED.data.cutoff_iso === cutoffIso) {
    return CACHED.data;
  }

  const cutoff = new Date(cutoffIso).getTime();
  const warnings: string[] = [];

  // Rock 1 — new signups (any state) created >= cutoff
  // Loop returns sorted by createdAt DESC by default, so we walk forward and
  // stop the first time we see an entire page below the cutoff.
  const newSignupsByStatus: Record<LoopStatus, number> = {
    ACTIVE: 0,
    CANCELLED: 0,
    PAUSED: 0,
  };
  let newAccess = 0;
  let newMember = 0;
  let firstSignup: number | null = null;
  let latestSignup: number | null = null;

  // Rock 2 — swaps (active, created < cutoff, on Reserve tier)
  let swapAccess = 0;
  let swapMember = 0;
  let earliestActive: number | null = null;

  for (const status of LOOP_STATUSES_FOR_SIGNUPS) {
    let sawBelowCutoff = 0;
    await walkStatus(status, (sub) => {
      const createdMs = Date.parse(sub.createdAt);
      if (!Number.isFinite(createdMs)) return;
      const tier = subTier(sub);
      if (!tier) return;

      if (createdMs >= cutoff) {
        // Rock 1
        newSignupsByStatus[status]++;
        if (tier === "access") newAccess++;
        else newMember++;
        firstSignup =
          firstSignup === null ? createdMs : Math.min(firstSignup, createdMs);
        latestSignup =
          latestSignup === null ? createdMs : Math.max(latestSignup, createdMs);
        sawBelowCutoff = 0;
      } else {
        // Below the cutoff
        sawBelowCutoff++;
        if (status === "ACTIVE") {
          // Rock 2
          if (tier === "access") swapAccess++;
          else swapMember++;
          earliestActive =
            earliestActive === null
              ? createdMs
              : Math.min(earliestActive, createdMs);
        }
        // For CANCELLED / PAUSED we can stop scanning once we've seen 80
        // consecutive sub-cutoff rows (one full page + safety margin) since
        // Loop sorts DESC. ACTIVE we keep walking — we need every row for
        // Rock 2.
        if (status !== "ACTIVE" && sawBelowCutoff > 80) {
          return false;
        }
      }
    });
  }

  const data: RocksData = {
    cutoff_iso: cutoffIso,
    generated_at: new Date().toISOString(),
    new_signups: {
      goal: ROCK_NEW_SIGNUPS_GOAL,
      total: newAccess + newMember,
      access: newAccess,
      member: newMember,
      by_status: newSignupsByStatus,
      first_signup_iso: firstSignup ? new Date(firstSignup).toISOString() : null,
      latest_signup_iso: latestSignup
        ? new Date(latestSignup).toISOString()
        : null,
    },
    swaps: {
      goal: ROCK_SWAPS_GOAL,
      total: swapAccess + swapMember,
      access: swapAccess,
      member: swapMember,
      earliest_active_iso: earliestActive
        ? new Date(earliestActive).toISOString()
        : null,
    },
    warnings,
  };

  CACHED = { at: now, data };
  return data;
}
