/**
 * GET /api/admin/cron/marketing-funnel-snapshot
 *
 * Hourly cron that pre-computes the marketing-funnel dashboard data and
 * writes it to `public.marketing_funnel_snapshots` so the page loads
 * instantly. The cron hits the existing funnel + rocks routes with an
 * authorization header so the cached payload is exactly what the
 * dashboard would render, no duplicated compute logic.
 *
 * Auth: Bearer CRON_SECRET, or vercel-cron user-agent (set by vercel.json).
 *
 * Default window: same as the dashboard's default (last 7 days).
 */

import { NextRequest, NextResponse } from "next/server";
import { pruneOldSnapshots } from "@/app/api/_lib/funnelSnapshot";

export const runtime = "nodejs";
export const maxDuration = 300;

function isAuthorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  if (req.headers.get("authorization") === `Bearer ${secret}`) return true;
  return (req.headers.get("user-agent") || "").includes("vercel-cron");
}

function defaultWindow(): { start: string; end: string } {
  const end = new Date();
  const start = new Date(end.getTime() - 6 * 24 * 60 * 60 * 1000);
  const fmt = (d: Date) => d.toISOString().slice(0, 10);
  return { start: fmt(start), end: fmt(end) };
}

function baseUrl(req: NextRequest): string {
  // Prefer VERCEL_URL (deployment-stable) over the incoming Host header so
  // the cron always hits the deployment it's running on, even for previews.
  const env = process.env.VERCEL_URL;
  if (env) return env.startsWith("http") ? env : `https://${env}`;
  const host = req.headers.get("host") ?? "localhost:3000";
  const proto = req.headers.get("x-forwarded-proto") ?? "https";
  return `${proto}://${host}`;
}

async function callInternal(
  url: string,
  label: string
): Promise<{ ok: boolean; status: number; ms: number; error?: string }> {
  const secret = process.env.CRON_SECRET;
  const startedAt = Date.now();
  try {
    const res = await fetch(url, {
      headers: secret
        ? { authorization: `Bearer ${secret}` }
        : undefined,
      cache: "no-store",
    });
    const ms = Date.now() - startedAt;
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      return {
        ok: false,
        status: res.status,
        ms,
        error: `${label} ${res.status}: ${text.slice(0, 200)}`,
      };
    }
    // Force the body to be read so the snapshot write inside the route
    // has time to begin (the route fires writeSnapshot as a Promise that
    // runs in the same isolate; awaiting response body keeps the isolate
    // alive long enough).
    await res.json().catch(() => null);
    return { ok: true, status: res.status, ms };
  } catch (err) {
    return {
      ok: false,
      status: 0,
      ms: Date.now() - startedAt,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

export async function GET(req: NextRequest): Promise<NextResponse> {
  if (!isAuthorized(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const startedAt = Date.now();
  const { start, end } = defaultWindow();
  const base = baseUrl(req);

  // Trigger both subroutes; each writes its own snapshot row.
  const [funnel, rocks] = await Promise.all([
    callInternal(
      `${base}/api/admin/marketing-funnel?start=${start}&end=${end}`,
      "funnel"
    ),
    callInternal(`${base}/api/admin/marketing-funnel/rocks`, "rocks"),
  ]);

  // Best-effort prune of rows older than retention window.
  let pruned: number | null = null;
  let pruneError: string | null = null;
  try {
    pruned = await pruneOldSnapshots(14);
  } catch (err) {
    pruneError = err instanceof Error ? err.message : String(err);
  }

  return NextResponse.json({
    ok: funnel.ok && rocks.ok,
    window: { start, end },
    funnel,
    rocks,
    pruned,
    prune_error: pruneError,
    total_ms: Date.now() - startedAt,
  });
}
