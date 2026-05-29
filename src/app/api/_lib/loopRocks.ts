/**
 * Rocks counters for /admin/marketing-funnel.
 *
 *   Rock 1 — New Reserve signups
 *     A Shopify order tagged "Subscription First Order" with a Reserve
 *     Access or Reserve Member line item, placed on/after the cutoff
 *     (default 2026-04-22). Pulled from Shopify GraphQL (one request,
 *     tag-filtered server-side) — much faster than scanning Loop.
 *
 *   Rock 2 — Reserve Swaps
 *     A Loop subscription that is currently ACTIVE on Reserve Access or
 *     Reserve Member but was created BEFORE the cutoff. This captures
 *     customers who came in on an older plan and are now on Reserve.
 *
 *   The data sources are split because they answer different questions:
 *     - Signups are an order-level event (best from Shopify).
 *     - Swaps are a subscription-state question (only Loop knows current
 *       sub status by tier).
 *
 *   Loop sorts /subscription ASC by createdAt by default, so for swaps we
 *   can walk pages from page 1 (oldest first) and stop the moment we see
 *   a row with createdAt >= cutoff — everything after that point is a new
 *   signup, not a swap.
 *
 *   Results are cached in-process for 5 minutes.
 */
import { resolveMemberTierFromVariantId } from "@/lib/membershipConfig";

const LOOP_BASE_URL =
  process.env.LOOP_API_BASE_URL ??
  "https://api.loopsubscriptions.com/admin/2023-10";

const DEFAULT_CUTOFF_ISO = "2026-04-22T00:00:00.000Z";
const ROCK_NEW_SIGNUPS_GOAL = 300;
const ROCK_SWAPS_GOAL = 300;

// ─── Types ────────────────────────────────────────────────────────────────────

interface LoopSubLine {
  variantShopifyId?: number | string | null;
}
interface LoopSubRow {
  id: number | string;
  status: string;
  createdAt: string; // ISO
  lines?: LoopSubLine[];
}
interface LoopPage {
  data: LoopSubRow[];
  pageInfo: { hasNextPage?: boolean };
}

export interface RocksData {
  cutoff_iso: string;
  generated_at: string;
  new_signups: {
    goal: number;
    total: number;
    access: number;
    member: number;
    by_status: { ACTIVE: number; CANCELLED: number; PAUSED: number };
    first_signup_iso: string | null;
    latest_signup_iso: string | null;
  };
  swaps: {
    goal: number;
    total: number;
    access: number;
    member: number;
    earliest_active_iso: string | null;
  };
  warnings: string[];
}

// ─── Loop helpers (used for swaps only) ───────────────────────────────────────

function loopHeaders(): Record<string, string> {
  const token = process.env.LOOP_ADMIN_API_TOKEN;
  if (!token) throw new Error("Missing LOOP_ADMIN_API_TOKEN");
  return { "X-Loop-Token": token, "Content-Type": "application/json" };
}

// Loop allows 3 req/sec. Space pages 340 ms apart.
const LOOP_SPACING_MS = 340;
let loopNextSlot = 0;
async function loopGate(): Promise<void> {
  const now = Date.now();
  const slot = Math.max(now, loopNextSlot);
  loopNextSlot = slot + LOOP_SPACING_MS;
  const wait = slot - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
}

async function fetchLoopActivePage(
  pageNo: number,
  attempt = 0
): Promise<LoopPage> {
  await loopGate();
  const url = `${LOOP_BASE_URL}/subscription?status=ACTIVE&pageNo=${pageNo}`;
  const res = await fetch(url, { headers: loopHeaders() });
  if (res.status === 429 && attempt < 5) {
    await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    return fetchLoopActivePage(pageNo, attempt + 1);
  }
  if (!res.ok) {
    throw new Error(
      `Loop /subscription ACTIVE pageNo=${pageNo} → ${res.status}: ${await res.text()}`
    );
  }
  return (await res.json()) as LoopPage;
}

function subTier(sub: LoopSubRow): "access" | "member" | null {
  const line = sub.lines?.[0];
  if (!line) return null;
  const tier = resolveMemberTierFromVariantId(line.variantShopifyId);
  return tier ?? null;
}

