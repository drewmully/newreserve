/**
 * GET /api/admin/ad-performance/organic
 *
 * Reads pre-aggregated organic-traffic snapshots from Supabase and returns the
 * Organic tab payload. ?start=YYYY-MM-DD&end=YYYY-MM-DD (defaults: last 7 days).
 *
 * If ?live=1 is passed, triggers refreshOrganicPerformance first — useful for
 * a "refresh now" button without waiting for the next cron tick.
 *
 * Auth: Firebase Bearer token + admin email allowlist.
 *
 * Benchmarks: % step-rates only (no cost-per — organic has no spend).
 * Funnel is collapsed — LP views removed at Drew's request, so step 1 is
 * session → profile directly.
 * - Profile rate (session → profile completed): 5–15% — organic sessions are
 *   noisy (homepage, blog, social hops); only a small share actually finishes
 *   the style profile. Drew can tighten this once we see 30–60 days of data.
 * - Checkout rate (profile → checkout started): 30–50% — reuses paid band.
 * - Purchase rate (checkout → purchase): 40–60% — anchored to Drew's 50%
 *   close-rate assumption.
 */

import { NextRequest, NextResponse } from "next/server";
import { adminAuth } from "@/lib/firebase-admin";
import { isAllowedAdminEmail } from "@/lib/adminEmailAllowlist";
import { getSupabaseService } from "@/app/api/_lib/supabaseService";
import {
  refreshOrganicPerformance,
  ORGANIC_SOURCES,
  SOURCE_LABEL_BY_SLUG,
} from "@/app/api/_lib/organicPerformance";

export const runtime = "nodejs";
export const maxDuration = 60;

async function verifyAdmin(req: NextRequest): Promise<void> {
  const header = req.headers.get("Authorization") ?? "";
  const token = header.replace(/^Bearer\s+/i, "").trim();
  if (!token) throw new Error("Missing Authorization header");
  const decoded = await adminAuth.verifyIdToken(token, true);
  if (!decoded.email || !isAllowedAdminEmail(decoded.email)) {
    throw new Error("Forbidden");
  }
}

function defaultWindow(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  try {
    await verifyAdmin(req);
  } catch (err) {
    const msg = err instanceof Error ? err.message : "unauthorized";
    return NextResponse.json({ error: msg }, { status: 401 });
  }

  const url = new URL(req.url);
  const { start: defStart, end: defEnd } = defaultWindow();
  const start = url.searchParams.get("start") || defStart;
  const end = url.searchParams.get("end") || defEnd;
  const live = url.searchParams.get("live") === "1";

  if (live) {
    try {
      const days = Math.max(
        2,
        Math.ceil(
          (new Date(end).getTime() - new Date(start).getTime()) /
            (24 * 60 * 60 * 1000)
        ) + 1
      );
      await refreshOrganicPerformance(Math.min(days, 30));
    } catch (err) {
      console.error("[ad-performance/organic] live refresh failed", err);
    }
  }

  const sb = getSupabaseService();
  const snapsRes = await sb
    .from("organic_performance_snapshots")
    .select("*")
    .gte("snapshot_date", start)
    .lte("snapshot_date", end)
    .order("snapshot_date", { ascending: true });

  if (snapsRes.error) {
    return NextResponse.json(
      { error: snapsRes.error.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    start,
    end,
    snapshots: snapsRes.data ?? [],
    sources: ORGANIC_SOURCES,
    source_labels: SOURCE_LABEL_BY_SLUG,
    // Step-rate benchmarks only. No cost-per on organic. Funnel is
    // session → profile → checkout → purchase (LP views dropped).
    benchmarks: {
      profile_rate: {
        kind: "rate" as const,
        low: 0.05,
        high: 0.15,
        label: "Session \u2192 profile (step)",
      },
      checkout_rate: {
        kind: "rate" as const,
        low: 0.3,
        high: 0.5,
        label: "Profile \u2192 checkout (step)",
      },
      purchase_rate: {
        kind: "rate" as const,
        low: 0.4,
        high: 0.6,
        label: "Checkout \u2192 purchase (step)",
      },
    },
  });
}
