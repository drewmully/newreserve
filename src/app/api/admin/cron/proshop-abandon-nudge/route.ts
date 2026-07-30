/**
 * GET /api/admin/cron/proshop-abandon-nudge
 *
 * Sends a single soft nudge to users who fired `proshop_quick_add_clicked`
 * (or `add_to_cart` against the Pro Shop) ~24h ago and have NOT completed
 * a purchase since.
 *
 * Cadence: runs hourly. For each candidate we send AT MOST ONE nudge per
 * (uid, product_slug) ever — enforced via Firestore doc id idempotency.
 *
 * Anti-spam guards:
 *   - Only paid members (the public-shop add can't be attributed to a uid).
 *   - Window is 22h–28h after the add (≥22h so we wait a full sleep cycle,
 *     ≤28h so we don't keep nagging stale carts).
 *   - Skip if user has a `purchase` event after the add timestamp.
 *   - Skip if user opted out via users/{uid}.email_preferences.proshop_nudges = false
 *   - Skip if a doc at `proshop_nudge_sent/{uid}__{slug}` already exists.
 *
 * Wire to vercel.json:
 *   { "path": "/api/admin/cron/proshop-abandon-nudge", "schedule": "5 * * * *" }
 */

import { NextRequest, NextResponse } from "next/server";
import { FieldValue } from "firebase-admin/firestore";
import { adminDb } from "@/lib/firebase-admin";
import { sendPlainText } from "@/lib/email/resend";
import { proShopAbandonTemplate } from "@/lib/email/templates/proshopAbandon";
import { getCollectionProducts, PRO_SHOP_COLLECTION_HANDLE } from "@/lib/shopify";

export const runtime = "nodejs";
export const maxDuration = 300;
export const dynamic = "force-dynamic";

const PAID_TIERS = new Set(["access", "member", "black"]);

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

interface AbandonCandidate {
  uid: string;
  productSlug: string;
  addedAt: string;
}

/**
 * Returns users who fired a Pro Shop add 22-28h ago and have NOT purchased
 * since. We dedupe per (uid, slug) and keep the most recent add.
 */