// ─── Rock 2: Swaps from Loop ACTIVE ───────────────────────────────────────────

interface SwapResult {
  access: number;
  member: number;
  earliest_active_iso: string | null;
  warnings: string[];
}

async function countSwaps(cutoffMs: number): Promise<SwapResult> {
  // Loop /subscription is sorted ASC by createdAt by default. Walk pages
  // from page 1; the moment we see a row with createdAt >= cutoff we know
  // every subsequent row is a new signup (not a swap) so we can stop.
  let access = 0;
  let member = 0;
  let earliest: number | null = null;
  const warnings: string[] = [];

  let pageNo = 1;
  outer: while (pageNo <= 200) {
    const page = await fetchLoopActivePage(pageNo);
    for (const sub of page.data) {
      const createdMs = Date.parse(sub.createdAt);
      if (!Number.isFinite(createdMs)) continue;
      if (createdMs >= cutoffMs) {
        // First row at or past the cutoff — done.
        break outer;
      }
      const tier = subTier(sub);
      if (!tier) continue; // skip non-Reserve active subs (e.g. Back 9 legacy)
      if (tier === "access") access++;
      else member++;
      earliest = earliest === null ? createdMs : Math.min(earliest, createdMs);
    }
    if (!page.pageInfo?.hasNextPage) break;
    pageNo++;
  }

  if (pageNo >= 200) {
    warnings.push("Loop swap scan stopped at safety cap (200 pages)");
  }

  return {
    access,
    member,
    earliest_active_iso: earliest ? new Date(earliest).toISOString() : null,
    warnings,
  };
}

// ─── Rock 1: New signups from Shopify GraphQL ─────────────────────────────────

interface ShopifyOrderNode {
  id: string;
  createdAt: string;
  tags: string[];
  displayFinancialStatus: string | null;
  lineItems: { edges: Array<{ node: { title: string } }> };
  cancelledAt?: string | null;
}

interface ShopifyOrdersResponse {
  data?: {
    orders: {
      edges: Array<{ node: ShopifyOrderNode; cursor: string }>;
      pageInfo: { hasNextPage: boolean; endCursor: string | null };
    };
  };
  errors?: Array<{ message: string }>;
}

function tierFromTitles(titles: string[]): "access" | "member" | null {
  const lc = titles.map((t) => t.toLowerCase());
  if (lc.some((t) => t.includes("reserve access"))) return "access";
  if (lc.some((t) => t.includes("reserve member"))) return "member";
  return null;
}

interface SignupResult {
  access: number;
  member: number;
  by_status: { ACTIVE: number; CANCELLED: number; PAUSED: number };
  first_signup_iso: string | null;
  latest_signup_iso: string | null;
  warnings: string[];
}

