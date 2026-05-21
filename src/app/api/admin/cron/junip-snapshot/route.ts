/**
 * GET /api/admin/cron/junip-snapshot
 *
 * Pulls aggregate review stats from the Junip Storefront API and writes
 * one `junip_snapshots` row per day. Idempotent on (snapshot_date).
 *
 * Junip storefront endpoint:
 *   https://api.junip.co/api/v1/store_reviews/summary
 *   header: Storefront-Access-Token: <JUNIP_STORE_KEY>
 *
 * If JUNIP_STORE_KEY is missing, the route still succeeds but writes nothing
 * and logs a soft warning in job_runs.meta.
 */

import { NextRequest, NextResponse } from "next/server";
import { getSupabaseService, withJobRun } from "@/app/api/_lib/supabaseService";

export const runtime = "nodejs";
export const maxDuration = 60;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return (req.headers.get("user-agent") || "").includes("vercel-cron");
}

export async function GET(req: NextRequest) {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const result = await withJobRun("junip-snapshot", async ({ setMeta, bumpRows }) => {
    const key = process.env.JUNIP_STORE_KEY;
    if (!key) {
      setMeta({ skipped: true, reason: "JUNIP_STORE_KEY unset" });
      return { skipped: true };
    }

    // Junip's documented summary endpoint. If it 404s we fall back to listing.
    let avgRating: number | null = null;
    let reviewCount: number | null = null;
    let raw: unknown = null;

    const summaryRes = await fetch(
      "https://api.junip.co/api/v1/store_reviews/summary",
      { headers: { "Storefront-Access-Token": key } },
    );
    if (summaryRes.ok) {
      raw = await summaryRes.json();
      const data = raw as Record<string, unknown>;
      const summary = (data?.store_review_summary || data) as Record<string, unknown>;
      avgRating = Number(summary?.average_rating ?? summary?.avg_rating ?? NaN);
      reviewCount = Number(summary?.review_count ?? summary?.count ?? NaN);
      if (!Number.isFinite(avgRating)) avgRating = null;
      if (!Number.isFinite(reviewCount)) reviewCount = null;
    } else {
      // Fallback: list reviews and compute locally (capped).
      const listRes = await fetch(
        "https://api.junip.co/api/v1/store_reviews?page=1&per_page=200",
        { headers: { "Storefront-Access-Token": key } },
      );
      if (listRes.ok) {
        raw = await listRes.json();
        const reviews =
          ((raw as Record<string, unknown>)?.store_reviews as Array<Record<string, unknown>>) ||
          [];
        if (reviews.length > 0) {
          reviewCount = reviews.length;
          avgRating =
            reviews.reduce((s, r) => s + Number(r.rating || 0), 0) / reviews.length || null;
          if (avgRating != null) avgRating = Number(avgRating.toFixed(2));
        }
      }
    }

    const today = new Date().toISOString().slice(0, 10);
    const svc = getSupabaseService();
    const { error } = await svc.from("junip_snapshots").upsert(
      {
        snapshot_date: today,
        avg_rating: avgRating,
        review_count: reviewCount,
        raw: raw as Record<string, unknown>,
      },
      { onConflict: "snapshot_date" },
    );
    if (error) throw new Error(`junip upsert: ${error.message}`);

    bumpRows(1, 1);
    setMeta({ snapshot_date: today, avg_rating: avgRating, review_count: reviewCount });
    return { snapshot_date: today, avg_rating: avgRating, review_count: reviewCount };
  });

  return NextResponse.json(result);
}
