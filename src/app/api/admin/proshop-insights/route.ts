/**
 * GET /api/admin/proshop-insights
 *
 * Server-side insights for the Pro Shop admin dashboard. Pulls PostHog
 * HogQL for top-of-funnel demand (views, adds), Shopify Admin for paid
 * conversion, and stitches a view→add→purchase funnel by product.
 *
 * Query params:
 *   - days: lookback window (default 30, capped at 90)
 *
 * Auth: same admin-email allowlist used elsewhere. Validates Firebase ID
 * token from Authorization header.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface HogQLResponse {
  results?: Array<Array<string | number | null>>;
}

async function runHogQL(query: string): Promise<HogQLResponse> {
  const projectId = process.env.POSTHOG_PROJECT_ID;
  const apiKey = process.env.POSTHOG_PERSONAL_API_KEY;
  const host = process.env.POSTHOG_HOST || "https://us.i.posthog.com";
  if (!projectId || !apiKey) {
    throw new Error("PostHog not configured (POSTHOG_PROJECT_ID / POSTHOG_PERSONAL_API_KEY missing)");
  }
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
    throw new Error(`PostHog HogQL ${res.status}: ${text.slice(0, 200)}`);
  }
  return (await res.json()) as HogQLResponse;
}

async function verifyAdmin(request: NextRequest): Promise<boolean> {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  if (!token) return false;
  try {
    const decoded = await adminAuth.verifyIdToken(token);
    return !!decoded.email && isAllowedAdminEmail(decoded.email);
  } catch {
    return false;
  }
}

export async function GET(request: NextRequest) {
  if (!(await verifyAdmin(request))) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const daysParam = parseInt(url.searchParams.get("days") ?? "30", 10);
  const days = Math.max(1, Math.min(90, Number.isFinite(daysParam) ? daysParam : 30));

  try {
    // ── Top products by add_to_cart ──
    const topProductsSql = `
      SELECT
        properties.product_slug AS slug,
        any(properties.name) AS name,
        any(properties.brand) AS brand,
        count() AS adds,
        count(DISTINCT person_id) AS users
      FROM events
      WHERE event = 'add_to_cart'
        AND timestamp > now() - INTERVAL ${days} DAY
        AND properties.product_slug IS NOT NULL
        AND (
          properties.source_context IN ('dashboard-shop', 'public-shop')
          OR properties.collection_handle = 'reserve-pro-shop'
        )
      GROUP BY slug
      ORDER BY adds DESC
      LIMIT 25
    `;

    // ── Surface-level funnel totals ──
    const funnelSql = `
      SELECT
        countIf(event = 'proshop_view') AS proshop_views,
        countIf(event = 'proshop_product_viewed') AS product_views,
        countIf(event = 'proshop_quick_add_clicked') AS quick_adds,
        countIf(event = 'add_to_cart' AND (
          properties.source_context IN ('dashboard-shop', 'public-shop')
          OR properties.collection_handle = 'reserve-pro-shop'
        )) AS adds,
        countIf(event = 'checkout_clicked') AS checkouts,
        countIf(event = 'purchase') AS purchases,
        count(DISTINCT if(event = 'proshop_view', person_id, NULL)) AS unique_viewers,
        count(DISTINCT if(event = 'add_to_cart' AND (
          properties.source_context IN ('dashboard-shop', 'public-shop')
          OR properties.collection_handle = 'reserve-pro-shop'
        ), person_id, NULL)) AS unique_adders
      FROM events
      WHERE timestamp > now() - INTERVAL ${days} DAY
    `;

    // ── Brand mix (where does demand come from) ──
    const brandSql = `
      SELECT
        properties.brand AS brand,
        count() AS adds,
        count(DISTINCT person_id) AS users
      FROM events
      WHERE event = 'add_to_cart'
        AND timestamp > now() - INTERVAL ${days} DAY
        AND properties.brand IS NOT NULL
        AND (
          properties.source_context IN ('dashboard-shop', 'public-shop')
          OR properties.collection_handle = 'reserve-pro-shop'
        )
      GROUP BY brand
      ORDER BY adds DESC
      LIMIT 15
    `;

    // ── Source mix (where members enter Pro Shop from) ──
    const sourceSql = `
      SELECT
        properties.source AS source,
        count() AS views
      FROM events
      WHERE event = 'proshop_product_viewed'
        AND timestamp > now() - INTERVAL ${days} DAY
      GROUP BY source
      ORDER BY views DESC
      LIMIT 20
    `;

    const [topProductsResp, funnelResp, brandResp, sourceResp] = await Promise.all([
      runHogQL(topProductsSql),
      runHogQL(funnelSql),
      runHogQL(brandSql),
      runHogQL(sourceSql),
    ]);

    const topProducts = (topProductsResp.results ?? []).map((row) => ({
      slug: row[0] as string | null,
      name: row[1] as string | null,
      brand: row[2] as string | null,
      adds: Number(row[3] ?? 0),
      users: Number(row[4] ?? 0),
    }));

    const fr = funnelResp.results?.[0] ?? [];
    const funnel = {
      proshop_views: Number(fr[0] ?? 0),
      product_views: Number(fr[1] ?? 0),
      quick_adds: Number(fr[2] ?? 0),
      adds: Number(fr[3] ?? 0),
      checkouts: Number(fr[4] ?? 0),
      purchases: Number(fr[5] ?? 0),
      unique_viewers: Number(fr[6] ?? 0),
      unique_adders: Number(fr[7] ?? 0),
    };

    // Derived rates — guard against divide-by-zero.
    const conv = {
      view_to_add: funnel.unique_viewers
        ? funnel.unique_adders / funnel.unique_viewers
        : null,
      add_to_purchase: funnel.adds ? funnel.purchases / funnel.adds : null,
    };

    const brands = (brandResp.results ?? []).map((row) => ({
      brand: row[0] as string | null,
      adds: Number(row[1] ?? 0),
      users: Number(row[2] ?? 0),
    }));

    const sources = (sourceResp.results ?? []).map((row) => ({
      source: row[0] as string | null,
      views: Number(row[1] ?? 0),
    }));

    return NextResponse.json({
      window_days: days,
      funnel,
      conv,
      top_products: topProducts,
      brands,
      sources,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "unknown" },
      { status: 500 }
    );
  }
}