async function fetchAbandonCandidates(): Promise<AbandonCandidate[]> {
  const sql = `
    WITH adds AS (
      SELECT
        person_id AS uid,
        properties.product_slug AS slug,
        max(timestamp) AS added_at
      FROM events
      WHERE event IN ('proshop_quick_add_clicked', 'add_to_cart')
        AND timestamp BETWEEN now() - INTERVAL 28 HOUR AND now() - INTERVAL 22 HOUR
        AND properties.product_slug IS NOT NULL
        AND properties.product_slug != ''
        AND (
          properties.collection_handle = '${PRO_SHOP_COLLECTION_HANDLE}'
          OR properties.source_context IN ('dashboard-shop', 'public-shop')
        )
      GROUP BY uid, slug
    ),
    purchases AS (
      SELECT DISTINCT person_id AS uid
      FROM events
      WHERE event = 'purchase'
        AND timestamp > now() - INTERVAL 36 HOUR
    )
    SELECT adds.uid, adds.slug, toString(adds.added_at)
    FROM adds
    LEFT JOIN purchases ON purchases.uid = adds.uid
    WHERE purchases.uid IS NULL
      AND adds.uid IS NOT NULL
    ORDER BY adds.added_at DESC
    LIMIT 200
  `;
  try {
    const resp = await runHogQL(sql);
    return (resp.results ?? [])
      .map((row) => ({
        uid: typeof row[0] === "string" ? row[0] : null,
        productSlug: typeof row[1] === "string" ? row[1] : null,
        addedAt: typeof row[2] === "string" ? row[2] : "",
      }))
      .filter((r): r is AbandonCandidate =>
        Boolean(r.uid && r.productSlug)
      );
  } catch (err) {
    console.error("[proshop-abandon-nudge] HogQL error:", err);
    return [];
  }
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const candidates = await fetchAbandonCandidates();
    if (candidates.length === 0) {
      return NextResponse.json({ status: "ok", sent: 0, reason: "no_candidates" });
    }

    // Pull product metadata once.
    const products = await getCollectionProducts(PRO_SHOP_COLLECTION_HANDLE);
    const bySlug = new Map(products.map((p) => [p.slug, p]));

    const results: Array<{ uid: string; slug: string; status: string; err?: string }> = [];

    for (const c of candidates) {
      const product = bySlug.get(c.productSlug);
      if (!product) {
        results.push({ uid: c.uid, slug: c.productSlug, status: "skip_no_product" });
        continue;
      }

      // Idempotency: one nudge per (uid, slug). Use Firestore as the
      // backstop — PostHog person_id may or may not be our Firebase uid,
      // and we don't want to double-email on cron overlap.
      const dedupeId = `${c.uid}__${c.productSlug}`.replace(/[^a-zA-Z0-9_-]/g, "_");
      const nudgeRef = adminDb.collection("proshop_nudge_sent").doc(dedupeId);
      const existing = await nudgeRef.get();
      if (existing.exists) {
        results.push({ uid: c.uid, slug: c.productSlug, status: "skip_already_sent" });
        continue;
      }

      // Look up the user record. PostHog person_id is set to the Firebase
      // uid via posthog.identify(uid) — if it isn't (anon person), skip.
      const userSnap = await adminDb.collection("users").doc(c.uid).get();
      if (!userSnap.exists) {
        results.push({ uid: c.uid, slug: c.productSlug, status: "skip_no_user" });
        continue;
      }
      const userData = userSnap.data() as Record<string, unknown>;
      const tier = String(userData.tier ?? "").toLowerCase();
      if (!PAID_TIERS.has(tier)) {
        results.push({ uid: c.uid, slug: c.productSlug, status: "skip_not_paid" });
        continue;
      }
      const email = typeof userData.email === "string" ? userData.email : null;
      if (!email) {
        results.push({ uid: c.uid, slug: c.productSlug, status: "skip_no_email" });
        continue;
      }
      const optedOut =
        (userData.email_preferences as Record<string, unknown> | undefined)
          ?.proshop_nudges === false;
      if (optedOut) {
        results.push({ uid: c.uid, slug: c.productSlug, status: "skip_opted_out" });
        continue;
      }

      const firstName =
        typeof userData.first_name === "string"
          ? userData.first_name
          : typeof (userData as { firstName?: unknown }).firstName === "string"
            ? ((userData as { firstName?: string }).firstName ?? null)
            : null;

      const { subject, text } = proShopAbandonTemplate({
        firstName,
        productName: product.name,
        productBrand: product.brand,
        productShopPath: `/shop/${product.slug}?utm_source=resend&utm_medium=email&utm_campaign=proshop_abandon_nudge&utm_content=${encodeURIComponent(product.slug)}`,
      });

      try {
        await sendPlainText({
          to: email,
          subject,
          text,
          idempotencyKey: `proshop-abandon-${dedupeId}`,
          sendClass: "lifecycle",
          flow: "proshop_abandon",
          category: "proshop_abandon",
          utmCampaign: "proshop_abandon_nudge",
          utmContent: product.slug,
          tags: [
            { name: "category", value: "proshop_abandon" },
            { name: "product_slug", value: product.slug },
          ],
        });
        await nudgeRef.set({
          uid: c.uid,
          product_slug: c.productSlug,
          email,
          added_at: c.addedAt,
          sent_at: FieldValue.serverTimestamp(),
          source: "cron",
        });
        results.push({ uid: c.uid, slug: c.productSlug, status: "sent" });
        // Pace below Resend's 5/sec ceiling. Sequential loop with 250ms.
        await new Promise((r) => setTimeout(r, 250));
      } catch (err) {
        results.push({
          uid: c.uid,
          slug: c.productSlug,
          status: "error",
          err: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({
      status: "ok",
      candidate_count: candidates.length,
      results,
      totals: {
        sent: results.filter((r) => r.status === "sent").length,
        skipped: results.filter((r) => r.status.startsWith("skip")).length,
        errors: results.filter((r) => r.status === "error").length,
      },
    });
  } catch (err) {
    console.error("[proshop-abandon-nudge] fatal:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