async function countNewSignups(cutoffIso: string): Promise<SignupResult> {
  const token =
    process.env.SHOPIFY_ADMIN_TOKEN ?? process.env.SHOPIFY_CLIENT_SECRET;
  const domain = process.env.SHOPIFY_STORE_DOMAIN;
  const version = process.env.SHOPIFY_ADMIN_API_VERSION ?? "2024-10";
  if (!token || !domain) {
    throw new Error("Missing Shopify credentials");
  }

  // Shopify search syntax: tag:"Subscription First Order" created_at:>=YYYY-MM-DD
  // The date portion of the ISO is sufficient.
  const cutoffDate = cutoffIso.slice(0, 10);
  const searchQuery = `tag:"Subscription First Order" created_at:>=${cutoffDate}`;

  const url = `https://${domain}/admin/api/${version}/graphql.json`;

  let access = 0;
  let member = 0;
  const byStatus = { ACTIVE: 0, CANCELLED: 0, PAUSED: 0 };
  let firstMs: number | null = null;
  let latestMs: number | null = null;
  const warnings: string[] = [];

  let cursor: string | null = null;
  let pages = 0;
  // 250 orders per page; cap at 8 pages = 2000 orders (way more than needed)
  while (pages < 8) {
    const after: string = cursor ? `, after: "${cursor}"` : "";
    const gqlQuery = `query {
      orders(first: 250, query: ${JSON.stringify(searchQuery)}, sortKey: CREATED_AT, reverse: true${after}) {
        edges {
          cursor
          node {
            id
            createdAt
            tags
            displayFinancialStatus
            cancelledAt
            lineItems(first: 10) {
              edges { node { title } }
            }
          }
        }
        pageInfo { hasNextPage endCursor }
      }
    }`;

    const res = await fetch(url, {
      method: "POST",
      headers: {
        "X-Shopify-Access-Token": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ query: gqlQuery }),
    });
    if (!res.ok) {
      throw new Error(`Shopify GraphQL → ${res.status}: ${await res.text()}`);
    }
    const json = (await res.json()) as ShopifyOrdersResponse;
    if (json.errors && json.errors.length > 0) {
      throw new Error(
        `Shopify GraphQL errors: ${json.errors.map((e) => e.message).join("; ")}`
      );
    }
    const edges = json.data?.orders?.edges ?? [];
    for (const { node } of edges) {
      const titles = node.lineItems.edges.map((e) => e.node.title);
      const tier = tierFromTitles(titles);
      if (!tier) continue; // Not a Reserve signup (e.g. Back 9 first order)
      if (tier === "access") access++;
      else member++;

      // Status bucket — Shopify doesn't carry the live Loop sub status on
      // the original first-order. We approximate using the order's
      // cancelled state as a proxy: cancelled order ≈ subscription likely
      // cancelled. This won't catch later cancellations or pauses, but
      // it's a useful "how many of these stuck?" signal.
      if (node.cancelledAt) byStatus.CANCELLED++;
      else byStatus.ACTIVE++;

      const createdMs = Date.parse(node.createdAt);
      if (Number.isFinite(createdMs)) {
        firstMs = firstMs === null ? createdMs : Math.min(firstMs, createdMs);
        latestMs = latestMs === null ? createdMs : Math.max(latestMs, createdMs);
      }
    }
    const pi = json.data?.orders?.pageInfo;
    if (!pi?.hasNextPage || !pi.endCursor) break;
    cursor = pi.endCursor;
    pages++;
  }

  if (pages >= 8) {
    warnings.push("Shopify signup scan stopped at safety cap (8 pages)");
  }

  return {
    access,
    member,
    by_status: byStatus,
    first_signup_iso: firstMs ? new Date(firstMs).toISOString() : null,
    latest_signup_iso: latestMs ? new Date(latestMs).toISOString() : null,
    warnings,
  };
}

// ─── In-process cache ─────────────────────────────────────────────────────────
let CACHED: { at: number; data: RocksData } | null = null;
const TTL_MS = 5 * 60 * 1000;

export async function getRocksProgress(
  cutoffIso: string = DEFAULT_CUTOFF_ISO
): Promise<RocksData> {
  const now = Date.now();
  if (CACHED && now - CACHED.at < TTL_MS && CACHED.data.cutoff_iso === cutoffIso) {
    return CACHED.data;
  }

  const cutoffMs = new Date(cutoffIso).getTime();

  // Run both rocks in parallel — they hit different APIs.
  const [signupsRes, swapsRes] = await Promise.all([
    countNewSignups(cutoffIso),
    countSwaps(cutoffMs),
  ]);

  const data: RocksData = {
    cutoff_iso: cutoffIso,
    generated_at: new Date().toISOString(),
    new_signups: {
      goal: ROCK_NEW_SIGNUPS_GOAL,
      total: signupsRes.access + signupsRes.member,
      access: signupsRes.access,
      member: signupsRes.member,
      by_status: signupsRes.by_status,
      first_signup_iso: signupsRes.first_signup_iso,
      latest_signup_iso: signupsRes.latest_signup_iso,
    },
    swaps: {
      goal: ROCK_SWAPS_GOAL,
      total: swapsRes.access + swapsRes.member,
      access: swapsRes.access,
      member: swapsRes.member,
      earliest_active_iso: swapsRes.earliest_active_iso,
    },
    warnings: [...signupsRes.warnings, ...swapsRes.warnings],
  };

  CACHED = { at: now, data };
  return data;
}
