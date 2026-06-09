/**
 * GET /api/admin/cron/proshop-weekly-digest
 *
 * Weekly digest of trending Pro Shop products, sent to all paid members
 * (tier in {access, member, black}) every Wednesday at 14:00 UTC (~10am ET).
 *
 * Pipeline:
 *   1. Query PostHog HogQL for `add_to_cart` events in the last 7 days where
 *      `collection_handle = "reserve-pro-shop"`. Bucket by product slug, rank
 *      by unique users.
 *   2. Fetch the matching Shopify product names/brands/member-prices via the
 *      Pro Shop collection.
 *   3. For each paid member, queue a personalized "This week in the Pro Shop"
 *      email via Resend. Idempotency key is per-week-per-uid so re-runs in
 *      the same week are no-ops.
 *
 * Auth: same CRON_SECRET / vercel-cron pattern as other crons in this dir.
 *
 * Wire to vercel.json:
 *   { "path": "/api/admin/cron/proshop-weekly-digest", "schedule": "0 14 * * 3" }
 *   (Wed 14:00 UTC = Wed 10:00 ET).
 */

import { NextRequest, NextResponse } from "next/server";
import { adminDb } from "@/lib/firebase-admin";
import { sendPlainText } from "@/lib/email/resend";
import { proShopWeeklyTemplate } from "@/lib/email/templates/proshopWeekly";
import {
  getCollectionProducts,
  PRO_SHOP_COLLECTION_HANDLE,
  MEMBER_DISCOUNT_RATE,
} from "@/lib/shopify";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const PAID_TIERS = new Set(["access", "member", "black"]);
const PRO_SHOP_HANDLE = PRO_SHOP_COLLECTION_HANDLE;
const TOP_N = 5;

function authorized(request: NextRequest): boolean {
  const header = request.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && token === cronSecret) return true;
  const ua = request.headers.get("user-agent") ?? "";
  if (cronSecret && ua.includes("vercel-cron")) return true;
  return false;
}

interface HogQLResponse {
  results?: Array<Array<string | number | null>>;
}

async function runHogQL(query: string): Promise<HogQLResponse> {
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
  if (!projectId || !apiKey) return {};
  const res = await fetch(`${host}/api/projects/${projectId}/query/`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query: { kind: "HogQLQuery", query } }),
    signal: AbortSignal.timeout(30000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`PostHog HogQL failed: ${res.status} ${text.slice(0, 200)}`);
  }
  return (await res.json()) as HogQLResponse;
}

/**
 * Returns up to TOP_N product slugs ranked by unique users who fired
 * `add_to_cart` against the Pro Shop in the last 7d. Falls back to an
 * empty array if PostHog is unconfigured — the digest then quietly skips
 * the send for this week (no spam, no half-baked emails).
 */
async function fetchTrendingProductSlugs(): Promise<string[]> {
  // Accept both legacy and current handle/collection naming. The PostHog
  // properties we set vary across older client builds — be lenient.
  const sql = `
    SELECT
      properties.product_slug AS slug,
      count(DISTINCT person_id) AS users
    FROM events
    WHERE event = 'add_to_cart'
      AND timestamp > now() - INTERVAL 7 DAY
      AND properties.product_slug IS NOT NULL
      AND properties.product_slug != ''
      AND (
        properties.collection_handle = '${PRO_SHOP_HANDLE}'
        OR properties.source_context IN ('dashboard-shop', 'public-shop')
      )
    GROUP BY slug
    ORDER BY users DESC
    LIMIT ${TOP_N}
  `;
  try {
    const resp = await runHogQL(sql);
    return (resp.results ?? [])
      .map((row) => (typeof row[0] === "string" ? row[0] : null))
      .filter((s): s is string => Boolean(s));
  } catch (err) {
    console.error("[proshop-weekly-digest] HogQL error:", err);
    return [];
  }
}

function isoWeekKey(d: Date = new Date()): string {
  // ISO week-of-year (e.g. "2026-W23") so the idempotency key collapses
  // multiple Wednesday runs into the same logical batch.
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dayNr = (target.getUTCDay() + 6) % 7;
  target.setUTCDate(target.getUTCDate() - dayNr + 3);
  const firstThursday = new Date(Date.UTC(target.getUTCFullYear(), 0, 4));
  const week =
    1 +
    Math.round(
      ((target.getTime() - firstThursday.getTime()) / 86400000 -
        3 +
        ((firstThursday.getUTCDay() + 6) % 7)) /
        7
    );
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    // Step 1 — top trending slugs from PostHog.
    const slugs = await fetchTrendingProductSlugs();
    if (slugs.length === 0) {
      return NextResponse.json({
        status: "skipped",
        reason: "no_trending_slugs",
      });
    }

    // Step 2 — hydrate product metadata from the live Pro Shop collection.
    const products = await getCollectionProducts(PRO_SHOP_HANDLE);
    const bySlug = new Map(products.map((p) => [p.slug, p]));
    const ordered = slugs
      .map((slug) => bySlug.get(slug))
      .filter((p): p is NonNullable<typeof p> => Boolean(p));

    if (ordered.length === 0) {
      return NextResponse.json({
        status: "skipped",
        reason: "no_products_matched",
        candidate_slugs: slugs,
      });
    }

    const digestProducts = ordered.map((p) => ({
      name: p.name,
      brand: p.brand,
      memberPrice: `$${(p.price * (1 - MEMBER_DISCOUNT_RATE)).toFixed(2)}`,
      shopPath: `/shop/${p.slug}?utm_source=resend&utm_medium=email&utm_campaign=proshop_weekly_digest&utm_content=${encodeURIComponent(p.slug)}`,
    }));

    // Step 3 — fan out to paid members.
    const usersSnap = await adminDb.collection("users").get();
    const weekKey = isoWeekKey();

    const results: Array<{ uid: string; email: string; status: string; err?: string }> = [];

    // Run a small concurrency pool so we don't hammer Resend.
    const queue = [] as Array<{ uid: string; email: string; firstName: string | null }>;
    usersSnap.forEach((doc) => {
      const data = doc.data() as Record<string, unknown>;
      const tier = String(data.tier ?? "").toLowerCase();
      if (!PAID_TIERS.has(tier)) return;
      const email = typeof data.email === "string" ? data.email : null;
      if (!email) return;
      const optedOut = (data.email_preferences as Record<string, unknown> | undefined)?.proshop_digest === false;
      if (optedOut) return;
      const firstName =
        typeof data.first_name === "string"
          ? data.first_name
          : typeof (data as { firstName?: unknown }).firstName === "string"
            ? ((data as { firstName?: string }).firstName ?? null)
            : null;
      queue.push({ uid: doc.id, email, firstName });
    });

    // Resend free-tier ceiling is 5 req/sec. Stay under by capping concurrency
    // at 3 and pacing each worker by ~300ms between sends.
    const CONCURRENCY = 3;
    const SEND_PACE_MS = 300;
    let cursor = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (cursor < queue.length) {
          const idx = cursor++;
          const u = queue[idx];
          const { subject, text } = proShopWeeklyTemplate({
            firstName: u.firstName,
            products: digestProducts,
          });
          try {
            await sendPlainText({
              to: u.email,
              subject,
              text,
              idempotencyKey: `proshop-weekly-${weekKey}-${u.uid}`,
              utmCampaign: "proshop_weekly_digest",
              utmContent: weekKey,
              tags: [
                { name: "category", value: "proshop_weekly" },
                { name: "week", value: weekKey },
              ],
            });
            results.push({ uid: u.uid, email: u.email, status: "sent" });
            await new Promise((r) => setTimeout(r, SEND_PACE_MS));
          } catch (err) {
            results.push({
              uid: u.uid,
              email: u.email,
              status: "error",
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      })
    );

    return NextResponse.json({
      status: "ok",
      week: weekKey,
      products: digestProducts,
      audience: queue.length,
      results: results.slice(0, 50),
      totals: {
        sent: results.filter((r) => r.status === "sent").length,
        errors: results.filter((r) => r.status === "error").length,
      },
    });
  } catch (err) {
    console.error("[proshop-weekly-digest] fatal:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
